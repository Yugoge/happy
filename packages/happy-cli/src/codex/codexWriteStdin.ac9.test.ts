// AC9 (R9, spec-20260520-051938 §5.13, SECONDARY / feasibility-gated): write_stdin
// should be discoverable as its own action/result card IF the producer can surface
// it, ELSE the producer limitation is documented (not silently dropped).
//
// FEASIBILITY VERDICT (dev-20260606-162217): NOT cleanly feasible as a discrete
// tool-call card — DOCUMENTED PRODUCER LIMITATION close path
// (closeable_on_documented_producer_limitation).
//
// Evidence (codex 0.130.0, verified via `codex app-server generate-ts -o .../v2`):
//   1. The model emits `write_stdin` as a function_call (~490 corpus hits in
//      ~/.codex/sessions/2026/06) carrying {session_id, chars, yield_time_ms,
//      max_output_tokens} — it targets an ALREADY-RUNNING exec session, it is not a
//      standalone tool family.
//   2. There is NO `writeStdin` / `stdin` variant in the generated ThreadItem union
//      (the discriminated family the app-server item/* switch maps into tool-call
//      envelopes): userMessage | hookPrompt | agentMessage | plan | reasoning |
//      commandExecution | fileChange | mcpToolCall | dynamicToolCall |
//      collabAgentToolCall | webSearch | imageView | imageGeneration |
//      enteredReviewMode | exitedReviewMode | contextCompaction. So write_stdin
//      NEVER arrives via item/started + item/completed (the AC3/AC4 channel).
//   3. The app-server surfaces the stdin write only as the streaming delta
//      notification `item/commandExecution/terminalInteraction`, whose params are
//      TerminalInteractionNotification = { threadId, turnId, itemId, processId,
//      stdin } — a stdin-echo into the EXISTING open commandExecution PTY item. It
//      has NO call_id, NO begin/end pair, NO status, and NO result, so there is no
//      tool-call lifecycle to map to a discrete action/result card.
//
// Conclusion: write_stdin stays visible as echoed PTY terminal text inside the
// commandExecution (exec) card — this is the intended, protocol-faithful behavior.
// Per the feasibility-gated close semantics we do NOT fabricate a synthetic card
// that is not backed by a real producer event. This test LOCKS that intentional
// behavior in (revert-sensitive): it FAILS if (a) someone fabricates a discrete
// write_stdin/stdin tool-call envelope from a terminalInteraction delta, or (b) the
// terminalInteraction delta disturbs the existing commandExecution exec card.
// The FINAL_LIVE_GATE is the user-observed handoff; this is the deterministic track.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockExecSync,
    mockInitializeSandbox,
    mockWrapForMcpTransport,
    mockSpawn,
} = vi.hoisted(() => ({
    mockExecSync: vi.fn(),
    mockInitializeSandbox: vi.fn(),
    mockWrapForMcpTransport: vi.fn(),
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
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../package.json', () => ({
    default: { version: '0.0.1-test' },
}));

type MockRpcMessage = { id?: number; method?: string; params?: any };

function pushJsonLine(stdout: NodeJS.ReadableStream & { push: (chunk: string) => void }, payload: unknown) {
    stdout.push(JSON.stringify(payload) + '\n');
}

function createMockProcess(opts?: {
    pid?: number;
    onRequest?: (msg: MockRpcMessage, stdout: NodeJS.ReadableStream & { push: (chunk: string) => void }) => void;
}) {
    const { Readable, Writable } = require('stream');
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
    const origWrite = stdin.write.bind(stdin);
    stdin.write = (data: any, ...args: any[]) => {
        try {
            const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
            if (msg.method === 'initialize' && msg.id != null) {
                setTimeout(() => {
                    pushJsonLine(stdout, { id: msg.id, result: { userAgent: 'test' } });
                }, 5);
            }
            opts?.onRequest?.(msg, stdout);
        } catch {}
        return origWrite(data, ...args);
    };
    return proc;
}

// Real captured tier-1 terminalInteraction shape (codex 0.130 generate-ts
// TerminalInteractionNotification): the stdin-echo delta into a running PTY exec.
const STDIN_ECHO = 'y\n';

beforeEach(() => {
    vi.clearAllMocks();
    // isAppServerAvailable() shells out to `codex --version`; satisfy it so
    // connect() proceeds (mirrors codexAppServerClient.test.ts / AC3 test).
    mockExecSync.mockReturnValue('codex-cli 0.130.0');
});

afterAll(() => {
    vi.restoreAllMocks();
});

describe('AC9 write_stdin documented producer limitation (no fabricated discrete card)', () => {
    it('does NOT emit any discrete write_stdin/stdin tool-call event for an item/commandExecution/terminalInteraction delta, and leaves the commandExecution exec card intact', async () => {
        const proc = createMockProcess({
            pid: 4900,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-ws9', path: '/tmp/thread-ws9' },
                                model: 'gpt-test', modelProvider: 'openai', cwd: '/tmp/project',
                                approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' }, reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: { turn: { id: 'turn-ws9', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: { threadId: 'thread-ws9', turn: { id: 'turn-ws9', items: [], status: 'inProgress', error: null } },
                        });
                        // A real long-running exec (PTY) session starts.
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-ws9', turnId: 'turn-ws9',
                                item: { type: 'commandExecution', id: 'cmd_ws9', command: 'python repl.py', cwd: '/tmp/project' },
                            },
                        });
                        // The model's write_stdin function_call surfaces ONLY as this
                        // terminalInteraction delta into the SAME exec item — no item
                        // field, no call lifecycle of its own.
                        pushJsonLine(stdout, {
                            method: 'item/commandExecution/terminalInteraction',
                            params: {
                                threadId: 'thread-ws9', turnId: 'turn-ws9',
                                itemId: 'cmd_ws9', processId: 'pty-1', stdin: STDIN_ECHO,
                            },
                        });
                        // The exec session completes normally (the stdin echo is part
                        // of aggregatedOutput, i.e. echoed terminal text).
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-ws9', turnId: 'turn-ws9',
                                item: {
                                    type: 'commandExecution', id: 'cmd_ws9', command: 'python repl.py',
                                    cwd: '/tmp/project', status: 'completed', exitCode: 0,
                                    aggregatedOutput: `>>> ${STDIN_ECHO}ok`, durationMs: 12,
                                },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-ws9', turnId: 'turn-ws9',
                                item: { type: 'agentMessage', id: 'final-ws9', text: 'done', phase: 'final_answer' },
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
        await expect(client.sendTurnAndWait('write_stdin into a running exec')).resolves.toEqual({ aborted: false });

        // (1) NO fabricated discrete write_stdin / stdin tool-call event of any kind.
        const stdinish = events.filter((e) => {
            const t = String(e.type ?? '');
            return /stdin/i.test(t) || /terminal_?interaction/i.test(t) || t === 'write_stdin';
        });
        expect(stdinish).toEqual([]);

        // (2) The terminalInteraction delta does NOT spawn an extra exec begin/end —
        //     the existing commandExecution PTY card stays a single intact pair.
        const execBegins = events.filter((e) => e.type === 'exec_command_begin');
        const execEnds = events.filter((e) => e.type === 'exec_command_end');
        expect(execBegins).toHaveLength(1);
        expect(execEnds).toHaveLength(1);
        expect((execBegins[0] as Record<string, unknown>).callId).toBe('cmd_ws9');

        // (3) The stdin echo remains visible inside the exec card's aggregated output
        //     (echoed terminal text — the intended, protocol-faithful surface).
        const output = String((execEnds[0] as Record<string, unknown>).output ?? '');
        expect(output).toContain(STDIN_ECHO.trim());

        await client.disconnect();
    });
});
