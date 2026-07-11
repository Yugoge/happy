// Cycle 6 (spec-20260506-203844 §5.3.D bullet 5):
// Synthetic functions.subagent_lifecycle envelope helpers — emits a
// merged lifecycle card alongside the existing 3 spawn/wait/close
// control envelopes, keyed by sessionSubagent. The app renderer
// suppresses the 3 underlying cards when a lifecycle envelope is
// present for the same sessionSubagent.

import { createEnvelope, type CreateEnvelopeOptions, type SessionEnvelope } from '@slopus/happy-wire';

export type LifecycleStateName = 'started' | 'running' | 'ready' | 'completed' | 'errored';

export type LifecycleState = {
    spawnCallId: string;
    lifecycleEnvelopeCall: string;
    state: LifecycleStateName;
    prompt: string;
    agentNickname: string | null;
    sessionSubagent: string;
    // Cycle 7 (spec-20260506-203844 §5.3.D bullet 5): buffered final_summary
    // captured from real Codex protocol path agentsStates[receiverThreadId].message
    // on `wait_agent` end (per Codex TUI wait_complete_lines surface point).
    // Inherited by `close_agent` end's lifecycle terminal envelope.
    bufferedFinalSummary?: string | null;
    // OBJ-5 (AC-A1 source-tagged buffer precedence): the PROVENANCE of bufferedFinalSummary.
    //   'final_answer' = an authoritative phase==='final_answer' agent_message text;
    //   'agentsStates' = an authoritative non-empty wait_agent/close_agent agentsStates.message;
    //   'intermediate' = a non-final agent_message kept for diagnostics ONLY (never surfaced as Result);
    //   undefined      = nothing buffered yet.
    // flush/close emit final_summary ONLY when the provenance is authoritative ('final_answer' |
    // 'agentsStates') AND the value is non-empty (trim().length > 0). This prevents intermediate
    // chatter from becoming a false Result and a null/empty agentsStates.message from erasing a real one.
    bufferedFinalSummarySource?: 'final_answer' | 'agentsStates' | 'intermediate';
};

// MIN-4 (AC-A1): the SINGLE non-empty definition shared across all buffer writes, the flush gate, and
// (via the same trim() semantics) AC-B1's renderer equality guard. A whitespace-only summary ('   ')
// is treated as empty so it never creates a Result and never erases an authoritative summary.
export function isNonEmptyFinalSummary(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

// AC-A1: a buffered summary is surfaced as the lifecycle Result ONLY when its provenance is authoritative
// (a real final_answer or a real wait/close agentsStates.message) AND the value is non-empty. Intermediate
// agent_message text (kept on the entry for diagnostics) is authoritative=false and is never a Result.
export function isAuthoritativeFinalSummary(entry: Pick<LifecycleState, 'bufferedFinalSummary' | 'bufferedFinalSummarySource'>): boolean {
    if (entry.bufferedFinalSummarySource !== 'final_answer' && entry.bufferedFinalSummarySource !== 'agentsStates') return false;
    return isNonEmptyFinalSummary(entry.bufferedFinalSummary);
}

export const LIFECYCLE_ENVELOPE_NAME = 'functions.subagent_lifecycle';

export function getSubagentLifecycles(state: { subagentLifecycles?: Map<string, LifecycleState> }): Map<string, LifecycleState> {
    return state.subagentLifecycles ?? new Map<string, LifecycleState>();
}

export function lifecycleCallId(sessionSubagent: string): string {
    return `lifecycle:${sessionSubagent}`;
}

function buildLifecycleStartArgs(sessionSubagent: string, prompt: string, agentNickname: string | null) {
    return {
        sessionSubagent,
        prompt,
        agentNickname,
        lifecycle_state: 'started' as const,
    };
}

function lifecycleDescription(prompt: string, sessionSubagent: string): string {
    if (prompt.length > 80) return `${prompt.slice(0, 77)}...`;
    return prompt || sessionSubagent;
}

// Item A #6a (AC-A1/AC-A2): a REAL provider nickname (replay function_call_output nickname, or a future
// live message.agentNickname) is authoritative and WINS. When it is ABSENT the producer MUST NOT synthesize
// a generic 'Subagent N' label — a synthesized label pre-empts the app's title fallback chain (knownTools.tsx
// agentNickname -> prompt first-line -> 'Subagent'). Returning null lets the app resolve the title to the
// truncated first line of the subagent's own prompt, which is the user-intended behavior for a no-nickname
// spawn. promoteRealAgentNickname still promotes a real provider nickname that arrives at the begin/END path.
function resolveAgentNickname(providerNickname: string | null): string | null {
    if (typeof providerNickname === 'string' && providerNickname.trim().length > 0) return providerNickname;
    return null;
}

export function emitLifecycleStart(
    sessionSubagent: string,
    spawnCallId: string,
    prompt: string,
    agentNickname: string | null,
    opts: CreateEnvelopeOptions,
    subagentLifecycles: Map<string, LifecycleState>,
    envelopes: SessionEnvelope[],
): void {
    if (subagentLifecycles.has(sessionSubagent)) return;
    // Item A (AC-A1): null when no real provider nickname, so the app's prompt-first-line title fallback wins.
    const resolvedNickname = resolveAgentNickname(agentNickname);
    const lifecycleEnvelopeCall = lifecycleCallId(sessionSubagent);
    subagentLifecycles.set(sessionSubagent, {
        spawnCallId,
        lifecycleEnvelopeCall,
        state: 'started',
        prompt,
        agentNickname: resolvedNickname,
        sessionSubagent,
    });
    envelopes.push(createEnvelope('agent', {
        t: 'tool-call-start',
        call: lifecycleEnvelopeCall,
        name: LIFECYCLE_ENVELOPE_NAME,
        title: 'Subagent',
        description: lifecycleDescription(prompt, sessionSubagent),
        args: buildLifecycleStartArgs(sessionSubagent, prompt, resolvedNickname),
    }, opts));
}

// Item A (AC-A2): a REAL provider nickname WINS even when it arrives AFTER the lifecycle was created. Real
// Codex stores the spawn nickname in the function_call_output ({agent_id, nickname}), which the replay path
// forwards onto the spawn-END; at that point the lifecycle already exists (created at spawn-begin with a NULL
// nickname — AC-A1, so the app prompt-first-line title fallback applies), so the begin-time emitLifecycleStart
// cannot have seen it. Promote the real nickname onto the existing entry. Only a genuine non-empty provider
// nickname promotes; a null/empty/missing nickname leaves the null nickname intact (the app then renders the
// prompt first-line — no regression for the live no-nickname path).
export function promoteRealAgentNickname(
    sessionSubagent: string,
    providerNickname: unknown,
    subagentLifecycles: Map<string, LifecycleState>,
): void {
    if (typeof providerNickname !== 'string' || providerNickname.trim().length === 0) return;
    const entry = subagentLifecycles.get(sessionSubagent);
    if (entry) entry.agentNickname = providerNickname;
}

export function emitLifecycleEnd(
    sessionSubagent: string,
    terminalState: LifecycleStateName,
    result: Record<string, unknown> | undefined,
    opts: CreateEnvelopeOptions,
    subagentLifecycles: Map<string, LifecycleState>,
    envelopes: SessionEnvelope[],
): void {
    const entry = subagentLifecycles.get(sessionSubagent);
    if (!entry) return;
    entry.state = terminalState;
    envelopes.push(createEnvelope('agent', {
        t: 'tool-call-end',
        call: entry.lifecycleEnvelopeCall,
        ...(result !== undefined ? { result } : {}),
    }, opts));
}

// Cycle 7 (spec-20260506-203844 §5.3.D bullet 5): real Codex protocol path for
// final_summary text. Per /tmp/codex-ts-v0.125.0/v2/CollabAgentState.ts the
// shape is { status, message: string | null }; per ThreadItem.ts:90-101 it
// lives at agentsStates[threadId]. Codex's first_agent_state
// (multi_agents.rs:537-550) selects the first matching receiver thread, then
// any state by ascending threadId — mirrored here.
export function readAgentsStatesMessage(message: Record<string, unknown>): string | null | undefined {
    const agentsStates = message.agentsStates;
    if (!agentsStates || typeof agentsStates !== 'object' || Array.isArray(agentsStates)) return undefined;
    const states = agentsStates as Record<string, unknown>;
    const ids = Array.isArray(message.receiverThreadIds) ? message.receiverThreadIds : [];
    const candidates = [...ids.filter((v): v is string => typeof v === 'string'), ...Object.keys(states).sort()];
    for (const id of candidates) {
        const entry = states[id];
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const msg = (entry as Record<string, unknown>).message;
            if (typeof msg === 'string' || msg === null) return msg;
        }
    }
    return undefined;
}

export function flushOpenLifecycles(
    terminalState: LifecycleStateName,
    statusValue: string,
    opts: CreateEnvelopeOptions,
    subagentLifecycles: Map<string, LifecycleState>,
    envelopes: SessionEnvelope[],
): void {
    for (const entry of subagentLifecycles.values()) {
        if (entry.state === 'completed' || entry.state === 'errored') continue;
        entry.state = terminalState;
        // Bug fix (live-confirmed): a subagent terminated by the end-of-turn flush path WITHOUT an
        // explicit close_agent never inherited its final answer — the bare { status, lifecycle_state }
        // result lacked final_summary, so the app's "Result" section never appeared. Capture the summary
        // onto bufferedFinalSummary so it is available at terminal time. OBJ-5/MIN-4 (AC-A1): the bare
        // length>0 gate was necessary-not-sufficient — it would surface INTERMEDIATE chatter as a false
        // Result. Now emit final_summary ONLY when the provenance is AUTHORITATIVE (a real final_answer or
        // a real wait/close agentsStates.message) AND non-empty under the shared trim() definition, so a
        // whitespace-only final answer and a flush-without-final_answer both correctly produce NO Result.
        envelopes.push(createEnvelope('agent', {
            t: 'tool-call-end',
            call: entry.lifecycleEnvelopeCall,
            result: {
                status: statusValue,
                ...(isAuthoritativeFinalSummary(entry) ? { final_summary: entry.bufferedFinalSummary } : {}),
                lifecycle_state: terminalState,
            },
        }, opts));
    }
}
