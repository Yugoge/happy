/**
 * Daemon-side glue for codex-mapping.json (M3 + M5 + S1).
 *
 * Keeps daemon/run.ts small by parking the codex-mapping coordination logic
 * here. The daemon module imports a single factory which returns:
 *   - getPendingCodexSessionIds(): synchronous accessor for /list `tidPending`
 *   - onWebhook(sessionId, metadata):  upsert on /session-started
 *   - onSessionEnd(sessionId):          remove on session end
 *   - runStartupSweep():                S1 GC at daemon startup
 *
 * SERIALIZATION: all mutations (upsert, remove, sweep) AND the pending-cache
 * refresh are chained on a single controller-local promise. This guarantees
 * the read-merge-write sequence inside upsertCodexMappingEntry is never
 * interleaved with another mutation. Fire-and-forget callers do NOT see lost
 * updates — closes codex-Q1 lost-update finding.
 *
 * @module codexMappingDaemon
 */

import type { Metadata } from '@/api/types';
import { logger } from '@/ui/logger';

import {
    readCgroupForPid,
    readCodexMapping,
    sweepCodexMapping,
    upsertCodexMappingEntry,
    removeCodexMappingEntry,
    codexMappingPath,
} from './codexMapping';

/**
 * M1' — daemon-side codex-mapping health telemetry surfaced at `/list` root.
 *
 * IMPORTANT: This is MAPPING-HEALTH telemetry derived from the daemon's own
 * codex-mapping.json + sweep return values. It is NOT a replacement for the
 * bash-side fd-scan fallback counter from Block 3 (recovery-script-patches-
 * 20260513-211054.md). Those two counters answer different questions:
 *   - mappingStats.* answers: "is the daemon's mapping file healthy?"
 *   - bash fd-scan counter answers: "is the recovery script's mapping-primary
 *     path firing, or is it falling back to /proc fd-scan?"
 *
 * `sweepRemovedCount` is a monotonic per-daemon-process accumulator that
 * increments each time `sweepCodexMapping` reports a removal. It resets to 0
 * on daemon restart (durable counter requires state-file mutation — out of
 * scope per BA Section R-4).
 *
 * `entryCount` / `pendingCount` / `boundCount` are derived (point-in-time)
 * from a fresh read of codex-mapping.json on each `getMappingStats()` call.
 */
export interface MappingStats {
    entryCount: number;
    pendingCount: number;
    boundCount: number;
    sweepRemovedCount: number;
}

export interface CodexMappingDaemonController {
    getPendingCodexSessionIds(): Set<string>;
    getMappingStats(): Promise<MappingStats>;
    onWebhook(sessionId: string, metadata: Metadata): void;
    onSessionEnd(sessionId: string): void;
    runStartupSweep(): Promise<void>;
}

interface MappingControllerState {
    cache: Set<string>;
    chain: Promise<void>;
    path: string;
    sweepRemovedCount: number;
}

function metadataIsCodex(metadata: Metadata): boolean {
    return metadata.flavor === 'codex';
}

async function refreshPending(state: MappingControllerState): Promise<void> {
    try {
        const mapping = await readCodexMapping(state.path);
        state.cache = new Set(
            mapping.entries
                .filter(e => e.state === 'pending')
                .map(e => e.happySessionId),
        );
    } catch (error) {
        logger.debug('[CODEX MAPPING] Failed to refresh pending cache (non-fatal):', error);
    }
}

function enqueue(state: MappingControllerState, task: () => Promise<void>): void {
    // Serialize: every mutation appended to a single promise chain so the
    // read-merge-write inside upsertCodexMappingEntry never interleaves with
    // another mutation on the same file. Errors are absorbed so one failed
    // task does not break the chain.
    state.chain = state.chain.then(task).catch(error => {
        logger.debug('[CODEX MAPPING] Queued task failed (non-fatal):', error);
    });
}

function queueUpsert(state: MappingControllerState, sessionId: string, metadata: Metadata): void {
    if (!metadataIsCodex(metadata) || !metadata.hostPid) return;
    const pid = metadata.hostPid;
    const tid = metadata.codexThreadId;
    const cwd = metadata.path;
    // M3' — snapshot /proc/<pid>/cgroup at bind time on Linux. Non-fatal:
    // returns undefined on non-Linux, invalid pid, or read error.
    const cgroup = readCgroupForPid(pid);
    enqueue(state, async () => {
        await upsertCodexMappingEntry(
            { happySessionId: sessionId, codexThreadId: tid, pid, cwd, cgroup },
            state.path,
        );
        await refreshPending(state);
    });
}

function queueRemove(state: MappingControllerState, sessionId: string): void {
    enqueue(state, async () => {
        await removeCodexMappingEntry(sessionId, state.path);
        await refreshPending(state);
    });
}

async function runSweepInline(state: MappingControllerState): Promise<void> {
    try {
        const sweep = await sweepCodexMapping(state.path);
        if (sweep.removed > 0) {
            // M1' — monotonic per-daemon-process accumulator. Resets on daemon
            // restart per BA Section R-4 (durable counter would require
            // state-file mutation, out of scope this cycle).
            state.sweepRemovedCount += sweep.removed;
            logger.debug(
                `[CODEX MAPPING] Startup GC removed ${sweep.removed} stale entries (${sweep.remaining} remain)`,
            );
        }
    } catch (error) {
        logger.debug('[CODEX MAPPING] Startup GC sweep failed (non-fatal):', error);
    }
    await refreshPending(state);
}

/**
 * M1' — derive point-in-time mapping-health stats. Reads codex-mapping.json
 * fresh; `entryCount`/`pendingCount`/`boundCount` reflect on-disk state right
 * now. `sweepRemovedCount` is the monotonic accumulator from this daemon
 * process's sweep activity (not durable across restarts).
 */
async function computeMappingStats(state: MappingControllerState): Promise<MappingStats> {
    let entryCount = 0;
    let pendingCount = 0;
    let boundCount = 0;
    try {
        const mapping = await readCodexMapping(state.path);
        entryCount = mapping.entries.length;
        for (const e of mapping.entries) {
            if (e.state === 'pending') pendingCount++;
            else if (e.state === 'bound') boundCount++;
        }
    } catch (error) {
        logger.debug('[CODEX MAPPING] Failed to read mapping for stats (non-fatal):', error);
    }
    return {
        entryCount,
        pendingCount,
        boundCount,
        sweepRemovedCount: state.sweepRemovedCount,
    };
}

/**
 * Build the daemon-side codex-mapping controller. The daemon module wires
 * the returned hooks into its webhook handler, child-exit handler, and the
 * control-server /list factory.
 */
export function createCodexMappingDaemonController(
    pathOverride?: string,
): CodexMappingDaemonController {
    const state: MappingControllerState = {
        cache: new Set<string>(),
        chain: Promise.resolve(),
        path: pathOverride ?? codexMappingPath(),
        sweepRemovedCount: 0,
    };
    return {
        getPendingCodexSessionIds: () => state.cache,
        getMappingStats: () => computeMappingStats(state),
        onWebhook: (sessionId, metadata) => queueUpsert(state, sessionId, metadata),
        onSessionEnd: (sessionId) => queueRemove(state, sessionId),
        runStartupSweep: () => {
            // Note (codex round-3 F1): runSweepInline starts EXECUTING immediately,
            // then enqueue() appends a no-op that awaits the same promise. This
            // means subsequent upsert/remove tasks block on sweep completion, but
            // the sweep itself is not "inside" the chain. The pattern is sound
            // for the single startup-call usage; a future periodic-sweep cycle
            // should re-enter through enqueue() proper to remain race-free.
            const p = runSweepInline(state);
            enqueue(state, () => p);
            return p;
        },
    };
}
