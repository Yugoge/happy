import { db } from "@/storage/db";
import { log } from "@/utils/log";

/**
 * Per-session transient `thinking` flag, set on every session-alive heartbeat.
 *
 * NOT persisted to Prisma (`Session` schema only stores `active` + `lastActiveAt`).
 * This in-memory map exists solely to answer "is session X currently thinking?"
 * for a freshly connected websocket client, so the app can render the
 * "claude babbling" indicator immediately on reconnect/reopen instead of
 * waiting for the next CLI keepAlive tick (every 2s).
 *
 * TTL is 5s — slightly longer than the CLI keepAlive cadence (2s) so a
 * reconnecting client always gets the most recent in-flight state, but
 * short enough that a silent CLI naturally rolls off without lingering.
 *
 * See spec-20260424-084848 section 5.19 / pipeline 7.2 for the full rationale.
 */

interface ThinkingEntry {
    thinking: boolean;
    activeAt: number;  // timestamp of the heartbeat that produced this entry
    userId: string;
}

interface ActivitySnapshotRow {
    sessionId: string;
    activeAt: number;
    thinking: boolean;
}

const THINKING_TTL_MS = 5 * 1000;
const SNAPSHOT_LOOKBACK_MS = 1000 * 60 * 2;

const thinkingCache = new Map<string, ThinkingEntry>();

/**
 * Record the current thinking state for a session.
 */
export function recordThinking(sessionId: string, userId: string, thinking: boolean, activeAt: number): void {
    thinkingCache.set(sessionId, { thinking, activeAt, userId });
}

/**
 * Clear the thinking entry for a session (e.g. on session-end).
 */
export function clearThinking(sessionId: string): void {
    thinkingCache.delete(sessionId);
}

function buildSnapshotRow(sessionId: string, lastActiveAt: Date, userId: string, now: number): ActivitySnapshotRow {
    const cached = thinkingCache.get(sessionId);
    const isFresh = cached !== undefined
        && (now - cached.activeAt) < THINKING_TTL_MS
        && cached.userId === userId;
    if (isFresh && cached) {
        return { sessionId, activeAt: cached.activeAt, thinking: cached.thinking };
    }
    return { sessionId, activeAt: lastActiveAt.getTime(), thinking: false };
}

async function findRecentlyActiveSessions(userId: string): Promise<Array<{ id: string; lastActiveAt: Date }>> {
    const cutoff = new Date(Date.now() - SNAPSHOT_LOOKBACK_MS);
    return db.session.findMany({
        where: { accountId: userId, active: true, lastActiveAt: { gt: cutoff } },
        select: { id: true, lastActiveAt: true }
    });
}

/**
 * Look up the active sessions for a user that are recently alive,
 * for a connect-time snapshot. Combines a DB query (scoped to active=true
 * sessions the user owns) with the in-memory thinking map (transient).
 * Sessions that are active in DB but have no recent thinking entry are
 * returned with thinking=false so the client gets a complete picture.
 */
export async function getActivitySnapshotForUser(userId: string): Promise<ActivitySnapshotRow[]> {
    try {
        const sessions = await findRecentlyActiveSessions(userId);
        const now = Date.now();
        return sessions.map(s => buildSnapshotRow(s.id, s.lastActiveAt, userId, now));
    } catch (error) {
        log({ module: 'thinking-cache', level: 'error' }, `Error building activity snapshot for user ${userId}: ${error}`);
        return [];
    }
}

// Periodic cleanup of stale thinking entries (every minute).
setInterval(() => {
    const cutoff = Date.now() - THINKING_TTL_MS;
    for (const [sid, entry] of thinkingCache.entries()) {
        if (entry.activeAt < cutoff) {
            thinkingCache.delete(sid);
        }
    }
}, 60 * 1000);
