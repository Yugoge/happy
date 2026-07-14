import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    canonicalizeClaudeConfigDir,
    compareTranscriptScore,
    deriveResumeSeed,
    discoverClaudeConfigDirForSession,
    resolveResumeConfigDir,
    scoreTranscript,
    seedClaudeConfigDirFromEnv,
    transcriptPathFor,
} from './claudeConfigDir';

function projectId(cwd: string): string {
    return resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-');
}

type Rec = Record<string, unknown>;

function compactRec(sessionId: string, ts: string): Rec {
    return { type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, uuid: `u-${ts}`, parentUuid: null, timestamp: ts, sessionId };
}
function normalRec(sessionId: string, ts: string): Rec {
    return { type: 'assistant', uuid: `a-${ts}`, parentUuid: null, timestamp: ts, sessionId };
}

/** Write a JSONL transcript for (home, cwd, sessionId) and return its absolute path. */
function writeTranscript(home: string, cwd: string, sessionId: string, records: Rec[]): string {
    const file = transcriptPathFor(home, cwd, sessionId);
    mkdirSync(join(home, 'projects', projectId(cwd)), { recursive: true });
    writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
}

describe('canonicalizeClaudeConfigDir (M3 / AC5)', () => {
    it('maps trailing-slash and double-slash variants to one identical canonical string', () => {
        const canonical = canonicalizeClaudeConfigDir('/root/.claude');
        expect(canonicalizeClaudeConfigDir('/root/.claude/')).toBe(canonical);
        expect(canonicalizeClaudeConfigDir('/root//.claude')).toBe(canonical);
        expect(canonical).toBe('/root/.claude');
    });

    it('expands a leading ~ against the home directory', () => {
        expect(canonicalizeClaudeConfigDir('~/.claude')).toBe(resolve(join(homedir(), '.claude')));
        expect(canonicalizeClaudeConfigDir('~')).toBe(resolve(homedir()));
    });

    it('is idempotent (f(f(x)) === f(x))', () => {
        const once = canonicalizeClaudeConfigDir('/a/b/../b/.claude/');
        expect(canonicalizeClaudeConfigDir(once!)).toBe(once);
    });

    it('is a strict no-op for undefined / null / empty / whitespace (default-home fallback preserved)', () => {
        expect(canonicalizeClaudeConfigDir(undefined)).toBeUndefined();
        expect(canonicalizeClaudeConfigDir(null)).toBeUndefined();
        expect(canonicalizeClaudeConfigDir('')).toBeUndefined();
        expect(canonicalizeClaudeConfigDir('   ')).toBeUndefined();
    });
});

describe('scoreTranscript (M4 / AC9) — content signals only, never mtime', () => {
    let root: string;
    const cwd = '/tmp/example-project';
    const sessionId = '869820bd-69f4-4282-ad31-6fad95da4656';

    beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cfgdir-score-')); });
    afterEach(() => { rmSync(root, { recursive: true, force: true }); });

    it('derives {compactCount, latestTs, validRecords, lineage} from record content', () => {
        const home = join(root, 'acctA', 'claude');
        const file = writeTranscript(home, cwd, sessionId, [
            normalRec(sessionId, '2026-07-13T10:00:00.000Z'),
            compactRec(sessionId, '2026-07-13T11:00:00.000Z'),
            normalRec(sessionId, '2026-07-13T12:00:00.000Z'),
            compactRec(sessionId, '2026-07-13T13:00:00.000Z'),
        ]);
        const score = scoreTranscript(file, sessionId);
        expect(score).toMatchObject({
            compactCount: 2,
            latestTs: '2026-07-13T13:00:00.000Z',
            validRecords: 4,
            lineage: true,
            exists: true,
        });
    });

    it('marks lineage false when no record carries the target sessionId', () => {
        const home = join(root, 'acctB', 'claude');
        const file = writeTranscript(home, cwd, sessionId, [normalRec('some-other-uuid', '2026-07-13T10:00:00.000Z')]);
        expect(scoreTranscript(file, sessionId).lineage).toBe(false);
    });

    it('counts only parseable lines as valid records', () => {
        const home = join(root, 'acctC', 'claude');
        const file = transcriptPathFor(home, cwd, sessionId);
        mkdirSync(join(home, 'projects', projectId(cwd)), { recursive: true });
        writeFileSync(file, [JSON.stringify(normalRec(sessionId, '2026-07-13T10:00:00.000Z')), 'not-json{', '', JSON.stringify(compactRec(sessionId, '2026-07-13T11:00:00.000Z'))].join('\n'));
        const score = scoreTranscript(file, sessionId);
        expect(score.validRecords).toBe(2);
        expect(score.compactCount).toBe(1);
    });

    it('returns exists:false for a missing file', () => {
        expect(scoreTranscript(join(root, 'nope', 'x.jsonl'), sessionId)).toMatchObject({ exists: false, compactCount: 0, validRecords: 0 });
    });
});

describe('compareTranscriptScore total order (M6.2)', () => {
    const base = { latestTs: '2026-07-13T10:00:00.000Z', lineage: true, exists: true };
    it('ranks by compactCount, then latestTs, then validRecords', () => {
        expect(compareTranscriptScore({ ...base, compactCount: 2, validRecords: 10 }, { ...base, compactCount: 1, validRecords: 99 })).toBeGreaterThan(0);
        expect(compareTranscriptScore({ ...base, compactCount: 1, validRecords: 10, latestTs: '2026-07-13T12:00:00.000Z' }, { ...base, compactCount: 1, validRecords: 10 })).toBeGreaterThan(0);
        expect(compareTranscriptScore({ ...base, compactCount: 1, validRecords: 20 }, { ...base, compactCount: 1, validRecords: 10 })).toBeGreaterThan(0);
        expect(compareTranscriptScore({ ...base, compactCount: 1, validRecords: 10 }, { ...base, compactCount: 1, validRecords: 10 })).toBe(0);
    });
});

describe('seedClaudeConfigDirFromEnv (M2 / AC4)', () => {
    it('seeds sticky + overlay from canonical env; unset is a no-op', () => {
        const seeded = seedClaudeConfigDirFromEnv({ CLAUDE_CONFIG_DIR: '/root/.happy-a/.claude/' });
        expect(seeded).toEqual({ sticky: '/root/.happy-a/.claude', overlay: '/root/.happy-a/.claude' });
        expect(seedClaudeConfigDirFromEnv({})).toEqual({ sticky: undefined, overlay: undefined });
    });
});

describe('deriveResumeSeed (M5b / AC11)', () => {
    it('derives {claudeSessionId, currentClaudeConfigDir} from --resume + canonical env', () => {
        expect(deriveResumeSeed(['claude', '--resume', '93a9705e-bc6a-406d-8dce-8acc014dedbd'], { CLAUDE_CONFIG_DIR: '/root/.happy-a/.claude/' }))
            .toEqual({ claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd', currentClaudeConfigDir: '/root/.happy-a/.claude' });
    });
    it('returns {} when no --resume arg is present', () => {
        expect(deriveResumeSeed(['claude', '--started-by', 'daemon'], { CLAUDE_CONFIG_DIR: '/root/.happy-a/.claude' })).toEqual({});
        expect(deriveResumeSeed(undefined, {})).toEqual({});
    });
    it('omits currentClaudeConfigDir when env is unset (still returns claudeSessionId)', () => {
        expect(deriveResumeSeed(['--resume', 'aaaa-bbbb-cccc'], {})).toEqual({ claudeSessionId: 'aaaa-bbbb-cccc' });
    });
});

describe('discoverClaudeConfigDirForSession (M6 / AC3-unit / AC12)', () => {
    let root: string;
    const cwd = '/tmp/discovery-project';
    const sessionId = '869820bd-69f4-4282-ad31-6fad95da4656';
    let savedEnv: string | undefined;
    let savedRoot: string | undefined;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'cfgdir-disc-'));
        savedEnv = process.env.CLAUDE_CONFIG_DIR;
        savedRoot = process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT;
        delete process.env.CLAUDE_CONFIG_DIR;
        delete process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT;
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
        if (savedEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedEnv;
        if (savedRoot === undefined) delete process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT; else process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT = savedRoot;
    });

    it('AC3-unit: post-compact same-lineage home wins over a stale same-UUID copy under another home', () => {
        const homeA = canonicalizeClaudeConfigDir(join(root, 'acctA', 'claude'))!;
        const staleHome = canonicalizeClaudeConfigDir(join(root, 'default', 'claude'))!;
        writeTranscript(homeA, cwd, sessionId, [
            normalRec(sessionId, '2026-07-13T10:00:00.000Z'),
            compactRec(sessionId, '2026-07-13T13:00:00.000Z'),
            normalRec(sessionId, '2026-07-13T14:00:00.000Z'),
        ]);
        writeTranscript(staleHome, cwd, sessionId, [normalRec(sessionId, '2026-07-13T09:00:00.000Z')]);
        const audit: string[] = [];
        const result = discoverClaudeConfigDirForSession(sessionId, cwd, { persisted: homeA, env: staleHome, onAudit: (l) => audit.push(l) });
        expect(result.home).toBe(homeA);
        expect(result.source).toBe('persisted');
        expect(audit).toHaveLength(1);
        expect(audit[0]).toContain(`chosen_home=${homeA}`);
    });

    it('AC12(a): no persisted binding — discovers the only same-lineage home via accounts-root override', () => {
        const homeA = canonicalizeClaudeConfigDir(join(root, 'acctA', 'claude'))!;
        writeTranscript(homeA, cwd, sessionId, [compactRec(sessionId, '2026-07-13T13:00:00.000Z')]);
        mkdirSync(join(root, 'acctEmpty', 'claude'), { recursive: true }); // sibling with no transcript
        const audit: string[] = [];
        const result = discoverClaudeConfigDirForSession(sessionId, cwd, { accountsRootEnv: root, onAudit: (l) => audit.push(l) });
        expect(result.home).toBe(homeA);
        expect(result.source).toBe('discovered');
    });

    it('AC12(b): a persisted binding strictly dominated by a same-lineage home self-heals to the richer home', () => {
        const homeA = canonicalizeClaudeConfigDir(join(root, 'acctA', 'claude'))!;
        const homeB = canonicalizeClaudeConfigDir(join(root, 'acctB', 'claude'))!;
        writeTranscript(homeA, cwd, sessionId, [normalRec(sessionId, '2026-07-13T10:00:00.000Z'), compactRec(sessionId, '2026-07-13T13:00:00.000Z')]);
        writeTranscript(homeB, cwd, sessionId, [normalRec(sessionId, '2026-07-13T09:00:00.000Z')]);
        const result = discoverClaudeConfigDirForSession(sessionId, cwd, { persisted: homeB, accountsRootEnv: root });
        expect(result.home).toBe(homeA);
        expect(result.source).toBe('dominated');
    });

    it('AC12(c): divergent lineages preserve both files, emit a user-visible event, and pick the target-lineage winner', () => {
        const homeA = canonicalizeClaudeConfigDir(join(root, 'acctA', 'claude'))!;
        const homeDiv = canonicalizeClaudeConfigDir(join(root, 'acctDiv', 'claude'))!;
        const fileA = writeTranscript(homeA, cwd, sessionId, [compactRec(sessionId, '2026-07-13T13:00:00.000Z')]);
        const fileDiv = writeTranscript(homeDiv, cwd, sessionId, [normalRec('different-lineage-uuid', '2026-07-13T20:00:00.000Z')]);
        const events: string[] = [];
        const result = discoverClaudeConfigDirForSession(sessionId, cwd, { accountsRootEnv: root, onDivergentEvent: (m) => events.push(m) });
        expect(result.home).toBe(homeA);
        expect(result.divergent).toBe(true);
        expect(events).toHaveLength(1);
        expect(existsSync(fileA)).toBe(true);
        expect(existsSync(fileDiv)).toBe(true); // never clobbered
    });

    it('AC12(d): an exact triple-tie resolves via total order — persisted-in-tied else lexicographically smallest', () => {
        const homeA = canonicalizeClaudeConfigDir(join(root, 'acctA', 'claude'))!;
        const homeZ = canonicalizeClaudeConfigDir(join(root, 'acctZ', 'claude'))!;
        const recs = [normalRec(sessionId, '2026-07-13T10:00:00.000Z'), compactRec(sessionId, '2026-07-13T13:00:00.000Z')];
        writeTranscript(homeA, cwd, sessionId, recs);
        writeTranscript(homeZ, cwd, sessionId, recs);
        // (d1) no persisted → lexicographically smallest (homeA < homeZ)
        const tiedAudit: string[] = [];
        const noPersist = discoverClaudeConfigDirForSession(sessionId, cwd, { accountsRootEnv: root, onAudit: (l) => tiedAudit.push(l) });
        expect(noPersist.home).toBe(homeA < homeZ ? homeA : homeZ);
        expect(noPersist.tieBreak).toBe(true);
        expect(tiedAudit[0]).toContain('tie_break');
        // (d2) persisted is in the tied set → persisted wins
        const withPersist = discoverClaudeConfigDirForSession(sessionId, cwd, { persisted: homeZ, accountsRootEnv: root });
        expect(withPersist.home).toBe(homeZ);
    });

    it('emits exactly one audit line per decision naming chosen_home, source, and tuple', () => {
        const homeA = canonicalizeClaudeConfigDir(join(root, 'acctA', 'claude'))!;
        writeTranscript(homeA, cwd, sessionId, [compactRec(sessionId, '2026-07-13T13:00:00.000Z')]);
        const audit: string[] = [];
        discoverClaudeConfigDirForSession(sessionId, cwd, { accountsRootEnv: root, onAudit: (l) => audit.push(l) });
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatch(/chosen_home=.*source=(persisted|discovered|dominated|default-fallback).*tuple=\(compactCount=/);
    });

    it('returns home:null (default-fallback) when there is no account-home signal or transcript', () => {
        const result = discoverClaudeConfigDirForSession(sessionId, cwd, {});
        expect(result.home).toBeNull();
        expect(result.source).toBe('default-fallback');
    });
});

describe('resolveResumeConfigDir (M6 mass-reboot wiring for runClaude / happy claude --resume)', () => {
    let root: string;
    const cwd = '/tmp/resume-massreboot-project';
    const sessionId = '869820bd-69f4-4282-ad31-6fad95da4656';

    beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'cfgdir-resume-')); });
    afterEach(() => { rmSync(root, { recursive: true, force: true }); });

    it('no-op (undefined) when there is no --resume <uuid> in the args — fresh / non-resume session', () => {
        expect(resolveResumeConfigDir([], cwd, undefined, {})).toBeUndefined();
        expect(resolveResumeConfigDir(['--model', 'opus'], cwd, undefined, {})).toBeUndefined();
        expect(resolveResumeConfigDir(undefined, cwd, undefined, {})).toBeUndefined();
    });

    it('mass-reboot: --resume launched under the stale/default home resolves to the richer same-lineage account home', () => {
        const homeA = canonicalizeClaudeConfigDir(join(root, 'acctA', 'claude'))!;
        const staleHome = canonicalizeClaudeConfigDir(join(root, 'default', 'claude'))!;
        writeTranscript(homeA, cwd, sessionId, [
            normalRec(sessionId, '2026-07-13T10:00:00.000Z'),
            compactRec(sessionId, '2026-07-13T13:00:00.000Z'),
        ]);
        writeTranscript(staleHome, cwd, sessionId, [normalRec(sessionId, '2026-07-13T09:00:00.000Z')]);
        const resolved = resolveResumeConfigDir(['--resume', sessionId], cwd, undefined, { CLAUDE_CONFIG_DIR: staleHome, HAPPY_CLAUDE_ACCOUNTS_ROOT: root });
        expect(resolved).toBe(homeA);
    });

    it('no-op (undefined) when the discovered winner already equals the current env home — single-account byte-identical', () => {
        const home = canonicalizeClaudeConfigDir(join(root, 'acctA', 'claude'))!;
        writeTranscript(home, cwd, sessionId, [compactRec(sessionId, '2026-07-13T13:00:00.000Z')]);
        const resolved = resolveResumeConfigDir(['--resume', sessionId], cwd, home, { CLAUDE_CONFIG_DIR: home, HAPPY_CLAUDE_ACCOUNTS_ROOT: root });
        expect(resolved).toBeUndefined();
    });

    it('no-op (undefined) when no transcript exists anywhere for the resumed session — default fallback', () => {
        const staleHome = canonicalizeClaudeConfigDir(join(root, 'default', 'claude'));
        const resolved = resolveResumeConfigDir(['--resume', sessionId], cwd, undefined, { CLAUDE_CONFIG_DIR: staleHome });
        expect(resolved).toBeUndefined();
    });

    it('codex-F2: a persisted binding with NO transcript on disk is a no-op, not a switch to the missing home', () => {
        const persistedButEmpty = canonicalizeClaudeConfigDir(join(root, 'acctStale', 'claude'))!;
        mkdirSync(join(root, 'acctStale', 'claude'), { recursive: true }); // home exists, no transcript for this session
        const envHome = canonicalizeClaudeConfigDir(join(root, 'default', 'claude'));
        const resolved = resolveResumeConfigDir(['--resume', sessionId], cwd, persistedButEmpty, { CLAUDE_CONFIG_DIR: envHome, HAPPY_CLAUDE_ACCOUNTS_ROOT: root });
        expect(resolved).toBeUndefined();
    });

    it('codex-F1: unset CLAUDE_CONFIG_DIR with the only transcript in the default ~/.claude home is a no-op', () => {
        const defaultHome = canonicalizeClaudeConfigDir(join(homedir(), '.claude'))!;
        const uniqueCwd = join(root, 'default-home-cwd'); // unique cwd → unique projectId under the real default home
        writeTranscript(defaultHome, uniqueCwd, sessionId, [compactRec(sessionId, '2026-07-13T13:00:00.000Z')]);
        try {
            const resolved = resolveResumeConfigDir(['--resume', sessionId], uniqueCwd, undefined, {}); // env unset
            expect(resolved).toBeUndefined();
        } finally {
            rmSync(join(defaultHome, 'projects', projectId(uniqueCwd)), { recursive: true, force: true });
        }
    });

    it('self-heals a stale persisted binding to the richer discovered home (mass-reboot after a prior buggy resume)', () => {
        const homeGood = canonicalizeClaudeConfigDir(join(root, 'acctGood', 'claude'))!;
        const homeStale = canonicalizeClaudeConfigDir(join(root, 'acctStale', 'claude'))!;
        writeTranscript(homeGood, cwd, sessionId, [normalRec(sessionId, '2026-07-13T10:00:00.000Z'), compactRec(sessionId, '2026-07-13T13:00:00.000Z')]);
        writeTranscript(homeStale, cwd, sessionId, [normalRec(sessionId, '2026-07-13T09:00:00.000Z')]);
        const resolved = resolveResumeConfigDir(['--resume', sessionId], cwd, homeStale, { CLAUDE_CONFIG_DIR: homeStale, HAPPY_CLAUDE_ACCOUNTS_ROOT: root });
        expect(resolved).toBe(homeGood);
    });

    it('forwards the divergent-lineage hook and stays a no-op when the target-lineage winner is already the env home', () => {
        const homeEnv = canonicalizeClaudeConfigDir(join(root, 'acctEnv', 'claude'))!;
        const homeDiv = canonicalizeClaudeConfigDir(join(root, 'acctDiv', 'claude'))!;
        writeTranscript(homeEnv, cwd, sessionId, [compactRec(sessionId, '2026-07-13T13:00:00.000Z')]);
        writeTranscript(homeDiv, cwd, sessionId, [normalRec('different-lineage-uuid', '2026-07-13T20:00:00.000Z')]);
        const events: string[] = [];
        const resolved = resolveResumeConfigDir(['--resume', sessionId], cwd, undefined, { CLAUDE_CONFIG_DIR: homeEnv, HAPPY_CLAUDE_ACCOUNTS_ROOT: root }, { onDivergentEvent: (m) => events.push(m) });
        expect(resolved).toBeUndefined();
        expect(events).toHaveLength(1);
    });
});

describe('claudeConfigDir source references no mtime (AC9 static_grep_absent)', () => {
    it('the module source never reads filesystem time', () => {
        const src = readFileSync(resolve('src/claude/utils/claudeConfigDir.ts'), 'utf-8');
        expect(src).not.toMatch(/mtime|mtimeMs|statSync|\.stat\(/);
    });
});
