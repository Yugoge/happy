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
    readCodexMapping,
    sweepCodexMapping,
    upsertCodexMappingEntry,
    removeCodexMappingEntry,
    codexMappingPath,
} from './codexMapping';

export interface CodexMappingDaemonController {
    getPendingCodexSessionIds(): Set<string>;
    onWebhook(sessionId: string, metadata: Metadata): void;
    onSessionEnd(sessionId: string): void;
    runStartupSweep(): Promise<void>;
}

interface MappingControllerState {
    cache: Set<string>;
    chain: Promise<void>;
    path: string;
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
    enqueue(state, async () => {
        await upsertCodexMappingEntry({ happySessionId: sessionId, codexThreadId: tid, pid, cwd }, state.path);
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
    };
    return {
        getPendingCodexSessionIds: () => state.cache,
        onWebhook: (sessionId, metadata) => queueUpsert(state, sessionId, metadata),
        onSessionEnd: (sessionId) => queueRemove(state, sessionId),
        runStartupSweep: () => {
            const p = runSweepInline(state);
            enqueue(state, () => p);
            return p;
        },
    };
}
