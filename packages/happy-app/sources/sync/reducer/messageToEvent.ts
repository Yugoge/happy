/**
 * Message to Event Parser
 *
 * Converts certain messages into events that skip normal message processing.
 * Tool calls like mcp__happy__change_title are intercepted here and converted
 * to native service messages (e.g. "Title changed to X").
 */

import { NormalizedMessage, AgentEvent } from "../typesRaw";

/** Check agent text content for usage-limit markers. */
function parseUsageLimitEvent(text: string): AgentEvent | null {
    const match = text.match(/^Claude AI usage limit reached\|(\d+)$/);
    if (!match) return null;
    const timestamp = parseInt(match[1], 10);
    if (isNaN(timestamp)) return null;
    return { type: 'limit-reached', endsAt: timestamp } as AgentEvent;
}

/**
 * AC-D3: defense-in-depth legacy fallback for already-stored plain-text resume
 * notices ("Resumed Codex thread <id>"). The live producer now emits a real
 * t:'service' envelope, but persisted agent text from before that change must
 * still render gray. Narrow by design: non-space suffix only, agent text only
 * (sidechains are skipped upstream in parseMessageAsEvent), no failure/error
 * conversion, regex not broadened.
 */
function parseResumedThreadEvent(text: string): AgentEvent | null {
    if (!/^Resumed Codex thread \S+$/.test(text)) return null;
    return { type: 'message', message: text } as AgentEvent;
}

/** Check agent content blocks for tool calls that should become events. */
function parseAgentMessage(msg: NormalizedMessage & { role: 'agent' }): AgentEvent | null {
    for (const block of msg.content) {
        if (block.type === 'text') {
            const evt = parseUsageLimitEvent(block.text);
            if (evt) return evt;
            const resumed = parseResumedThreadEvent(block.text);
            if (resumed) return resumed;
        }
        // Intercept mcp__happy__change_title tool calls and convert to service message
        if (block.type === 'tool-call' && block.name === 'mcp__happy__change_title') {
            const title = block.input?.title;
            if (typeof title === 'string') {
                return { type: 'message', message: 'Title changed to "' + title + '"' } as AgentEvent;
            }
        }
        if (block.type === 'tool-call' && (block.name === 'EnterPlanMode' || block.name === 'enter_plan_mode')) {
            return { type: 'message', message: 'Entering plan mode' } as AgentEvent;
        }
    }
    return null;
}

/**
 * Parses a normalized message to determine if it should be converted to an event.
 * Returns an AgentEvent if the message should be converted, null otherwise.
 */
export function parseMessageAsEvent(msg: NormalizedMessage): AgentEvent | null {
    if (msg.isSidechain) return null;

    if (msg.role === 'agent') {
        return parseAgentMessage(msg);
    }

    if (msg.role === 'user') {
        const trimmed = msg.content.text.trim();
        if (trimmed === '/compact' || trimmed.startsWith('/compact ')) {
            return { type: 'message', message: 'Compacting conversation...' } as AgentEvent;
        }
    }

    return null;
}

/**
 * Checks if a message should be excluded from normal processing
 * after being converted to an event.
 */
export function shouldSkipNormalProcessing(msg: NormalizedMessage): boolean {
    return parseMessageAsEvent(msg) !== null;
}