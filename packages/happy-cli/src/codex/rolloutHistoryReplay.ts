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

// Cycle 9 (A1-M2): bound the child-merge depth via an EXPLICIT numeric `depth` parameter threaded
// through mergeChildRollout. Depth semantics: root = 0, child = 1, grandchild = 2, great-grandchild = 3.
// The depth-2 grandchild is MERGED (inside the cap); only depth >= 3 (great-grandchild) is gracefully
// omitted. The boundary guard is `if (depth > MAX_CHILD_MERGE_DEPTH) return` so a depth-2 grandchild
// (depth === 2) still merges and only depth 3+ is skipped — NOT `depth >= 2` (which would reproduce the
// Cycle-8 depth-1-only gap by skipping the grandchild itself). visitedThreadIds is used ONLY for cycle
// prevention and is branch-local (new Set(visited) per recursive branch) so sibling grandchildren do
// not starve each other's budget; the gate MUST NOT key off visitedThreadIds.size (Codex #2).
// Corpus: 76 depth-2 grandchild threads carry exec_command (full-corpus scan, Cycle 9).
const MAX_CHILD_MERGE_DEPTH = 2;

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
            // Cycle 9 (NO-regression fix): mark this CodexTurnState as the replay path so replay-only
            // rendering branches activate (multi-target wait_agent BEGIN fan-out). Set ONCE here; preserved
            // across every mapWithState rebuild below so it persists for the whole replay record loop. The
            // live caller (runCodex.ts) never sets this, keeping live byte-equal to baseline.
            replay: true,
            currentTurnId: null,
            startedSubagents: new Set<string>(),
            activeSubagents: new Set<string>(),
            providerSubagentToSessionSubagent: new Map<string, string>(),
            subagentLifecycles: new Map(),
            // Cycle 8 (M5): seed the per-turn emitted-collab-begin Set so the orphan-end discriminator
            // persists across mapWithState calls on the REPLAY path (the live A1 caller leaves this unset,
            // keeping M5 inert there — replay-only, AC-C8-9).
            emittedCollabBeginCallIds: new Set<string>(),
            // Cycle 9 (A2-M1): seed the multi-target wait BEGIN target map on the REPLAY path so the
            // per-target END enumeration finds the persisted begin list (replay-only; live A1 leaves unset).
            waitTargetsByCallId: new Map<string, string[]>(),
        },
        toolNamesByCallId: new Map<string, string>(),
        childSpawnBindings: new Map<string, ChildSpawnBinding>(),
    };
}

function mapWithState(message: Record<string, unknown>, state: ReplayState): SessionEnvelope[] {
    const mapped = mapCodexMcpMessageToSessionEnvelopes(message, state.mapper);
    state.mapper = {
        // Cycle 9 (NO-regression fix): the mapper result omits `replay`; preserve it across the rebuild so
        // the replay-only fan-out stays gated ON for the entire replay loop.
        replay: true,
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
        // Cycle 9 (A2-M1): preserve the multi-target wait BEGIN target list (keyed by call_id) across the
        // rebuild so the per-target END enumeration reuses the begin list (it arrives in a later call).
        waitTargetsByCallId: mapped.waitTargetsByCallId ?? state.mapper.waitTargetsByCallId,
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
            // Cycle 9 (A2-M2): real wait_agent output uses `status` as a per-target MAP ({id: {completed|
            // errored|not_found}}), not a scalar. Forward the object map verbatim so the mapper's per-target
            // status extraction reads status[id]; fall back to the scalar string for the non-map shapes.
            status: isRecord(parsedRecord.status)
                ? parsedRecord.status
                : (typeof parsedRecord.status === 'string' ? parsedRecord.status : 'completed'),
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

// Cycle 8/9 (M1/M3/M6/S1/S2 + A1-M1/M2/M3/M4): merge ONE child rollout's internal tool calls
// (exec_command, apply_patch, mcp_*, dynamic tools) as sidechain children of the lifecycle card for
// `binding.sessionSubagent`. Recurses into the child's OWN spawn_agent grandchildren up to depth 2.
// - M3: only renderable tool begin/end records are mapped; child session_meta/task_started/
//   task_complete/turn_aborted are SKIPPED so they never feed the parent mapper or emit stray turns.
// - A1-M2 (depth): `depth` is an explicit numeric (root=0/child=1/grandchild=2). The function returns
//   early when `depth > MAX_CHILD_MERGE_DEPTH` (i.e. depth 3+) so the depth-2 grandchild still merges
//   and only the great-grandchild is gracefully omitted. The gate is the integer `depth`, NOT
//   visitedThreadIds.size (Codex #2).
// - A1-M3 (grandchild discovery): a child `spawn_agent` function_call + its function_call_output binding
//   grandchild agent_id is captured; the grandchild rollout is recursively merged under the SAME child
//   ssn (no separate grandchild lifecycle card — A1-M1/Codex #4). Non-spawn control verbs stay skipped.
// - S2: a missing/unreadable/malformed child file yields zero child envelopes; no throw escapes.
// - M6: every emitted child tool-call-start is postcondition-checked: ev.call !== ssn AND args carry no
//   sessionSubagent. A violating envelope is dropped (defends against merge-code regressions).
async function mergeChildRollout(
    binding: ChildSpawnBinding,
    home: string,
    visitedThreadIds: Set<string>,
    depth: number,
): Promise<SessionEnvelope[]> {
    // A1-M2 boundary: merge through depth-2 INCLUSIVE; defer only depth >= 3 (great-grandchild). The
    // depth-2 grandchild (depth === 2 === MAX_CHILD_MERGE_DEPTH) is INSIDE the cap and still merges.
    if (depth > MAX_CHILD_MERGE_DEPTH) {
        return [];
    }
    if (visitedThreadIds.has(binding.agentId)) {
        return []; // cycle prevention only — NOT a depth gate.
    }
    // A1-M2: branch-local visited set per recursive branch so sibling grandchildren do not consume each
    // other's budget; a per-branch copy is taken before each recursive descent below.
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
    // A1 (Codex finding #1): depth-2 grandchild tools attach under the SAME depth-1 child ssn. Codex
    // numbers internal call_ids per-thread, so two sibling grandchildren can reuse the same raw call_id;
    // the replay dedupe key is (subagent + call), so without namespacing the second grandchild's tool
    // would collide and be dropped. Namespace the EMITTED call id by the grandchild's own thread id at
    // depth >= 2 (depth-1 child ids are left raw — they are already unique per child ssn). Begin AND end
    // share the same namespaced id so the pair stays matched.
    const emittedCallId = (rawCallId: string): string => depth >= 2 ? `gc:${binding.agentId}:${rawCallId}` : rawCallId;
    const toolNamesByCallId = new Map<string, string>();
    const childEnvelopes: SessionEnvelope[] = [];
    // A1-M3: grandchild spawn bindings discovered in THIS child's replay (callId -> spawn-call metadata),
    // resolved at the spawn's function_call_output into agent_id and recursively merged after this file
    // loop completes (so the grandchild tools attach under THIS child's ssn).
    const grandchildSpawnCallIds = new Set<string>();
    const grandchildBindings: ChildSpawnBinding[] = [];

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
                // A1-M3: a spawn_agent collab verb is NOT a renderable internal tool (no child envelope),
                // but it DOES bind a grandchild — record its callId so the matching output resolves the
                // grandchild agent_id. Non-spawn control verbs remain skipped (no regression — AC-A1-4).
                if (COLLAB_REPLAY_TOOL_MAP.has(toolName)) {
                    if (COLLAB_REPLAY_TOOL_MAP.get(toolName) === 'spawnAgent') {
                        grandchildSpawnCallIds.add(callId);
                    }
                    continue;
                }
                toolNamesByCallId.set(callId, toolName);
                const envelope = buildChildBeginEnvelope(toolName, emittedCallId(callId), payload, ssn, recordOpts);
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
                // A1-M3: a function_call_output for a recorded grandchild spawn binds the grandchild
                // agent_id; capture a binding under THIS child's ssn for the recursive merge below.
                if (grandchildSpawnCallIds.has(callId)) {
                    const grandAgentId = parseSpawnOutputAgentId(payload.output);
                    if (grandAgentId) {
                        grandchildBindings.push({
                            agentId: grandAgentId,
                            sessionSubagent: ssn,
                            parentTurnId: binding.parentTurnId,
                            recordTime: typeof childRecordTime === 'number' && Number.isFinite(childRecordTime) ? childRecordTime : binding.recordTime,
                        });
                    }
                    continue;
                }
                const toolName = toolNamesByCallId.get(callId);
                // Only emit an end for a tool whose begin we merged (skips collab/grandchild ends).
                if (!toolName) continue;
                // Codex finding #1: end uses the SAME namespaced emitted id as its begin (depth>=2).
                const envelope = buildChildEndEnvelope(toolName, emittedCallId(callId), payload, ssn, recordOpts);
                if (envelope) {
                    childEnvelopes.push(envelope);
                }
                continue;
            }
        }
    }

    // A1-M1/M3: recursively merge each discovered grandchild under THIS child's ssn. A branch-local
    // visited-set copy per grandchild keeps siblings independent (AC-A1-2 — no shared-budget starvation);
    // the depth+1 increment caps the recursion at depth 2 (great-grandchildren are omitted via the
    // `depth > MAX_CHILD_MERGE_DEPTH` guard at the top of the recursive call).
    for (const grandBinding of grandchildBindings) {
        const branchVisited = new Set(visitedThreadIds);
        const grandEnvelopes = await mergeChildRollout(grandBinding, home, branchVisited, depth + 1);
        if (grandEnvelopes.length > 0) {
            childEnvelopes.push(...grandEnvelopes);
        }
    }

    return childEnvelopes;
}

// A1-M3: parse a spawn_agent function_call_output and extract the bound child/grandchild agent_id.
// Real Codex output is `{"agent_id":"019…","nickname":"Architect"}` (confirmed against the corpus);
// returns the agent_id string or null when absent/malformed.
function parseSpawnOutputAgentId(output: unknown): string | null {
    const text = outputText(output);
    if (text.length === 0) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isRecord(parsed)) return null;
    return typeof parsed.agent_id === 'string' && parsed.agent_id.length > 0 ? parsed.agent_id : null;
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

    // Cycle 8/9 (M1/M3/M6/S2 + A1): merge each spawned subagent's nested child rollout's internal
    // tool calls (and, A1, its depth-2 grandchildren) as sidechain children of its OWN lifecycle card.
    // The explicit `depth` param bounds recursion at depth 2 (great-grandchildren omitted); a per-binding
    // fresh visited set keeps siblings independent (AC-C8-11 / AC-A1-2 — no cross-attribution, no starve).
    const childEnvelopesBySsn = new Map<string, SessionEnvelope[]>();
    for (const binding of state.childSpawnBindings.values()) {
        const visited = new Set<string>();
        // A1-M2: the initial call is for a depth-1 CHILD binding (root=0, child=1); the recursion
        // increments depth so a depth-2 grandchild merges and depth-3 is omitted.
        const merged = await mergeChildRollout(binding, opts.home, visited, 1);
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
