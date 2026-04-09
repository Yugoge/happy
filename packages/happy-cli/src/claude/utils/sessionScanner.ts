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

/** Check if a message is only available via JSONL (not emitted by SDK live stream) */
function isJSONLOnlyMessage(m: RawJSONLines): boolean {
    return (m as { isMeta?: boolean }).isMeta === true
        || (m as { isSidechain?: boolean }).isSidechain === true;
}

type ScannerState = {
    finishedSessions: Set<string>;
    pendingSessions: Set<string>;
    currentSessionId: string | null;
    watchers: Map<string, () => void>;
    processedMessageKeys: Set<string>;
};

function createScannerState(): ScannerState {
    return {
        finishedSessions: new Set(),
        pendingSessions: new Set(),
        currentSessionId: null,
        watchers: new Map(),
        processedMessageKeys: new Set(),
    };
}

/** Initialize by processing existing messages in the session file */
async function initExistingMessages(
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
        for (const m of messages) {
            state.processedMessageKeys.add(messageKey(m));
            // Forward isMeta and isSidechain messages even when sendExisting=false.
            // The SDK writes skill prompts (isMeta) and subagent internal operations
            // (isSidechain) to JSONL but never emits them via live stream — skipping
            // them here means the file watcher will never re-deliver them either.
            if (isJSONLOnlyMessage(m)) {
                onMessage(m);
            }
        }
    }
    state.currentSessionId = sessionId;
}

/** Collect all session IDs that need processing */
function collectSessionIds(state: ScannerState): string[] {
    const sessions: string[] = [...state.pendingSessions];
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

/** Process new messages from a single session file */
async function processSession(
    state: ScannerState,
    projectDir: string,
    session: string,
    onMessage: (m: RawJSONLines) => void,
) {
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

/** Update session lifecycle and watchers after sync */
function updateSessionTracking(state: ScannerState, sessions: string[], sync: InvalidateSync, projectDir: string) {
    for (const p of sessions) {
        if (state.pendingSessions.has(p)) {
            state.pendingSessions.delete(p);
            state.finishedSessions.add(p);
        }
        if (!state.watchers.has(p)) {
            logger.debug(`[SESSION_SCANNER] Starting watcher for session: ${p}`);
            state.watchers.set(p, startFileWatcher(join(projectDir, `${p}.jsonl`), () => { sync.invalidate(); }));
        }
    }
}

/** Build the sync function that processes all pending sessions */
function buildSyncFn(state: ScannerState, projectDir: string, onMessage: (m: RawJSONLines) => void, syncRef: { current: InvalidateSync | null }) {
    return async () => {
        const sessions = collectSessionIds(state);
        for (const session of sessions) {
            await processSession(state, projectDir, session, onMessage);
        }
        updateSessionTracking(state, sessions, syncRef.current!, projectDir);
    };
}

/** Handle a new session ID arriving */
function handleNewSession(state: ScannerState, sessionId: string, sync: InvalidateSync) {
    if (state.currentSessionId === sessionId || state.finishedSessions.has(sessionId) || state.pendingSessions.has(sessionId)) {
        logger.debug(`[SESSION_SCANNER] New session: ${sessionId} already known, skipping`);
        return;
    }
    if (state.currentSessionId) {
        state.pendingSessions.add(state.currentSessionId);
    }
    logger.debug(`[SESSION_SCANNER] New session: ${sessionId}`);
    state.currentSessionId = sessionId;
    sync.invalidate();
}

/** Clean up scanner resources */
async function cleanupScanner(state: ScannerState, intervalId: NodeJS.Timeout, sync: InvalidateSync) {
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
    sendExisting?: boolean,
}) {
    const projectDir = getProjectPath(opts.workingDirectory);
    const state = createScannerState();

    if (opts.sessionId) {
        await initExistingMessages(state, projectDir, opts.sessionId, opts.sendExisting ?? false, opts.onMessage);
    }

    const syncRef: { current: InvalidateSync | null } = { current: null };
    const sync = new InvalidateSync(buildSyncFn(state, projectDir, opts.onMessage, syncRef));
    syncRef.current = sync;
    await sync.invalidateAndAwait();
    const intervalId = setInterval(() => { sync.invalidate(); }, 3000);

    return {
        cleanup: () => cleanupScanner(state, intervalId, sync),
        onNewSession: (sessionId: string) => handleNewSession(state, sessionId, sync),
    };
}

export type SessionScanner = ReturnType<typeof createSessionScanner>;

function messageKey(message: RawJSONLines): string {
    if (message.type === 'summary') {
        return 'summary: ' + message.leafUuid + ': ' + message.summary;
    }
    return message.uuid;
}

/** Parse a single JSONL line into a RawJSONLines message, or null if invalid */
function parseLine(line: string): RawJSONLines | null {
    if (line.trim() === '') return null;
    try {
        const message = JSON.parse(line);
        if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) return null;
        const parsed = RawJSONLinesSchema.safeParse(message);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/** Read and parse session log file */
async function readSessionLog(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    logger.debug(`[SESSION_SCANNER] Reading session file: ${filePath}`);
    let file: string;
    try {
        file = await readFile(filePath, 'utf-8');
    } catch {
        logger.debug(`[SESSION_SCANNER] Session file not found: ${filePath}`);
        return [];
    }
    return file.split('\n').map(parseLine).filter((m): m is RawJSONLines => m !== null);
}
