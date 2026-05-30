import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createEnvelope, type CreateEnvelopeOptions, type SessionEnvelope } from '@slopus/happy-wire';
import { logger } from '@/ui/logger';
import {
    mapCodexMcpMessageToSessionEnvelopes,
    type CodexTurnState,
} from './utils/sessionProtocolMapper';
import { flushOpenLifecycles, lifecycleCallId, type LifecycleState } from './utils/subagentLifecycle';

// Cycle 8 (M2): a binding captured at parent spawn-output time. The child rollout file for `agentId`
// is `rollout-<ts>-<agentId>.jsonl`; its internal tool calls merge as sidechain children of the
// lifecycle card identified by `sessionSubagent` (ssn), inheriting `parentTurnId`. Captured at spawn
// time and stored OUTSIDE CodexTurnState so it survives the parent's intervening task_complete clears
// (the corpus parent has 30 task_complete events that wipe providerSubagentToSessionSubagent).
type ChildSpawnBinding = {
    agentId: string;
    sessionSubagent: string;
    parentTurnId: string | null;
    recordTime?: number;
};

// Cycle 8 (S1): bound the child-merge depth so a child rollout that itself contains a real spawn_agent
// (grandchild) cannot trigger runaway recursion. Direct children are depth 1; grandchildren (depth >= 2)
// are not merged this cycle (graceful omission). The corpus sampled parent has 0 real grandchildren.
const MAX_CHILD_MERGE_DEPTH = 1;

type ReplaySession = {
    sendSessionProtocolMessage: (envelope: SessionEnvelope) => void;
    sendSessionEvent: (event: { type: 'message'; message: string }) => void;
    flush?: () => Promise<void>;
};

type ReplayResultStatus = 'replayed' | 'failed';

export type CodexRolloutHistoryReplayResult = {
    status: ReplayResultStatus;
    threadId: string;
    files: string[];
    recordsRead: number;
    envelopesSent: number;
    reason?: string;
};

type ReplayState = {
    mapper: CodexTurnState;
    toolNamesByCallId: Map<string, string>;
    // Cycle 8 (M2): agent_id -> {ssn, parentTurnId} bindings captured at parent spawn-output time,
    // stored on the replay state (OUTSIDE the mapper's CodexTurnState) so they survive the parent's
    // task_complete map-clears. Consumed by the child-merge pass after the parent replay finishes.
    childSpawnBindings: Map<string, ChildSpawnBinding>;
};

function codexHome(explicitHome?: string): string {
    return explicitHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function findRolloutFilesForThread(threadId: string, home: string): Promise<string[]> {
    const sessionsDir = join(home, 'sessions');
    if (!existsSync(sessionsDir)) {
        return [];
    }

    const matches: string[] = [];
    async function walk(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(path);
                continue;
            }
            if (entry.isFile()
                && entry.name.startsWith('rollout-')
                && entry.name.endsWith(`-${threadId}.jsonl`)) {
                matches.push(path);
            }
        }
    }

    await walk(sessionsDir);
    return matches.sort();
}

function parseJsonLine(line: string): Record<string, unknown> | null {
    if (!line.trim()) {
        return null;
    }
    try {
        const parsed = JSON.parse(line);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function textFromContent(content: unknown): string | null {
    if (typeof content === 'string') {
        return content;
    }
    if (!Array.isArray(content)) {
        return null;
    }

    const parts: string[] = [];
    for (const item of content) {
        if (!isRecord(item)) {
            continue;
        }
        if (typeof item.text === 'string') {
            parts.push(item.text);
        }
    }

    const text = parts.join('\n\n').trim();
    return text.length > 0 ? text : null;
}

function textFromUserPayload(payload: Record<string, unknown>): string | null {
    if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
        return payload.message;
    }
    return textFromContent(payload.text_elements);
}

function parseArguments(value: unknown): Record<string, unknown> {
    if (isRecord(value)) {
        return value;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : { value: parsed };
    } catch {
        return { value };
    }
}

function commandFromArguments(args: Record<string, unknown>): unknown {
    if (args.command !== undefined) {
        return args.command;
    }
    if (args.cmd !== undefined) {
        return args.cmd;
    }
    if (args.argv !== undefined) {
        return args.argv;
    }
    return args;
}

// Cycle 7 (M2.c): normalize the per-verb receiver-thread arg shapes observed in real Codex rollouts.
// spawn_agent: receiverThreadIds populated at end (from agent_id); wait_agent: `targets`[] (array);
// close_agent: `target` (singular string). Returns a string[] the mapper's collab handlers consume.
function collabReceiverThreadIds(args: Record<string, unknown>): string[] {
    if (Array.isArray(args.receiverThreadIds)) {
        return args.receiverThreadIds.filter((v): v is string => typeof v === 'string' && v.length > 0);
    }
    if (Array.isArray(args.targets)) {
        return args.targets.filter((v): v is string => typeof v === 'string' && v.length > 0);
    }
    if (typeof args.target === 'string' && args.target.length > 0) {
        return [args.target];
    }
    return [];
}

function outputText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined || value === null) {
        return '';
    }
    return JSON.stringify(value);
}

function normalizeToolName(name: unknown): string {
    return typeof name === 'string' && name.length > 0 ? name : 'unknown';
}

function mcpPartsFromName(name: string): { server: string; tool: string } | null {
    const match = /^mcp__(.+?)__(.+)$/.exec(name);
    if (!match) {
        return null;
    }
    return { server: match[1], tool: match[2] };
}

// A2 replay path (AC-C6-2): maps all known collab lifecycle verb spellings to the canonical
// COLLAB_VERB_MAP key used by sessionProtocolMapper.ts. Covers camelCase (live app-server
// protocol) and snake_case (Codex CLI rollout file variants). Value is the canonical tool
// name passed as `tool` in the synthesized collab_agent_call_begin/end message so the
// mapper's COLLAB_VERB_MAP lookup produces the correct verb (e.g. 'spawnAgent' → 'spawn_agent').
const COLLAB_REPLAY_TOOL_MAP = new Map<string, string>([
    ['spawnAgent', 'spawnAgent'],
    ['spawn_agent', 'spawnAgent'],
    ['sendInput', 'sendInput'],
    ['send_input', 'sendInput'],
    ['wait', 'wait'],
    ['wait_agent', 'wait'],
    ['closeAgent', 'closeAgent'],
    ['close_agent', 'closeAgent'],
    ['resumeAgent', 'resumeAgent'],
    ['resume_agent', 'resumeAgent'],
]);

function createReplayState(): ReplayState {
    return {
        mapper: {
            currentTurnId: null,
            startedSubagents: new Set<string>(),
            activeSubagents: new Set<string>(),
            providerSubagentToSessionSubagent: new Map<string, string>(),
            subagentLifecycles: new Map(),
            // Cycle 8 (M5): seed the per-turn emitted-collab-begin Set so the orphan-end discriminator
            // persists across mapWithState calls on the REPLAY path (the live A1 caller leaves this unset,
            // keeping M5 inert there — replay-only, AC-C8-9).
            emittedCollabBeginCallIds: new Set<string>(),
        },
        toolNamesByCallId: new Map<string, string>(),
        childSpawnBindings: new Map<string, ChildSpawnBinding>(),
    };
}

function mapWithState(message: Record<string, unknown>, state: ReplayState): SessionEnvelope[] {
    const mapped = mapCodexMcpMessageToSessionEnvelopes(message, state.mapper);
    state.mapper = {
        currentTurnId: mapped.currentTurnId,
        startedSubagents: mapped.startedSubagents,
        activeSubagents: mapped.activeSubagents,
        providerSubagentToSessionSubagent: mapped.providerSubagentToSessionSubagent,
        subagentLifecycles: mapped.subagentLifecycles,
        // Cycle 7 (M2.a): the mapper result intentionally omits recordTime; preserve the per-record
        // value across the rebuild so every mapWithState call for the SAME record inherits it.
        recordTime: state.mapper.recordTime,
        // Cycle 8 (M5): preserve the emitted-collab-begin Set across the rebuild so a control-verb BEGIN
        // recorded earlier in the turn is still seen when its END arrives in a later mapWithState call.
        emittedCollabBeginCallIds: mapped.emittedCollabBeginCallIds ?? state.mapper.emittedCollabBeginCallIds,
    };
    return mapped.envelopes;
}

// Cycle 7 (M2): parse the rollout record's top-level ISO-8601 `timestamp` to epoch-ms. Returns
// undefined for a missing/garbage timestamp so the mapper falls back to createEnvelope's Date.now()
// default (M2 guard — never emit NaN: createEnvelope's zod schema accepts NaN but it corrupts ordering).
function parseRecordTime(record: Record<string, unknown>): number | undefined {
    const ts = record.timestamp;
    if (typeof ts !== 'string') return undefined;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function userTextEnvelope(text: string, state: ReplayState): SessionEnvelope {
    const turn = state.mapper.currentTurnId;
    // Cycle 7 (M2.a): user-text replay envelopes inherit the per-record historical time.
    const recordTime = state.mapper.recordTime;
    const hasTime = typeof recordTime === 'number' && Number.isFinite(recordTime);
    const opts = {
        ...(turn ? { turn } : {}),
        ...(hasTime ? { time: recordTime } : {}),
    };
    return createEnvelope('user', { t: 'text', text }, Object.keys(opts).length > 0 ? opts : undefined);
}

function mapFunctionCall(payload: Record<string, unknown>, state: ReplayState): SessionEnvelope[] {
    const callId = typeof payload.call_id === 'string'
        ? payload.call_id
        : (typeof payload.callId === 'string' ? payload.callId : undefined);
    if (!callId) {
        return [];
    }

    const name = normalizeToolName(payload.name);
    const args = parseArguments(payload.arguments);
    state.toolNamesByCallId.set(callId, name);

    if (name === 'exec_command') {
        return mapWithState({
            type: 'exec_command_begin',
            call_id: callId,
            command: commandFromArguments(args),
            cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
            description: typeof args.description === 'string' ? args.description : undefined,
        }, state);
    }

    if (name === 'apply_patch') {
        return mapWithState({
            type: 'patch_apply_begin',
            call_id: callId,
            changes: isRecord(args.changes) ? args.changes : args,
        }, state);
    }

    const mcpParts = mcpPartsFromName(name);
    if (mcpParts) {
        return mapWithState({
            type: 'mcp_tool_call_begin',
            call_id: callId,
            server: mcpParts.server,
            tool: mcpParts.tool,
            arguments: args,
        }, state);
    }

    // A2 replay path (AC-C6-2): collab lifecycle control verbs arrive from rollout files as
    // function_call payloads. Route them through collab_agent_call_begin so the mapper's
    // collab_agent_call_begin handler fires emitLifecycleStart for spawn_agent and resolves
    // sessionSubagent for the other control verbs. COLLAB_REPLAY_TOOL_MAP covers both
    // camelCase (live Codex app-server protocol keys) and snake_case (Codex CLI rollout variants).
    if (COLLAB_REPLAY_TOOL_MAP.has(name)) {
        return mapWithState({
            type: 'collab_agent_call_begin',
            call_id: callId,
            tool: COLLAB_REPLAY_TOOL_MAP.get(name) ?? name,
            // Cycle 7 (M2.c): real Codex rollout spawn_agent args use `message`, not `prompt`
            // (confirmed against /root/.codex/sessions/2026/05/16/rollout-…-019e31bd-….jsonl). Read both
            // so the A2 lifecycle card description is not empty.
            prompt: typeof args.prompt === 'string' ? args.prompt : (typeof args.message === 'string' ? args.message : null),
            model: typeof args.model === 'string' ? args.model : null,
            agentNickname: typeof args.agentNickname === 'string' ? args.agentNickname : null,
            // Cycle 7 (M2.c): real wait_agent uses `targets`[]; close_agent uses `target` (singular).
            // Synthesize receiverThreadIds from receiverThreadIds ?? targets ?? [target] so parallel A2
            // subagents attach to the correct lifecycle (the begin/end handlers resolve ssn from the
            // first receiver thread id; single-subagent still works via the single-active fallback).
            receiverThreadIds: collabReceiverThreadIds(args),
            agentsStates: isRecord(args.agentsStates) ? args.agentsStates : {},
        }, state);
    }

    return mapWithState({
        type: 'dynamic_tool_call_begin',
        call_id: callId,
        namespace: typeof payload.namespace === 'string' ? payload.namespace : 'functions',
        tool: name,
        arguments: args,
    }, state);
}

function mapFunctionCallOutput(payload: Record<string, unknown>, state: ReplayState): SessionEnvelope[] {
    const callId = typeof payload.call_id === 'string'
        ? payload.call_id
        : (typeof payload.callId === 'string' ? payload.callId : undefined);
    if (!callId) {
        return [];
    }

    const name = state.toolNamesByCallId.get(callId) ?? 'unknown';
    const output = outputText(payload.output);

    if (name === 'exec_command') {
        return mapWithState({
            type: 'exec_command_end',
            call_id: callId,
            output,
            status: 'completed',
        }, state);
    }

    if (name === 'apply_patch') {
        return mapWithState({
            type: 'patch_apply_end',
            call_id: callId,
            output,
            status: 'completed',
        }, state);
    }

    const mcpParts = mcpPartsFromName(name);
    if (mcpParts) {
        return mapWithState({
            type: 'mcp_tool_call_end',
            call_id: callId,
            server: mcpParts.server,
            tool: mcpParts.tool,
            output,
            result: payload.output,
            status: 'completed',
        }, state);
    }

    // A2 replay path (AC-C6-2): route collab lifecycle control verb ends through collab_agent_call_end
    // so the mapper's handler fires emitLifecycleEnd for close_agent. The output field from rollout
    // files is parsed JSON; extract agentsStates and receiverThreadIds if present.
    if (COLLAB_REPLAY_TOOL_MAP.has(name)) {
        const outputParsed = (() => { try { return JSON.parse(output); } catch { return {}; } })();
        const parsedRecord = isRecord(outputParsed) ? outputParsed : {};
        // Cycle 7 (M2.c): real spawn_agent function_call_output binds the child via `agent_id`
        // (confirmed: {"agent_id":"019e31bf-…","nickname":"Architect"}). Map agent_id -> receiverThreadId
        // so the mapper's spawn-end handler binds it to ssn (ensureReceiverSessionSubagent). Fall back to
        // receiverThreadIds ?? targets ?? [target] for the other shapes.
        const endReceiverIds = Array.isArray(parsedRecord.receiverThreadIds)
            ? parsedRecord.receiverThreadIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
            : (typeof parsedRecord.agent_id === 'string' && parsedRecord.agent_id.length > 0
                ? [parsedRecord.agent_id]
                : collabReceiverThreadIds(parsedRecord));
        const turnIdBeforeMap = state.mapper.currentTurnId;
        const recordTimeAtSpawn = state.mapper.recordTime;
        const envelopes = mapWithState({
            type: 'collab_agent_call_end',
            call_id: callId,
            tool: COLLAB_REPLAY_TOOL_MAP.get(name) ?? name,
            status: typeof parsedRecord.status === 'string' ? parsedRecord.status : 'completed',
            receiverThreadIds: endReceiverIds,
            agentsStates: isRecord(parsedRecord.agentsStates) ? parsedRecord.agentsStates : {},
        }, state);
        // Cycle 8 (M2): capture the agent_id -> ssn binding at this spawn-output time. The mapper's
        // collab spawn-end handler binds `agent_id` (the receiverThreadId) to its lifecycle ssn in
        // providerSubagentToSessionSubagent; read it back NOW (before any later parent task_complete
        // clears the map) and store it on the replay state for the post-replay child-merge pass.
        if (COLLAB_REPLAY_TOOL_MAP.get(name) === 'spawnAgent'
            && typeof parsedRecord.agent_id === 'string' && parsedRecord.agent_id.length > 0) {
            const agentId = parsedRecord.agent_id;
            const ssn = state.mapper.providerSubagentToSessionSubagent?.get(agentId);
            if (ssn && !state.childSpawnBindings.has(agentId)) {
                state.childSpawnBindings.set(agentId, {
                    agentId,
                    sessionSubagent: ssn,
                    parentTurnId: turnIdBeforeMap,
                    recordTime: recordTimeAtSpawn,
                });
            }
        }
        return envelopes;
    }

    return mapWithState({
        type: 'dynamic_tool_call_end',
        call_id: callId,
        output,
        result: payload.output,
        status: 'completed',
    }, state);
}

function mapResponseItem(payload: Record<string, unknown>, state: ReplayState): SessionEnvelope[] {
    if (payload.type === 'message') {
        const role = typeof payload.role === 'string' ? payload.role : '';
        const text = textFromContent(payload.content);
        if (!text) {
            return [];
        }
        if (role === 'user') {
            return [];
        }
        if (role === 'assistant') {
            return mapWithState({ type: 'agent_message', message: text, phase: payload.phase }, state);
        }
        return [];
    }

    if (payload.type === 'function_call') {
        return mapFunctionCall(payload, state);
    }

    if (payload.type === 'function_call_output') {
        return mapFunctionCallOutput(payload, state);
    }

    return [];
}

function mapEventMsg(payload: Record<string, unknown>, state: ReplayState): SessionEnvelope[] {
    if (payload.type === 'user_message') {
        const text = textFromUserPayload(payload);
        return text ? [userTextEnvelope(text, state)] : [];
    }

    if (payload.type === 'agent_reasoning' || payload.type === 'agent_reasoning_delta') {
        return [];
    }

    return mapWithState(payload, state);
}

function mapRolloutRecord(record: Record<string, unknown>, state: ReplayState): SessionEnvelope[] {
    const payload = isRecord(record.payload) ? record.payload : null;
    if (!payload) {
        return [];
    }

    // Cycle 7 (M2/M2.a): thread THIS record's historical time into the mapper so every envelope
    // produced from this record (turn-start, spawn child, lifecycle-start, control starts/ends,
    // lifecycle-end, user text, turn-end) inherits it via createEnvelope's opts.time. The lifecycle-END
    // for a close/abort record correctly uses the close record's own time. A finite value or undefined.
    state.mapper.recordTime = parseRecordTime(record);

    if (record.type === 'event_msg') {
        return mapEventMsg(payload, state);
    }

    if (record.type === 'response_item') {
        return mapResponseItem(payload, state);
    }

    return [];
}

function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function envelopeDedupeKey(envelope: SessionEnvelope): string {
    const turn = envelope.turn ?? '';
    const subagent = envelope.subagent ?? '';
    const event = envelope.ev;

    if (event.t === 'text') {
        return `${envelope.role}:text:${turn}:${subagent}:${event.thinking ? 'thinking' : 'visible'}:${hashValue(event.text)}`;
    }
    if (event.t === 'tool-call-start' || event.t === 'tool-call-end') {
        return `${envelope.role}:${event.t}:${turn}:${subagent}:${event.call}`;
    }
    if (event.t === 'turn-start') {
        return `${envelope.role}:turn-start:${turn}`;
    }
    if (event.t === 'turn-end') {
        return `${envelope.role}:turn-end:${turn}:${event.status}`;
    }
    if (event.t === 'start' || event.t === 'stop') {
        return `${envelope.role}:${event.t}:${turn}:${subagent}`;
    }

    return `${envelope.role}:${turn}:${subagent}:${hashValue(JSON.stringify(event))}`;
}

async function sendFailure(session: ReplaySession, threadId: string, reason: string): Promise<void> {
    session.sendSessionEvent({
        type: 'message',
        message: `Prior Codex history could not be restored for thread ${threadId}: ${reason}. New messages will still work.`,
    });
    await session.flush?.();
}

// Cycle 8 (M1/M6): build a child-tool sidechain tool-call-START envelope for a child rollout record,
// carrying subagent === ssn, ev.call === provider call_id, args WITHOUT sessionSubagent. The M6
// postcondition is enforced at the call site (mergeChildRollout) before the envelope is kept.
function buildChildStartEnvelope(
    sessionSubagent: string,
    call: string,
    body: { name: string; title: string; description: string; args: Record<string, unknown> },
    opts: CreateEnvelopeOptions,
): SessionEnvelope {
    return createEnvelope('agent', { t: 'tool-call-start', call, ...body }, { ...opts, subagent: sessionSubagent });
}

// Cycle 8 (M1): build a child-tool sidechain tool-call-END envelope. END carries no args (INV-2 auto).
function buildChildEndToolEnvelope(
    sessionSubagent: string,
    call: string,
    body: { output?: string; result?: unknown },
    opts: CreateEnvelopeOptions,
): SessionEnvelope {
    return createEnvelope('agent', { t: 'tool-call-end', call, ...body }, { ...opts, subagent: sessionSubagent });
}

// Cycle 8 (M1/M3/M6/S1/S2): merge ONE child rollout's internal tool calls (exec_command, apply_patch,
// mcp_*, dynamic tools) as sidechain children of the lifecycle card for `binding.sessionSubagent`.
// - M3: only renderable tool begin/end records are mapped; child session_meta/task_started/
//   task_complete/turn_aborted are SKIPPED so they never feed the parent mapper or emit stray turns.
// - S1: a child `spawn_agent` function_call is NOT recursed into (depth-1 only); grandchild internal
//   tools are gracefully omitted.
// - S2: a missing/unreadable/malformed child file yields zero child envelopes; no throw escapes.
// - M6: every emitted child tool-call-start is postcondition-checked: ev.call !== ssn AND args carry no
//   sessionSubagent. A violating envelope is dropped (defends against merge-code regressions).
async function mergeChildRollout(
    binding: ChildSpawnBinding,
    home: string,
    visitedThreadIds: Set<string>,
): Promise<SessionEnvelope[]> {
    if (visitedThreadIds.size >= MAX_CHILD_MERGE_DEPTH) {
        return [];
    }
    if (visitedThreadIds.has(binding.agentId)) {
        return [];
    }
    visitedThreadIds.add(binding.agentId);

    let files: string[];
    try {
        files = await findRolloutFilesForThread(binding.agentId, home);
    } catch {
        return [];
    }
    if (files.length === 0) {
        return [];
    }

    const ssn = binding.sessionSubagent;
    const opts: CreateEnvelopeOptions = {
        ...(binding.parentTurnId ? { turn: binding.parentTurnId } : {}),
        ...(typeof binding.recordTime === 'number' && Number.isFinite(binding.recordTime) ? { time: binding.recordTime } : {}),
    };
    const toolNamesByCallId = new Map<string, string>();
    const childEnvelopes: SessionEnvelope[] = [];

    for (const file of files) {
        let content: string;
        try {
            content = await readFile(file, 'utf-8');
        } catch {
            continue; // S2: unreadable child file -> omit, no throw.
        }
        for (const line of content.split('\n')) {
            const record = parseJsonLine(line);
            if (!record) {
                continue; // S2: malformed JSON line -> skip.
            }
            // M3: child turn boundaries / metadata are NOT mapped (no parent-state feed, no stray turns).
            if (record.type !== 'response_item') {
                continue;
            }
            const payload = isRecord(record.payload) ? record.payload : null;
            if (!payload) {
                continue;
            }
            const childRecordTime = parseRecordTime(record);
            const recordOpts: CreateEnvelopeOptions = {
                ...opts,
                ...(typeof childRecordTime === 'number' && Number.isFinite(childRecordTime) ? { time: childRecordTime } : opts.time !== undefined ? { time: opts.time } : {}),
            };

            if (payload.type === 'function_call') {
                const callId = typeof payload.call_id === 'string' ? payload.call_id
                    : (typeof payload.callId === 'string' ? payload.callId : undefined);
                if (!callId) continue;
                const toolName = normalizeToolName(payload.name);
                // S1: a real grandchild spawn is not merged; omit its internal tools (depth-1 only).
                if (COLLAB_REPLAY_TOOL_MAP.has(toolName)) {
                    continue;
                }
                toolNamesByCallId.set(callId, toolName);
                const envelope = buildChildBeginEnvelope(toolName, callId, payload, ssn, recordOpts);
                // M6 postcondition guard: drop any begin that would violate INV-1 (call === ssn) or
                // INV-2 (args.sessionSubagent present). The producer above never injects these, but the
                // guard defends against a future merge-code regression.
                if (envelope && childEnvelopePassesInvariants(envelope, ssn)) {
                    childEnvelopes.push(envelope);
                }
                continue;
            }

            if (payload.type === 'function_call_output') {
                const callId = typeof payload.call_id === 'string' ? payload.call_id
                    : (typeof payload.callId === 'string' ? payload.callId : undefined);
                if (!callId) continue;
                const toolName = toolNamesByCallId.get(callId);
                // Only emit an end for a tool whose begin we merged (skips collab/grandchild ends).
                if (!toolName) continue;
                const envelope = buildChildEndEnvelope(toolName, callId, payload, ssn, recordOpts);
                if (envelope) {
                    childEnvelopes.push(envelope);
                }
                continue;
            }
        }
    }

    return childEnvelopes;
}

// Cycle 8 (M1/M6): synthesize a child tool-call-START envelope from a child rollout function_call.
// Covers exec_command / apply_patch / mcp_* / dynamic tools. Args NEVER include sessionSubagent (INV-2)
// and `call` is ALWAYS the provider call_id (INV-1).
function buildChildBeginEnvelope(
    toolName: string,
    callId: string,
    payload: Record<string, unknown>,
    ssn: string,
    opts: CreateEnvelopeOptions,
): SessionEnvelope | null {
    const args = parseArguments(payload.arguments);

    if (toolName === 'exec_command') {
        const command = commandFromArguments(args);
        const commandText = typeof command === 'string' ? command : (Array.isArray(command) ? command.map(String).join(' ') : '');
        const short = commandText.length > 80 ? `${commandText.slice(0, 77)}...` : commandText;
        return buildChildStartEnvelope(ssn, callId, {
            name: 'CodexBash',
            title: short.length > 0 ? `Run \`${short}\`` : 'Run command',
            description: typeof args.description === 'string' ? args.description : (commandText || 'Execute command'),
            args: { ...args, command },
        }, opts);
    }

    if (toolName === 'apply_patch') {
        const changes = isRecord(args.changes) ? args.changes : args;
        const fileCount = Object.keys(isRecord(changes) ? changes : {}).length;
        return buildChildStartEnvelope(ssn, callId, {
            name: 'CodexPatch',
            title: 'Apply patch',
            description: fileCount === 1 ? 'Applying patch to 1 file' : `Applying patch to ${fileCount} files`,
            args: { changes },
        }, opts);
    }

    const mcpParts = mcpPartsFromName(toolName);
    if (mcpParts) {
        return buildChildStartEnvelope(ssn, callId, {
            name: `mcp__${mcpParts.server}__${mcpParts.tool}`,
            title: `MCP: ${mcpParts.server}.${mcpParts.tool}`,
            description: mcpParts.tool || 'MCP tool call',
            args,
        }, opts);
    }

    // Dynamic / unknown function tool.
    return buildChildStartEnvelope(ssn, callId, {
        name: `functions.${toolName}`,
        title: toolName || 'Dynamic tool',
        description: toolName || 'Dynamic tool call',
        args,
    }, opts);
}

// Cycle 8 (M1): synthesize a child tool-call-END envelope. END carries no args, so INV-2 is automatic.
function buildChildEndEnvelope(
    toolName: string,
    callId: string,
    payload: Record<string, unknown>,
    ssn: string,
    opts: CreateEnvelopeOptions,
): SessionEnvelope | null {
    const output = outputText(payload.output);
    return buildChildEndToolEnvelope(ssn, callId, {
        output,
        ...(payload.output !== undefined ? { result: payload.output } : {}),
    }, opts);
}

// Cycle 8 (M6): replay-side INV-1/INV-2 postcondition check on a merged child envelope.
// INV-1: a child tool-call-start with subagent === ssn MUST have ev.call !== ssn.
// INV-2: it MUST NOT carry ev.args.sessionSubagent.
// Exported for the AC-C8-8 negative/postcondition test (proves a violating envelope is dropped).
export function childEnvelopePassesInvariants(envelope: SessionEnvelope, ssn: string): boolean {
    const ev = envelope.ev;
    if (ev.t !== 'tool-call-start') return true;
    if (envelope.subagent !== ssn) return true;
    if (ev.call === ssn) return false; // INV-1 violation.
    const args = (ev as { args?: unknown }).args;
    if (isRecord(args) && 'sessionSubagent' in args) return false; // INV-2 violation.
    return true;
}

// Cycle 8 (M1/INV-3): splice each subagent's merged child tool envelopes into the parent envelope
// stream IMMEDIATELY AFTER that subagent's lifecycle-start envelope, so lifecycle-start precedes all of
// its child tool envelopes (INV-3) and children attach to the correct (own) lifecycle card with no
// cross-attribution (AC-C8-11). Subagents whose lifecycle-start is absent (e.g. truncated) are appended
// after the last buffered envelope so their children are not silently dropped.
function spliceChildEnvelopes(
    parentEnvelopes: SessionEnvelope[],
    childEnvelopesBySsn: Map<string, SessionEnvelope[]>,
): SessionEnvelope[] {
    if (childEnvelopesBySsn.size === 0) {
        return parentEnvelopes;
    }
    const result: SessionEnvelope[] = [];
    const inserted = new Set<string>();
    for (const envelope of parentEnvelopes) {
        result.push(envelope);
        const ev = envelope.ev;
        if (ev.t === 'tool-call-start' && envelope.subagent) {
            // The lifecycle-start envelope's call is `lifecycle:<ssn>`; match on it so children land
            // right after their OWN lifecycle card.
            if (ev.call === lifecycleCallId(envelope.subagent)) {
                const children = childEnvelopesBySsn.get(envelope.subagent);
                if (children && !inserted.has(envelope.subagent)) {
                    result.push(...children);
                    inserted.add(envelope.subagent);
                }
            }
        }
    }
    // Any subagent whose lifecycle-start was not found (truncated/missing) -> append its children at end
    // so they still render (best-available degradation), still attached to their own ssn.
    for (const [ssn, children] of childEnvelopesBySsn) {
        if (!inserted.has(ssn)) {
            result.push(...children);
        }
    }
    return result;
}

async function replayFiles(opts: {
    threadId: string;
    files: string[];
    session: ReplaySession;
    home: string;
}): Promise<CodexRolloutHistoryReplayResult> {
    const state = createReplayState();
    let recordsRead = 0;

    // Cycle 8: buffer the parent envelope stream rather than streaming inline, so (M1/INV-3) merged
    // child tool envelopes can be spliced right after each lifecycle-start, and (M4) still-open
    // lifecycles can be flushed at end-of-replay before anything is sent.
    const parentEnvelopes: SessionEnvelope[] = [];
    for (const file of opts.files) {
        const content = await readFile(file, 'utf-8');
        for (const line of content.split('\n')) {
            const record = parseJsonLine(line);
            if (!record) {
                continue;
            }
            recordsRead++;
            parentEnvelopes.push(...mapRolloutRecord(record, state));
        }
    }

    // Cycle 8 (M4 — item 2 mode d): at end-of-replay, flush any lifecycle still in a non-terminal state
    // (truncated rollout with no close_agent / task_complete) with a non-success terminal marker so the
    // card closes instead of staying stuck open. Replay-path ONLY — the live A1 mapper never calls this.
    const flushOpts: CreateEnvelopeOptions = {
        ...(state.mapper.currentTurnId ? { turn: state.mapper.currentTurnId } : {}),
        ...(typeof state.mapper.recordTime === 'number' && Number.isFinite(state.mapper.recordTime) ? { time: state.mapper.recordTime } : {}),
    };
    const openLifecycles: Map<string, LifecycleState> = state.mapper.subagentLifecycles ?? new Map();
    flushOpenLifecycles('errored', 'replay_truncated', flushOpts, openLifecycles, parentEnvelopes);

    // Cycle 8 (M1/M3/M6/S1/S2 — item 1): merge each spawned subagent's nested child rollout's internal
    // tool calls as sidechain children of its OWN lifecycle card. visitedThreadIds bounds recursion (S1);
    // a per-binding fresh merge keeps siblings independent (AC-C8-11 — no cross-attribution).
    const childEnvelopesBySsn = new Map<string, SessionEnvelope[]>();
    for (const binding of state.childSpawnBindings.values()) {
        const visited = new Set<string>();
        const merged = await mergeChildRollout(binding, opts.home, visited);
        if (merged.length > 0) {
            const existing = childEnvelopesBySsn.get(binding.sessionSubagent) ?? [];
            existing.push(...merged);
            childEnvelopesBySsn.set(binding.sessionSubagent, existing);
        }
    }
    const merged = spliceChildEnvelopes(parentEnvelopes, childEnvelopesBySsn);

    // Stream the merged stream with dedupe (key includes subagent + call, so sibling/child call_id
    // collisions across distinct ssn are safe).
    const dedupe = new Set<string>();
    let envelopesSent = 0;
    for (const envelope of merged) {
        const key = envelopeDedupeKey(envelope);
        if (dedupe.has(key)) {
            continue;
        }
        dedupe.add(key);
        opts.session.sendSessionProtocolMessage(envelope);
        envelopesSent++;
        await opts.session.flush?.();
    }

    await opts.session.flush?.();
    return {
        status: envelopesSent > 0 ? 'replayed' : 'failed',
        threadId: opts.threadId,
        files: opts.files,
        recordsRead,
        envelopesSent,
        ...(envelopesSent > 0 ? {} : { reason: 'no renderable history records found' }),
    };
}

export async function replayCodexRolloutHistory(opts: {
    threadId: string;
    session: ReplaySession;
    codexHome?: string;
    fallbackThreadIds?: string[];
}): Promise<CodexRolloutHistoryReplayResult> {
    const home = codexHome(opts.codexHome);
    const threadIds = [opts.threadId, ...(opts.fallbackThreadIds ?? [])]
        .filter((id, index, all) => id && all.indexOf(id) === index);

    let lastFailure: CodexRolloutHistoryReplayResult | null = null;
    for (const threadId of threadIds) {
        try {
            const files = await findRolloutFilesForThread(threadId, home);
            if (files.length === 0) {
                lastFailure = {
                    status: 'failed',
                    threadId,
                    files: [],
                    recordsRead: 0,
                    envelopesSent: 0,
                    reason: `no rollout file found under ${join(home, 'sessions')}`,
                };
                continue;
            }

            const result = await replayFiles({ threadId, files, session: opts.session, home });
            if (result.status === 'replayed') {
                logger.debug(`[Codex][history] Replayed ${result.envelopesSent} envelopes from ${files.length} rollout file(s) for ${threadId}`);
                return result;
            }
            lastFailure = result;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            lastFailure = {
                status: 'failed',
                threadId,
                files: [],
                recordsRead: 0,
                envelopesSent: 0,
                reason,
            };
        }
    }

    const failure = lastFailure ?? {
        status: 'failed' as const,
        threadId: opts.threadId,
        files: [],
        recordsRead: 0,
        envelopesSent: 0,
        reason: 'no thread id provided',
    };
    await sendFailure(opts.session, opts.threadId, failure.reason ?? 'unknown error');
    return failure;
}
