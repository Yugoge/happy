import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayCodexRolloutHistory } from './rolloutHistoryReplay';

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
});

async function createCodexHome(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'codex-rollout-replay-'));
    tempDirs.push(dir);
    return dir;
}

async function writeRollout(codexHome: string, threadId: string, name: string, records: unknown[]): Promise<void> {
    const dir = join(codexHome, 'sessions', '2026', '05', '15');
    await mkdir(dir, { recursive: true });
    await writeFile(
        join(dir, `${name}-${threadId}.jsonl`),
        records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    );
}

describe('replayCodexRolloutHistory', () => {
    it('replays rollout records in file order with user, assistant, and tool mapping', async () => {
        const codexHome = await createCodexHome();
        const threadId = '019e2d74-1194-7a93-adc6-cac523612303';
        await writeRollout(codexHome, threadId, 'rollout-2026-05-15T00-00-00', [
            { type: 'session_meta', payload: { id: threadId } },
            { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
            {
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: 'hello codex' }],
                },
            },
            { type: 'event_msg', payload: { type: 'user_message', message: 'hello codex' } },
            {
                type: 'response_item',
                payload: {
                    type: 'function_call',
                    name: 'exec_command',
                    call_id: 'call-1',
                    arguments: JSON.stringify({ command: 'pwd', cwd: '/tmp' }),
                },
            },
        ]);
        await writeRollout(codexHome, threadId, 'rollout-2026-05-15T00-01-00', [
            {
                type: 'response_item',
                payload: { type: 'function_call_output', call_id: 'call-1', output: '/tmp\n' },
            },
            { type: 'response_item', payload: { type: 'reasoning', encrypted_content: 'secret' } },
            { type: 'event_msg', payload: { type: 'agent_message', message: 'assistant answer' } },
            {
                type: 'response_item',
                payload: {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'assistant answer' }],
                },
            },
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } },
        ]);

        const session = {
            sendSessionProtocolMessage: vi.fn(),
            sendSessionEvent: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        const result = await replayCodexRolloutHistory({ threadId, session, codexHome });

        expect(result.status).toBe('replayed');
        expect(result.envelopesSent).toBe(6);
        expect(session.sendSessionEvent).not.toHaveBeenCalled();
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([envelope]) => envelope);
        expect(envelopes.map((envelope) => envelope.ev.t)).toEqual([
            'turn-start',
            'text',
            'tool-call-start',
            'tool-call-end',
            'text',
            'turn-end',
        ]);
        expect(envelopes[1]).toMatchObject({ role: 'user', ev: { text: 'hello codex' } });
        expect(envelopes[4]).toMatchObject({ role: 'agent', ev: { text: 'assistant answer' } });
        expect(
            envelopes.filter((envelope) => envelope.ev.t === 'text' && envelope.ev.text === 'hello codex'),
        ).toHaveLength(1);
        expect(
            envelopes.filter((envelope) => envelope.ev.t === 'text' && envelope.ev.text === 'assistant answer'),
        ).toHaveLength(1);
    });

    it('sends a visible service message when no rollout history can be loaded', async () => {
        const codexHome = await createCodexHome();
        const session = {
            sendSessionProtocolMessage: vi.fn(),
            sendSessionEvent: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        const result = await replayCodexRolloutHistory({
            threadId: 'missing-thread',
            session,
            codexHome,
        });

        expect(result.status).toBe('failed');
        expect(session.sendSessionProtocolMessage).not.toHaveBeenCalled();
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: expect.stringContaining('Prior Codex history could not be restored'),
        });
    });

    // AC-C6-3 (rollout replay path): verify that a spawnAgent function_call in a real
    // rollout .jsonl file produces a functions.subagent_lifecycle tool-call-start envelope.
    // This exercises rolloutHistoryReplay.ts COLLAB_REPLAY_TOOL_MAP routing → collab_agent_call_begin
    // → emitLifecycleStart. Tests both camelCase (app-server protocol) and snake_case (CLI rollout).
    it('AC-C6-3: spawnAgent function_call in rollout file emits functions.subagent_lifecycle envelope (camelCase)', async () => {
        const codexHome = await createCodexHome();
        const threadId = 'ac-c6-3-camel-thread';
        await writeRollout(codexHome, threadId, 'rollout-2026-05-29T00-00-00', [
            { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-c6-3' } },
            {
                type: 'response_item',
                payload: {
                    type: 'function_call',
                    name: 'spawnAgent',
                    call_id: 'spawn-c6-3',
                    arguments: JSON.stringify({ prompt: 'do some work', model: null, receiverThreadIds: [], agentsStates: {} }),
                },
            },
        ]);
        const session = {
            sendSessionProtocolMessage: vi.fn(),
            sendSessionEvent: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        const result = await replayCodexRolloutHistory({ threadId, session, codexHome });

        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        // Must include a functions.subagent_lifecycle tool-call-start
        const lifecycleEnv = envelopes.find(
            (e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle'
        );
        expect(lifecycleEnv).toBeDefined();
        // call ID starts with 'lifecycle:'
        expect((lifecycleEnv as any).ev.call.startsWith('lifecycle:')).toBe(true);
        // args.sessionSubagent is populated
        expect(typeof (lifecycleEnv as any).ev.args.sessionSubagent).toBe('string');
        expect((lifecycleEnv as any).ev.args.lifecycle_state).toBe('started');
    });

    it('AC-C6-3: spawn_agent function_call in rollout file emits functions.subagent_lifecycle envelope (snake_case)', async () => {
        const codexHome = await createCodexHome();
        const threadId = 'ac-c6-3-snake-thread';
        await writeRollout(codexHome, threadId, 'rollout-2026-05-29T00-00-00', [
            { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-c6-3-snake' } },
            {
                type: 'response_item',
                payload: {
                    type: 'function_call',
                    name: 'spawn_agent',
                    call_id: 'spawn-c6-3-snake',
                    arguments: JSON.stringify({ prompt: 'snake case test', receiverThreadIds: [], agentsStates: {} }),
                },
            },
        ]);
        const session = {
            sendSessionProtocolMessage: vi.fn(),
            sendSessionEvent: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        const result = await replayCodexRolloutHistory({ threadId, session, codexHome });

        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        const lifecycleEnv = envelopes.find(
            (e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle'
        );
        expect(lifecycleEnv).toBeDefined();
        expect((lifecycleEnv as any).ev.call.startsWith('lifecycle:')).toBe(true);
        expect(typeof (lifecycleEnv as any).ev.args.sessionSubagent).toBe('string');
    });

    // Cycle 7 (S3 / AC-C7-3): a rollout record with a known top-level `timestamp` produces envelopes
    // whose `time === Date.parse(timestamp)` (NOT Date.now()).
    it('AC-C7-3: threads record.timestamp into the lifecycle + same-record envelopes (time === Date.parse)', async () => {
        const codexHome = await createCodexHome();
        const threadId = 'ac-c7-3-thread';
        const spawnTs = '2026-05-16T17:02:39.301Z';
        const spawnMs = Date.parse(spawnTs);
        await writeRollout(codexHome, threadId, 'rollout-2026-05-16T17-02-35', [
            { type: 'event_msg', timestamp: '2026-05-16T17:02:35.000Z', payload: { type: 'task_started', turn_id: 'turn-c7-3' } },
            {
                type: 'response_item',
                timestamp: spawnTs,
                payload: {
                    type: 'function_call',
                    name: 'spawn_agent',
                    call_id: 'spawn-c7-3',
                    // M2.c: real rollout uses `message`, not `prompt`.
                    arguments: JSON.stringify({ agent_type: 'architect', message: 'inspect auth', reasoning_effort: 'medium' }),
                },
            },
        ]);
        const session = {
            sendSessionProtocolMessage: vi.fn(),
            sendSessionEvent: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        const result = await replayCodexRolloutHistory({ threadId, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);

        const lifecycleEnv = envelopes.find(
            (e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle'
        );
        expect(lifecycleEnv).toBeDefined();
        // AC-C7-3: lifecycle-START carries the spawn record's historical time.
        expect((lifecycleEnv as any).time).toBe(spawnMs);
        // M2.c: the lifecycle description must use `message` (not empty).
        expect((lifecycleEnv as any).ev.description).toBe('inspect auth');

        // The spawn child (same record) carries the same historical time.
        const spawnChild = envelopes.find(
            (e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.spawn_agent'
        );
        expect(spawnChild).toBeDefined();
        expect((spawnChild as any).time).toBe(spawnMs);
        // The turn-start (separate record) carries ITS record's time.
        const turnStart = envelopes.find((e: any) => e.ev.t === 'turn-start');
        expect((turnStart as any).time).toBe(Date.parse('2026-05-16T17:02:35.000Z'));
    });

    // Cycle 7 (S3 / AC-C7-4): missing/garbage timestamp falls back to a finite numeric time (no NaN).
    it('AC-C7-4: missing or garbage timestamp yields a finite numeric time (no NaN, Date.now() fallback)', async () => {
        const codexHome = await createCodexHome();
        const threadId = 'ac-c7-4-thread';
        await writeRollout(codexHome, threadId, 'rollout-2026-05-16T17-03-00', [
            // No timestamp key at all.
            { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-c7-4' } },
            // Garbage, unparseable timestamp.
            {
                type: 'response_item',
                timestamp: 'not-a-date',
                payload: {
                    type: 'function_call',
                    name: 'spawn_agent',
                    call_id: 'spawn-c7-4',
                    arguments: JSON.stringify({ message: 'garbage ts test' }),
                },
            },
        ]);
        const session = {
            sendSessionProtocolMessage: vi.fn(),
            sendSessionEvent: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        const result = await replayCodexRolloutHistory({ threadId, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        expect(envelopes.length).toBeGreaterThan(0);
        for (const env of envelopes) {
            expect(Number.isFinite((env as any).time)).toBe(true);
            expect(Number.isNaN((env as any).time)).toBe(false);
        }
    });

    // Cycle 7 (S3 / AC-C7-10): lifecycle-END uses the close record's time, not the spawn record's;
    // each record's envelopes carry that record's time.
    it('AC-C7-10: lifecycle-END carries the close record time; per-record envelopes carry their own time', async () => {
        const codexHome = await createCodexHome();
        const threadId = 'ac-c7-10-thread';
        const spawnTs = '2026-05-16T17:02:39.000Z';
        const closeTs = '2026-05-16T17:05:00.000Z';
        const agentId = '019e31bf-f5d6-7112-9c56-c575c6ede31a';
        await writeRollout(codexHome, threadId, 'rollout-2026-05-16T17-02-35', [
            { type: 'event_msg', timestamp: '2026-05-16T17:02:35.000Z', payload: { type: 'task_started', turn_id: 'turn-c7-10' } },
            {
                type: 'response_item', timestamp: spawnTs,
                payload: { type: 'function_call', name: 'spawn_agent', call_id: 'spawn-c7-10', arguments: JSON.stringify({ message: 'do work' }) },
            },
            {
                // M2.c: spawn output binds agent_id -> ssn.
                type: 'response_item', timestamp: spawnTs,
                payload: { type: 'function_call_output', call_id: 'spawn-c7-10', output: JSON.stringify({ agent_id: agentId, nickname: 'Architect' }) },
            },
            {
                // M2.c: close_agent uses `target` (singular).
                type: 'response_item', timestamp: closeTs,
                payload: { type: 'function_call', name: 'close_agent', call_id: 'close-c7-10', arguments: JSON.stringify({ target: agentId }) },
            },
            {
                type: 'response_item', timestamp: closeTs,
                payload: { type: 'function_call_output', call_id: 'close-c7-10', output: JSON.stringify({ status: 'completed' }) },
            },
        ]);
        const session = {
            sendSessionProtocolMessage: vi.fn(),
            sendSessionEvent: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        const result = await replayCodexRolloutHistory({ threadId, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);

        const lifecycleStart = envelopes.find(
            (e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle'
        );
        expect(lifecycleStart).toBeDefined();
        expect((lifecycleStart as any).time).toBe(Date.parse(spawnTs));
        const lifecycleCall = (lifecycleStart as any).ev.call;

        const lifecycleEnd = envelopes.find(
            (e: any) => e.ev.t === 'tool-call-end' && e.ev.call === lifecycleCall
        );
        expect(lifecycleEnd).toBeDefined();
        // AC-C7-10: lifecycle-END uses the CLOSE record's time, not the spawn record's.
        expect((lifecycleEnd as any).time).toBe(Date.parse(closeTs));
        expect((lifecycleEnd as any).time).not.toBe(Date.parse(spawnTs));
    });

    it('replays a fallback thread when the requested thread has no rollout file', async () => {
        const codexHome = await createCodexHome();
        await writeRollout(codexHome, 'fallback-thread', 'rollout-2026-05-15T00-00-00', [
            { type: 'event_msg', payload: { type: 'user_message', message: 'fallback hello' } },
        ]);
        const session = {
            sendSessionProtocolMessage: vi.fn(),
            sendSessionEvent: vi.fn(),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        const result = await replayCodexRolloutHistory({
            threadId: 'requested-thread',
            fallbackThreadIds: ['fallback-thread'],
            session,
            codexHome,
        });

        expect(result).toMatchObject({ status: 'replayed', threadId: 'fallback-thread' });
        expect(session.sendSessionEvent).not.toHaveBeenCalled();
        expect(session.sendSessionProtocolMessage).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'user', ev: expect.objectContaining({ text: 'fallback hello' }) }),
        );
    });
});
