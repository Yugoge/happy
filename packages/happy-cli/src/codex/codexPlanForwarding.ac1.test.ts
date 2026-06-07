// AC1 (R1, spec-20260520-051938 §5.13): update_plan must render per-step rows.
//
// Root cause (BA/QA + codex 0.130 type verification, dev-20260606-162217):
// the Codex app-server delivers the STRUCTURED plan array on its own
// `turn/plan/updated` notification (TurnPlanUpdatedNotification:
// { threadId, turnId, explanation, plan: TurnPlanStep[] }), NOT inside the
// item/* 'plan' item (whose generated ThreadItem variant is only { id, text }).
// Previously: (a) the app-server router (shouldHandleRawNotification) did not
// include turn/plan/updated at all, so the structured steps were dropped; and
// (b) the plan-item handler forwarded only `item.text`. So the mapper built
// functions.update_plan with message.plan undefined and only the text fallback
// survived — CodexPlanView (reads input.plan via extractPlanItems) rendered no
// rows. TurnPlanStepStatus is camelCase ("inProgress"); the renderer/mapper
// compare against snake_case ("in_progress"), so status must be normalized.
//
// This test asserts the deterministic legs of the mapper→CodexPlanView path:
//   (1) the app-server handles turn/plan/updated and forwards the structured
//       `plan` array (begin + end) with status normalized to snake_case,
//   (2) the legacy item/* 'plan' belt still forwards a nested array if present,
//   (3) the mapper emits functions.update_plan with args.plan as an array of
//       { step, status } objects of length > 0 (the exact shape CodexPlanView's
//       extractPlanItems consumes to render one row per step).
// The final live render of CodexPlanView is the FINAL_LIVE_GATE (user-observed),
// not unit-testable here because the view transitively imports react-native.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapCodexMcpMessageToSessionEnvelopes } from './utils/sessionProtocolMapper';

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

// Real captured tier-1 plan array shape.
const PLAN_ARRAY = [
    { step: 'Inspect git status and changed-file diffs', status: 'completed' },
    { step: 'Review added lines against cleanliness standards', status: 'in_progress' },
    { step: 'Summarize findings', status: 'pending' },
];

beforeEach(() => {
    vi.clearAllMocks();
    // isAppServerAvailable() shells out to `codex --version`; satisfy it so
    // connect() proceeds (mirrors codexAppServerClient.test.ts).
    mockExecSync.mockReturnValue('codex-cli 0.107.0');
});

afterAll(() => {
    vi.restoreAllMocks();
});

// Codex 0.130 wire status enum (TurnPlanStepStatus) is camelCase.
const TURN_PLAN = [
    { step: 'Inspect git status and changed-file diffs', status: 'completed' },
    { step: 'Review added lines against cleanliness standards', status: 'inProgress' },
    { step: 'Summarize findings', status: 'pending' },
];

describe('AC1 update_plan structured-step forwarding (app-server plan handler)', () => {
    it('handles turn/plan/updated and forwards the structured plan array with status normalized to snake_case', async () => {
        const proc = createMockProcess({
            pid: 4100,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-tp', path: '/tmp/thread-tp' },
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
                            result: { turn: { id: 'turn-tp', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: { threadId: 'thread-tp', turn: { id: 'turn-tp', items: [], status: 'inProgress', error: null } },
                        });
                        // Real Codex 0.130 channel: structured plan on turn/plan/updated.
                        pushJsonLine(stdout, {
                            method: 'turn/plan/updated',
                            params: { threadId: 'thread-tp', turnId: 'turn-tp', explanation: 'Working the plan', plan: TURN_PLAN },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-tp', turnId: 'turn-tp',
                                item: { type: 'agentMessage', id: 'final-tp', text: 'done', phase: 'final_answer' },
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
        await expect(client.sendTurnAndWait('turn/plan/updated forwarding')).resolves.toEqual({ aborted: false });

        const begin = events.find((e) => e.type === 'plan_update_begin' && e.callId === 'turn-tp');
        const end = events.find((e) => e.type === 'plan_update_end' && e.callId === 'turn-tp');
        expect(begin).toBeDefined();
        expect(end).toBeDefined();
        const expectedNormalized = [
            { step: 'Inspect git status and changed-file diffs', status: 'completed' },
            { step: 'Review added lines against cleanliness standards', status: 'in_progress' },
            { step: 'Summarize findings', status: 'pending' },
        ];
        // camelCase "inProgress" normalized to snake_case "in_progress".
        expect((begin as Record<string, unknown>).plan).toEqual(expectedNormalized);
        expect((end as Record<string, unknown>).plan).toEqual(expectedNormalized);
        expect((begin as Record<string, unknown>).text).toBe('Working the plan');

        await client.disconnect();
    });

    it('forwards the structured plan array on plan_update_begin and plan_update_end (not only text)', async () => {
        const proc = createMockProcess({
            pid: 4101,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-ac1', path: '/tmp/thread-ac1' },
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
                            result: { turn: { id: 'turn-ac1', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: { threadId: 'thread-ac1', turn: { id: 'turn-ac1', items: [], status: 'inProgress', error: null } },
                        });
                        // Structured plan item: plan array present alongside a text summary.
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-ac1',
                                turnId: 'turn-ac1',
                                item: { type: 'plan', id: 'plan-ac1', text: 'Working the plan', plan: PLAN_ARRAY },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-ac1',
                                turnId: 'turn-ac1',
                                item: { type: 'plan', id: 'plan-ac1', text: 'Working the plan', plan: PLAN_ARRAY },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-ac1',
                                turnId: 'turn-ac1',
                                item: { type: 'agentMessage', id: 'final-ac1', text: 'done', phase: 'final_answer' },
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
        await expect(client.sendTurnAndWait('ac1 plan forwarding')).resolves.toEqual({ aborted: false });

        const begin = events.find((e) => e.type === 'plan_update_begin' && e.callId === 'plan-ac1');
        const end = events.find((e) => e.type === 'plan_update_end' && e.callId === 'plan-ac1');
        expect(begin).toBeDefined();
        expect(end).toBeDefined();
        // The structured array survives forwarding (the bug was: only `text` survived).
        expect((begin as Record<string, unknown>).plan).toEqual(PLAN_ARRAY);
        expect((end as Record<string, unknown>).plan).toEqual(PLAN_ARRAY);
        expect((begin as Record<string, unknown>).text).toBe('Working the plan');

        await client.disconnect();
    });

    it('falls back to undefined plan when the app-server item carries no structured array (text-only legacy shape)', async () => {
        const proc = createMockProcess({
            pid: 4102,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-ac1b', path: '/tmp/thread-ac1b' },
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
                            result: { turn: { id: 'turn-ac1b', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: { threadId: 'thread-ac1b', turn: { id: 'turn-ac1b', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-ac1b', turnId: 'turn-ac1b',
                                item: { type: 'plan', id: 'plan-ac1b', text: 'No structured steps' },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-ac1b', turnId: 'turn-ac1b',
                                item: { type: 'agentMessage', id: 'final-ac1b', text: 'done', phase: 'final_answer' },
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
        await expect(client.sendTurnAndWait('ac1 plan text-only')).resolves.toEqual({ aborted: false });

        const begin = events.find((e) => e.type === 'plan_update_begin' && e.callId === 'plan-ac1b');
        expect(begin).toBeDefined();
        // No structured array present → plan is undefined, text fallback preserved.
        expect((begin as Record<string, unknown>).plan).toBeUndefined();
        expect((begin as Record<string, unknown>).text).toBe('No structured steps');

        await client.disconnect();
    });
});

describe('AC1 mapper emits functions.update_plan with structured per-step args (mapper→CodexPlanView path)', () => {
    it('emits args.plan as a non-empty array of { step, status } that extractPlanItems would render row-per-step', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'plan_update_begin', call_id: 'plan-m1', text: 'Working the plan', plan: PLAN_ARRAY },
            { currentTurnId: 'turn-m1' },
        );

        const startEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-start');
        expect(startEnvelope).toBeDefined();
        const ev = startEnvelope!.ev;
        if (ev.t !== 'tool-call-start') throw new Error('Expected tool-call-start');
        expect(ev.name).toBe('functions.update_plan');

        const plan = ev.args.plan as Array<{ step: string; status: string }>;
        expect(Array.isArray(plan)).toBe(true);
        expect(plan.length).toBe(3);
        // Per-step shape consumed by CodexPlanView via extractPlanItems(input.plan).
        expect(plan[0]).toMatchObject({ step: expect.any(String), status: 'completed' });
        expect(plan[1]).toMatchObject({ status: 'in_progress' });
        expect(plan[2]).toMatchObject({ status: 'pending' });
    });

    it('passes the normalized turn/plan/updated array through with in_progress status preserved for CodexPlanView icons', () => {
        // Mirrors what the app-server now forwards from turn/plan/updated (already
        // status-normalized): the mapper must keep in_progress so CodexPlanView
        // selects the active icon (not the pending fallback).
        const normalizedPlan = [
            { step: 'a', status: 'completed' },
            { step: 'b', status: 'in_progress' },
            { step: 'c', status: 'pending' },
        ];
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'plan_update_begin', call_id: 'turn-m3', text: 'Working the plan', plan: normalizedPlan },
            { currentTurnId: 'turn-m3' },
        );

        const startEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-start');
        expect(startEnvelope).toBeDefined();
        const ev = startEnvelope!.ev;
        if (ev.t !== 'tool-call-start') throw new Error('Expected tool-call-start');
        expect(ev.name).toBe('functions.update_plan');
        expect(ev.args.plan).toEqual(normalizedPlan);
        const plan = ev.args.plan as Array<{ step: string; status: string }>;
        expect(plan.filter((s) => s.status === 'in_progress')).toHaveLength(1);
    });

    it('keeps text fallback in args.plan when no structured array is forwarded (legacy text-only)', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'plan_update_begin', call_id: 'plan-m2', text: '- one\n- two' },
            { currentTurnId: 'turn-m2' },
        );

        const startEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-start');
        expect(startEnvelope).toBeDefined();
        const ev = startEnvelope!.ev;
        if (ev.t !== 'tool-call-start') throw new Error('Expected tool-call-start');
        // With no structured array, the text fallback flows through (mapper :941),
        // which extractPlanItems splits into pending rows on the consumer side.
        expect(ev.args.plan).toBe('- one\n- two');
    });
});
