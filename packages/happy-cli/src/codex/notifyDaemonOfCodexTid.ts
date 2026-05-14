/**
 * Codex tid-bind daemon notify hook (M1).
 *
 * Single shared helper called from every codex tid-binding site:
 *   - packages/happy-cli/src/codex/runCodex.ts (startThread path, post line ~713)
 *   - packages/happy-cli/src/codex/resumeExistingThread.ts (resume path, post line ~38)
 *
 * Mirrors the claude reference pattern at packages/happy-cli/src/claude/session.ts:112-124
 * (`onSessionFound`): once the tid is known downstream, re-call the idempotent
 * daemon `/session-started` endpoint with enriched metadata so the daemon's
 * in-memory TrackedSession (and the per-daemon codex-mapping.json) learn the tid.
 *
 * No new daemon endpoint is needed — daemon webhook handler at
 * packages/happy-cli/src/daemon/run.ts:179-208 is idempotent (overwrites
 * existingSession.happySessionMetadataFromLocalWebhook in place).
 *
 * @module notifyDaemonOfCodexTid
 */

import { logger } from '@/ui/logger';
import type { Metadata } from '@/api/types';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';

/**
 * Notify the daemon that the codex thread ID has been bound for a happy session.
 *
 * Idempotent — safe to call multiple times for the same (happySessionId, tid).
 *
 * @param happySessionId Server-issued happy session ID (response.id from getOrCreateSession)
 * @param tid            Codex thread ID (RESULT tid from startThread/resumeThread —
 *                       NOT the requested tid; see codexAppServerClient.ts:856
 *                       where the returned tid can be rotated)
 * @param baseMetadata   Current session metadata (will be merged with codexThreadId)
 */
/**
 * M2' — set `process.title` for operator observability via `ps` / `ps -ef`.
 *
 * Slice direction: `tid.slice(-8)` uses the random/sequence TAIL of UUIDv7.
 * DO NOT use `slice(0,8)` — UUIDv7 first chars are a millisecond timestamp,
 * so two sessions started in the same millisecond would collide on a prefix
 * slice. The TAIL is the random portion and is collision-safe.
 *
 * Linux 16-char `comm` truncation: `"happy-codex:"` (12 chars) + 8 tail = 20
 * chars total, exceeds Linux's 16-char `comm` cap. `ps`/`ps -ef` cmdline
 * shows the full title; `comm` field gets truncated to ~4 visible chars of
 * the tid. Acceptable for the observability purpose. If htop visibility
 * becomes required, shorten to `codex:${tid.slice(-8)}` (15 chars) in a
 * follow-up cycle.
 *
 * Best-effort: assignment failure is swallowed so the daemon-notify path
 * still runs.
 */
function setCodexProcessTitle(tid: string): void {
    try {
        process.title = `happy-codex:${tid.slice(-8)}`;
    } catch (titleError) {
        logger.debug(
            `[CODEX TID NOTIFY] process.title set failed for tid ${tid} (non-fatal):`,
            titleError,
        );
    }
}

export async function notifyDaemonOfCodexTid(
    happySessionId: string,
    tid: string,
    baseMetadata: Metadata,
): Promise<void> {
    const enriched: Metadata = { ...baseMetadata, codexThreadId: tid };
    // M2' — centralized title set so both start path (runCodex.ts) and resume
    // path (resumeExistingThread.ts) get parity. Best-effort; does not break notify.
    setCodexProcessTitle(tid);
    try {
        const result = await notifyDaemonSessionStarted(happySessionId, enriched);
        if (result && result.error) {
            logger.debug(
                `[CODEX TID NOTIFY] Daemon notify failed for session ${happySessionId} tid ${tid}: ${result.error}`,
            );
        } else {
            logger.debug(
                `[CODEX TID NOTIFY] Daemon notified for session ${happySessionId} tid ${tid}`,
            );
        }
    } catch (error) {
        logger.debug(
            `[CODEX TID NOTIFY] Daemon notify threw for session ${happySessionId} tid ${tid}:`,
            error,
        );
    }
}
