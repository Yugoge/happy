import { db } from "@/storage/db";
import { log } from "@/utils/log";

/**
 * Protect active sessions during server shutdown by extending their lastActiveAt timestamp.
 *
 * This function updates all currently active sessions to have a lastActiveAt time set 20 minutes
 * into the future. This prevents the timeout mechanism from marking sessions as inactive during
 * a server restart, giving the system time to come back online before sessions expire.
 *
 * Logic:
 * 1. Find all sessions with active=true
 * 2. Set their lastActiveAt to (current time + 20 minutes)
 * 3. The timeout checker runs every minute and marks sessions inactive after 20 minutes
 * 4. With the 20-minute buffer, sessions survive a typical restart cycle
 *
 * @returns The number of sessions protected
 */
export async function protectActiveSessions(): Promise<number> {
    try {
        const futureTime = new Date(Date.now() + 1000 * 60 * 20);

        const result = await db.session.updateMany({
            where: { active: true },
            data: { lastActiveAt: futureTime }
        });

        log(
            { module: 'protect-sessions' },
            `Protected ${result.count} active sessions from timeout during shutdown`
        );

        return result.count;
    } catch (error) {
        log(
            { module: 'protect-sessions', level: 'error' },
            `Failed to protect sessions: ${error}`
        );
        return 0;
    }
}
