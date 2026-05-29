import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createEnvelope, type SessionEnvelope } from '@slopus/happy-wire';
import { logger } from '@/ui/logger';
import {
    mapCodexMcpMessageToSessionEnvelopes,
    type CodexTurnState,
} from './utils/sessionProtocolMapper';

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
        },
        toolNamesByCallId: new Map<string, string>(),
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
    };
    return mapped.envelopes;
}

function userTextEnvelope(text: string, state: ReplayState): SessionEnvelope {
    const turn = state.mapper.currentTurnId;
    return createEnvelope('user', { t: 'text', text }, turn ? { turn } : undefined);
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
            prompt: typeof args.prompt === 'string' ? args.prompt : null,
            model: typeof args.model === 'string' ? args.model : null,
            agentNickname: typeof args.agentNickname === 'string' ? args.agentNickname : null,
            receiverThreadIds: Array.isArray(args.receiverThreadIds) ? args.receiverThreadIds : [],
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
        return mapWithState({
            type: 'collab_agent_call_end',
            call_id: callId,
            tool: COLLAB_REPLAY_TOOL_MAP.get(name) ?? name,
            status: typeof parsedRecord.status === 'string' ? parsedRecord.status : 'completed',
            receiverThreadIds: Array.isArray(parsedRecord.receiverThreadIds) ? parsedRecord.receiverThreadIds : [],
            agentsStates: isRecord(parsedRecord.agentsStates) ? parsedRecord.agentsStates : {},
        }, state);
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

async function replayFiles(opts: {
    threadId: string;
    files: string[];
    session: ReplaySession;
}): Promise<CodexRolloutHistoryReplayResult> {
    const state = createReplayState();
    const dedupe = new Set<string>();
    let recordsRead = 0;
    let envelopesSent = 0;

    for (const file of opts.files) {
        const content = await readFile(file, 'utf-8');
        for (const line of content.split('\n')) {
            const record = parseJsonLine(line);
            if (!record) {
                continue;
            }
            recordsRead++;
            const envelopes = mapRolloutRecord(record, state);
            for (const envelope of envelopes) {
                const key = envelopeDedupeKey(envelope);
                if (dedupe.has(key)) {
                    continue;
                }
                dedupe.add(key);
                opts.session.sendSessionProtocolMessage(envelope);
                envelopesSent++;
                await opts.session.flush?.();
            }
        }
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

            const result = await replayFiles({ threadId, files, session: opts.session });
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
