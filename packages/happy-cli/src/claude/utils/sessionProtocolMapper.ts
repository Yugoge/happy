import { createId } from '@paralleldrive/cuid2';
import type { RawJSONLines } from '@/claude/types';
import {
    createEnvelope,
    type SessionEnvelope,
    type SessionTurnEndStatus,
} from '@slopus/happy-wire';

export type ClaudeSessionProtocolState = {
    currentTurnId: string | null;
    uuidToProviderSubagent?: Map<string, string>;
    taskPromptToSubagents?: Map<string, string[]>;
    providerSubagentToSessionSubagent?: Map<string, string>;
    subagentTitles?: Map<string, string>;
    bufferedSubagentMessages?: Map<string, RawJSONLines[]>;
    hiddenParentToolCalls?: Set<string>;
    startedSubagents?: Set<string>;
    activeSubagents?: Set<string>;
    /** UUID of the command-message whose next child is the skill prompt to wrap */
    pendingSkillCommandUuid?: string;
    /** Slash command name (e.g. "/review") for the pending skill prompt label */
    pendingSkillCommandName?: string;
};

type ClaudeMapperResult = {
    currentTurnId: string | null;
    envelopes: SessionEnvelope[];
};

/**
 * Extract text output from a tool_result block's content field.
 * Claude API sends content as either a string or Array<{type: 'text', text: string}>.
 */
function extractToolResultOutput(block: { content?: unknown }): string | undefined {
    if (!block.content) return undefined;
    if (typeof block.content === 'string') return block.content || undefined;
    if (Array.isArray(block.content)) {
        const texts = block.content
            .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
            .map((c: any) => c.text);
        return texts.length > 0 ? texts.join('\n') : undefined;
    }
    return undefined;
}

function pickProviderSubagent(message: RawJSONLines): string | undefined {
    const raw = message as { parent_tool_use_id?: unknown; parentToolUseId?: unknown };
    if (typeof raw.parent_tool_use_id === 'string' && raw.parent_tool_use_id.length > 0) {
        return raw.parent_tool_use_id;
    }
    if (typeof raw.parentToolUseId === 'string' && raw.parentToolUseId.length > 0) {
        return raw.parentToolUseId;
    }
    return undefined;
}

function getUuidToProviderSubagent(state: ClaudeSessionProtocolState): Map<string, string> {
    if (!state.uuidToProviderSubagent) {
        state.uuidToProviderSubagent = new Map<string, string>();
    }
    return state.uuidToProviderSubagent;
}

function getTaskPromptToSubagents(state: ClaudeSessionProtocolState): Map<string, string[]> {
    if (!state.taskPromptToSubagents) {
        state.taskPromptToSubagents = new Map<string, string[]>();
    }
    return state.taskPromptToSubagents;
}

function getProviderSubagentToSessionSubagent(state: ClaudeSessionProtocolState): Map<string, string> {
    if (!state.providerSubagentToSessionSubagent) {
        state.providerSubagentToSessionSubagent = new Map<string, string>();
    }
    return state.providerSubagentToSessionSubagent;
}

function getSessionSubagentIdForProviderSubagent(
    state: ClaudeSessionProtocolState,
    providerSubagent: string,
): string | undefined {
    return getProviderSubagentToSessionSubagent(state).get(providerSubagent);
}

function ensureSessionSubagentIdForProviderSubagent(
    state: ClaudeSessionProtocolState,
    providerSubagent: string,
): string {
    const existing = getSessionSubagentIdForProviderSubagent(state, providerSubagent);
    if (existing) {
        return existing;
    }

    const created = createId();
    getProviderSubagentToSessionSubagent(state).set(providerSubagent, created);
    return created;
}

function getSubagentTitles(state: ClaudeSessionProtocolState): Map<string, string> {
    if (!state.subagentTitles) {
        state.subagentTitles = new Map<string, string>();
    }
    return state.subagentTitles;
}

function getBufferedSubagentMessages(state: ClaudeSessionProtocolState): Map<string, RawJSONLines[]> {
    if (!state.bufferedSubagentMessages) {
        state.bufferedSubagentMessages = new Map<string, RawJSONLines[]>();
    }
    return state.bufferedSubagentMessages;
}

function getHiddenParentToolCalls(state: ClaudeSessionProtocolState): Set<string> {
    if (!state.hiddenParentToolCalls) {
        state.hiddenParentToolCalls = new Set<string>();
    }
    return state.hiddenParentToolCalls;
}

function bufferSubagentMessage(state: ClaudeSessionProtocolState, subagent: string, message: RawJSONLines): void {
    const buffer = getBufferedSubagentMessages(state);
    const queue = buffer.get(subagent) ?? [];
    queue.push(message);
    buffer.set(subagent, queue);
}

function consumeBufferedSubagentMessages(state: ClaudeSessionProtocolState, subagent: string): RawJSONLines[] {
    const buffer = getBufferedSubagentMessages(state);
    const queue = buffer.get(subagent) ?? [];
    buffer.delete(subagent);
    return queue;
}

function getStartedSubagents(state: ClaudeSessionProtocolState): Set<string> {
    if (!state.startedSubagents) {
        state.startedSubagents = new Set<string>();
    }
    return state.startedSubagents;
}

function getActiveSubagents(state: ClaudeSessionProtocolState): Set<string> {
    if (!state.activeSubagents) {
        state.activeSubagents = new Set<string>();
    }
    return state.activeSubagents;
}

function pickUuid(message: RawJSONLines): string | undefined {
    const raw = message as { uuid?: unknown };
    if (typeof raw.uuid === 'string' && raw.uuid.length > 0) {
        return raw.uuid;
    }
    return undefined;
}

function pickParentUuid(message: RawJSONLines): string | undefined {
    const raw = message as { parentUuid?: unknown; parentUUID?: unknown };
    if (typeof raw.parentUuid === 'string' && raw.parentUuid.length > 0) {
        return raw.parentUuid;
    }
    if (typeof raw.parentUUID === 'string' && raw.parentUUID.length > 0) {
        return raw.parentUUID;
    }
    return undefined;
}

function isSidechainMessage(message: RawJSONLines): boolean {
    const raw = message as { isSidechain?: unknown };
    return raw.isSidechain === true;
}

function normalizePrompt(prompt: string): string {
    return prompt.trim();
}

function queueTaskPromptSubagent(state: ClaudeSessionProtocolState, prompt: string, subagent: string): void {
    const normalized = normalizePrompt(prompt);
    if (normalized.length === 0) {
        return;
    }

    const promptMap = getTaskPromptToSubagents(state);
    const queue = promptMap.get(normalized) ?? [];
    if (!queue.includes(subagent)) {
        queue.push(subagent);
    }
    promptMap.set(normalized, queue);
}

function consumeTaskPromptSubagent(state: ClaudeSessionProtocolState, prompt: string): string | undefined {
    const normalized = normalizePrompt(prompt);
    if (normalized.length === 0) {
        return undefined;
    }

    const promptMap = getTaskPromptToSubagents(state);
    const queue = promptMap.get(normalized);
    if (!queue || queue.length === 0) {
        return undefined;
    }

    const subagent = queue.shift();
    if (queue.length === 0) {
        promptMap.delete(normalized);
    }
    return subagent;
}

function consumeSinglePendingTaskSubagent(state: ClaudeSessionProtocolState): string | undefined {
    const promptMap = getTaskPromptToSubagents(state);
    let candidateKey: string | null = null;
    let candidateSubagent: string | null = null;

    for (const [prompt, queue] of promptMap.entries()) {
        if (queue.length === 0) {
            continue;
        }

        if (candidateKey !== null) {
            return undefined;
        }

        candidateKey = prompt;
        candidateSubagent = queue[0] ?? null;
    }

    if (!candidateKey || !candidateSubagent) {
        return undefined;
    }

    const queue = promptMap.get(candidateKey);
    if (!queue || queue.length === 0) {
        return undefined;
    }

    queue.shift();
    if (queue.length === 0) {
        promptMap.delete(candidateKey);
    }

    return candidateSubagent;
}

function pickSidechainRootPrompt(message: RawJSONLines): string | undefined {
    if (message.type !== 'user') {
        return undefined;
    }

    if (typeof message.message?.content === 'string') {
        const normalized = normalizePrompt(message.message.content);
        return normalized.length > 0 ? normalized : undefined;
    }

    return undefined;
}

function resolveProviderSubagent(message: RawJSONLines, state: ClaudeSessionProtocolState): string | undefined {
    const explicitSubagent = pickProviderSubagent(message);
    if (explicitSubagent) {
        return explicitSubagent;
    }

    const parentUuid = pickParentUuid(message);
    if (parentUuid) {
        const inheritedSubagent = getUuidToProviderSubagent(state).get(parentUuid);
        if (inheritedSubagent) {
            return inheritedSubagent;
        }
    }

    if (!isSidechainMessage(message)) {
        return undefined;
    }

    const prompt = pickSidechainRootPrompt(message);
    if (prompt) {
        const matchedSubagent = consumeTaskPromptSubagent(state, prompt);
        if (matchedSubagent) {
            return matchedSubagent;
        }
    }

    if (!parentUuid) {
        return consumeSinglePendingTaskSubagent(state);
    }

    return undefined;
}

function rememberSubagentForMessage(message: RawJSONLines, state: ClaudeSessionProtocolState, providerSubagent: string | undefined): void {
    if (!providerSubagent) {
        return;
    }

    const uuid = pickUuid(message);
    if (!uuid) {
        return;
    }

    getUuidToProviderSubagent(state).set(uuid, providerSubagent);
}

function pickTaskPrompt(input: unknown): string | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    const prompt = (input as { prompt?: unknown }).prompt;
    if (typeof prompt !== 'string') {
        return undefined;
    }

    const normalized = normalizePrompt(prompt);
    return normalized.length > 0 ? normalized : undefined;
}

function pickTaskTitle(input: unknown): string | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    const candidateKeys = ['description', 'title', 'subagent_type'];
    for (const key of candidateKeys) {
        const value = (input as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }

    return undefined;
}

function setSubagentTitle(state: ClaudeSessionProtocolState, subagent: string, title: string | undefined): void {
    if (!title || title.trim().length === 0) {
        return;
    }
    getSubagentTitles(state).set(subagent, title.trim());
}

function maybeEmitSubagentStart(
    state: ClaudeSessionProtocolState,
    turn: string,
    subagent: string | undefined,
    envelopes: SessionEnvelope[],
): void {
    if (!subagent) {
        return;
    }

    const started = getStartedSubagents(state);
    if (started.has(subagent)) {
        return;
    }

    const title = getSubagentTitles(state).get(subagent);
    envelopes.push(createEnvelope('agent', {
        t: 'start',
        ...(title ? { title } : {}),
    }, { turn, subagent }));
    started.add(subagent);
    getActiveSubagents(state).add(subagent);
}

function maybeEmitSubagentStop(
    state: ClaudeSessionProtocolState,
    turn: string,
    subagent: string,
    envelopes: SessionEnvelope[],
): void {
    const active = getActiveSubagents(state);
    if (!active.has(subagent)) {
        return;
    }

    envelopes.push(createEnvelope('agent', { t: 'stop' }, { turn, subagent }));
    active.delete(subagent);
}

function clearSubagentTracking(state: ClaudeSessionProtocolState): void {
    getUuidToProviderSubagent(state).clear();
    getTaskPromptToSubagents(state).clear();
    getProviderSubagentToSessionSubagent(state).clear();
    getSubagentTitles(state).clear();
    getBufferedSubagentMessages(state).clear();
    getHiddenParentToolCalls(state).clear();
    getStartedSubagents(state).clear();
    getActiveSubagents(state).clear();
}

function ensureTurn(state: ClaudeSessionProtocolState, envelopes: SessionEnvelope[]): string {
    if (state.currentTurnId) {
        return state.currentTurnId;
    }

    const turnId = createId();
    envelopes.push(createEnvelope('agent', { t: 'turn-start' }, { turn: turnId }));
    state.currentTurnId = turnId;
    return turnId;
}

function closeTurn(
    state: ClaudeSessionProtocolState,
    status: SessionTurnEndStatus,
    envelopes: SessionEnvelope[],
): void {
    if (!state.currentTurnId) {
        return;
    }

    envelopes.push(createEnvelope('agent', { t: 'turn-end', status }, { turn: state.currentTurnId }));
    state.currentTurnId = null;
    clearSubagentTracking(state);
}

function toolTitle(name: string, input: unknown): string {
    if (input && typeof input === 'object') {
        const description = (input as { description?: unknown }).description;
        if (typeof description === 'string' && description.trim().length > 0) {
            return description.length > 80 ? `${description.slice(0, 77)}...` : description;
        }
    }
    return `${name} call`;
}

function toToolArgs(input: unknown): Record<string, unknown> {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        return input as Record<string, unknown>;
    }
    if (input === undefined) {
        return {};
    }
    return { input };
}

export function closeClaudeTurnWithStatus(
    state: ClaudeSessionProtocolState,
    status: SessionTurnEndStatus,
): ClaudeMapperResult {
    const envelopes: SessionEnvelope[] = [];
    closeTurn(state, status, envelopes);
    return {
        currentTurnId: state.currentTurnId,
        envelopes,
    };
}

export function mapClaudeLogMessageToSessionEnvelopes(
    message: RawJSONLines,
    state: ClaudeSessionProtocolState,
): ClaudeMapperResult {
    return mapClaudeLogMessageToSessionEnvelopesInternal(message, state);
}

function mapClaudeLogMessageToSessionEnvelopesInternal(
    message: RawJSONLines,
    state: ClaudeSessionProtocolState,
): ClaudeMapperResult {
    const envelopes: SessionEnvelope[] = [];
    const providerSubagent = resolveProviderSubagent(message, state);
    const subagent = providerSubagent
        ? getSessionSubagentIdForProviderSubagent(state, providerSubagent)
        : undefined;
    rememberSubagentForMessage(message, state, providerSubagent);

    if (providerSubagent && !subagent) {
        bufferSubagentMessage(state, providerSubagent, message);
        return {
            currentTurnId: state.currentTurnId,
            envelopes: [],
        };
    }

    if (message.type === 'summary') {
        return {
            currentTurnId: state.currentTurnId,
            envelopes,
        };
    }

    if (message.type === 'system') {
        return {
            currentTurnId: state.currentTurnId,
            envelopes,
        };
    }

    if (message.type === 'assistant') {
        const turnId = ensureTurn(state, envelopes);
        maybeEmitSubagentStart(state, turnId, subagent, envelopes);
        const blocks = Array.isArray(message.message?.content) ? message.message.content : [];

        for (const block of blocks) {
            if (block.type === 'text' && typeof block.text === 'string') {
                envelopes.push(createEnvelope('agent', { t: 'text', text: block.text }, { turn: turnId, subagent }));
                continue;
            }

            if (block.type === 'thinking' && typeof block.thinking === 'string') {
                envelopes.push(createEnvelope('agent', { t: 'text', text: block.thinking, thinking: true }, { turn: turnId, subagent }));
                continue;
            }

            if (block.type === 'tool_use') {
                const call = typeof block.id === 'string' && block.id.length > 0 ? block.id : createId();
                const name = typeof block.name === 'string' && block.name.length > 0 ? block.name : 'unknown';
                const args = toToolArgs(block.input);
                const title = toolTitle(name, block.input);
                const sessionSubagentForCall = ensureSessionSubagentIdForProviderSubagent(state, call);
                if (name === 'Task' || name === 'Agent') {
                    const prompt = pickTaskPrompt(block.input);
                    if (prompt) {
                        queueTaskPromptSubagent(state, prompt, call);
                    }
                    setSubagentTitle(state, sessionSubagentForCall, pickTaskTitle(block.input) ?? prompt);
                    getHiddenParentToolCalls(state).add(call);

                    // Emit tool-call-start using the session subagent CUID2 as call id.
                    // This lets the app tracer link subsequent subagent messages (which carry
                    // the same CUID2 as envelope.subagent / parentUUID) to this tool call.
                    envelopes.push(createEnvelope('agent', {
                        t: 'tool-call-start',
                        call: sessionSubagentForCall,
                        name,
                        title,
                        description: title,
                        args,
                    }, { turn: turnId, subagent }));

                    const buffered = consumeBufferedSubagentMessages(state, call);
                    for (const bufferedMessage of buffered) {
                        const replay = mapClaudeLogMessageToSessionEnvelopesInternal(bufferedMessage, state);
                        envelopes.push(...replay.envelopes);
                    }
                    continue;
                }

                envelopes.push(createEnvelope('agent', {
                    t: 'tool-call-start',
                    call,
                    name,
                    title,
                    description: title,
                    args,
                }, { turn: turnId, subagent }));
                const buffered = consumeBufferedSubagentMessages(state, call);
                for (const bufferedMessage of buffered) {
                    const replay = mapClaudeLogMessageToSessionEnvelopesInternal(bufferedMessage, state);
                    envelopes.push(...replay.envelopes);
                }
            }
        }

        return {
            currentTurnId: state.currentTurnId,
            envelopes,
        };
    }

    if (message.type === 'user') {
        // Compact summary messages → service event (not user message)
        // Check isCompactSummary flag first (set in JSONL logs), then fall back to content
        // prefix detection (SDK stream-json output does not include isCompactSummary)
        const rawContent = message.message.content;
        const compactCheckText = typeof rawContent === 'string'
            ? rawContent
            : (Array.isArray(rawContent) && rawContent.length > 0 && rawContent[0].type === 'text')
                ? rawContent[0].text
                : null;
        if ((message as any).isCompactSummary
            || (compactCheckText && compactCheckText.startsWith('This session is being continued from a previous conversation'))) {
            const turnId = ensureTurn(state, envelopes);
            envelopes.push(createEnvelope('agent', { t: 'service', text: 'Context compacted' }, { turn: turnId }));
            return { currentTurnId: state.currentTurnId, envelopes };
        }

        if (typeof message.message.content === 'string') {
            let text = message.message.content;

            // /compact command → service event (not user message)
            const trimmedText = text.trim();
            if (trimmedText === '/compact' || trimmedText.startsWith('/compact ')) {
                const turnId = ensureTurn(state, envelopes);
                envelopes.push(createEnvelope('agent', { t: 'service', text: 'Compacting conversation...' }, { turn: turnId }));
                return { currentTurnId: state.currentTurnId, envelopes };
            }

            // Skill/slash command messages:
            // <command-message> = user-visible short message → normal user text
            // <command-name> = slash command name (e.g. /review)
            // <command-args> = user's arguments → normal user text
            // Both message and args are shown as plain text; no collapsing.
            if (text.includes('<command-message>')) {
                const msgMatch = text.match(/<command-message>([\s\S]*?)<\/command-message>/);
                const nameMatch = text.match(/<command-name>\s*(\/?\S+)\s*<\/command-name>/);
                const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
                if (nameMatch) {
                    const args = argsMatch ? argsMatch[1].trim() : '';
                    const combined = [nameMatch[1].trim(), args].filter(Boolean).join(' ');

                    // Track this command so the next user message (skill prompt) gets wrapped
                    const uuid = pickUuid(message);
                    if (uuid) {
                        state.pendingSkillCommandUuid = uuid;
                        state.pendingSkillCommandName = nameMatch[1].trim();
                    }

                    closeTurn(state, 'completed', envelopes);
                    if (combined) {
                        envelopes.push(createEnvelope('user', { t: 'text', text: combined }));
                    }

                    return { currentTurnId: state.currentTurnId, envelopes };
                }
            }

            // System-injected protocol messages — silently swallow.
            // These are Claude Code internal messages (e.g. <task-notification>, [Request interrupted])
            // written to JSONL but not meant for the user. Emitting them as service envelopes
            // caused the app to render them as agent reply bubbles (Bug 12B).
            const systemServiceText = getSystemInjectedServiceText(trimmedText, message);
            if (systemServiceText !== null) {
                return { currentTurnId: state.currentTurnId, envelopes };
            }

            if (message.isSidechain) {
                const turnId = ensureTurn(state, envelopes);
                maybeEmitSubagentStart(state, turnId, subagent, envelopes);
                envelopes.push(createEnvelope('agent', { t: 'text', text }, { turn: turnId, subagent }));
            } else {
                closeTurn(state, 'completed', envelopes);
                envelopes.push(createEnvelope('user', { t: 'text', text }));
            }

            return {
                currentTurnId: state.currentTurnId,
                envelopes,
            };
        }

        const blocks = Array.isArray(message.message.content) ? message.message.content : [];
        if (blocks.length === 0) {
            return {
                currentTurnId: state.currentTurnId,
                envelopes,
            };
        }

        // Non-sidechain user messages with array content: extract text as user envelope,
        // and handle tool_results as agent envelopes (they are Claude's tool responses)
        if (!message.isSidechain) {
            // Check if this message is a skill prompt (child of a command-message).
            // Two paths:
            // 1. Restored session: JSONL replayed with original uuids, parentUuid matches directly.
            // 2. New session: SDK writes skill prompt to JSONL with isMeta=true but never emits
            //    it in the live stream. The JSONL meta-scanner forwards it, but sdkToLogConverter
            //    already assigned a different random uuid to the command-message so parentUuid
            //    won't match — use isMeta=true as the fallback signal instead.
            const parentUuid = pickParentUuid(message);
            const isMeta = (message as { isMeta?: boolean }).isMeta === true;
            const isSkillPrompt = state.pendingSkillCommandUuid !== undefined
                && (
                    (parentUuid !== undefined && parentUuid === state.pendingSkillCommandUuid)
                    || isMeta
                );
            const skillCommandName = isSkillPrompt ? state.pendingSkillCommandName : undefined;
            if (isSkillPrompt) {
                state.pendingSkillCommandUuid = undefined;
                state.pendingSkillCommandName = undefined;
            }

            // Collect user text from blocks
            const userTexts: string[] = [];
            const toolResultBlocks: typeof blocks = [];
            for (const block of blocks) {
                if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
                    userTexts.push(block.text);
                } else if (block.type === 'tool_result') {
                    toolResultBlocks.push(block);
                }
            }

            if (isSkillPrompt && userTexts.length > 0) {
                // Skill prompt → emit as a structured wrap event (collapsible on new clients,
                // silently dropped by old clients whose Zod schema lacks t:'wrap')
                const label = skillCommandName ?? 'command prompt';
                const content = userTexts.join('\n');
                const turnId = ensureTurn(state, envelopes);
                envelopes.push(createEnvelope('agent', {
                    t: 'wrap',
                    label,
                    content,
                }, { turn: turnId }));
            } else if (userTexts.length > 0) {
                const joined = userTexts.join('\n');
                const systemText = getSystemInjectedServiceText(joined.trim(), message);
                if (systemText !== null) {
                    // System-injected message in array format → service event
                    const turnId = ensureTurn(state, envelopes);
                    envelopes.push(createEnvelope('agent', { t: 'service', text: systemText }, { turn: turnId }));
                } else {
                    // Regular user text
                    closeTurn(state, 'completed', envelopes);
                    envelopes.push(createEnvelope('user', { t: 'text', text: joined }));
                }
            }

            // Handle tool_results as agent envelopes (need a turn)
            if (toolResultBlocks.length > 0) {
                const turnId = ensureTurn(state, envelopes);
                for (const block of toolResultBlocks) {
                    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && block.tool_use_id.length > 0) {
                        const sessionSubagentForToolResult = getSessionSubagentIdForProviderSubagent(state, block.tool_use_id);
                        if (getHiddenParentToolCalls(state).has(block.tool_use_id)) {
                            if (sessionSubagentForToolResult) {
                                maybeEmitSubagentStop(state, turnId, sessionSubagentForToolResult, envelopes);
                                // Emit tool-call-end with the CUID2 that was used in tool-call-start
                                envelopes.push(createEnvelope('agent', {
                                    t: 'tool-call-end',
                                    call: sessionSubagentForToolResult,
                                    output: extractToolResultOutput(block),
                                }, { turn: turnId, subagent }));
                            }
                            getHiddenParentToolCalls(state).delete(block.tool_use_id);
                            continue;
                        }
                        if (sessionSubagentForToolResult) {
                            maybeEmitSubagentStop(state, turnId, sessionSubagentForToolResult, envelopes);
                        }
                        envelopes.push(createEnvelope('agent', {
                            t: 'tool-call-end',
                            call: block.tool_use_id,
                            output: extractToolResultOutput(block),
                        }, { turn: turnId, subagent }));
                    }
                }
            }
        } else {
            // Sidechain user messages: keep original behavior (agent role)
            const turnId = ensureTurn(state, envelopes);
            maybeEmitSubagentStart(state, turnId, subagent, envelopes);
            for (const block of blocks) {
                if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && block.tool_use_id.length > 0) {
                    const sessionSubagentForToolResult = getSessionSubagentIdForProviderSubagent(state, block.tool_use_id);
                    if (getHiddenParentToolCalls(state).has(block.tool_use_id)) {
                        if (sessionSubagentForToolResult) {
                            maybeEmitSubagentStop(state, turnId, sessionSubagentForToolResult, envelopes);
                            // Emit tool-call-end with the CUID2 that was used in tool-call-start
                            envelopes.push(createEnvelope('agent', {
                                t: 'tool-call-end',
                                call: sessionSubagentForToolResult,
                                output: extractToolResultOutput(block),
                            }, { turn: turnId, subagent }));
                        }
                        getHiddenParentToolCalls(state).delete(block.tool_use_id);
                        continue;
                    }
                    if (sessionSubagentForToolResult) {
                        maybeEmitSubagentStop(state, turnId, sessionSubagentForToolResult, envelopes);
                    }
                    envelopes.push(createEnvelope('agent', {
                        t: 'tool-call-end',
                        call: block.tool_use_id,
                        output: extractToolResultOutput(block),
                    }, { turn: turnId, subagent }));
                    continue;
                }

                if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
                    envelopes.push(createEnvelope('agent', { t: 'text', text: block.text }, { turn: turnId, subagent }));
                }
            }
        }

        return {
            currentTurnId: state.currentTurnId,
            envelopes,
        };
    }

    return {
        currentTurnId: state.currentTurnId,
        envelopes,
    };
}

/**
 * Detect system-injected user messages that Claude Code writes to JSONL
 * but never emits via SDK stdout stream. These are internal protocol
 * elements (same pattern as <command-message> detection in the mapper).
 *
 * Returns a human-readable service label if the message is system-injected,
 * or null if it's a real user message.
 */
function getSystemInjectedServiceText(trimmedContent: string, message: RawJSONLines): string | null {
    // Task completion notifications (Claude Code background task protocol)
    if (trimmedContent.startsWith('<task-notification>')) {
        return 'Task completed';
    }

    // User interruption markers (written by Claude Code or happy-cli)
    if (trimmedContent.startsWith('[Request interrupted')) {
        return 'Request interrupted';
    }

    // Session start errors (daemon/SDK errors injected as user messages)
    if (trimmedContent.startsWith('Failed to start session') || trimmedContent.startsWith('Error\nFailed to start session')) {
        return 'Session error';
    }

    // API errors injected as user messages
    if (trimmedContent.startsWith('API Error:')) {
        return 'API error';
    }

    // isMeta=true messages that weren't caught as skill prompts
    // (e.g. "Continue from where you left off" without a preceding command-message)
    if ((message as { isMeta?: boolean }).isMeta === true) {
        return null;  // SDK protocol msg — silently ignore
    }

    return null;
}
