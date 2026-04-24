/**
 * Stop-hook feedback filter for Claude Code CLI JSONL output.
 *
 * Claude Code CLI injects stop-hook output (e.g. spec-verify.py, overnight-timelock.py)
 * as `type: "user"` JSONL records with string content starting with
 * "Stop hook feedback:". This is developer-facing telemetry and must never appear
 * in the user's conversation view (spec §5.9).
 *
 * This filter is invoked at the transport/relay layer before the session-protocol
 * mapper, so suppressed messages never reach the app or produce any envelope.
 */

import type { RawJSONLines } from '@/claude/types';

const STOP_HOOK_PREFIX = 'Stop hook feedback:';

/**
 * Returns true if the given JSONL record is stop-hook feedback and must be
 * silently discarded. Non-user records, non-string content, and any content
 * that does not start with the "Stop hook feedback:" prefix are passed
 * through unchanged.
 */
export function isStopHookFeedback(message: RawJSONLines): boolean {
    if (message.type !== 'user') {
        return false;
    }
    const content = (message as { message?: { content?: unknown } }).message?.content;
    if (typeof content !== 'string') {
        return false;
    }
    return content.trimStart().startsWith(STOP_HOOK_PREFIX);
}
