import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const notifyDaemonSessionStarted = vi.fn();
vi.mock('@/daemon/controlClient', () => ({
    notifyDaemonSessionStarted: (...args: unknown[]) => notifyDaemonSessionStarted(...args),
}));

import { resumeExistingThread } from './resumeExistingThread';

// M2' — restore process.title after each test. resumeExistingThread.ts calls
// notifyDaemonOfCodexTid (real helper, mocked controlClient), which now sets
// process.title. Restoring here prevents leaking state into other test suites.
let originalProcessTitle: string;

beforeEach(() => {
    notifyDaemonSessionStarted.mockReset();
    notifyDaemonSessionStarted.mockResolvedValue({ status: 'ok' });
    originalProcessTitle = process.title;
});

afterEach(() => {
    process.title = originalProcessTitle;
});

describe('resumeExistingThread', () => {
    it('resumes the thread and updates session metadata', async () => {
        const client = {
            resumeThread: vi.fn().mockResolvedValue({
                threadId: '019ccca2-1a77-7481-9873-de72f3464372',
                model: 'gpt-5.4',
            }),
        };
        const metadataHandlers: Array<(metadata: any) => any> = [];
        const session = {
            updateMetadata: vi.fn((handler) => metadataHandlers.push(handler)),
            sendSessionProtocolMessage: vi.fn(),
        };
        const messageBuffer = {
            addMessage: vi.fn(),
        };

        const result = await resumeExistingThread({
            client,
            session,
            messageBuffer,
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            cwd: '/tmp/project',
            mcpServers: { happy: { command: 'happy-mcp' } },
        });

        expect(result).toEqual({
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            model: 'gpt-5.4',
        });
        expect(client.resumeThread).toHaveBeenCalledWith({
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            cwd: '/tmp/project',
            mcpServers: { happy: { command: 'happy-mcp' } },
        });
        expect(metadataHandlers).toHaveLength(1);
        expect(metadataHandlers[0]({ existing: true })).toEqual({
            existing: true,
            codexThreadId: '019ccca2-1a77-7481-9873-de72f3464372',
        });
        expect(messageBuffer.addMessage).toHaveBeenCalledWith(expect.stringContaining('Resumed thread'), 'status');
        // AC-D1 (codex#7): exactly ONE app-visible notice, a real t:'service'
        // envelope (role 'agent' per sessionProtocol.ts:120) — not the legacy
        // {type:'message'} event, and not both.
        expect(session.sendSessionProtocolMessage).toHaveBeenCalledTimes(1);
        const emitted = session.sendSessionProtocolMessage.mock.calls[0][0];
        expect(emitted.role).toBe('agent');
        expect(emitted.ev).toMatchObject({
            t: 'service',
            text: 'Resumed Codex thread 019ccca2-1a77-7481-9873-de72f3464372',
        });
        expect((session as Record<string, unknown>).sendSessionEvent).toBeUndefined();
    });

    it('AC2: fires M1 daemon re-notify with the RESULT tid (not the requested tid)', async () => {
        // codexAppServerClient.ts:856 reassigns this._threadId from the server
        // response; the result tid can differ from the requested tid.
        const requestedTid = 'requested-019d-tid-aaaa';
        const resultTid = 'result-019d-tid-bbbb';
        const client = {
            resumeThread: vi.fn().mockResolvedValue({ threadId: resultTid, model: 'gpt-5.4' }),
        };
        const session = {
            sessionId: 'happy-session-xyz',
            updateMetadata: vi.fn((handler) => handler({ existing: true })),
            sendSessionProtocolMessage: vi.fn(),
        };
        const messageBuffer = { addMessage: vi.fn() };
        await resumeExistingThread({
            client,
            session,
            messageBuffer,
            threadId: requestedTid,
            cwd: '/tmp/project',
            mcpServers: {},
        });
        expect(notifyDaemonSessionStarted).toHaveBeenCalledTimes(1);
        const [sessionIdArg, metadataArg] = notifyDaemonSessionStarted.mock.calls[0];
        expect(sessionIdArg).toBe('happy-session-xyz');
        expect(metadataArg.codexThreadId).toBe(resultTid);
        expect(metadataArg.codexThreadId).not.toBe(requestedTid);
    });

    it('skips M1 notify when session.sessionId is absent (early init path)', async () => {
        const client = {
            resumeThread: vi.fn().mockResolvedValue({ threadId: 't', model: 'gpt-5.4' }),
        };
        const session = {
            updateMetadata: vi.fn((handler) => handler({})),
            sendSessionProtocolMessage: vi.fn(),
        };
        await resumeExistingThread({
            client,
            session,
            messageBuffer: { addMessage: vi.fn() },
            threadId: 't',
            cwd: '/tmp/project',
            mcpServers: {},
        });
        expect(notifyDaemonSessionStarted).not.toHaveBeenCalled();
    });

    it('M2 AC3: resume path also sets process.title via centralized helper', async () => {
        const resultTid = '0192abcd-XXXX-YYYY-ZZZZ-RESUMETAILZ';
        const client = {
            resumeThread: vi.fn().mockResolvedValue({ threadId: resultTid, model: 'gpt-5.4' }),
        };
        const session = {
            sessionId: 'happy-resume-session',
            updateMetadata: vi.fn((handler) => handler({ existing: true })),
            sendSessionProtocolMessage: vi.fn(),
        };
        await resumeExistingThread({
            client,
            session,
            messageBuffer: { addMessage: vi.fn() },
            threadId: 'requested-tid',
            cwd: '/tmp/project',
            mcpServers: {},
        });
        // resultTid.slice(-8) = "SUMETAIL"... actually JS slice(-8) on
        // "0192abcd-XXXX-YYYY-ZZZZ-RESUMETAILZ" — count from end: "ESUMETAILZ"[-8:]
        // is the last 8 chars of the full string. Compute deterministically:
        expect(process.title).toBe(`happy-codex:${resultTid.slice(-8)}`);
        // Negative: NOT the first 8 chars (which are timestamp-heavy for UUIDv7).
        expect(process.title).not.toBe(`happy-codex:${resultTid.slice(0, 8)}`);
    });

    it('wraps backend resume errors with the thread ID', async () => {
        const client = {
            resumeThread: vi.fn().mockRejectedValue(new Error('thread not found')),
        };
        const session = {
            updateMetadata: vi.fn(),
            sendSessionProtocolMessage: vi.fn(),
        };
        const messageBuffer = {
            addMessage: vi.fn(),
        };

        await expect(
            resumeExistingThread({
                client,
                session,
                messageBuffer,
                threadId: 'thread-404',
                cwd: '/tmp/project',
                mcpServers: {},
            }),
        ).rejects.toThrow('Failed to resume Codex thread thread-404: thread not found');
    });
});
