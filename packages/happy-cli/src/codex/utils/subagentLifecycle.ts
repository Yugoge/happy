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
};

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
    const lifecycleEnvelopeCall = lifecycleCallId(sessionSubagent);
    subagentLifecycles.set(sessionSubagent, {
        spawnCallId,
        lifecycleEnvelopeCall,
        state: 'started',
        prompt,
        agentNickname,
        sessionSubagent,
    });
    envelopes.push(createEnvelope('agent', {
        t: 'tool-call-start',
        call: lifecycleEnvelopeCall,
        name: LIFECYCLE_ENVELOPE_NAME,
        title: 'Subagent',
        description: lifecycleDescription(prompt, sessionSubagent),
        args: buildLifecycleStartArgs(sessionSubagent, prompt, agentNickname),
    }, opts));
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
        envelopes.push(createEnvelope('agent', {
            t: 'tool-call-end',
            call: entry.lifecycleEnvelopeCall,
            result: { status: statusValue, lifecycle_state: terminalState },
        }, opts));
    }
}
