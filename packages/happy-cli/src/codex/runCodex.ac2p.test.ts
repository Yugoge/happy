// Cycle 16 / AC2P (spec-20260520-051938 §5.16): the LIVE runCodex loop must thread the per-turn
// collab BEGIN-pairing Set (emittedCollabBeginCallIds) + multi-target wait BEGIN target map
// (waitTargetsByCallId) across mapper calls, exactly as the replay path (rolloutHistoryReplay.ts:
// 239/242/265/268) does. Without that, a control-verb END whose BEGIN arrived in an EARLIER message
// is mis-classified as a true orphan (sessionProtocolMapper.ts:843) and its legitimate tool-call-end
// is suppressed — the runtime no-op behind the Wave-1 lifecycle render fix.
//
// runCodex.ts is a long-lived RPC loop that cannot be imported in node-env vitest (it pulls in the
// session/api/process side-effects). So these tests reproduce runCodex's EXACT state-reconstruction
// (rebuild CodexTurnState from individual mapper-result fields with `mapped.X ?? existing` fallback)
// against the pure mapper, contrasting the BUGGY reconstruction (the two Sets dropped) with the FIXED
// reconstruction (the two Sets threaded). This is the deterministic mirror of the source change.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    mapCodexMcpMessageToSessionEnvelopes,
} from './utils/sessionProtocolMapper';

type AnyState = Parameters<typeof mapCodexMcpMessageToSessionEnvelopes>[1];
type Mapped = ReturnType<typeof mapCodexMcpMessageToSessionEnvelopes>;

// Mirrors the LIVE runCodex loop AFTER the AC2P fix: rebuild the next CodexTurnState from the mapper
// result's individual fields, threading emittedCollabBeginCallIds + waitTargetsByCallId back with the
// `?? existing` fallback (the mapper omits them on early-return paths). NEVER sets replay:true.
function liveStepFixed(message: Record<string, unknown>, prior: AnyState): { mapped: Mapped; next: AnyState } {
    const mapped = mapCodexMcpMessageToSessionEnvelopes(message, prior);
    const next: AnyState = {
        currentTurnId: mapped.currentTurnId,
        startedSubagents: mapped.startedSubagents,
        activeSubagents: mapped.activeSubagents,
        providerSubagentToSessionSubagent: mapped.providerSubagentToSessionSubagent,
        subagentLifecycles: mapped.subagentLifecycles,
        emittedCollabBeginCallIds: mapped.emittedCollabBeginCallIds ?? prior.emittedCollabBeginCallIds,
        waitTargetsByCallId: mapped.waitTargetsByCallId ?? prior.waitTargetsByCallId,
    };
    return { mapped, next };
}

// Mirrors the OLD (buggy) runCodex loop BEFORE the AC2P fix: rebuild from only the 5 threaded fields;
// the two Sets are DROPPED, so each message starts them empty.
function liveStepBuggy(message: Record<string, unknown>, prior: AnyState): { mapped: Mapped; next: AnyState } {
    const mapped = mapCodexMcpMessageToSessionEnvelopes(message, prior);
    const next: AnyState = {
        currentTurnId: mapped.currentTurnId,
        startedSubagents: mapped.startedSubagents,
        activeSubagents: mapped.activeSubagents,
        providerSubagentToSessionSubagent: mapped.providerSubagentToSessionSubagent,
        subagentLifecycles: mapped.subagentLifecycles,
        // emittedCollabBeginCallIds + waitTargetsByCallId intentionally DROPPED (the bug).
    };
    return { mapped, next };
}

function toolEndCalls(mapped: Mapped): string[] {
    return mapped.envelopes.filter(e => e.ev.t === 'tool-call-end').map(e => (e.ev as any).call as string);
}

describe('AC2P — runCodex live loop threads collab begin/end-pairing state across messages', () => {
    // A spawn lifecycle is created in message 1; a stand-alone control-verb (wait, no resolvable ssn at
    // END after the lifecycle is gone) is the canonical case where the emitted-begin Set is the ONLY
    // thing keeping the legitimate END from being orphan-suppressed. To isolate the Set's role we use a
    // control verb whose END does NOT resolve a child lifecycle (isChildEnd === false), so the ONLY
    // discriminator is emittedCollabBeginCallIds.has(call). A wait_agent with NO matching lifecycle is
    // exactly that shape.
    function startTurn(step: typeof liveStepFixed) {
        return step({ type: 'task_started' }, { currentTurnId: null });
    }

    it('REGRESSION (bug): dropping the two Sets orphan-suppresses a legit cross-message control-verb END', () => {
        // Message 0: turn start. Message 1: a top-level control-verb BEGIN with no resolvable lifecycle.
        // Message 2: its matching END arrives in a LATER mapper call. With the Set dropped, the END is
        // mis-classified as a true orphan and suppressed.
        let state = startTurn(liveStepBuggy).next;
        const begin = liveStepBuggy(
            { type: 'collab_agent_call_begin', call_id: 'verb-1', tool: 'wait', receiverThreadIds: [] },
            state,
        );
        state = begin.next;
        // BEGIN emitted a tool-call-start.
        expect(begin.mapped.envelopes.some(e => e.ev.t === 'tool-call-start' && (e.ev as any).call === 'verb-1')).toBe(true);

        const end = liveStepBuggy(
            { type: 'collab_agent_call_end', call_id: 'verb-1', tool: 'wait', status: 'completed' },
            state,
        );
        // BUG: the END's call_id is not in the (freshly-empty) Set -> isTrueOrphanEnd -> suppressed.
        expect(toolEndCalls(end.mapped)).not.toContain('verb-1');
    });

    it('FIX: threading the two Sets pairs a cross-message control-verb begin/end (no orphan suppression)', () => {
        let state = startTurn(liveStepFixed).next;
        const begin = liveStepFixed(
            { type: 'collab_agent_call_begin', call_id: 'verb-1', tool: 'wait', receiverThreadIds: [] },
            state,
        );
        state = begin.next;
        expect(begin.mapped.envelopes.some(e => e.ev.t === 'tool-call-start' && (e.ev as any).call === 'verb-1')).toBe(true);
        // The BEGIN recorded its call_id in the threaded Set.
        expect(state.emittedCollabBeginCallIds?.has('verb-1')).toBe(true);

        const end = liveStepFixed(
            { type: 'collab_agent_call_end', call_id: 'verb-1', tool: 'wait', status: 'completed' },
            state,
        );
        // FIX: the END's begin was emitted (threaded Set) -> not an orphan -> the legit end is emitted.
        expect(toolEndCalls(end.mapped)).toContain('verb-1');
    });

    it('FIX: runCodex passes AND reads back both collections at the mapper call site (set-threading)', () => {
        // Proves the source contract: after a BEGIN that mutates the Set, the live-reconstructed next
        // state still carries that Set (passes-in + reads-back), and the Map is preserved across a hop
        // that omits it (the `?? existing` fallback).
        let state = startTurn(liveStepFixed).next;
        expect(state.emittedCollabBeginCallIds).toBeInstanceOf(Set);
        expect(state.waitTargetsByCallId).toBeInstanceOf(Map);

        const begin = liveStepFixed(
            { type: 'collab_agent_call_begin', call_id: 'verb-x', tool: 'wait', receiverThreadIds: [] },
            state,
        );
        // Read-back: the mutated Set survives into the next live state.
        expect(begin.next.emittedCollabBeginCallIds?.has('verb-x')).toBe(true);

        // A subsequent message type that early-returns WITHOUT the two fields (token_count) must NOT
        // wipe them — the `?? existing` fallback preserves them (mirrors rolloutHistoryReplay :265/:268).
        const tokenStep = liveStepFixed({ type: 'token_count' }, begin.next);
        expect(tokenStep.next.emittedCollabBeginCallIds?.has('verb-x')).toBe(true);
        expect(tokenStep.next.waitTargetsByCallId).toBeInstanceOf(Map);
    });

    it('ORDERING REGRESSION (codex finding 3): spawn-begin(empty rcv) -> child commandExecution -> spawn-end threads the child under the lifecycle ssn', () => {
        // event_mapping.rs:75-86 spawn-begin carries EMPTY receiverThreadIds; the child commandExecution
        // arrives on the child thread BEFORE spawn-end binds it. This verifies the child threads under the
        // lifecycle ssn via the persisted providerSubagentToSessionSubagent map (already threaded by
        // runCodex), proving the AC2 gap is the two Sets only — not the child-thread binding.
        let state = startTurn(liveStepFixed).next;
        const begin = liveStepFixed(
            { type: 'collab_agent_call_begin', call_id: 'spawn-1', tool: 'spawnAgent', prompt: 'inspect', receiverThreadIds: [], agentsStates: {} },
            state,
        );
        const lifecycleStart = begin.mapped.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle');
        expect(lifecycleStart).toBeDefined();
        const ssn = (lifecycleStart!.ev as any).args.sessionSubagent as string;
        state = begin.next;

        // spawn-end binds the child thread to the ssn (event_mapping.rs:104-114).
        const end = liveStepFixed(
            { type: 'collab_agent_call_end', call_id: 'spawn-1', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child-thread'], agentsStates: { 'child-thread': { status: 'running', message: null } } },
            state,
        );
        state = end.next;

        // The subagent's OWN child work-tool (commandExecution) arrives on the child thread.
        const child = liveStepFixed(
            { type: 'exec_command_begin', call_id: 'cmd-1', command: 'ls -la', threadId: 'child-thread', turnId: 'child-turn' },
            state,
        );
        const childToolStart = child.mapped.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'CodexBash');
        expect(childToolStart).toBeDefined();
        // The child work-tool threads UNDER the lifecycle ssn (sidechain child), not at top level.
        expect((childToolStart as any).subagent).toBe(ssn);
    });

    it('REPLAY-RECONSTRUCTION PARITY: live first-stream (fixed) and full-result reconstruction produce identical merged children + control-verb pairing', () => {
        // The full-result threading (existing tests / replay caller) is the reference: passing the whole
        // mapper result as the next state. The AC2P fix makes the field-by-field live reconstruction
        // produce the SAME tool-call-start/end pairing. We compare the (call, t) pairing across a
        // spawn -> child cmd -> wait(begin/end) -> close(begin/end) sequence.
        const sequence: Record<string, unknown>[] = [
            { type: 'task_started' },
            { type: 'collab_agent_call_begin', call_id: 'spawn-1', tool: 'spawnAgent', prompt: 'p', receiverThreadIds: [], agentsStates: {} },
            { type: 'collab_agent_call_end', call_id: 'spawn-1', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child-A'], agentsStates: { 'child-A': { status: 'running', message: null } } },
            { type: 'exec_command_begin', call_id: 'cmd-1', command: 'pwd', threadId: 'child-A', turnId: 'child-turn' },
            { type: 'exec_command_end', call_id: 'cmd-1', status: 'completed', threadId: 'child-A', turnId: 'child-turn' },
            { type: 'collab_agent_call_begin', call_id: 'wait-1', tool: 'wait', receiverThreadIds: ['child-A'] },
            { type: 'collab_agent_call_end', call_id: 'wait-1', tool: 'wait', status: 'completed', receiverThreadIds: ['child-A'], agentsStates: { 'child-A': { status: 'completed', message: 'done' } } },
            { type: 'collab_agent_call_begin', call_id: 'close-1', tool: 'closeAgent', receiverThreadIds: ['child-A'] },
            { type: 'collab_agent_call_end', call_id: 'close-1', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['child-A'] },
        ];

        // The lifecycle ssn is a fresh random cuid2 per run, so canonicalize the dynamic
        // `lifecycle:<cuid>` call id to a stable token — the STRUCTURE of the pairing is what parity
        // asserts, not the value of the random id.
        function canon(call: string): string {
            return call.startsWith('lifecycle:') ? 'lifecycle:<ssn>' : call;
        }

        // Path A: the FIXED live field-by-field reconstruction.
        function runLiveFixed(): Array<[string, string]> {
            let state: AnyState = { currentTurnId: null };
            const pairs: Array<[string, string]> = [];
            for (const msg of sequence) {
                const { mapped, next } = liveStepFixed(msg, state);
                for (const e of mapped.envelopes) {
                    if (e.ev.t === 'tool-call-start' || e.ev.t === 'tool-call-end') {
                        pairs.push([canon((e.ev as any).call), e.ev.t]);
                    }
                }
                state = next;
            }
            return pairs;
        }

        // Path B: full-result threading (the replay/reference shape — pass the whole result as next state).
        function runFullResult(): Array<[string, string]> {
            let state: AnyState = { currentTurnId: null };
            const pairs: Array<[string, string]> = [];
            for (const msg of sequence) {
                const mapped = mapCodexMcpMessageToSessionEnvelopes(msg, state);
                for (const e of mapped.envelopes) {
                    if (e.ev.t === 'tool-call-start' || e.ev.t === 'tool-call-end') {
                        pairs.push([canon((e.ev as any).call), e.ev.t]);
                    }
                }
                state = mapped as unknown as AnyState;
            }
            return pairs;
        }

        const live = runLiveFixed();
        const full = runFullResult();
        // Identical pairing — the live reconstruction reconstructs the merged card identically.
        expect(live).toEqual(full);
        // Every control-verb begin has its matching end (no dangling start, no orphan-suppressed end).
        const starts = live.filter(([, t]) => t === 'tool-call-start').map(([c]) => c);
        const ends = new Set(live.filter(([, t]) => t === 'tool-call-end').map(([c]) => c));
        for (const call of ['wait-1', 'close-1', 'cmd-1']) {
            expect(starts).toContain(call);
            expect(ends.has(call)).toBe(true);
        }
    });
});

// Codex finding 2 (revert-sensitivity): the behavioral tests above exercise the PURE mapper under two
// reconstruction strategies, but runCodex.ts itself cannot be imported in node-env vitest (RPC/session/
// process side-effects). So this source-contract test reads runCodex.ts and asserts the AC2P wiring is
// physically present at the live mapper call site — making the suite FAIL if the 19-line source change
// is reverted. This couples the deterministic check to the actual production edit.
describe('AC2P — runCodex.ts source contract (revert-sensitive)', () => {
    const runCodexSource = readFileSync(join(__dirname, 'runCodex.ts'), 'utf8');

    it('declares the two persisted collections in the live loop', () => {
        expect(runCodexSource).toMatch(/let\s+codexEmittedCollabBeginCallIds\s*=\s*new Set<string>\(\)/);
        expect(runCodexSource).toMatch(/let\s+codexWaitTargetsByCallId\s*=\s*new Map<string,\s*string\[\]>\(\)/);
    });

    it('passes both collections INTO the live mapper call', () => {
        expect(runCodexSource).toMatch(/emittedCollabBeginCallIds:\s*codexEmittedCollabBeginCallIds/);
        expect(runCodexSource).toMatch(/waitTargetsByCallId:\s*codexWaitTargetsByCallId/);
    });

    it('reads both collections BACK with the `?? existing` replay-parity fallback (mirrors rolloutHistoryReplay :265/:268)', () => {
        expect(runCodexSource).toMatch(/codexEmittedCollabBeginCallIds\s*=\s*mapped\.emittedCollabBeginCallIds\s*\?\?\s*codexEmittedCollabBeginCallIds/);
        expect(runCodexSource).toMatch(/codexWaitTargetsByCallId\s*=\s*mapped\.waitTargetsByCallId\s*\?\?\s*codexWaitTargetsByCallId/);
    });

    it('does NOT set replay:true on the live mapper call (keeps the :706 fan-out gate inert)', () => {
        // The live mapper-call object literal must not contain `replay: true`. Guard against accidental
        // enabling of the replay-only multi-target fan-out on the live path.
        const callSite = runCodexSource.slice(
            runCodexSource.indexOf('mapCodexMcpMessageToSessionEnvelopes(msg, {'),
            runCodexSource.indexOf('for (const envelope of mapped.envelopes)'),
        );
        expect(callSite.length).toBeGreaterThan(0);
        expect(callSite).not.toMatch(/replay:\s*true/);
    });
});
