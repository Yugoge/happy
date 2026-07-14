import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateClaudeSessionFile } from './claudeRemote';

const CWD = '/tmp/migrate-project';
const SESSION = '869820bd-69f4-4282-ad31-6fad95da4656';

function projectId(cwd: string): string {
    return resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-');
}
function compactRec(sessionId: string, ts: string): object {
    return { type: 'user', isCompactSummary: true, uuid: `c-${ts}`, timestamp: ts, sessionId };
}
function normalRec(sessionId: string, ts: string): object {
    return { type: 'assistant', uuid: `a-${ts}`, timestamp: ts, sessionId };
}
function transcriptFile(configDir: string): string {
    return join(configDir, 'projects', projectId(CWD), `${SESSION}.jsonl`);
}
function write(configDir: string, records: object[]): string {
    const file = transcriptFile(configDir);
    mkdirSync(join(configDir, 'projects', projectId(CWD)), { recursive: true });
    writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
}

describe('migrateClaudeSessionFile guard (M4 / AC6-AC8)', () => {
    let root: string;
    let from: string;
    let to: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'migrate-'));
        from = join(root, 'fromAcct', 'claude');
        to = join(root, 'toAcct', 'claude');
    });
    afterEach(() => { rmSync(root, { recursive: true, force: true }); });

    it('AC7: copies the source when the destination is absent', () => {
        const src = write(from, [normalRec(SESSION, '2026-07-13T10:00:00.000Z'), compactRec(SESSION, '2026-07-13T13:00:00.000Z')]);
        const decision = migrateClaudeSessionFile(from, to, CWD, SESSION);
        expect(decision).toBe('copied');
        expect(readFileSync(transcriptFile(to))).toEqual(readFileSync(src));
    });

    it('AC7: copies when the same-lineage source strictly dominates a poorer destination', () => {
        const src = write(from, [normalRec(SESSION, '2026-07-13T10:00:00.000Z'), compactRec(SESSION, '2026-07-13T13:00:00.000Z')]);
        write(to, [normalRec(SESSION, '2026-07-13T09:00:00.000Z')]);
        const decision = migrateClaudeSessionFile(from, to, CWD, SESSION);
        expect(decision).toBe('copied');
        expect(readFileSync(transcriptFile(to))).toEqual(readFileSync(src));
    });

    it('AC6: leaves a same-lineage strictly-richer destination intact', () => {
        write(from, [normalRec(SESSION, '2026-07-13T09:00:00.000Z')]);
        write(to, [normalRec(SESSION, '2026-07-13T10:00:00.000Z'), compactRec(SESSION, '2026-07-13T13:00:00.000Z')]);
        const before = readFileSync(transcriptFile(to));
        const decision = migrateClaudeSessionFile(from, to, CWD, SESSION);
        expect(decision).toBe('dest-richer-noop');
        expect(readFileSync(transcriptFile(to))).toEqual(before); // untouched
    });

    it('AC8: divergent lineage — clobbers nothing and emits a user-visible event', () => {
        const src = write(from, [compactRec(SESSION, '2026-07-13T13:00:00.000Z')]);
        const dst = write(to, [normalRec('a-different-session-uuid', '2026-07-13T20:00:00.000Z')]);
        const beforeSrc = readFileSync(src);
        const beforeDst = readFileSync(dst);
        const onEvent = vi.fn();
        const decision = migrateClaudeSessionFile(from, to, CWD, SESSION, onEvent);
        expect(decision).toBe('divergent-noclobber');
        expect(readFileSync(src)).toEqual(beforeSrc);
        expect(readFileSync(dst)).toEqual(beforeDst);
        expect(onEvent).toHaveBeenCalledTimes(1);
    });

    it('AC8: tied richness on different content — clobbers nothing and emits a user-visible event', () => {
        // identical tuple (same compactCount/latestTs/validRecords) but different bytes
        const src = write(from, [normalRec(SESSION, '2026-07-13T10:00:00.000Z'), compactRec(SESSION, '2026-07-13T13:00:00.000Z')]);
        const dst = write(to, [normalRec(SESSION, '2026-07-13T11:11:11.111Z'), compactRec(SESSION, '2026-07-13T13:00:00.000Z')]);
        const beforeSrc = readFileSync(src);
        const beforeDst = readFileSync(dst);
        const onEvent = vi.fn();
        const decision = migrateClaudeSessionFile(from, to, CWD, SESSION, onEvent);
        expect(decision).toBe('tied-noclobber');
        expect(readFileSync(src)).toEqual(beforeSrc);
        expect(readFileSync(dst)).toEqual(beforeDst);
        expect(onEvent).toHaveBeenCalledTimes(1);
    });

    it('a byte-identical destination is a silent no-op (no event)', () => {
        const records = [normalRec(SESSION, '2026-07-13T10:00:00.000Z'), compactRec(SESSION, '2026-07-13T13:00:00.000Z')];
        write(from, records);
        write(to, records);
        const onEvent = vi.fn();
        const decision = migrateClaudeSessionFile(from, to, CWD, SESSION, onEvent);
        expect(decision).toBe('identical-noop');
        expect(onEvent).not.toHaveBeenCalled();
    });
});
