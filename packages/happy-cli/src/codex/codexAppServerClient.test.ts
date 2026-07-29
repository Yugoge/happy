import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxConfig } from '@/persistence';

const {
    mockExecSync,
    mockInitializeSandbox,
    mockWrapForMcpTransport,
    mockSandboxCleanup,
    mockSpawn,
} = vi.hoisted(() => ({
    mockExecSync: vi.fn(),
    mockInitializeSandbox: vi.fn(),
    mockWrapForMcpTransport: vi.fn(),
    mockSandboxCleanup: vi.fn(),
    mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
    execSync: mockExecSync,
    spawn: mockSpawn,
}));

vi.mock('@/sandbox/manager', () => ({
    initializeSandbox: mockInitializeSandbox,
    wrapForMcpTransport: mockWrapForMcpTransport,
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('../package.json', () => ({
    default: { version: '0.0.1-test' },
}));

type MockRpcMessage = {
    id?: number;
    method?: string;
    params?: any;
};

function pushJsonLine(stdout: NodeJS.ReadableStream & { push: (chunk: string) => void }, payload: unknown) {
    stdout.push(JSON.stringify(payload) + '\n');
}

// Mock child process with stdin/stdout/stderr
function createMockProcess(opts?: {
    pid?: number;
    initializeDelayMs?: number;
    onRequest?: (msg: MockRpcMessage, stdout: NodeJS.ReadableStream & { push: (chunk: string) => void }) => void;
}) {
    const { Readable, Writable } = require('stream');
    const initializeDelayMs = opts?.initializeDelayMs ?? 5;
    const stdin = new Writable({ write: (_: any, __: any, cb: () => void) => cb() });
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const proc = Object.assign(new (require('events').EventEmitter)(), {
        stdin,
        stdout,
        stderr,
        pid: opts?.pid ?? 12345,
        kill: vi.fn(),
    });
    // Send initialize response immediately when stdin is written to
    const origWrite = stdin.write.bind(stdin);
    stdin.write = (data: any, ...args: any[]) => {
        try {
            const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
            if (msg.method === 'initialize' && msg.id != null) {
                // Send response on next tick
                setTimeout(() => {
                    pushJsonLine(stdout, { id: msg.id, result: { userAgent: 'test' } });
                }, initializeDelayMs);
            }
            opts?.onRequest?.(msg, stdout);
        } catch {}
        return origWrite(data, ...args);
    };
    return proc;
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error(`Timed out after ${timeoutMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

const sandboxConfig: SandboxConfig = {
    enabled: true,
    workspaceRoot: '~/projects',
    sessionIsolation: 'workspace',
    customWritePaths: [],
    denyReadPaths: ['~/.ssh'],
    extraWritePaths: ['/tmp'],
    denyWritePaths: ['.env'],
    networkMode: 'allowed',
    allowedDomains: [],
    deniedDomains: [],
    allowLocalBinding: true,
};

describe('CodexAppServerClient sandbox integration', () => {
    const originalRustLog = process.env.RUST_LOG;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.RUST_LOG = originalRustLog;
        mockExecSync.mockReturnValue('codex-cli 0.107.0');
        mockInitializeSandbox.mockResolvedValue(mockSandboxCleanup);
        mockWrapForMcpTransport.mockResolvedValue({ command: 'sh', args: ['-c', 'wrapped codex app-server'] });
        mockSpawn.mockImplementation(() => createMockProcess());
    });

    afterAll(() => {
        process.env.RUST_LOG = originalRustLog;
    });

    it('wraps transport when sandbox is enabled', async () => {
        // Dynamic import to ensure mocks are applied
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig);

        await client.connect();

        expect(mockInitializeSandbox).toHaveBeenCalledWith(sandboxConfig, process.cwd());
        expect(mockWrapForMcpTransport).toHaveBeenCalledWith('codex', ['app-server', '--listen', 'stdio://']);
        expect(mockSpawn).toHaveBeenCalledWith(
            'sh',
            ['-c', 'wrapped codex app-server'],
            expect.objectContaining({
                env: expect.objectContaining({
                    CODEX_SANDBOX: 'seatbelt',
                    RUST_LOG: expect.stringContaining('codex_core::rollout::list=off'),
                }),
            }),
        );
        expect(client.sandboxEnabled).toBe(true);

        await client.disconnect();
    });

    it('falls back to non-sandbox transport when sandbox initialization fails', async () => {
        mockInitializeSandbox.mockRejectedValue(new Error('sandbox init failed'));
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig);

        await client.connect();

        expect(mockWrapForMcpTransport).not.toHaveBeenCalled();
        expect(mockSpawn).toHaveBeenCalledWith(
            'codex',
            ['app-server', '--listen', 'stdio://'],
            expect.objectContaining({
                env: expect.objectContaining({
                    RUST_LOG: expect.stringContaining('codex_core::rollout::list=off'),
                }),
            }),
        );
        expect(client.sandboxEnabled).toBe(false);

        await client.disconnect();
    });

    it('resets sandbox on disconnect', async () => {
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig);

        await client.connect();
        await client.disconnect();

        expect(mockSandboxCleanup).toHaveBeenCalledTimes(1);
        expect(client.sandboxEnabled).toBe(false);
    });

    it('appends rollout log filter to existing RUST_LOG', async () => {
        process.env.RUST_LOG = 'info,codex_core=warn';
        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient(sandboxConfig);

        await client.connect();

        expect(mockSpawn).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({
                env: expect.objectContaining({
                    RUST_LOG: 'info,codex_core=warn,codex_core::rollout::list=off',
                }),
            }),
        );

        await client.disconnect();
    });

    it('ignores stale process exit during reconnect initialize', async () => {
        const proc1 = createMockProcess({ pid: 1001, initializeDelayMs: 5 });
        const proc2 = createMockProcess({ pid: 1002, initializeDelayMs: 50 });
        mockSpawn
            .mockImplementationOnce(() => proc1)
            .mockImplementationOnce(() => proc2);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        await client.connect();
        await client.disconnect();

        const reconnect = client.connect();
        setTimeout(() => {
            proc1.emit('exit', 0, null);
        }, 10);

        await expect(reconnect).resolves.toBeUndefined();
        await client.disconnect();
    });

    it('reconnects and resumes the same thread after forced restart timeout', async () => {
        const firstProcessRequests: MockRpcMessage[] = [];
        const secondProcessRequests: MockRpcMessage[] = [];
        type CapturedEvent = { type: string; [key: string]: unknown };

        const proc1 = createMockProcess({
            pid: 2001,
            onRequest: (msg, stdout) => {
                firstProcessRequests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-1', path: '/tmp/thread-1' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'readOnly' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, { id: msg.id, result: {} });
                        pushJsonLine(stdout, {
                            method: 'codex/event',
                            params: { msg: { type: 'task_started', turn_id: 'turn-1' } },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/interrupt' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, { id: msg.id, result: { abortReason: 'interrupted' } });
                    }, 0);
                }
            },
        });

        const proc2 = createMockProcess({
            pid: 2002,
            onRequest: (msg, stdout) => {
                secondProcessRequests.push(msg);

                if (msg.method === 'thread/resume' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-1', path: '/tmp/thread-1' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'readOnly' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, { id: msg.id, result: {} });
                        pushJsonLine(stdout, {
                            method: 'codex/event',
                            params: { msg: { type: 'task_started', turn_id: 'turn-2' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'codex/event',
                            params: { msg: { type: 'task_complete', turn_id: 'turn-2' } },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn
            .mockImplementationOnce(() => proc1)
            .mockImplementationOnce(() => proc2);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: CapturedEvent[] = [];
        client.setEventHandler((msg) => {
            events.push(msg as CapturedEvent);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'read-only',
        });

        const pendingTurn = client.sendTurnAndWait('hang forever', { turnTimeoutMs: 5000 });
        await waitFor(() => firstProcessRequests.some((msg) => msg.method === 'turn/start'));

        const abortResult = await client.abortTurnWithFallback({
            gracePeriodMs: 1,
            forceRestartOnTimeout: true,
        });

        await expect(pendingTurn).resolves.toEqual({ aborted: true });
        expect(abortResult).toEqual({
            hadActiveTurn: true,
            aborted: true,
            forcedRestart: true,
            resumedThread: true,
        });
        expect(events).toContainEqual(expect.objectContaining({
            type: 'turn_aborted',
            reason: 'interrupted',
            turn_id: 'turn-1',
            forced_restart: true,
        }));

        const resumeRequest = secondProcessRequests.find((msg) => msg.method === 'thread/resume');
        expect(resumeRequest?.params).toEqual(expect.objectContaining({
            threadId: 'thread-1',
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'read-only',
            persistExtendedHistory: true,
        }));
        expect(client.threadId).toBe('thread-1');

        await expect(client.sendTurnAndWait('follow up after reconnect')).resolves.toEqual({ aborted: false });

        await client.disconnect();
    });

    it('forwards explicit input items when starting a turn', async () => {
        const requests: MockRpcMessage[] = [];
        const proc = createMockProcess({
            pid: 2501,
            onRequest: (msg, stdout) => {
                requests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: {
                                    id: 'thread-input-items',
                                    path: '/tmp/thread-input-items',
                                },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: {
                                    id: 'turn-input-items',
                                    items: [],
                                    status: 'inProgress',
                                    error: null,
                                },
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const inputItems = [
            { type: 'text' as const, text: 'see attached image' },
            { type: 'localImage' as const, path: '/tmp/happy-attachments/image.png' },
        ];

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });
        await client.sendTurn('fallback prompt', { inputItems });

        const turnRequest = requests.find((msg) => msg.method === 'turn/start');
        expect(turnRequest?.params).toEqual(expect.objectContaining({
            threadId: 'thread-input-items',
            input: inputItems,
        }));

        await client.disconnect();
    });

    it('maps raw item notifications into legacy events and deduplicates turn completion', async () => {
        const requests: MockRpcMessage[] = [];
        const proc = createMockProcess({
            pid: 3001,
            onRequest: (msg, stdout) => {
                requests.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-raw-1', path: '/tmp/thread-raw-1' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-raw-1', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'thread/status/changed',
                            params: { threadId: 'thread-raw-1', status: { type: 'active', activeFlags: [] } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-raw-1',
                                turn: { id: 'turn-raw-1', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'commandExecution',
                                    id: 'call-1',
                                    command: '/bin/zsh -lc pwd',
                                    cwd: '/tmp/project',
                                    status: 'inProgress',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'commandExecution',
                                    id: 'call-1',
                                    command: '/bin/zsh -lc pwd',
                                    cwd: '/tmp/project',
                                    aggregatedOutput: '/tmp/project\n',
                                    exitCode: 0,
                                    durationMs: 1,
                                    status: 'completed',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turnId: 'turn-raw-1',
                                item: {
                                    type: 'agentMessage',
                                    id: 'msg-1',
                                    text: 'done',
                                    phase: 'final_answer',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'thread/status/changed',
                            params: { threadId: 'thread-raw-1', status: { type: 'idle' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/completed',
                            params: {
                                threadId: 'thread-raw-1',
                                turn: { id: 'turn-raw-1', items: [], status: 'completed', error: null },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await expect(client.sendTurnAndWait('run pwd')).resolves.toEqual({ aborted: false });

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'task_started', turn_id: 'turn-raw-1' }),
            expect.objectContaining({ type: 'exec_command_begin', callId: 'call-1', threadId: 'thread-raw-1', turnId: 'turn-raw-1' }),
            expect.objectContaining({ type: 'exec_command_end', callId: 'call-1', output: '/tmp/project\n', threadId: 'thread-raw-1', turnId: 'turn-raw-1' }),
            expect.objectContaining({ type: 'agent_message', message: 'done', threadId: 'thread-raw-1', turnId: 'turn-raw-1' }),
        ]));
        expect(events.filter((event) => event.type === 'task_complete')).toHaveLength(1);

        await client.disconnect();
    });

    it('normalizes Codex 0.144.4 subAgentActivity items and deduplicates each event id', async () => {
        const proc = createMockProcess({
            pid: 3006,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-activity', path: '/tmp/thread-activity' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        const stdout = proc.stdout as NodeJS.ReadableStream & { push: (chunk: string) => void };
        const activity = {
            method: 'item/started',
            params: {
                threadId: 'thread-activity',
                turnId: 'turn-activity',
                item: {
                    type: 'subAgentActivity',
                    id: 'call_ypdbzxxoWfNA6VPRyS4fmxyj',
                    kind: 'started',
                    agentThreadId: '019fa2e7-3fca-7100-a0e9-2c7812b9ac23',
                    agentPath: '/root/agent_render_live',
                },
            },
        };
        pushJsonLine(stdout, activity);
        pushJsonLine(stdout, activity);
        pushJsonLine(stdout, {
            method: 'item/started',
            params: {
                ...activity.params,
                item: {
                    ...activity.params.item,
                    id: 'call_ZSASUqJS1JTbg8qucYlAb8ex',
                    kind: 'interacted',
                },
            },
        });
        pushJsonLine(stdout, {
            method: 'item/started',
            params: {
                ...activity.params,
                item: {
                    ...activity.params.item,
                    id: 'call_1shwlYIfQqEF5ADZjWPtCNK9',
                    kind: 'interrupted',
                },
            },
        });
        pushJsonLine(stdout, {
            method: 'item/started',
            params: {
                ...activity.params,
                item: { ...activity.params.item, id: 'bad-kind', kind: 'unknown' },
            },
        });
        pushJsonLine(stdout, {
            method: 'item/started',
            params: {
                ...activity.params,
                item: { ...activity.params.item, id: 'missing-thread', agentThreadId: '' },
            },
        });

        await waitFor(() => events.filter((event) => event.type === 'sub_agent_activity').length === 3);
        expect(events.filter((event) => event.type === 'sub_agent_activity')).toEqual([
            expect.objectContaining({
                type: 'sub_agent_activity',
                event_id: 'call_ypdbzxxoWfNA6VPRyS4fmxyj',
                kind: 'started',
                agent_thread_id: '019fa2e7-3fca-7100-a0e9-2c7812b9ac23',
                agent_path: '/root/agent_render_live',
                threadId: 'thread-activity',
                turnId: 'turn-activity',
            }),
            expect.objectContaining({
                type: 'sub_agent_activity',
                event_id: 'call_ZSASUqJS1JTbg8qucYlAb8ex',
                kind: 'interacted',
                agent_thread_id: '019fa2e7-3fca-7100-a0e9-2c7812b9ac23',
            }),
            expect.objectContaining({
                type: 'sub_agent_activity',
                event_id: 'call_1shwlYIfQqEF5ADZjWPtCNK9',
                kind: 'interrupted',
                agent_thread_id: '019fa2e7-3fca-7100-a0e9-2c7812b9ac23',
            }),
        ]);

        await client.disconnect();
    });

    it('consumes reverse child-to-root activity without suppressing root completion', async () => {
        const rootThreadId = '019fa399-e3b1-7622-afb0-01ea400ae19c';
        const childThreadId = '019fa39a-3f7d-78a2-b842-af361d12122d';
        const proc = createMockProcess({
            pid: 3008,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: rootThreadId, path: '/tmp/root-thread' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'root-turn', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: rootThreadId,
                                turn: { id: 'root-turn', items: [], status: 'inProgress', error: null },
                            },
                        });
                        // Normal root -> child activity teaches the adapter the child wrapper.
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: rootThreadId,
                                turnId: 'root-turn',
                                item: {
                                    type: 'subAgentActivity',
                                    id: 'spawn-child',
                                    kind: 'started',
                                    agentThreadId: childThreadId,
                                    agentPath: '/root/restart_root_cause',
                                },
                            },
                        });
                        // A child send_message produces the reverse shape: the target is ROOT.
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: childThreadId,
                                turnId: 'child-turn',
                                item: {
                                    type: 'subAgentActivity',
                                    id: 'child-send-message',
                                    kind: 'interacted',
                                    agentThreadId: rootThreadId,
                                    agentPath: '/root',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: rootThreadId,
                                turnId: 'root-turn',
                                item: {
                                    type: 'commandExecution',
                                    id: 'root-exec',
                                    command: ['pwd'],
                                    cwd: '/tmp/project',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: childThreadId,
                                turnId: 'child-turn',
                                item: {
                                    type: 'commandExecution',
                                    id: 'child-exec',
                                    command: ['rg', 'restart'],
                                    cwd: '/tmp/project',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: rootThreadId,
                                turnId: 'root-turn',
                                item: {
                                    type: 'agentMessage',
                                    id: 'root-final',
                                    text: 'root completed',
                                    phase: 'final_answer',
                                },
                            },
                        });
                        // A second completion signal must remain deduplicated.
                        pushJsonLine(stdout, {
                            method: 'turn/completed',
                            params: {
                                threadId: rootThreadId,
                                turn: { id: 'root-turn', items: [], status: 'completed', error: null },
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await expect(client.sendTurnAndWait('investigate restart', { turnTimeoutMs: 150 }))
            .resolves.toEqual({ aborted: false });
        expect(events.filter((event) => event.type === 'task_complete')).toHaveLength(1);
        expect(events.filter((event) => event.type === 'sub_agent_activity')).toEqual([
            expect.objectContaining({
                event_id: 'spawn-child',
                agent_thread_id: childThreadId,
                agent_path: '/root/restart_root_cause',
            }),
        ]);
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'exec_command_begin', callId: 'root-exec', threadId: rootThreadId }),
            expect.objectContaining({ type: 'exec_command_begin', callId: 'child-exec', threadId: childThreadId }),
            expect.objectContaining({ type: 'agent_message', message: 'root completed', threadId: rootThreadId }),
        ]));

        await client.disconnect();
    });

    it('keeps child final answers from completing the root turn', async () => {
        let releaseRootCompletion!: () => void;
        const rootCompletionAllowed = new Promise<void>((resolve) => {
            releaseRootCompletion = resolve;
        });
        const proc = createMockProcess({
            pid: 3007,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'root-thread', path: '/tmp/root-thread' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'root-turn', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'root-thread',
                                turn: { id: 'root-turn', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'root-thread',
                                turnId: 'root-turn',
                                item: {
                                    type: 'collabAgentToolCall',
                                    id: 'spawn-1',
                                    tool: 'spawnAgent',
                                    prompt: 'inspect files',
                                    senderThreadId: 'root-thread',
                                    receiverThreadIds: ['child-thread'],
                                    agentsStates: {},
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'child-thread',
                                turnId: 'child-turn',
                                item: {
                                    type: 'agentMessage',
                                    id: 'child-final',
                                    text: 'child answer',
                                    phase: 'final_answer',
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'root-thread',
                                turnId: 'root-turn',
                                item: {
                                    type: 'collabAgentToolCall',
                                    id: 'spawn-1',
                                    tool: 'spawnAgent',
                                    status: 'completed',
                                    senderThreadId: 'root-thread',
                                    receiverThreadIds: ['child-thread'],
                                },
                            },
                        });
                        rootCompletionAllowed.then(() => {
                            pushJsonLine(stdout, {
                                method: 'item/completed',
                                params: {
                                    threadId: 'root-thread',
                                    turnId: 'root-turn',
                                    item: {
                                        type: 'agentMessage',
                                        id: 'root-final',
                                        text: 'root answer',
                                        phase: 'final_answer',
                                    },
                                },
                            });
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        const turn = client.sendTurnAndWait('spawn helper');
        await waitFor(() => events.some((event) => event.type === 'agent_message' && event.message === 'child answer'));
        expect(events.filter((event) => event.type === 'task_complete')).toHaveLength(0);
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'collab_agent_call_begin',
                callId: 'spawn-1',
                threadId: 'root-thread',
                turnId: 'root-turn',
                receiverThreadIds: ['child-thread'],
            }),
            expect.objectContaining({
                type: 'agent_message',
                message: 'child answer',
                threadId: 'child-thread',
                turnId: 'child-turn',
                phase: 'final_answer',
            }),
        ]));

        releaseRootCompletion();
        await expect(turn).resolves.toEqual({ aborted: false });
        expect(events.filter((event) => event.type === 'task_complete')).toHaveLength(1);

        await client.disconnect();
    });

    it('maps raw file change items into legacy patch events', async () => {
        const proc = createMockProcess({
            pid: 3003,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-raw-3', path: '/tmp/thread-raw-3' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-raw-3', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-raw-3',
                                turn: { id: 'turn-raw-3', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-raw-3',
                                turnId: 'turn-raw-3',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-1',
                                    status: 'inProgress',
                                    changes: [{
                                        path: 'README.md',
                                        kind: { type: 'update', move_path: null },
                                        diff: '@@ -1 +1 @@',
                                    }],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-3',
                                turnId: 'turn-raw-3',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-1',
                                    status: 'completed',
                                    changes: [{
                                        path: 'README.md',
                                        kind: { type: 'update', move_path: null },
                                        diff: '@@ -1 +1 @@',
                                    }],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-3',
                                turnId: 'turn-raw-3',
                                item: {
                                    type: 'agentMessage',
                                    id: 'msg-3',
                                    text: 'patched',
                                    phase: 'final_answer',
                                },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await expect(client.sendTurnAndWait('patch the file')).resolves.toEqual({ aborted: false });

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'patch_apply_begin',
                callId: 'patch-1',
                changes: {
                    'README.md': {
                        diff: '@@ -1 +1 @@',
                        kind: { type: 'update', move_path: null },
                    },
                },
            }),
            expect.objectContaining({
                type: 'patch_apply_end',
                callId: 'patch-1',
                status: 'completed',
            }),
        ]));

        await client.disconnect();
    });

    // Regression (codex-render): the app patch readers
    // (CodexPatchView.getPatchTexts and SidebarFileView.CodexPatchContent) read
    // the per-file body from change.add.content / change.delete.content /
    // change.unified_diff. The normalizer previously forwarded ONLY the legacy
    // `diff` field, so multi-file ADD and multi-file UPDATE patches rendered the
    // paths with an empty body. These two tests assert each normalized entry now
    // carries the body in the exact key those readers consume.
    it('maps a multi-file ADD patch so every entry carries add.content', async () => {
        const proc = createMockProcess({
            pid: 3013,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-add', path: '/tmp/thread-add' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-add', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-add',
                                turn: { id: 'turn-add', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-add',
                                turnId: 'turn-add',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-add',
                                    status: 'inProgress',
                                    changes: [
                                        {
                                            path: 'src/alpha.ts',
                                            kind: { type: 'add', move_path: null },
                                            content: 'export const alpha = 1;\n',
                                        },
                                        {
                                            path: 'src/beta.ts',
                                            kind: { type: 'add', move_path: null },
                                            content: 'export const beta = 2;\n',
                                        },
                                    ],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-add',
                                turnId: 'turn-add',
                                item: {
                                    type: 'agentMessage',
                                    id: 'msg-add',
                                    text: 'added',
                                    phase: 'final_answer',
                                },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await expect(client.sendTurnAndWait('add two files')).resolves.toEqual({ aborted: false });

        const begin = events.find((event) => event.type === 'patch_apply_begin') as
            | { changes?: Record<string, any> }
            | undefined;
        expect(begin).toBeDefined();
        const changes = begin!.changes!;
        // Both files present, each carrying the body in the key the app readers
        // consume (change.add.content) — NOT just the path.
        expect(changes['src/alpha.ts']).toEqual({
            add: { content: 'export const alpha = 1;\n' },
            kind: { type: 'add', move_path: null },
        });
        expect(changes['src/beta.ts']).toEqual({
            add: { content: 'export const beta = 2;\n' },
            kind: { type: 'add', move_path: null },
        });

        await client.disconnect();
    });

    it('maps a multi-file UPDATE patch so every entry carries unified_diff', async () => {
        const proc = createMockProcess({
            pid: 3014,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-upd', path: '/tmp/thread-upd' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-upd', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-upd',
                                turn: { id: 'turn-upd', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-upd',
                                turnId: 'turn-upd',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-upd',
                                    status: 'inProgress',
                                    changes: [
                                        {
                                            path: 'src/one.ts',
                                            kind: { type: 'update', move_path: null },
                                            unified_diff: '@@ -1 +1 @@\n-const one = 0;\n+const one = 1;\n',
                                        },
                                        {
                                            path: 'src/two.ts',
                                            kind: { type: 'update', move_path: null },
                                            unified_diff: '@@ -1 +1 @@\n-const two = 0;\n+const two = 2;\n',
                                        },
                                    ],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-upd',
                                turnId: 'turn-upd',
                                item: {
                                    type: 'agentMessage',
                                    id: 'msg-upd',
                                    text: 'updated',
                                    phase: 'final_answer',
                                },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await expect(client.sendTurnAndWait('update two files')).resolves.toEqual({ aborted: false });

        const begin = events.find((event) => event.type === 'patch_apply_begin') as
            | { changes?: Record<string, any> }
            | undefined;
        expect(begin).toBeDefined();
        const changes = begin!.changes!;
        // Both files present, each carrying the unified diff in the key the app
        // readers consume (change.unified_diff) — NOT just the path.
        expect(changes['src/one.ts']).toEqual({
            unified_diff: '@@ -1 +1 @@\n-const one = 0;\n+const one = 1;\n',
            kind: { type: 'update', move_path: null },
        });
        expect(changes['src/two.ts']).toEqual({
            unified_diff: '@@ -1 +1 @@\n-const two = 0;\n+const two = 2;\n',
            kind: { type: 'update', move_path: null },
        });

        await client.disconnect();
    });

    it('hydrates v2 file change approvals from raw item metadata', async () => {
        const approvals: Array<Record<string, unknown>> = [];
        const proc = createMockProcess({
            pid: 3004,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-raw-4', path: '/tmp/thread-raw-4' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-request',
                                sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
                                reasoningEffort: null,
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-raw-4',
                                turnId: 'turn-raw-4',
                                item: {
                                    type: 'fileChange',
                                    id: 'patch-approval-1',
                                    status: 'inProgress',
                                    changes: [{
                                        path: 'README.md',
                                        kind: { type: 'update', move_path: null },
                                        diff: '@@ -1 +1 @@',
                                    }],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            id: 99,
                            method: 'item/fileChange/requestApproval',
                            params: {
                                threadId: 'thread-raw-4',
                                turnId: 'turn-raw-4',
                                itemId: 'patch-approval-1',
                                reason: null,
                                grantRoot: null,
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        client.setApprovalHandler(async (params) => {
            approvals.push(params as Record<string, unknown>);
            return 'approved';
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
        });

        await waitFor(() => approvals.length === 1);

        expect(approvals[0]).toEqual(expect.objectContaining({
            type: 'patch',
            callId: 'patch-approval-1',
            fileChanges: {
                'README.md': {
                    diff: '@@ -1 +1 @@',
                    kind: { type: 'update', move_path: null },
                },
            },
            reason: null,
        }));

        await client.disconnect();
    });

    it('routes MCP tool-call elicitations through the approval handler', async () => {
        const writes: any[] = [];
        const approvals: Array<Record<string, unknown>> = [];
        const proc = createMockProcess({
            pid: 3005,
            onRequest: (msg, stdout) => {
                writes.push(msg);

                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-mcp-approval', path: '/tmp/thread-mcp' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'on-failure',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        client.setApprovalHandler(async (params) => {
            approvals.push(params as Record<string, unknown>);
            return 'approved';
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'on-failure',
            sandbox: 'danger-full-access',
        });

        pushJsonLine(proc.stdout as NodeJS.ReadableStream & { push: (chunk: string) => void }, {
            id: 0,
            method: 'mcpServer/elicitation/request',
            params: {
                threadId: 'thread-mcp-approval',
                turnId: 'turn-mcp-approval',
                serverName: 'playwright',
                mode: 'form',
                _meta: {
                    codex_approval_kind: 'mcp_tool_call',
                    tool_description: 'List, create, close, or select a browser tab.',
                    tool_params: { action: 'list' },
                },
                message: 'Allow the playwright MCP server to run tool "browser_tabs"?',
                requestedSchema: { type: 'object', properties: {} },
            },
        });

        await waitFor(() => approvals.length === 1);
        await waitFor(() => writes.some((msg) => msg.id === 0 && msg.result));

        expect(approvals[0]).toEqual(expect.objectContaining({
            type: 'mcp_elicitation',
            callId: 'mcp:playwright:0',
            serverName: 'playwright',
            toolName: 'browser_tabs',
            toolDescription: 'List, create, close, or select a browser tab.',
            toolArguments: { action: 'list' },
            message: 'Allow the playwright MCP server to run tool "browser_tabs"?',
        }));
        expect(writes.find((msg) => msg.id === 0 && msg.result)?.result).toEqual({
            action: 'accept',
            content: {},
            _meta: null,
        });

        await client.disconnect();
    });

    it('routes form-mode elicitations without codex_approval_kind through the approval handler (Playwright MCP shape variant)', async () => {
        const writes: any[] = [];
        const approvals: Array<Record<string, unknown>> = [];
        const proc = createMockProcess({
            pid: 3006,
            onRequest: (msg) => {
                writes.push(msg);
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        client.setApprovalHandler(async (params) => {
            approvals.push(params as Record<string, unknown>);
            return 'approved';
        });

        await client.connect();
        pushJsonLine(proc.stdout as NodeJS.ReadableStream & { push: (chunk: string) => void }, {
            id: 0,
            method: 'mcpServer/elicitation/request',
            params: {
                threadId: 'thread-mcp-form-no-meta',
                turnId: null,
                serverName: 'playwright',
                mode: 'form',
                _meta: null,
                message: 'Allow the playwright MCP server to run tool "browser_navigate"?',
                requestedSchema: {
                    type: 'object',
                    properties: { answer: { type: 'string' } },
                    required: ['answer'],
                },
            },
        });

        await waitFor(() => approvals.length === 1);
        await waitFor(() => writes.some((msg) => msg.id === 0 && msg.result));

        expect(approvals[0]).toEqual(expect.objectContaining({
            type: 'mcp_elicitation',
            serverName: 'playwright',
            mode: 'form',
            toolName: 'browser_navigate',
        }));
        expect(writes.find((msg) => msg.id === 0 && msg.result)?.result).toEqual({
            action: 'accept',
            content: {},
            _meta: null,
        });

        await client.disconnect();
    });

    it('routes url-mode elicitations through the approval handler (Codex 0.125 url shape)', async () => {
        const writes: any[] = [];
        const approvals: Array<Record<string, unknown>> = [];
        const proc = createMockProcess({
            pid: 3007,
            onRequest: (msg) => {
                writes.push(msg);
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        client.setApprovalHandler(async (params) => {
            approvals.push(params as Record<string, unknown>);
            return 'denied';
        });

        await client.connect();
        pushJsonLine(proc.stdout as NodeJS.ReadableStream & { push: (chunk: string) => void }, {
            id: 0,
            method: 'mcpServer/elicitation/request',
            params: {
                threadId: 'thread-mcp-url',
                turnId: null,
                serverName: 'playwright',
                mode: 'url',
                _meta: null,
                message: 'Allow tool "browser_navigate" to open https://example.com?',
                url: 'https://example.com',
                elicitationId: 'elic-001',
            },
        });

        await waitFor(() => approvals.length === 1);
        await waitFor(() => writes.some((msg) => msg.id === 0 && msg.result));

        expect(approvals[0]).toEqual(expect.objectContaining({
            type: 'mcp_elicitation',
            serverName: 'playwright',
            mode: 'url',
            toolName: 'browser_navigate',
        }));
        expect(writes.find((msg) => msg.id === 0 && msg.result)?.result).toEqual({
            action: 'decline',
            content: null,
            _meta: null,
        });

        await client.disconnect();
    });

    // Cycle 7 (spec-20260506-203844 §5.3.D bullet 5) AC1: bridge MUST forward
    // agentsStates on item/completed for collabAgentToolCall, mirroring the
    // existing forwarding on item/started. Source field shape per
    // /tmp/codex-ts-v0.125.0/v2/CollabAgentState.ts.
    it('forwards agentsStates on item/completed for collabAgentToolCall (with and without payload)', async () => {
        const proc = createMockProcess({
            pid: 3010,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-cycle7', path: '/tmp/thread-cycle7' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: { turn: { id: 'turn-cycle7', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: { threadId: 'thread-cycle7', turn: { id: 'turn-cycle7', items: [], status: 'inProgress', error: null } },
                        });
                        // item/completed for collabAgentToolCall WITH agentsStates payload (real Codex shape)
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-cycle7',
                                turnId: 'turn-cycle7',
                                item: {
                                    type: 'collabAgentToolCall',
                                    id: 'wait-c7-1',
                                    tool: 'wait',
                                    status: 'completed',
                                    senderThreadId: 'thread-cycle7',
                                    receiverThreadIds: ['child-c7'],
                                    agentsStates: { 'child-c7': { status: 'completed', message: 'real summary' } },
                                },
                            },
                        });
                        // item/completed for collabAgentToolCall WITHOUT agentsStates (fallback to {})
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-cycle7',
                                turnId: 'turn-cycle7',
                                item: {
                                    type: 'collabAgentToolCall',
                                    id: 'close-c7-1',
                                    tool: 'closeAgent',
                                    status: 'completed',
                                    senderThreadId: 'thread-cycle7',
                                    receiverThreadIds: ['child-c7'],
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-cycle7',
                                turnId: 'turn-cycle7',
                                item: { type: 'agentMessage', id: 'final-c7', text: 'done', phase: 'final_answer' },
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => { events.push(msg as Record<string, unknown>); });

        await client.connect();
        await client.startThread({ model: 'gpt-test', cwd: '/tmp/project', approvalPolicy: 'never', sandbox: 'danger-full-access' });
        await expect(client.sendTurnAndWait('cycle 7 agentsStates forwarding')).resolves.toEqual({ aborted: false });

        // Wait-end forwarded event includes agentsStates with real CollabAgentState shape
        const waitEnd = events.find((event) => event.type === 'collab_agent_call_end' && event.callId === 'wait-c7-1');
        expect(waitEnd).toBeDefined();
        expect(waitEnd).toEqual(expect.objectContaining({
            type: 'collab_agent_call_end',
            callId: 'wait-c7-1',
            tool: 'wait',
            status: 'completed',
            receiverThreadIds: ['child-c7'],
            agentsStates: { 'child-c7': { status: 'completed', message: 'real summary' } },
        }));

        // Close-end forwarded event has agentsStates defaulted to {} when item.agentsStates is missing
        const closeEnd = events.find((event) => event.type === 'collab_agent_call_end' && event.callId === 'close-c7-1');
        expect(closeEnd).toBeDefined();
        expect((closeEnd as Record<string, unknown>).agentsStates).toEqual({});

        await client.disconnect();
    });

    it('falls back to final answer completion when raw turn/completed is missing', async () => {
        const proc = createMockProcess({
            pid: 3002,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-raw-2', path: '/tmp/thread-raw-2' },
                                model: 'gpt-test',
                                modelProvider: 'openai',
                                cwd: '/tmp/project',
                                approvalPolicy: 'never',
                                sandbox: { type: 'dangerFullAccess' },
                                reasoningEffort: null,
                            },
                        });
                    }, 0);
                }

                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                turn: { id: 'turn-raw-2', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: {
                                threadId: 'thread-raw-2',
                                turn: { id: 'turn-raw-2', items: [], status: 'inProgress', error: null },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-raw-2',
                                turnId: 'turn-raw-2',
                                item: {
                                    type: 'agentMessage',
                                    id: 'msg-2',
                                    text: 'still works',
                                    phase: 'final_answer',
                                },
                            },
                        });
                    }, 0);
                }
            },
        });

        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => {
            events.push(msg as Record<string, unknown>);
        });

        await client.connect();
        await client.startThread({
            model: 'gpt-test',
            cwd: '/tmp/project',
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });

        await expect(client.sendTurnAndWait('say hi')).resolves.toEqual({ aborted: false });
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'task_started', turn_id: 'turn-raw-2' }),
            expect.objectContaining({ type: 'agent_message', message: 'still works' }),
            expect.objectContaining({ type: 'task_complete', turn_id: 'turn-raw-2' }),
        ]));

        await client.disconnect();
    });

    // AC-C1 (client half): collaborationMode is forwarded into turn/start only when set.
    it("forwards collaborationMode='plan' into turn/start params only when set", async () => {
        const turnStarts: any[] = [];
        const proc = createMockProcess({
            pid: 4101,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-collab', path: '/tmp/thread-collab' },
                                model: 'gpt-test', modelProvider: 'openai', cwd: '/tmp/project',
                                approvalPolicy: 'untrusted',
                                sandbox: { type: 'workspaceWrite' }, reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
                if (msg.method === 'turn/start' && msg.id != null) {
                    turnStarts.push(msg.params);
                    setTimeout(() => {
                        pushJsonLine(stdout, { id: msg.id, result: {} });
                        pushJsonLine(stdout, {
                            method: 'codex/event',
                            params: { msg: { type: 'task_started', turn_id: 'turn-collab' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'codex/event',
                            params: { msg: { type: 'task_complete', turn_id: 'turn-collab' } },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        await client.connect();
        await client.startThread({ model: 'gpt-test', cwd: '/tmp/project', approvalPolicy: 'untrusted', sandbox: 'workspace-write' });

        // Plan turn → collaborationMode forwarded as the {mode, settings} struct
        // (codex app-server rejects a bare "plan" string).
        await client.sendTurnAndWait('plan turn', { collaborationMode: 'plan', model: 'gpt-test' });
        // Non-plan turn → collaborationMode absent.
        await client.sendTurnAndWait('coding turn');

        expect(turnStarts).toHaveLength(2);
        expect(turnStarts[0].collaborationMode).toEqual({
            mode: 'plan',
            settings: {
                model: 'gpt-test',
                reasoning_effort: null,
                developer_instructions: null,
            },
        });
        expect('collaborationMode' in turnStarts[1]).toBe(false);

        await client.disconnect();
    });

    // Fix #1: when a plan turn omits model, fall back to the model returned by
    // thread/start (stored as _lastModel) so settings.model is never empty.
    it('falls back to the thread model for collaborationMode.settings.model when the turn omits it', async () => {
        const turnStarts: any[] = [];
        const proc = createMockProcess({
            pid: 4104,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-fb', path: '/tmp/thread-fb' },
                                model: 'gpt-resolved', modelProvider: 'openai', cwd: '/tmp/project',
                                approvalPolicy: 'untrusted',
                                sandbox: { type: 'workspaceWrite' }, reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
                if (msg.method === 'turn/start' && msg.id != null) {
                    turnStarts.push(msg.params);
                    setTimeout(() => {
                        pushJsonLine(stdout, { id: msg.id, result: {} });
                        pushJsonLine(stdout, { method: 'codex/event', params: { msg: { type: 'task_started', turn_id: 'turn-fb' } } });
                        pushJsonLine(stdout, { method: 'codex/event', params: { msg: { type: 'task_complete', turn_id: 'turn-fb' } } });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        await client.connect();
        await client.startThread({ model: 'gpt-test', cwd: '/tmp/project', approvalPolicy: 'untrusted', sandbox: 'workspace-write' });

        await client.sendTurnAndWait('plan turn no model', { collaborationMode: 'plan' });

        expect(turnStarts[0].collaborationMode.settings.model).toBe('gpt-resolved');

        await client.disconnect();
    });

    // AC-C2: item/tool/requestUserInput → handler invoked, answers mapped, SAME id replied.
    it('handles item/tool/requestUserInput and replies the same id with the mapped answer map', async () => {
        const writes: any[] = [];
        const proc = createMockProcess({
            pid: 4102,
            onRequest: (msg, stdout) => {
                writes.push(msg);
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-rui', path: '/tmp/thread-rui' },
                                model: 'gpt-test', modelProvider: 'openai', cwd: '/tmp/project',
                                approvalPolicy: 'untrusted',
                                sandbox: { type: 'workspaceWrite' }, reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();

        const received: any[] = [];
        client.setRequestUserInputHandler(async (params) => {
            received.push(params);
            // Mirror the app: answersRecord keyed by question id (qid).
            return { q1: 'Blue', q2: 'Large' };
        });

        await client.connect();
        await client.startThread({ model: 'gpt-test', cwd: '/tmp/project', approvalPolicy: 'untrusted', sandbox: 'workspace-write' });

        const requestId = 0;
        pushJsonLine(proc.stdout as NodeJS.ReadableStream & { push: (chunk: string) => void }, {
            id: requestId,
            method: 'item/tool/requestUserInput',
            params: {
                threadId: 'thread-rui',
                turnId: 'turn-rui',
                itemId: 'item-rui-1',
                questions: [
                    { id: 'q1', header: 'Color', question: 'Pick a color', isOther: false, isSecret: false, options: [{ label: 'Blue' }, { label: 'Red' }] },
                    { id: 'q2', header: 'Size', question: 'Pick a size', isOther: false, isSecret: false, options: [{ label: 'Large' }, { label: 'Small' }] },
                ],
            },
        });

        await waitFor(() => received.length === 1);
        await waitFor(() => writes.some((m) => m.id === requestId && m.result));

        // Handler received the full params (threadId/turnId/itemId/questions).
        expect(received[0]).toEqual(expect.objectContaining({
            threadId: 'thread-rui',
            turnId: 'turn-rui',
            itemId: 'item-rui-1',
        }));
        expect(received[0].questions).toHaveLength(2);

        // Reply is on the SAME JSON-RPC id, mapped to {[qid]:{answers:[label]}}.
        const reply = writes.find((m) => m.id === requestId && m.result);
        expect(reply.result).toEqual({
            answers: {
                q1: { answers: ['Blue'] },
                q2: { answers: ['Large'] },
            },
        });

        await client.disconnect();
    });

    // AC-C2: a missing/absent handler must still reply (empty answers) so codex doesn't hang.
    it('replies with empty answers when no requestUserInput handler is set', async () => {
        const writes: any[] = [];
        const proc = createMockProcess({
            pid: 4103,
            onRequest: (msg, stdout) => {
                writes.push(msg);
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-rui-2', path: '/tmp/thread-rui-2' },
                                model: 'gpt-test', modelProvider: 'openai', cwd: '/tmp/project',
                                approvalPolicy: 'untrusted',
                                sandbox: { type: 'workspaceWrite' }, reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        await client.connect();
        await client.startThread({ model: 'gpt-test', cwd: '/tmp/project', approvalPolicy: 'untrusted', sandbox: 'workspace-write' });

        const requestId = 0;
        pushJsonLine(proc.stdout as NodeJS.ReadableStream & { push: (chunk: string) => void }, {
            id: requestId,
            method: 'item/tool/requestUserInput',
            params: { threadId: 'thread-rui-2', turnId: 'turn-rui-2', itemId: 'item-x', questions: [] },
        });

        await waitFor(() => writes.some((m) => m.id === requestId && m.result));
        expect(writes.find((m) => m.id === requestId && m.result).result).toEqual({ answers: {} });

        await client.disconnect();
    });
});
