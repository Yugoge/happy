/**
 * Per-daemon codex tid <-> happy session mapping file (M3).
 *
 * Location: `${configuration.happyHomeDir}/codex-mapping.json`
 *
 * Schema (schemaVersion = 1):
 *   {
 *     schemaVersion: 1,
 *     entries: [
 *       {
 *         happySessionId, codexThreadId?, pid, cwd, flavor: 'codex',
 *         state: 'pending' | 'bound' | 'stale',
 *         firstSeenAt, lastUpdatedAt   // ISO-8601
 *       },
 *       ...
 *     ]
 *   }
 *
 * Writer contract (M3 + F6): the DAEMON is the SOLE writer. Codex wrappers
 * communicate via the existing idempotent `/session-started` endpoint; the
 * daemon's webhook handler (`run.ts:179-205`) invokes `recordCodexMappingEntry`
 * which writes via `atomicWriteJson`. Because there is exactly one daemon
 * process per `$happyHomeDir` (enforced by daemon.state.json.lock), and Node's
 * single event loop serializes async work, no flock is required.
 *
 * Readers (recovery script, GC sweep) do NOT need locks: POSIX rename is
 * atomic AND daemon-as-sole-writer means readers never see a partial file.
 *
 * @module codexMapping
 */

import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { atomicWriteJson, cleanOrphanTmpFiles } from '@/utils/atomicWriteJson';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

export const CODEX_MAPPING_SCHEMA_VERSION = 1;
export const CODEX_MAPPING_FILE_NAME = 'codex-mapping.json';
export const PENDING_TTL_MS = 30_000;

export type CodexMappingState = 'pending' | 'bound' | 'stale';

export interface CodexMappingEntry {
    happySessionId: string;
    codexThreadId?: string;
    pid: number;
    cwd: string;
    flavor: 'codex';
    state: CodexMappingState;
    firstSeenAt: string;
    lastUpdatedAt: string;
}

export interface CodexMappingFile {
    schemaVersion: number;
    entries: CodexMappingEntry[];
}

export function codexMappingPath(happyHomeDir: string = configuration.happyHomeDir): string {
    return join(happyHomeDir, CODEX_MAPPING_FILE_NAME);
}

function emptyMapping(): CodexMappingFile {
    return { schemaVersion: CODEX_MAPPING_SCHEMA_VERSION, entries: [] };
}

/**
 * Read the codex-mapping file. Returns an empty mapping if the file is
 * missing, unreadable, or malformed.
 */
export async function readCodexMapping(
    path: string = codexMappingPath(),
): Promise<CodexMappingFile> {
    let raw: string;
    try {
        raw = await readFile(path, 'utf8');
    } catch {
        return emptyMapping();
    }
    if (!raw.trim()) return emptyMapping();
    try {
        const parsed = JSON.parse(raw) as Partial<CodexMappingFile>;
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
            return emptyMapping();
        }
        return {
            schemaVersion: typeof parsed.schemaVersion === 'number'
                ? parsed.schemaVersion
                : CODEX_MAPPING_SCHEMA_VERSION,
            entries: parsed.entries.filter(isValidEntry),
        };
    } catch (error) {
        logger.debug(`[CODEX MAPPING] Failed to parse ${path}, treating as empty:`, error);
        return emptyMapping();
    }
}

function isValidEntry(entry: unknown): entry is CodexMappingEntry {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    return typeof e.happySessionId === 'string'
        && typeof e.pid === 'number'
        && typeof e.cwd === 'string'
        && e.flavor === 'codex'
        && (e.state === 'pending' || e.state === 'bound' || e.state === 'stale')
        && typeof e.firstSeenAt === 'string'
        && typeof e.lastUpdatedAt === 'string';
}

/**
 * Persist the mapping file via atomic write. Caller is the daemon (sole writer).
 */
export async function writeCodexMapping(
    mapping: CodexMappingFile,
    path: string = codexMappingPath(),
): Promise<void> {
    await cleanOrphanTmpFiles(path);
    await atomicWriteJson(path, mapping);
}

export interface UpsertCodexEntryInput {
    happySessionId: string;
    codexThreadId?: string;
    pid: number;
    cwd: string;
}

function nowIso(): string {
    return new Date().toISOString();
}

function mergeEntry(
    existing: CodexMappingEntry | undefined,
    input: UpsertCodexEntryInput,
): CodexMappingEntry {
    const ts = nowIso();
    const state: CodexMappingState = input.codexThreadId ? 'bound' : 'pending';
    return {
        happySessionId: input.happySessionId,
        codexThreadId: input.codexThreadId ?? existing?.codexThreadId,
        pid: input.pid,
        cwd: input.cwd,
        flavor: 'codex',
        state: input.codexThreadId ? 'bound' : (existing?.state ?? state),
        firstSeenAt: existing?.firstSeenAt ?? ts,
        lastUpdatedAt: ts,
    };
}

/**
 * Upsert a codex mapping entry. The daemon webhook handler calls this when
 * /session-started arrives with `flavor === 'codex'`.
 *
 * - Without `codexThreadId`: row enters `pending` state.
 * - With `codexThreadId`:    row transitions to `bound` state.
 */
export async function upsertCodexMappingEntry(
    input: UpsertCodexEntryInput,
    path: string = codexMappingPath(),
): Promise<void> {
    const current = await readCodexMapping(path);
    const idx = current.entries.findIndex(e => e.happySessionId === input.happySessionId);
    const merged = mergeEntry(idx >= 0 ? current.entries[idx] : undefined, input);
    if (idx >= 0) {
        current.entries[idx] = merged;
    } else {
        current.entries.push(merged);
    }
    current.schemaVersion = CODEX_MAPPING_SCHEMA_VERSION;
    await writeCodexMapping(current, path);
}

/**
 * Remove a codex mapping entry by happySessionId. Called on session end.
 */
export async function removeCodexMappingEntry(
    happySessionId: string,
    path: string = codexMappingPath(),
): Promise<void> {
    const current = await readCodexMapping(path);
    const next = current.entries.filter(e => e.happySessionId !== happySessionId);
    if (next.length === current.entries.length) return;
    current.entries = next;
    current.schemaVersion = CODEX_MAPPING_SCHEMA_VERSION;
    await writeCodexMapping(current, path);
}

/**
 * Delete the mapping file entirely. Used by tests and by daemon shutdown
 * cleanup if desired (not currently wired into shutdown — daemon leaves the
 * file in place; the next startup GC sweep prunes dead-pid entries).
 */
export async function deleteCodexMapping(
    path: string = codexMappingPath(),
): Promise<void> {
    try {
        await unlink(path);
    } catch {
        // ignore
    }
}

function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function entryIsExpired(entry: CodexMappingEntry, nowMs: number): boolean {
    if (!pidAlive(entry.pid)) return true;
    if (entry.state !== 'pending') return false;
    const firstSeen = Date.parse(entry.firstSeenAt);
    if (!Number.isFinite(firstSeen)) return false;
    return nowMs - firstSeen > PENDING_TTL_MS;
}

/**
 * Daemon-startup GC sweep (S1).
 *
 * Removes:
 *   - Entries whose pid is no longer alive (dead-pid GC)
 *   - Entries in `pending` state older than `PENDING_TTL_MS` (30s) — codex
 *     process crashed before thread/start completed
 *
 * Returns the number of entries removed (for logging / telemetry).
 */
export async function sweepCodexMapping(
    path: string = codexMappingPath(),
): Promise<{ removed: number; remaining: number }> {
    const current = await readCodexMapping(path);
    const nowMs = Date.now();
    const kept = current.entries.filter(e => !entryIsExpired(e, nowMs));
    const removed = current.entries.length - kept.length;
    if (removed > 0) {
        current.entries = kept;
        current.schemaVersion = CODEX_MAPPING_SCHEMA_VERSION;
        await writeCodexMapping(current, path);
    }
    return { removed, remaining: kept.length };
}
