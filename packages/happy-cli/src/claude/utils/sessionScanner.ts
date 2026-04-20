import { InvalidateSync } from "@/utils/sync";
import { RawJSONLines, RawJSONLinesSchema } from "../types";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
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

type ScannerState = {
    projectDir: string,
    finishedSessions: Set<string>,
    pendingSessions: Set<string>,
    currentSessionId: string | null,
    watchers: Map<string, () => void>,
    processedMessageKeys: Set<string>,
};

type ScannerOpts = {
    sessionId: string | null,
    workingDirectory: string,
    onMessage: (message: RawJSONLines) => void,
    sendExisting?: boolean,
};

export async function createSessionScanner(opts: ScannerOpts) {
    const state: ScannerState = {
        projectDir: getProjectPath(opts.workingDirectory),
        finishedSessions: new Set<string>(),
        pendingSessions: new Set<string>(),
        currentSessionId: null,
        watchers: new Map<string, () => void>(),
        processedMessageKeys: new Set<string>(),
    };

    if (opts.sessionId) {
        await seedInitialMessages(state, opts.sessionId, opts.sendExisting === true, opts.onMessage);
        // IMPORTANT: Also start watching the initial session file because Claude Code
        // may continue writing to it even after creating a new session with --resume
        // (agent tasks and other updates can still write to the original session file)
        state.currentSessionId = opts.sessionId;
    }

    const sync: InvalidateSync = new InvalidateSync(async () => {
        await runSyncCycle(state, opts.onMessage, sync);
    });
    await sync.invalidateAndAwait();
    const intervalId = setInterval(() => { sync.invalidate(); }, 3000);

    return buildPublicInterface(state, sync, intervalId);
}

export type SessionScanner = ReturnType<typeof createSessionScanner>;


//
// Helpers
//

async function runSyncCycle(
    state: ScannerState,
    onMessage: (message: RawJSONLines) => void,
    sync: InvalidateSync,
): Promise<void> {
    const sessions = collectActiveSessions(state.pendingSessions, state.currentSessionId, state.watchers);
    for (const session of sessions) {
        const sessionMessages = await readSessionLog(state.projectDir, session);
        processAndDispatch(session, sessionMessages, state.processedMessageKeys, onMessage);
    }
    movePendingToFinished(sessions, state.pendingSessions, state.finishedSessions);
    ensureWatchers(sessions, state, sync);
}

function movePendingToFinished(
    sessions: string[],
    pending: Set<string>,
    finished: Set<string>,
): void {
    for (const p of sessions) {
        if (pending.has(p)) {
            pending.delete(p);
            finished.add(p);
        }
    }
}

function ensureWatchers(sessions: string[], state: ScannerState, sync: InvalidateSync): void {
    for (const p of sessions) {
        if (state.watchers.has(p)) continue;
        logger.debug(`[SESSION_SCANNER] Starting watcher for session: ${p}`);
        state.watchers.set(p, startFileWatcher(
            join(state.projectDir, `${p}.jsonl`),
            () => { sync.invalidate(); },
        ));
    }
}

function buildPublicInterface(
    state: ScannerState,
    sync: InvalidateSync,
    intervalId: NodeJS.Timeout,
) {
    return {
        cleanup: async () => {
            clearInterval(intervalId);
            for (const w of state.watchers.values()) w();
            state.watchers.clear();
            await sync.invalidateAndAwait();
            sync.stop();
        },
        onNewSession: (sessionId: string) => handleNewSession(state, sync, sessionId),
    };
}

function handleNewSession(state: ScannerState, sync: InvalidateSync, sessionId: string): void {
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

async function seedInitialMessages(
    state: ScannerState,
    sessionId: string,
    sendExisting: boolean,
    onMessage: (message: RawJSONLines) => void,
): Promise<void> {
    const messages = await readSessionLog(state.projectDir, sessionId);
    if (sendExisting) {
        logger.debug(`[SESSION_SCANNER] Sending ${messages.length} existing messages from session ${sessionId}`);
        for (const m of messages) {
            state.processedMessageKeys.add(messageKey(m));
            onMessage(m);
        }
        return;
    }
    logger.debug(`[SESSION_SCANNER] Marking ${messages.length} existing messages as processed from session ${sessionId}`);
    forwardMetaMessages(messages, state.processedMessageKeys, onMessage);
}

function forwardMetaMessages(
    messages: RawJSONLines[],
    processedMessageKeys: Set<string>,
    onMessage: (message: RawJSONLines) => void,
): void {
    for (const m of messages) {
        processedMessageKeys.add(messageKey(m));
        // Forward isMeta messages even when sendExisting=false.
        // The SDK writes skill prompts to JSONL with isMeta=true but
        // never emits them via live stream — skipping them here means
        // the file watcher will never re-deliver them either.
        if ((m as { isMeta?: boolean }).isMeta === true) {
            onMessage(m);
        }
    }
}

function collectActiveSessions(
    pendingSessions: Set<string>,
    currentSessionId: string | null,
    watchers: Map<string, () => void>,
): string[] {
    const sessions: string[] = [];
    for (const p of pendingSessions) sessions.push(p);
    if (currentSessionId && !pendingSessions.has(currentSessionId)) {
        sessions.push(currentSessionId);
    }
    for (const [sessionId] of watchers) {
        if (!sessions.includes(sessionId)) sessions.push(sessionId);
    }
    return sessions;
}

function processAndDispatch(
    session: string,
    sessionMessages: RawJSONLines[],
    processedMessageKeys: Set<string>,
    onMessage: (message: RawJSONLines) => void,
): void {
    let skipped = 0;
    let sent = 0;
    for (const file of sessionMessages) {
        const key = messageKey(file);
        if (processedMessageKeys.has(key)) { skipped++; continue; }
        processedMessageKeys.add(key);
        logger.debug(`[SESSION_SCANNER] Sending new message: type=${file.type}, uuid=${file.type === 'summary' ? file.leafUuid : file.uuid}`);
        onMessage(file);
        sent++;
    }
    if (sessionMessages.length > 0) {
        logger.debug(`[SESSION_SCANNER] Session ${session}: found=${sessionMessages.length}, skipped=${skipped}, sent=${sent}`);
    }
}

function messageKey(message: RawJSONLines): string {
    if (message.type === 'user') return message.uuid;
    if (message.type === 'assistant') return message.uuid;
    if (message.type === 'summary') return 'summary: ' + message.leafUuid + ': ' + message.summary;
    if (message.type === 'system') return message.uuid;
    throw Error(); // Impossible
}

function parseJSONLContent(content: string, sourceLabel: string): RawJSONLines[] {
    const lines = content.split('\n');
    const messages: RawJSONLines[] = [];
    for (const l of lines) {
        try {
            if (l.trim() === '') continue;
            const message = JSON.parse(l);
            if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) continue;
            const parsed = RawJSONLinesSchema.safeParse(message);
            if (!parsed.success) continue;
            messages.push(parsed.data);
        } catch (e) {
            logger.debug(`[SESSION_SCANNER] Error processing message from ${sourceLabel}: ${e}`);
            continue;
        }
    }
    return messages;
}

/**
 * Read and parse session log file, merging any per-session subagent logs.
 * Subagent logs live at <projectDir>/<sessionId>/subagents/*.jsonl and carry
 * Task-delegated work. We merge them with the main session log, sorted by
 * timestamp so they interleave naturally with the parent messages.
 */
async function readSessionLog(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
    const expectedSessionFile = join(projectDir, `${sessionId}.jsonl`);
    logger.debug(`[SESSION_SCANNER] Reading session file: ${expectedSessionFile}`);
    let mainMessages: RawJSONLines[] = [];
    try {
        const file = await readFile(expectedSessionFile, 'utf-8');
        mainMessages = parseJSONLContent(file, expectedSessionFile);
    } catch (error) {
        logger.debug(`[SESSION_SCANNER] Session file not found: ${expectedSessionFile}`);
    }
    const subagentMessages = await readSubagentLogs(projectDir, sessionId);
    if (subagentMessages.length === 0) return mainMessages;
    return mergeByTimestamp(mainMessages, subagentMessages);
}

function mergeByTimestamp(a: RawJSONLines[], b: RawJSONLines[]): RawJSONLines[] {
    const combined = [...a, ...b];
    combined.sort((x, y) => {
        const tx = (x as { timestamp?: string }).timestamp ?? '';
        const ty = (y as { timestamp?: string }).timestamp ?? '';
        return tx < ty ? -1 : tx > ty ? 1 : 0;
    });
    return combined;
}

/**
 * Read subagent JSONL logs from <projectDir>/<sessionId>/subagents/.
 * Returns an empty array if the directory does not exist.
 */
async function readSubagentLogs(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
    const subagentsDir = join(projectDir, sessionId, 'subagents');
    let entries: string[];
    try {
        entries = await readdir(subagentsDir);
    } catch (error) {
        return [];
    }
    const messages: RawJSONLines[] = [];
    for (const name of entries) {
        if (!name.endsWith('.jsonl')) continue;
        const filePath = join(subagentsDir, name);
        try {
            const content = await readFile(filePath, 'utf-8');
            messages.push(...parseJSONLContent(content, filePath));
        } catch (e) {
            logger.debug(`[SESSION_SCANNER] Error reading subagent log ${filePath}: ${e}`);
        }
    }
    return messages;
}
