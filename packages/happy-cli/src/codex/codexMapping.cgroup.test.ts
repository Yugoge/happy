/**
 * M3' cgroup tests — pure parser + Linux-only reader + validator + merge rule.
 *
 * Split into its own file so the parser tests do not collide with the
 * pre-existing codexMapping.test.ts function-size budgets.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
    readCodexMapping,
    upsertCodexMappingEntry,
    parseCgroupRaw,
    readCgroupForPid,
    isValidCgroupInfo,
    type CgroupInfo,
} from './codexMapping';

const READ_AT = '2026-05-14T12:00:00.000Z';
const CG_A: CgroupInfo = { raw: '0::/a', version: 'v2', paths: ['/a'], readAt: '2026-05-14T12:00:00.000Z' };
const CG_B: CgroupInfo = { raw: '0::/b', version: 'v2', paths: ['/b'], readAt: '2026-05-14T12:00:01.000Z' };

let workDir: string;
let mappingFile: string;

beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'happy-cgroup-test-'));
    mappingFile = join(workDir, 'codex-mapping.json');
});

afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
});

function malformedFile(): object {
    return {
        schemaVersion: 1,
        entries: [{
            happySessionId: 'cg-bad', pid: process.pid, cwd: '/t', flavor: 'codex', state: 'bound',
            firstSeenAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
            cgroup: { raw: 'ok', version: 'BAD', paths: 'x', readAt: 1 },
        }],
    };
}

describe('parseCgroupRaw (M3 pure parser)', () => {
    it('classifies cgroup v2 single-line as v2', () => {
        const r = parseCgroupRaw('0::/user.slice/session-3.scope', READ_AT);
        expect(r.version).toBe('v2');
        expect(r.paths).toEqual(['/user.slice/session-3.scope']);
        expect(r.readAt).toBe(READ_AT);
    });

    it('classifies cgroup v1 multi-line as v1', () => {
        const raw = '12:perf_event:/\n10:memory:/user.slice\n9:cpu,cpuacct:/user.slice';
        const r = parseCgroupRaw(raw, READ_AT);
        expect(r.version).toBe('v1');
        expect(r.paths).toEqual(['/', '/user.slice', '/user.slice']);
    });

    it('classifies a mix of v1 and v2 lines as mixed', () => {
        const r = parseCgroupRaw('0::/somewhere\n2:cpu:/user.slice', READ_AT);
        expect(r.version).toBe('mixed');
        expect(r.paths).toEqual(['/somewhere', '/user.slice']);
    });

    it('classifies unrecognized lines as unknown', () => {
        const r = parseCgroupRaw('garbage-no-colons', READ_AT);
        expect(r.version).toBe('unknown');
        expect(r.paths).toEqual([]);
    });

    it('tolerates blank lines and whitespace', () => {
        const r = parseCgroupRaw('\n0::/x\n   \n', READ_AT);
        expect(r.version).toBe('v2');
        expect(r.paths).toEqual(['/x']);
    });

    it('preserves verbatim raw input', () => {
        const raw = '0::/a/b/c\n12:cpu:/x';
        expect(parseCgroupRaw(raw, READ_AT).raw).toBe(raw);
    });

    it('returns empty paths and unknown for empty input', () => {
        const r = parseCgroupRaw('', READ_AT);
        expect(r.version).toBe('unknown');
        expect(r.paths).toEqual([]);
    });
});

describe('readCgroupForPid (M3 wrapper)', () => {
    it('returns undefined for invalid pid', () => {
        expect(readCgroupForPid(0)).toBeUndefined();
        expect(readCgroupForPid(-1)).toBeUndefined();
        expect(readCgroupForPid(1.5)).toBeUndefined();
        expect(readCgroupForPid(NaN)).toBeUndefined();
    });

    it('returns CgroupInfo for own pid on Linux, undefined otherwise', () => {
        const r = readCgroupForPid(process.pid);
        if (process.platform !== 'linux') {
            expect(r).toBeUndefined();
            return;
        }
        expect(r).toBeDefined();
        expect(r!.raw.length).toBeGreaterThan(0);
        expect(['v1', 'v2', 'mixed', 'unknown']).toContain(r!.version);
    });

    it('returns undefined for nonexistent high pid', () => {
        expect(readCgroupForPid(2_147_483_646)).toBeUndefined();
    });
});

describe('isValidCgroupInfo (M3 validator)', () => {
    const valid: CgroupInfo = { raw: '0::/x', version: 'v2', paths: ['/x'], readAt: READ_AT };

    it('accepts well-formed CgroupInfo', () => {
        expect(isValidCgroupInfo(valid)).toBe(true);
    });

    it('rejects null/undefined/non-object/wrong types', () => {
        expect(isValidCgroupInfo(null)).toBe(false);
        expect(isValidCgroupInfo(undefined)).toBe(false);
        expect(isValidCgroupInfo({ ...valid, raw: 123 })).toBe(false);
        expect(isValidCgroupInfo({ ...valid, version: 'bogus' })).toBe(false);
        expect(isValidCgroupInfo({ ...valid, paths: 'x' })).toBe(false);
        expect(isValidCgroupInfo({ ...valid, paths: [1] })).toBe(false);
        expect(isValidCgroupInfo({ ...valid, readAt: 123 })).toBe(false);
    });
});

describe('upsertCodexMappingEntry cgroup merge (AC4)', () => {
    it('stores cgroup when provided on a fresh entry', async () => {
        await upsertCodexMappingEntry({ happySessionId: 'cg-1', pid: process.pid, cwd: '/t', cgroup: CG_A }, mappingFile);
        expect((await readCodexMapping(mappingFile)).entries[0].cgroup).toEqual(CG_A);
    });

    it('omits cgroup when not provided on a fresh entry', async () => {
        await upsertCodexMappingEntry({ happySessionId: 'cg-2', pid: process.pid, cwd: '/t' }, mappingFile);
        expect((await readCodexMapping(mappingFile)).entries[0].cgroup).toBeUndefined();
    });

    it('REPLACES cgroup on re-upsert when fresh cgroup is provided', async () => {
        await upsertCodexMappingEntry({ happySessionId: 'cg-3', pid: process.pid, cwd: '/t', cgroup: CG_A }, mappingFile);
        await upsertCodexMappingEntry({ happySessionId: 'cg-3', pid: process.pid, cwd: '/t', cgroup: CG_B, codexThreadId: 'tid' }, mappingFile);
        expect((await readCodexMapping(mappingFile)).entries[0].cgroup).toEqual(CG_B);
    });

    it('PRESERVES existing cgroup on re-upsert when fresh cgroup is undefined AND pid matches', async () => {
        await upsertCodexMappingEntry({ happySessionId: 'cg-4', pid: process.pid, cwd: '/t', cgroup: CG_A }, mappingFile);
        await upsertCodexMappingEntry({ happySessionId: 'cg-4', pid: process.pid, cwd: '/t', codexThreadId: 'tid' }, mappingFile);
        expect((await readCodexMapping(mappingFile)).entries[0].cgroup).toEqual(CG_A);
    });

    it('DROPS existing cgroup on re-upsert when fresh cgroup is undefined AND pid changed (defensive F4)', async () => {
        // Same happySessionId rebinds to a different pid: old pid's cgroup is no
        // longer applicable. Better to omit than to mislabel the new pid.
        await upsertCodexMappingEntry({ happySessionId: 'cg-5', pid: process.pid, cwd: '/t', cgroup: CG_A }, mappingFile);
        await upsertCodexMappingEntry({ happySessionId: 'cg-5', pid: process.pid + 1, cwd: '/t', codexThreadId: 'tid' }, mappingFile);
        expect((await readCodexMapping(mappingFile)).entries[0].cgroup).toBeUndefined();
    });

    it('strips malformed persisted cgroup on read (defensive)', async () => {
        await writeFile(mappingFile, JSON.stringify(malformedFile()), 'utf8');
        const m = await readCodexMapping(mappingFile);
        expect(m.entries).toHaveLength(1);
        expect(m.entries[0].cgroup).toBeUndefined();
    });
});
