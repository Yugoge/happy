import { describe, expect, it, vi, beforeEach } from 'vitest';

const notifyDaemonSessionStarted = vi.fn();
vi.mock('@/daemon/controlClient', () => ({
    notifyDaemonSessionStarted: (...args: unknown[]) => notifyDaemonSessionStarted(...args),
}));

import { resumeExistingThread } from './resumeExistingThread';

beforeEach(() => {
    notifyDaemonSessionStarted.mockReset();
    notifyDaemonSessionStarted.mockResolvedValue({ status: 'ok' });
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
            sendSessionEvent: vi.fn(),
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
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: 'Resumed Codex thread 019ccca2-1a77-7481-9873-de72f3464372',
        });
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
            sendSessionEvent: vi.fn(),
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
            sendSessionEvent: vi.fn(),
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

    it('wraps backend resume errors with the thread ID', async () => {
        const client = {
            resumeThread: vi.fn().mockRejectedValue(new Error('thread not found')),
        };
        const session = {
            updateMetadata: vi.fn(),
            sendSessionEvent: vi.fn(),
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
