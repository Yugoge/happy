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
export async function notifyDaemonOfCodexTid(
    happySessionId: string,
    tid: string,
    baseMetadata: Metadata,
): Promise<void> {
    const enriched: Metadata = { ...baseMetadata, codexThreadId: tid };
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
