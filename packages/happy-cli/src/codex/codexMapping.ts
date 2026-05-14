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

import { readFileSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { platform } from 'node:os';

import { atomicWriteJson, cleanOrphanTmpFiles } from '@/utils/atomicWriteJson';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

export const CODEX_MAPPING_SCHEMA_VERSION = 1;
export const CODEX_MAPPING_FILE_NAME = 'codex-mapping.json';
export const PENDING_TTL_MS = 30_000;

export type CodexMappingState = 'pending' | 'bound' | 'stale';

/**
 * M3' — optional structured cgroup metadata captured at upsert time on Linux.
 *
 * Snapshot-at-upsert; not refreshed on later sweeps. `paths` is empty when
 * /proc/<pid>/cgroup is unreadable or unparseable. `version` distinguishes
 * cgroup v1 (multiple `N:subsys:/path` lines with non-zero hierarchyId), v2
 * (single `0::/path` line with empty controllers), `mixed` (both shapes
 * present), and `unknown` (recognized neither). Field is OMITTED (not null)
 * on non-Linux platforms and on read failure.
 *
 * NOTE: This is observability metadata captured at session bind time, NOT a
 * replacement for the bash-side fd-scan fallback counter from Block 3.
 */
export interface CgroupInfo {
    raw: string;
    version: 'v1' | 'v2' | 'mixed' | 'unknown';
    paths: string[];
    readAt: string;
}

export interface CodexMappingEntry {
    happySessionId: string;
    codexThreadId?: string;
    pid: number;
    cwd: string;
    flavor: 'codex';
    state: CodexMappingState;
    firstSeenAt: string;
    lastUpdatedAt: string;
    cgroup?: CgroupInfo;
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

/**
 * M3' — validate persisted cgroup blob. Defensive: a malformed `cgroup` field
 * on disk MUST NOT poison the entry. Returns true only for the exact shape
 * produced by `parseCgroupRaw`. Lines in `raw` are NOT independently
 * re-validated here — `parseCgroupRaw` already classified the version.
 */
export function isValidCgroupInfo(value: unknown): value is CgroupInfo {
    if (!value || typeof value !== 'object') return false;
    const c = value as Record<string, unknown>;
    if (typeof c.raw !== 'string') return false;
    if (c.version !== 'v1' && c.version !== 'v2' && c.version !== 'mixed' && c.version !== 'unknown') {
        return false;
    }
    if (!Array.isArray(c.paths)) return false;
    if (!c.paths.every(p => typeof p === 'string')) return false;
    if (typeof c.readAt !== 'string') return false;
    return true;
}

function isValidEntry(entry: unknown): entry is CodexMappingEntry {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    const baseOk = typeof e.happySessionId === 'string'
        && typeof e.pid === 'number'
        && typeof e.cwd === 'string'
        && e.flavor === 'codex'
        && (e.state === 'pending' || e.state === 'bound' || e.state === 'stale')
        && typeof e.firstSeenAt === 'string'
        && typeof e.lastUpdatedAt === 'string';
    if (!baseOk) return false;
    // Strip malformed persisted cgroup data — entry remains valid; cgroup becomes undefined.
    if (e.cgroup !== undefined && !isValidCgroupInfo(e.cgroup)) {
        delete (entry as Record<string, unknown>).cgroup;
    }
    return true;
}

interface CgroupLineClass {
    path: string | undefined;
    kind: 'v1' | 'v2' | 'unknown';
}

function classifyCgroupLine(line: string): CgroupLineClass {
    const firstColon = line.indexOf(':');
    if (firstColon < 0) return { path: undefined, kind: 'unknown' };
    const secondColon = line.indexOf(':', firstColon + 1);
    if (secondColon < 0) return { path: undefined, kind: 'unknown' };
    const hierarchyId = line.slice(0, firstColon);
    const controllers = line.slice(firstColon + 1, secondColon);
    const path = line.slice(secondColon + 1);
    if (!/^\d+$/.test(hierarchyId)) return { path: undefined, kind: 'unknown' };
    if (hierarchyId === '0' && controllers === '') return { path, kind: 'v2' };
    if (hierarchyId !== '0' && controllers !== '') return { path, kind: 'v1' };
    return { path, kind: 'unknown' };
}

function decideCgroupVersion(sawV1: boolean, sawV2: boolean, unrecognized: boolean): CgroupInfo['version'] {
    if (sawV1 && sawV2) return 'mixed';
    if (sawV1 && !sawV2) return 'v1';
    if (sawV2 && !sawV1) return 'v2';
    if (unrecognized) return 'unknown';
    return 'unknown';
}

/**
 * M3' — pure parser for /proc/<pid>/cgroup contents.
 *
 * Exported separately from `readCgroupForPid` so unit tests can exercise
 * v1/v2/mixed/unknown classification with fixture strings on any platform
 * (vitest dev loop runs on macOS as well as Linux CI).
 *
 * Line shapes:
 *   - cgroup v2 single-line: `0::/some/path` (hierarchyId=0, controllers empty)
 *   - cgroup v1 multi-line:  `N:controller[,controller2]:/some/path`
 *   - hybrid (rare):         mixture of both forms
 *
 * @param raw     verbatim file contents
 * @param readAt  ISO-8601 timestamp captured at read time (caller-supplied
 *                so the parser stays pure / deterministic for tests)
 */
export function parseCgroupRaw(raw: string, readAt: string): CgroupInfo {
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let sawV1 = false;
    let sawV2 = false;
    let unrecognized = false;
    const paths: string[] = [];
    for (const line of lines) {
        const cls = classifyCgroupLine(line);
        if (cls.path !== undefined) paths.push(cls.path);
        if (cls.kind === 'v1') sawV1 = true;
        else if (cls.kind === 'v2') sawV2 = true;
        else unrecognized = true;
    }
    return { raw, version: decideCgroupVersion(sawV1, sawV2, unrecognized), paths, readAt };
}

/**
 * M3' — read /proc/<pid>/cgroup on Linux only and parse via `parseCgroupRaw`.
 *
 * Returns `undefined` on:
 *   - non-Linux platforms (darwin / win32 / freebsd)
 *   - invalid pid (not a positive integer)
 *   - read failure (ENOENT, EACCES, etc.)
 *
 * Sync read because /proc/<pid>/cgroup is a small (≤4KB) kernel-synthesized
 * file and the caller (`queueUpsert`) runs inside the daemon's serialized
 * mutation chain where sync I/O is acceptable.
 */
export function readCgroupForPid(pid: number): CgroupInfo | undefined {
    if (platform() !== 'linux') return undefined;
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    let raw: string;
    try {
        raw = readFileSync(`/proc/${pid}/cgroup`, 'utf8');
    } catch (error) {
        logger.debug(`[CODEX MAPPING] cgroup read failed for pid ${pid} (non-fatal):`, error);
        return undefined;
    }
    return parseCgroupRaw(raw, new Date().toISOString());
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
    /**
     * M3' — optional cgroup snapshot captured by the daemon when binding the
     * entry. Caller passes `undefined` on non-Linux or when /proc read fails.
     *
     * Merge rule (codex round-2 #6 + BA-QA observation #2):
     *   - Fresh upsert with cgroup defined → REPLACE existing cgroup
     *     (cgroup paths don't change for a live pid, but readAt should
     *     refresh on each successful bind)
     *   - Fresh upsert with cgroup undefined AND existing entry has cgroup →
     *     PRESERVE existing cgroup (don't overwrite real data with read failure)
     *   - New entry with cgroup undefined → field omitted
     */
    cgroup?: CgroupInfo;
}

function nowIso(): string {
    return new Date().toISOString();
}

function resolveMergedCgroup(
    existing: CodexMappingEntry | undefined,
    input: UpsertCodexEntryInput,
): CgroupInfo | undefined {
    if (input.cgroup) return input.cgroup;
    // Codex round-3 F4 defensive rule: only preserve existing cgroup if the
    // pid hasn't changed. If happySessionId is rebound to a different pid AND
    // the fresh cgroup read fails, the old pid's cgroup is no longer
    // applicable — better to omit than to mislabel.
    if (existing?.cgroup && existing.pid === input.pid) return existing.cgroup;
    return undefined;
}

function mergeEntry(
    existing: CodexMappingEntry | undefined,
    input: UpsertCodexEntryInput,
): CodexMappingEntry {
    const ts = nowIso();
    const state: CodexMappingState = input.codexThreadId ? 'bound' : 'pending';
    const merged: CodexMappingEntry = {
        happySessionId: input.happySessionId,
        codexThreadId: input.codexThreadId ?? existing?.codexThreadId,
        pid: input.pid,
        cwd: input.cwd,
        flavor: 'codex',
        state: input.codexThreadId ? 'bound' : (existing?.state ?? state),
        firstSeenAt: existing?.firstSeenAt ?? ts,
        lastUpdatedAt: ts,
    };
    const cgroup = resolveMergedCgroup(existing, input);
    if (cgroup) merged.cgroup = cgroup;
    return merged;
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
