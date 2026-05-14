/**
 * AC3 + AC5 + S1 tests for codexMapping module.
 *
 * Covers: read/write round-trip, upsert, remove, sweep (dead-pid + pending TTL),
 * malformed file tolerance, idempotency.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
    readCodexMapping,
    writeCodexMapping,
    upsertCodexMappingEntry,
    removeCodexMappingEntry,
    sweepCodexMapping,
    CODEX_MAPPING_SCHEMA_VERSION,
    PENDING_TTL_MS,
    type CodexMappingFile,
    type CodexMappingEntry,
} from './codexMapping';

let workDir: string;
let mappingFile: string;

beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'happy-codex-mapping-test-'));
    mappingFile = join(workDir, 'codex-mapping.json');
});

afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<CodexMappingEntry> = {}): CodexMappingEntry {
    return {
        happySessionId: 'happy-1',
        codexThreadId: '019d-tid-1',
        pid: process.pid,
        cwd: '/tmp/project',
        flavor: 'codex',
        state: 'bound',
        firstSeenAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makeFile(entries: CodexMappingEntry[]): CodexMappingFile {
    return { schemaVersion: 1, entries };
}

describe('readCodexMapping', () => {
    it('returns empty mapping when file is absent', async () => {
        const result = await readCodexMapping(mappingFile);
        expect(result).toEqual({ schemaVersion: CODEX_MAPPING_SCHEMA_VERSION, entries: [] });
    });

    it('returns empty mapping when file is empty', async () => {
        await writeFile(mappingFile, '', 'utf8');
        const result = await readCodexMapping(mappingFile);
        expect(result.entries).toEqual([]);
    });

    it('returns empty mapping when JSON is malformed', async () => {
        await writeFile(mappingFile, '{not json', 'utf8');
        const result = await readCodexMapping(mappingFile);
        expect(result.entries).toEqual([]);
    });

    it('filters out invalid entries while keeping valid ones', async () => {
        const invalid = { invalid: true } as unknown as CodexMappingEntry;
        const file = makeFile([makeEntry({ happySessionId: 'good' }), invalid]);
        await writeFile(mappingFile, JSON.stringify(file), 'utf8');
        const result = await readCodexMapping(mappingFile);
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].happySessionId).toBe('good');
    });
});

describe('writeCodexMapping', () => {
    it('round-trips correctly via atomic write', async () => {
        await writeCodexMapping(makeFile([makeEntry()]), mappingFile);
        const raw = await readFile(mappingFile, 'utf8');
        const parsed = JSON.parse(raw);
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.entries).toHaveLength(1);
    });
});

describe('upsertCodexMappingEntry', () => {
    it('creates a bound entry when codexThreadId is provided', async () => {
        await upsertCodexMappingEntry(
            { happySessionId: 'h1', codexThreadId: 'tid-1', pid: process.pid, cwd: '/tmp' },
            mappingFile,
        );
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(1);
        expect(mapping.entries[0].state).toBe('bound');
        expect(mapping.entries[0].codexThreadId).toBe('tid-1');
    });

    it('creates a pending entry when codexThreadId is absent', async () => {
        await upsertCodexMappingEntry(
            { happySessionId: 'h2', pid: process.pid, cwd: '/tmp' },
            mappingFile,
        );
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries[0].state).toBe('pending');
        expect(mapping.entries[0].codexThreadId).toBeUndefined();
    });

    it('transitions pending -> bound on follow-up upsert with tid', async () => {
        await upsertCodexMappingEntry({ happySessionId: 'h3', pid: process.pid, cwd: '/tmp' }, mappingFile);
        await upsertCodexMappingEntry(
            { happySessionId: 'h3', codexThreadId: 'tid-3', pid: process.pid, cwd: '/tmp' },
            mappingFile,
        );
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(1);
        expect(mapping.entries[0].state).toBe('bound');
        expect(mapping.entries[0].codexThreadId).toBe('tid-3');
    });

    it('preserves firstSeenAt across upserts', async () => {
        await upsertCodexMappingEntry({ happySessionId: 'h4', pid: process.pid, cwd: '/tmp' }, mappingFile);
        const before = await readCodexMapping(mappingFile);
        const firstSeen = before.entries[0].firstSeenAt;
        await new Promise(resolve => setTimeout(resolve, 5));
        await upsertCodexMappingEntry(
            { happySessionId: 'h4', codexThreadId: 'tid-4', pid: process.pid, cwd: '/tmp' },
            mappingFile,
        );
        const after = await readCodexMapping(mappingFile);
        expect(after.entries[0].firstSeenAt).toBe(firstSeen);
        expect(after.entries[0].lastUpdatedAt >= firstSeen).toBe(true);
    });
});

describe('removeCodexMappingEntry', () => {
    it('removes an entry by happySessionId', async () => {
        await upsertCodexMappingEntry(
            { happySessionId: 'h5', codexThreadId: 'tid-5', pid: process.pid, cwd: '/tmp' },
            mappingFile,
        );
        await removeCodexMappingEntry('h5', mappingFile);
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(0);
    });

    it('is a no-op when the entry does not exist', async () => {
        await upsertCodexMappingEntry(
            { happySessionId: 'h6', codexThreadId: 'tid-6', pid: process.pid, cwd: '/tmp' },
            mappingFile,
        );
        await removeCodexMappingEntry('nonexistent', mappingFile);
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(1);
    });
});

describe('sweepCodexMapping (S1)', () => {
    it('removes entries whose pid is no longer alive', async () => {
        const file = makeFile([makeEntry({ pid: 999999, happySessionId: 'dead' })]);
        await writeCodexMapping(file, mappingFile);
        const result = await sweepCodexMapping(mappingFile);
        expect(result.removed).toBe(1);
        expect(result.remaining).toBe(0);
    });

    it('keeps entries whose pid is alive', async () => {
        await writeCodexMapping(makeFile([makeEntry({ pid: process.pid })]), mappingFile);
        const result = await sweepCodexMapping(mappingFile);
        expect(result.removed).toBe(0);
        expect(result.remaining).toBe(1);
    });

    it('removes pending entries older than PENDING_TTL_MS', async () => {
        const oldIso = new Date(Date.now() - (PENDING_TTL_MS + 5_000)).toISOString();
        const entry = makeEntry({
            pid: process.pid,
            happySessionId: 'stale-pending',
            state: 'pending',
            codexThreadId: undefined,
            firstSeenAt: oldIso,
            lastUpdatedAt: oldIso,
        });
        await writeCodexMapping(makeFile([entry]), mappingFile);
        const result = await sweepCodexMapping(mappingFile);
        expect(result.removed).toBe(1);
    });

    it('keeps pending entries newer than PENDING_TTL_MS', async () => {
        const recentIso = new Date(Date.now() - 1_000).toISOString();
        const entry = makeEntry({
            pid: process.pid,
            happySessionId: 'fresh-pending',
            state: 'pending',
            codexThreadId: undefined,
            firstSeenAt: recentIso,
            lastUpdatedAt: recentIso,
        });
        await writeCodexMapping(makeFile([entry]), mappingFile);
        const result = await sweepCodexMapping(mappingFile);
        expect(result.removed).toBe(0);
        expect(result.remaining).toBe(1);
    });

    it('does not rewrite the file when nothing changed', async () => {
        await writeCodexMapping(makeFile([makeEntry({ pid: process.pid })]), mappingFile);
        const before = (await readFile(mappingFile, 'utf8')).length;
        const result = await sweepCodexMapping(mappingFile);
        const after = (await readFile(mappingFile, 'utf8')).length;
        expect(result.removed).toBe(0);
        expect(after).toBe(before);
    });
});
