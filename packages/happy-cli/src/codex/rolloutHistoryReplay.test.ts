import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayCodexRolloutHistory, childEnvelopePassesInvariants } from './rolloutHistoryReplay';
import { createEnvelope } from '@slopus/happy-wire';
import { createId } from '@paralleldrive/cuid2';

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

    // ====================================================================================
    // Cycle 8 (spec-20260520-051938): nested subagent internal-tool merge + degradation tolerance.
    // Fixtures mirror the real corpus shapes (/root/.codex/sessions/2026/05/16/): parent spawn
    // function_call_output binds {agent_id, nickname}; sibling child rollout-<ts>-<agent_id>.jsonl
    // with session_meta thread_spawn + exec_command begin/end records.
    // ====================================================================================

    // Helper: a parent rollout that spawns subagent `agentId` (with prompt) within turn `turnId`.
    function parentSpawnRecords(turnId: string, spawnCallId: string, agentId: string, nickname: string, prompt: string): unknown[] {
        return [
            { type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: spawnCallId, arguments: JSON.stringify({ message: prompt }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: spawnCallId, output: JSON.stringify({ agent_id: agentId, nickname }) } },
        ];
    }

    // Helper: a child rollout file mirroring corpus shape — session_meta + task_started + N exec_command
    // begin/end pairs + task_complete. callIds[] are the child's distinct provider call_ids.
    function childRecords(agentId: string, parentThreadId: string, callIds: string[]): unknown[] {
        const recs: unknown[] = [
            { type: 'session_meta', payload: { id: agentId, source: { subagent: { thread_spawn: { parent_thread_id: parentThreadId, depth: 1 } } } } },
            { type: 'event_msg', payload: { type: 'task_started', turn_id: `child-turn-${agentId}` } },
        ];
        for (const cid of callIds) {
            recs.push({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: cid, arguments: JSON.stringify({ cmd: `echo ${cid}` }) } });
            recs.push({ type: 'response_item', payload: { type: 'function_call_output', call_id: cid, output: `out-${cid}` } });
        }
        recs.push({ type: 'event_msg', payload: { type: 'task_complete', turn_id: `child-turn-${agentId}` } });
        return recs;
    }

    // AC-C8-1: child internal tools merge as lifecycle children (subagent===ssn, ev.call===call_id, no sessionSubagent).
    it('AC-C8-1: child exec_command tools merge as sidechain children of the lifecycle card', async () => {
        const codexHome = await createCodexHome();
        const parentThread = '019e31bd-6275-7cf1-a525-3616befac9ec';
        const agentId = '019e31bf-f5d6-7112-9c56-c575c6ede31a';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-c8-1', 'call_spawnA', agentId, 'Architect', 'inspect auth'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-c8-1' } },
        ]);
        await writeRollout(codexHome, agentId, 'rollout-2026-05-16T17-05-24', childRecords(agentId, parentThread, ['call_x1', 'call_x2']));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);

        const lifecycle = envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle');
        expect(lifecycle).toBeDefined();
        const ssn = (lifecycle as any).ev.args.sessionSubagent;
        // Child exec_command begin envelopes present, attached to ssn, with provider call_ids.
        const childStarts = envelopes.filter((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'CodexBash' && e.subagent === ssn);
        expect(childStarts.map((e: any) => e.ev.call).sort()).toEqual(['call_x1', 'call_x2']);
        for (const cs of childStarts) {
            expect((cs as any).ev.call).not.toBe(ssn);                       // INV-1
            expect((cs as any).ev.args.sessionSubagent).toBeUndefined();     // INV-2
        }
        const childEnds = envelopes.filter((e: any) => e.ev.t === 'tool-call-end' && e.subagent === ssn && ['call_x1', 'call_x2'].includes(e.ev.call));
        expect(childEnds).toHaveLength(2);
    });

    // AC-C8-2: binding captured at spawn-time survives a parent task_complete that clears the map.
    it('AC-C8-2: child tools attach to correct ssn even after a parent task_complete clears state', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'c8-2-parent';
        const agentId = 'c8-2-agentA';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-c8-2', 'call_spawnA', agentId, 'Architect', 'work'),
            // task_complete AFTER spawn output, clears providerSubagentToSessionSubagent.
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-c8-2' } },
            // A second turn so end-of-file state no longer holds the binding.
            { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-c8-2b' } },
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-c8-2b' } },
        ]);
        await writeRollout(codexHome, agentId, 'rollout-2026-05-16T17-05-24', childRecords(agentId, parentThread, ['call_y1']));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        const lifecycle = envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle');
        const ssn = (lifecycle as any).ev.args.sessionSubagent;
        const childStart = envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.call === 'call_y1');
        expect(childStart).toBeDefined();
        expect((childStart as any).subagent).toBe(ssn);
    });

    // AC-C8-3: child turn boundaries suppressed — no extra turn-start/turn-end from child, no premature flush.
    it('AC-C8-3: child session_meta/task_started/task_complete produce no stray parent turn envelopes', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'c8-3-parent';
        const agentId = 'c8-3-agentA';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-c8-3', 'call_spawnA', agentId, 'Architect', 'work'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-c8-3' } },
        ]);
        await writeRollout(codexHome, agentId, 'rollout-2026-05-16T17-05-24', childRecords(agentId, parentThread, ['call_z1']));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        // Exactly ONE turn-start and ONE turn-end (from the parent), none synthesized from the child.
        expect(envelopes.filter((e: any) => e.ev.t === 'turn-start')).toHaveLength(1);
        expect(envelopes.filter((e: any) => e.ev.t === 'turn-end')).toHaveLength(1);
        // The parent lifecycle closed via the parent task_complete as 'completed' (not prematurely errored by child).
        const lifecycle = envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle');
        const lcCall = (lifecycle as any).ev.call;
        const lcEnd = envelopes.find((e: any) => e.ev.t === 'tool-call-end' && e.ev.call === lcCall);
        expect((lcEnd as any).ev.result.lifecycle_state).toBe('completed');
    });

    // AC-C8-4: truncated-open lifecycle flushed at end-of-replay with non-success marker (mode d / M4).
    it('AC-C8-4: truncated rollout (no close/task_complete) flushes the lifecycle as replay_truncated', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'c8-4-parent';
        const agentId = 'c8-4-agentA';
        // Truncated AFTER spawn — no close_agent, no task_complete/turn_aborted.
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35',
            parentSpawnRecords('turn-c8-4', 'call_spawnA', agentId, 'Architect', 'work'));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        const lifecycle = envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle');
        expect(lifecycle).toBeDefined();    // card still rendered
        const lcCall = (lifecycle as any).ev.call;
        const lcEnd = envelopes.find((e: any) => e.ev.t === 'tool-call-end' && e.ev.call === lcCall);
        expect(lcEnd).toBeDefined();        // card closed, not stuck open
        expect((lcEnd as any).ev.result.status).toBe('replay_truncated');
        expect((lcEnd as any).ev.result.lifecycle_state).toBe('errored');
    });

    // AC-C8-7: missing OR malformed child file tolerated — lifecycle + parent envelopes preserved (S2).
    it('AC-C8-7: missing child file omits internal tools but preserves the lifecycle card', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'c8-7-parent';
        const agentId = 'c8-7-missing-agent';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-c8-7', 'call_spawnA', agentId, 'Architect', 'work'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-c8-7' } },
        ]);
        // NO child file written for agentId.
        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        expect(envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle')).toBeDefined();
        // Zero child CodexBash envelopes.
        expect(envelopes.filter((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'CodexBash')).toHaveLength(0);
    });

    it('AC-C8-7: malformed child JSON lines omit internal tools, no exception escapes', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'c8-7b-parent';
        const agentId = 'c8-7b-agent';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-c8-7b', 'call_spawnA', agentId, 'Architect', 'work'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-c8-7b' } },
        ]);
        // Child file with malformed JSON lines (raw write, not via writeRollout's JSON.stringify).
        const dir = join(codexHome, 'sessions', '2026', '05', '16');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `rollout-2026-05-16T17-05-24-${agentId}.jsonl`), '{ this is not valid json\n}}}\nnot json at all\n');

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        expect(envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle')).toBeDefined();
        expect(envelopes.filter((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'CodexBash')).toHaveLength(0);
    });

    // AC-C8-8 (INV-3 ordering on the replay path): lifecycle-start precedes all of its child tool envelopes.
    it('AC-C8-8: lifecycle-start precedes all merged child tool envelopes for that ssn (INV-3)', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'c8-8-parent';
        const agentId = 'c8-8-agent';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-c8-8', 'call_spawnA', agentId, 'Architect', 'work'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-c8-8' } },
        ]);
        await writeRollout(codexHome, agentId, 'rollout-2026-05-16T17-05-24', childRecords(agentId, parentThread, ['call_o1', 'call_o2']));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        const lifecycle = envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle');
        const ssn = (lifecycle as any).ev.args.sessionSubagent;
        const lifecycleIdx = envelopes.indexOf(lifecycle as any);
        const childIdxs = envelopes
            .map((e: any, i: number) => ({ e, i }))
            .filter(({ e }) => e.ev.t === 'tool-call-start' && e.subagent === ssn && e.ev.name === 'CodexBash')
            .map(({ i }) => i);
        expect(childIdxs.length).toBeGreaterThan(0);
        for (const ci of childIdxs) {
            expect(ci).toBeGreaterThan(lifecycleIdx);    // INV-3
        }
    });

    // AC-C8-10: a child rollout containing a real grandchild spawn does not recurse / crash (S1).
    it('AC-C8-10: child containing a spawn_agent grandchild does not recurse infinitely', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'c8-10-parent';
        const agentId = 'c8-10-agent';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-c8-10', 'call_spawnA', agentId, 'Architect', 'work'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-c8-10' } },
        ]);
        // Child has its own exec_command AND a real grandchild spawn_agent function_call.
        const childRecs: unknown[] = [
            { type: 'session_meta', payload: { id: agentId, source: { subagent: { thread_spawn: { parent_thread_id: parentThread, depth: 1 } } } } },
            { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'call_gc1', arguments: JSON.stringify({ cmd: 'echo hi' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_gc1', output: 'hi' } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'call_grandspawn', arguments: JSON.stringify({ message: 'grandchild' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_grandspawn', output: JSON.stringify({ agent_id: 'c8-10-grandchild', nickname: 'Grand' }) } },
        ];
        await writeRollout(codexHome, agentId, 'rollout-2026-05-16T17-05-24', childRecs);

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        // The child's own exec_command merged; the grandchild spawn produced no merged child tool envelope.
        const ssnLifecycle = envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle');
        const ssn = (ssnLifecycle as any).ev.args.sessionSubagent;
        expect(envelopes.filter((e: any) => e.ev.call === 'call_gc1' && e.subagent === ssn)).not.toHaveLength(0);
        // No envelope carries the grandchild spawn call_id as a merged child tool-start (grandchild omitted).
        expect(envelopes.filter((e: any) => e.ev.t === 'tool-call-start' && e.ev.call === 'call_grandspawn' && e.ev.name === 'CodexBash')).toHaveLength(0);
    });

    // AC-C8-11 (RC-2): N>=2 subagents each merge to their OWN lifecycle card with no cross-attribution.
    it('AC-C8-11: 3 subagents each merge to their own lifecycle card with no cross-attribution', async () => {
        const codexHome = await createCodexHome();
        const parentThread = '019e31bd-6275-7cf1-a525-3616befac9ec';
        const a1 = '019e31bf-f5d6-7112-9c56-c575c6ede31a';
        const a2 = '019e31bf-f64b-7e30-83ed-d729438688c3';
        const a3 = '019e31bf-f6bb-7501-9ef9-8be22b357d64';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-c8-11' } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'call_s1', arguments: JSON.stringify({ message: 'architect work' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_s1', output: JSON.stringify({ agent_id: a1, nickname: 'Architect' }) } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'call_s2', arguments: JSON.stringify({ message: 'po work' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_s2', output: JSON.stringify({ agent_id: a2, nickname: 'ProductOwner' }) } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'call_s3', arguments: JSON.stringify({ message: 'user work' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_s3', output: JSON.stringify({ agent_id: a3, nickname: 'User' }) } },
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-c8-11' } },
        ]);
        await writeRollout(codexHome, a1, 'rollout-2026-05-16T17-05-24', childRecords(a1, parentThread, ['call_a1_x', 'call_a1_y']));
        await writeRollout(codexHome, a2, 'rollout-2026-05-16T17-05-24', childRecords(a2, parentThread, ['call_a2_x']));
        await writeRollout(codexHome, a3, 'rollout-2026-05-16T17-05-24', childRecords(a3, parentThread, ['call_a3_x', 'call_a3_y', 'call_a3_z']));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);

        // 3 distinct lifecycle cards -> 3 distinct ssn values.
        const lifecycles = envelopes.filter((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle');
        const ssns = lifecycles.map((e: any) => e.ev.args.sessionSubagent);
        expect(new Set(ssns).size).toBe(3);

        // Map each child's call_ids to the ssn they attach to; assert correct, non-cross-attributed grouping.
        const callIdToSsn = new Map<string, string>();
        for (const e of envelopes as any[]) {
            if (e.ev.t === 'tool-call-start' && e.ev.name === 'CodexBash') {
                callIdToSsn.set(e.ev.call, e.subagent);
            }
        }
        // a1's two calls share one ssn; a2's one call a different ssn; a3's three calls a third ssn.
        const ssnA1 = callIdToSsn.get('call_a1_x');
        expect(callIdToSsn.get('call_a1_y')).toBe(ssnA1);
        const ssnA2 = callIdToSsn.get('call_a2_x');
        const ssnA3 = callIdToSsn.get('call_a3_x');
        expect(callIdToSsn.get('call_a3_y')).toBe(ssnA3);
        expect(callIdToSsn.get('call_a3_z')).toBe(ssnA3);
        // No cross-attribution: the three groups' ssn are mutually distinct, and each is a real lifecycle ssn.
        expect(new Set([ssnA1, ssnA2, ssnA3]).size).toBe(3);
        for (const s of [ssnA1, ssnA2, ssnA3]) expect(ssns).toContain(s);
        // a1's call_ids never appear under a2's or a3's ssn.
        expect(ssnA1).not.toBe(ssnA2);
        expect(ssnA1).not.toBe(ssnA3);
        expect(ssnA2).not.toBe(ssnA3);
    });

    // AC-C8-8 (M6 negative postcondition): a child tool-call-start that would VIOLATE INV-1 (call===ssn)
    // or INV-2 (args.sessionSubagent present) is rejected by the postcondition guard (would be dropped).
    it('AC-C8-8: M6 postcondition guard rejects INV-1/INV-2-violating child envelopes', () => {
        const ssn = createId(); // sessionSubagent must be a valid cuid2 (wire schema constraint).
        // Valid child: call !== ssn, no sessionSubagent in args.
        const ok = createEnvelope('agent', { t: 'tool-call-start', call: 'call_ok', name: 'CodexBash', title: 't', description: 'd', args: { cmd: 'x' } }, { subagent: ssn });
        expect(childEnvelopePassesInvariants(ok, ssn)).toBe(true);
        // INV-1 violation: ev.call === ssn.
        const inv1 = createEnvelope('agent', { t: 'tool-call-start', call: ssn, name: 'CodexBash', title: 't', description: 'd', args: { cmd: 'x' } }, { subagent: ssn });
        expect(childEnvelopePassesInvariants(inv1, ssn)).toBe(false);
        // INV-2 violation: args carries sessionSubagent.
        const inv2 = createEnvelope('agent', { t: 'tool-call-start', call: 'call_bad', name: 'CodexBash', title: 't', description: 'd', args: { cmd: 'x', sessionSubagent: ssn } }, { subagent: ssn });
        expect(childEnvelopePassesInvariants(inv2, ssn)).toBe(false);
    });

    // ====================================================================================
    // Cycle 9 (A1): depth-2 grandchild internal-tool merge. Fixtures mirror real corpus depth-2
    // chains (e.g. depth-1 019d9570-181c → grandchild 019d9570-5b97). A child rollout that itself
    // contains a spawn_agent binding a grandchild whose sibling file carries exec_command must merge
    // those grandchild tools under the SAME depth-1 child ssn (no separate grandchild lifecycle card).
    // ====================================================================================

    // Helper: a child rollout that spawns ONE grandchild (binding grandAgentId) AND has its own
    // exec_command. The grandchild spawn output binds {agent_id: grandAgentId}.
    function childWithGrandchildSpawn(agentId: string, parentThreadId: string, ownCallIds: string[], grandSpawnCallId: string, grandAgentId: string): unknown[] {
        const recs: unknown[] = [
            { type: 'session_meta', payload: { id: agentId, source: { subagent: { thread_spawn: { parent_thread_id: parentThreadId, depth: 1 } } } } },
            { type: 'event_msg', payload: { type: 'task_started', turn_id: `child-turn-${agentId}` } },
        ];
        for (const cid of ownCallIds) {
            recs.push({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: cid, arguments: JSON.stringify({ cmd: `echo ${cid}` }) } });
            recs.push({ type: 'response_item', payload: { type: 'function_call_output', call_id: cid, output: `out-${cid}` } });
        }
        recs.push({ type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: grandSpawnCallId, arguments: JSON.stringify({ message: 'grandchild work' }) } });
        recs.push({ type: 'response_item', payload: { type: 'function_call_output', call_id: grandSpawnCallId, output: JSON.stringify({ agent_id: grandAgentId, nickname: 'Grand' }) } });
        recs.push({ type: 'event_msg', payload: { type: 'task_complete', turn_id: `child-turn-${agentId}` } });
        return recs;
    }

    // AC-A1-1 + AC-A1-4: depth-2 grandchild exec_command tools merge under the depth-1 child's ssn,
    // with INV-1/INV-2 preserved and no separate grandchild lifecycle card.
    it('AC-A1-1/4: depth-2 grandchild exec_command merges under the child ssn (no separate grandchild card)', async () => {
        const codexHome = await createCodexHome();
        const parentThread = '019d9570-0000-7cf1-a525-3616befac9ec';
        const childId = '019d9570-181c-7112-9c56-c575c6ede31a';
        const grandId = '019d9570-5b97-7e30-83ed-d729438688c3';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-a1-1', 'call_spawnChild', childId, 'Architect', 'inspect auth'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a1-1' } },
        ]);
        await writeRollout(codexHome, childId, 'rollout-2026-05-16T17-05-24', childWithGrandchildSpawn(childId, parentThread, ['call_child_a'], 'call_grandspawn', grandId));
        await writeRollout(codexHome, grandId, 'rollout-2026-05-16T17-06-00', childRecords(grandId, childId, ['call_gc_1', 'call_gc_2']));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);

        // Exactly ONE lifecycle card (the depth-1 child) — no separate grandchild card.
        const lifecycles = envelopes.filter((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle');
        expect(lifecycles).toHaveLength(1);
        const ssn = (lifecycles[0] as any).ev.args.sessionSubagent;

        // The depth-1 child's own exec_command merged under ssn.
        const childStart = envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.call === 'call_child_a' && e.subagent === ssn);
        expect(childStart).toBeDefined();

        // The depth-2 grandchild's exec_command tools ALSO merge under the SAME child ssn (AC-A1-1).
        // Codex finding #1: depth-2 emitted call ids are namespaced `gc:<grandId>:<rawCallId>` so sibling
        // grandchildren with colliding raw call ids do not de-dupe each other out.
        const gcExpected = [`gc:${grandId}:call_gc_1`, `gc:${grandId}:call_gc_2`];
        const gcStarts = envelopes.filter((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'CodexBash' && e.subagent === ssn && gcExpected.includes(e.ev.call));
        expect(gcStarts.map((e: any) => e.ev.call).sort()).toEqual(gcExpected);
        for (const gc of gcStarts) {
            expect((gc as any).ev.call).not.toBe(ssn);                    // INV-1
            expect((gc as any).ev.args.sessionSubagent).toBeUndefined();  // INV-2
            expect((gc as any).subagent).toBe(ssn);                       // attached to child ssn, not root
        }
        const gcEnds = envelopes.filter((e: any) => e.ev.t === 'tool-call-end' && e.subagent === ssn && gcExpected.includes(e.ev.call));
        expect(gcEnds).toHaveLength(2);
    });

    // AC-A1-2: TWO grandchildren G1, G2 (depth 2) under one child — BOTH merge (depth>2 boundary, not
    // depth>=2), neither starved by the other consuming a shared budget (branch-local visited set).
    it('AC-A1-2: two sibling grandchildren both merge under the child ssn (no shared-budget starvation)', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'a1-2-parent';
        const childId = 'a1-2-child';
        const g1 = 'a1-2-grand1';
        const g2 = 'a1-2-grand2';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-a1-2', 'call_spawnChild', childId, 'Architect', 'work'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a1-2' } },
        ]);
        // Child spawns TWO grandchildren.
        const childRecs: unknown[] = [
            { type: 'session_meta', payload: { id: childId, source: { subagent: { thread_spawn: { parent_thread_id: parentThread, depth: 1 } } } } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'call_gs1', arguments: JSON.stringify({ message: 'g1' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_gs1', output: JSON.stringify({ agent_id: g1, nickname: 'G1' }) } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'call_gs2', arguments: JSON.stringify({ message: 'g2' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_gs2', output: JSON.stringify({ agent_id: g2, nickname: 'G2' }) } },
        ];
        await writeRollout(codexHome, childId, 'rollout-2026-05-16T17-05-24', childRecs);
        await writeRollout(codexHome, g1, 'rollout-2026-05-16T17-06-00', childRecords(g1, childId, ['call_g1_x']));
        await writeRollout(codexHome, g2, 'rollout-2026-05-16T17-06-30', childRecords(g2, childId, ['call_g2_x']));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        const ssn = (envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle') as any).ev.args.sessionSubagent;
        // BOTH grandchildren's tools merged — neither sibling starved (namespaced call ids).
        expect(envelopes.find((e: any) => e.ev.call === `gc:${g1}:call_g1_x` && e.subagent === ssn)).toBeDefined();
        expect(envelopes.find((e: any) => e.ev.call === `gc:${g2}:call_g2_x` && e.subagent === ssn)).toBeDefined();
    });

    // AC-A1-2 (Codex finding #1): two sibling grandchildren that reuse the SAME raw internal call_id
    // must BOTH render — the namespaced emitted id prevents the (subagent+call) dedupe from dropping one.
    it('AC-A1-2: sibling grandchildren sharing a raw call_id both render (namespaced, no dedupe collision)', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'a1-2c-parent';
        const childId = 'a1-2c-child';
        const g1 = 'a1-2c-grand1';
        const g2 = 'a1-2c-grand2';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-a1-2c', 'call_spawnChild', childId, 'Architect', 'work'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a1-2c' } },
        ]);
        const childRecs: unknown[] = [
            { type: 'session_meta', payload: { id: childId, source: { subagent: { thread_spawn: { parent_thread_id: parentThread, depth: 1 } } } } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'gs1', arguments: JSON.stringify({ message: 'g1' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'gs1', output: JSON.stringify({ agent_id: g1, nickname: 'G1' }) } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'gs2', arguments: JSON.stringify({ message: 'g2' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'gs2', output: JSON.stringify({ agent_id: g2, nickname: 'G2' }) } },
        ];
        await writeRollout(codexHome, childId, 'rollout-2026-05-16T17-05-24', childRecs);
        // BOTH grandchildren reuse the same raw internal call_id 'call_1' (Codex per-thread numbering).
        await writeRollout(codexHome, g1, 'rollout-2026-05-16T17-06-00', childRecords(g1, childId, ['call_1']));
        await writeRollout(codexHome, g2, 'rollout-2026-05-16T17-06-30', childRecords(g2, childId, ['call_1']));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        const ssn = (envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle') as any).ev.args.sessionSubagent;
        // Both render under distinct namespaced ids despite the shared raw call_id.
        expect(envelopes.find((e: any) => e.ev.call === `gc:${g1}:call_1` && e.subagent === ssn)).toBeDefined();
        expect(envelopes.find((e: any) => e.ev.call === `gc:${g2}:call_1` && e.subagent === ssn)).toBeDefined();
    });

    // AC-A1-3: a great-grandchild (depth 3) is gracefully OMITTED — no recursion to depth 3, no crash.
    it('AC-A1-3: depth-3 great-grandchild tools are omitted, no crash', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'a1-3-parent';
        const childId = 'a1-3-child';
        const grandId = 'a1-3-grand';
        const greatId = 'a1-3-great';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            ...parentSpawnRecords('turn-a1-3', 'call_spawnChild', childId, 'Architect', 'work'),
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a1-3' } },
        ]);
        // child (depth1) spawns grand (depth2); grand spawns great (depth3) AND has own exec.
        await writeRollout(codexHome, childId, 'rollout-2026-05-16T17-05-24', childWithGrandchildSpawn(childId, parentThread, ['call_child_a'], 'call_gs', grandId));
        await writeRollout(codexHome, grandId, 'rollout-2026-05-16T17-06-00', childWithGrandchildSpawn(grandId, childId, ['call_grand_a'], 'call_ggs', greatId));
        await writeRollout(codexHome, greatId, 'rollout-2026-05-16T17-07-00', childRecords(greatId, grandId, ['call_great_x']));

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);
        const ssn = (envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle') as any).ev.args.sessionSubagent;
        // depth-1 child own exec (raw id) + depth-2 grandchild own exec (namespaced) MERGE.
        expect(envelopes.find((e: any) => e.ev.call === 'call_child_a' && e.subagent === ssn)).toBeDefined();
        expect(envelopes.find((e: any) => e.ev.call === `gc:${grandId}:call_grand_a` && e.subagent === ssn)).toBeDefined();
        // depth-3 great-grandchild exec is OMITTED (raw or namespaced — neither appears).
        expect(envelopes.filter((e: any) => typeof e.ev.call === 'string' && e.ev.call.includes('call_great_x'))).toHaveLength(0);
    });

    // ====================================================================================
    // Cycle 9 (A2): multi-target wait_agent per-target rendering via the REPLAY path. Mirrors the real
    // corpus shape: wait_agent function_call args carry `targets`[] (length 2-3); its function_call_output
    // carries a per-target `status{}` map that is PARTIAL (242/245 real cases have status for a subset).
    // ====================================================================================
    it('AC-A2-2 (replay): multi-target wait with partial output status renders all begin targets; absent ones unreported', async () => {
        const codexHome = await createCodexHome();
        const parentThread = 'a2-replay-parent';
        const t1 = 'a2-tgt-1';
        const t2 = 'a2-tgt-2';
        const t3 = 'a2-tgt-3';
        await writeRollout(codexHome, parentThread, 'rollout-2026-05-16T17-02-35', [
            { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-a2' } },
            // Spawn three children so each target resolves to its own lifecycle ssn.
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'sp1', arguments: JSON.stringify({ message: 'c1' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'sp1', output: JSON.stringify({ agent_id: t1, nickname: 'C1' }) } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'sp2', arguments: JSON.stringify({ message: 'c2' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'sp2', output: JSON.stringify({ agent_id: t2, nickname: 'C2' }) } },
            { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'sp3', arguments: JSON.stringify({ message: 'c3' }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'sp3', output: JSON.stringify({ agent_id: t3, nickname: 'C3' }) } },
            // Multi-target wait: targets[] of length 3; output status{} carries ONLY t1 (partial).
            { type: 'response_item', payload: { type: 'function_call', name: 'wait_agent', call_id: 'wait-multi', arguments: JSON.stringify({ targets: [t1, t2, t3] }) } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'wait-multi', output: JSON.stringify({ status: { [t1]: { completed: true, message: 't1 done' } } }) } },
            { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a2' } },
        ]);

        const session = { sendSessionProtocolMessage: vi.fn(), sendSessionEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        const result = await replayCodexRolloutHistory({ threadId: parentThread, session, codexHome });
        expect(result.status).toBe('replayed');
        const envelopes = session.sendSessionProtocolMessage.mock.calls.map(([e]) => e);

        // Three per-target wait begins with stable synthetic call ids.
        const waitBegins = envelopes.filter((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.wait_agent');
        expect(waitBegins.map((e: any) => e.ev.call).sort()).toEqual(['wait-multi#0:a2-tgt-1', 'wait-multi#1:a2-tgt-2', 'wait-multi#2:a2-tgt-3']);
        // Three per-target wait ends — all begin targets render even though status{} only covered t1.
        const waitEndCalls = envelopes.filter((e: any) => e.ev.t === 'tool-call-end' && typeof e.ev.call === 'string' && e.ev.call.startsWith('wait-multi#')).map((e: any) => e.ev.call).sort();
        expect(waitEndCalls).toEqual(['wait-multi#0:a2-tgt-1', 'wait-multi#1:a2-tgt-2', 'wait-multi#2:a2-tgt-3']);
        const endT2 = envelopes.find((e: any) => e.ev.t === 'tool-call-end' && e.ev.call === 'wait-multi#1:a2-tgt-2');
        expect(JSON.stringify((endT2 as any).ev.output ?? (endT2 as any).ev.result ?? {})).toContain('unreported');
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
