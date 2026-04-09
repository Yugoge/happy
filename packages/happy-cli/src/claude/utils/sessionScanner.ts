import { InvalidateSync } from "@/utils/sync";
import { RawJSONLines, RawJSONLinesSchema } from "../types";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { logger } from "@/ui/logger";
import { startFileWatcher } from "@/modules/watcher/startFileWatcher";
import { getProjectPath } from "./path";

/**
 * Known internal Claude Code event types that should be silently skipped.
 * These are written to session JSONL files by Claude Code but are not
 * actual conversation messages - they're internal state/tracking events.
 */
const INTERNAL_CLAUDE_EVENT_TYPES = new Set([
    'file-history-snapshot',
    'change',
    'queue-operation',
]);

/** Returns true if the message should be forwarded even when sendExisting=false */
function isJSONLOnlyMessage(m: RawJSONLines): boolean {
    const isMeta = (m as { isMeta?: boolean }).isMeta === true;
    const isSidechain = (m as { isSidechain?: boolean }).isSidechain === true;
    return isMeta || isSidechain;
}

interface ScannerState {
    finishedSessions: Set<string>;
    pendingSessions: Set<string>;
    currentSessionId: string | null;
    watchers: Map<string, (() => void)>;
    processedMessageKeys: Set<string>;
}

function createScannerState(): ScannerState {
    return {
        finishedSessions: new Set<string>(),
        pendingSessions: new Set<string>(),
        currentSessionId: null,
        watchers: new Map<string, (() => void)>(),
        processedMessageKeys: new Set<string>(),
    };
}

/** Mark existing messages as processed, optionally sending them */
async function initializeExistingMessages(
    state: ScannerState,
    projectDir: string,
    sessionId: string,
    sendExisting: boolean,
    onMessage: (m: RawJSONLines) => void,
) {
    const messages = await readSessionLog(projectDir, sessionId);
    if (sendExisting) {
        logger.debug(`[SESSION_SCANNER] Sending ${messages.length} existing messages from session ${sessionId}`);
        for (const m of messages) {
            state.processedMessageKeys.add(messageKey(m));
            onMessage(m);
        }
    } else {
        logger.debug(`[SESSION_SCANNER] Marking ${messages.length} existing messages as processed from session ${sessionId}`);
        markExistingAsProcessed(state, messages, onMessage);
    }
    state.currentSessionId = sessionId;
}

/** Mark messages as processed, forwarding JSONL-only messages (isMeta, isSidechain) */
function markExistingAsProcessed(
    state: ScannerState,
    messages: RawJSONLines[],
    onMessage: (m: RawJSONLines) => void,
) {
    for (const m of messages) {
        state.processedMessageKeys.add(messageKey(m));
        // Forward isMeta and isSidechain messages even when sendExisting=false.
        // The SDK writes skill prompts (isMeta) and subagent operations
        // (isSidechain) to JSONL but never emits them via live stream —
        // skipping them here means the file watcher will never re-deliver them.
        if (isJSONLOnlyMessage(m)) {
            onMessage(m);
        }
    }
}

/** Collect all session IDs that need processing */
function collectSessionIds(state: ScannerState): string[] {
    const sessions: string[] = [];
    for (const p of state.pendingSessions) {
        sessions.push(p);
    }
    if (state.currentSessionId && !state.pendingSessions.has(state.currentSessionId)) {
        sessions.push(state.currentSessionId);
    }
    for (const [sessionId] of state.watchers) {
        if (!sessions.includes(sessionId)) {
            sessions.push(sessionId);
        }
    }
    return sessions;
}

/** Process new messages for all tracked sessions */
async function processSessions(
    state: ScannerState,
    projectDir: string,
    sessions: string[],
    onMessage: (m: RawJSONLines) => void,
) {
    for (const session of sessions) {
        const sessionMessages = await readSessionLog(projectDir, session);
        let skipped = 0;
        let sent = 0;
        for (const file of sessionMessages) {
            const key = messageKey(file);
            if (state.processedMessageKeys.has(key)) {
                skipped++;
                continue;
            }
            state.processedMessageKeys.add(key);
            logger.debug(`[SESSION_SCANNER] Sending new message: type=${file.type}, uuid=${file.type === 'summary' ? file.leafUuid : file.uuid}`);
            onMessage(file);
            sent++;
        }
        if (sessionMessages.length > 0) {
            logger.debug(`[SESSION_SCANNER] Session ${session}: found=${sessionMessages.length}, skipped=${skipped}, sent=${sent}`);
        }
    }
}

/** Move pending sessions to finished and ensure watchers exist */
function updateSessionTracking(
    state: ScannerState,
    sessions: string[],
    projectDir: string,
    sync: InvalidateSync,
) {
    for (const p of sessions) {
        if (state.pendingSessions.has(p)) {
            state.pendingSessions.delete(p);
            state.finishedSessions.add(p);
        }
    }
    for (const p of sessions) {
        if (!state.watchers.has(p)) {
            logger.debug(`[SESSION_SCANNER] Starting watcher for session: ${p}`);
            state.watchers.set(p, startFileWatcher(join(projectDir, `${p}.jsonl`), () => { sync.invalidate(); }));
        }
    }
}

/** Clean up scanner resources */
async function cleanupScanner(state: ScannerState, intervalId: ReturnType<typeof setInterval>, sync: InvalidateSync) {
    clearInterval(intervalId);
    for (const w of state.watchers.values()) { w(); }
    state.watchers.clear();
    await sync.invalidateAndAwait();
    sync.stop();
}

export async function createSessionScanner(opts: {
    sessionId: string | null,
    workingDirectory: string,
    onMessage: (message: RawJSONLines) => void,
    /** If true, send all existing messages immediately instead of marking them as processed */
    sendExisting?: boolean,
}) {
    const projectDir = getProjectPath(opts.workingDirectory);
    const state = createScannerState();

    if (opts.sessionId) {
        await initializeExistingMessages(state, projectDir, opts.sessionId, !!opts.sendExisting, opts.onMessage);
    }

    const sync = new InvalidateSync(async () => {
        const sessions = collectSessionIds(state);
        await processSessions(state, projectDir, sessions, opts.onMessage);
        updateSessionTracking(state, sessions, projectDir, sync);
    });
    await sync.invalidateAndAwait();
    const intervalId = setInterval(() => { sync.invalidate(); }, 3000);

    return {
        cleanup: () => cleanupScanner(state, intervalId, sync),
        onNewSession: (sessionId: string) => handleNewSession(state, sessionId, sync),
    };
}

function handleNewSession(state: ScannerState, sessionId: string, sync: InvalidateSync) {
    if (state.currentSessionId === sessionId) {
        logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is the same as the current session, skipping`);
        return;
    }
    if (state.finishedSessions.has(sessionId)) {
        logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already finished, skipping`);
        return;
    }
    if (state.pendingSessions.has(sessionId)) {
        logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already pending, skipping`);
        return;
    }
    if (state.currentSessionId) {
        state.pendingSessions.add(state.currentSessionId);
    }
    logger.debug(`[SESSION_SCANNER] New session: ${sessionId}`);
    state.currentSessionId = sessionId;
    sync.invalidate();
}

export type SessionScanner = ReturnType<typeof createSessionScanner>;


//
// Helpers
//

function messageKey(message: RawJSONLines): string {
    if (message.type === 'user') {
        return message.uuid;
    } else if (message.type === 'assistant') {
        return message.uuid;
    } else if (message.type === 'summary') {
        return 'summary: ' + message.leafUuid + ': ' + message.summary;
    } else if (message.type === 'system') {
        return message.uuid;
    } else {
        throw Error() // Impossible
    }
}

/** Parse a single JSONL line into a RawJSONLines message, or null if invalid */
function parseJSONLLine(line: string): RawJSONLines | null {
    if (line.trim() === '') return null;
    const message = JSON.parse(line);
    if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) return null;
    const parsed = RawJSONLinesSchema.safeParse(message);
    return parsed.success ? parsed.data : null;
}

/** Read and parse session log file */
async function readSessionLog(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
    const expectedSessionFile = join(projectDir, `${sessionId}.jsonl`);
    logger.debug(`[SESSION_SCANNER] Reading session file: ${expectedSessionFile}`);
    let file: string;
    try {
        file = await readFile(expectedSessionFile, 'utf-8');
    } catch (error) {
        logger.debug(`[SESSION_SCANNER] Session file not found: ${expectedSessionFile}`);
        return [];
    }
    const messages: RawJSONLines[] = [];
    for (const line of file.split('\n')) {
        try {
            const parsed = parseJSONLLine(line);
            if (parsed) messages.push(parsed);
        } catch (e) {
            logger.debug(`[SESSION_SCANNER] Error processing message: ${e}`);
        }
    }
    return messages;
}
