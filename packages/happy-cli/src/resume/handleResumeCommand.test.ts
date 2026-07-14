import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canonicalizeClaudeConfigDir } from '@/claude/utils/claudeConfigDir';

import { buildResumeLaunch, formatResumeHelp, parseResumeCommandArgs } from './handleResumeCommand';

// Account-home restore is gated on a real signal; clear the ambient env so the
// existing single-account expectations stay deterministic (no env patch injected).
let savedConfigDir: string | undefined;
let savedAccountsRoot: string | undefined;
beforeEach(() => {
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
    savedAccountsRoot = process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT;
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT;
});
afterEach(() => {
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
    if (savedAccountsRoot === undefined) delete process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT; else process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT = savedAccountsRoot;
});

describe('parseResumeCommandArgs', () => {
    it('parses the happy session id', () => {
        expect(parseResumeCommandArgs(['cmmij8olq00dp5jcxr3wtbpau'])).toEqual({
            showHelp: false,
            sessionId: 'cmmij8olq00dp5jcxr3wtbpau',
        });
    });

    it('recognizes help flags', () => {
        expect(parseResumeCommandArgs(['--help'])).toEqual({
            showHelp: true,
            sessionId: '',
        });
    });

    it('rejects missing session ids', () => {
        expect(() => parseResumeCommandArgs([])).toThrow(
            'Happy session ID is required: happy resume <session-id>',
        );
    });
});

describe('buildResumeLaunch', () => {
    it('builds a Codex resume command', () => {
        expect(buildResumeLaunch({
            id: 'session-1',
            active: false,
            metadata: {
                path: '/tmp/p1-control-flow',
                flavor: 'codex',
                codexThreadId: '019ccca5-726b-7c61-b914-16de27dfab6e',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        })).toEqual({
            cwd: '/tmp/p1-control-flow',
            args: ['codex', '--resume', '019ccca5-726b-7c61-b914-16de27dfab6e'],
        });
    });

    it('builds a Claude resume command', () => {
        expect(buildResumeLaunch({
            id: 'session-2',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'claude',
                claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        })).toEqual({
            cwd: '/tmp/repo',
            args: ['claude', '--resume', '93a9705e-bc6a-406d-8dce-8acc014dedbd'],
        });
    });

    it('rejects unsupported flavors', () => {
        expect(() => buildResumeLaunch({
            id: 'session-3',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'gemini',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        })).toThrow('Happy session session-3 uses unsupported flavor "gemini".');
    });
});

describe('buildResumeLaunch account-home restore (M1 / AC1 / AC13)', () => {
    it('AC1: claude flavor returns a canonical CLAUDE_CONFIG_DIR env patch from the persisted binding', () => {
        const launch = buildResumeLaunch({
            id: 'session-a',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'claude',
                claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
                currentClaudeConfigDir: '/root/.happy-dev-a/.claude/',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        });
        expect(launch.env?.CLAUDE_CONFIG_DIR).toBe(canonicalizeClaudeConfigDir('/root/.happy-dev-a/.claude/'));
        expect(launch.args).toEqual(['claude', '--resume', '93a9705e-bc6a-406d-8dce-8acc014dedbd']);
    });

    it('AC1: codex flavor returns no env patch', () => {
        const launch = buildResumeLaunch({
            id: 'session-c',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'codex',
                codexThreadId: '019ccca5-726b-7c61-b914-16de27dfab6e',
                currentClaudeConfigDir: '/root/.happy-dev-a/.claude/',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        });
        expect(launch.env).toBeUndefined();
    });

    it('AC13: single-account claude session (no binding, CLAUDE_CONFIG_DIR unset) injects no env patch', () => {
        const launch = buildResumeLaunch({
            id: 'session-b',
            active: false,
            metadata: {
                path: '/tmp/repo',
                flavor: 'claude',
                claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
                host: 'localhost',
                homeDir: '/tmp',
                happyHomeDir: '/tmp/.happy',
                happyLibDir: '/tmp/happy',
                happyToolsDir: '/tmp/happy/tools',
            },
        });
        expect(launch.env).toBeUndefined();
    });

    it('AC3-unit: with the post-compact transcript under home A and a stale copy under the env home, the env patch resolves to home A', () => {
        const root = mkdtempSync(join(tmpdir(), 'resume-ac3-'));
        try {
            const cwd = '/tmp/repo';
            const sessionId = '93a9705e-bc6a-406d-8dce-8acc014dedbd';
            const projectId = resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-');
            const homeA = canonicalizeClaudeConfigDir(join(root, 'acctA', 'claude'))!;
            const staleHome = canonicalizeClaudeConfigDir(join(root, 'default', 'claude'))!;
            const write = (home: string, records: object[]) => {
                mkdirSync(join(home, 'projects', projectId), { recursive: true });
                writeFileSync(join(home, 'projects', projectId, `${sessionId}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
            };
            write(homeA, [
                { type: 'assistant', uuid: 'a1', timestamp: '2026-07-13T10:00:00.000Z', sessionId },
                { type: 'user', isCompactSummary: true, uuid: 'c1', timestamp: '2026-07-13T13:00:00.000Z', sessionId },
            ]);
            write(staleHome, [{ type: 'assistant', uuid: 'a0', timestamp: '2026-07-13T09:00:00.000Z', sessionId }]);
            process.env.CLAUDE_CONFIG_DIR = staleHome; // daemon default env
            const launch = buildResumeLaunch({
                id: 'session-ac3',
                active: false,
                metadata: {
                    path: cwd,
                    flavor: 'claude',
                    claudeSessionId: sessionId,
                    currentClaudeConfigDir: homeA,
                    host: 'localhost',
                    homeDir: '/tmp',
                    happyHomeDir: '/tmp/.happy',
                    happyLibDir: '/tmp/happy',
                    happyToolsDir: '/tmp/happy/tools',
                },
            });
            expect(launch.env?.CLAUDE_CONFIG_DIR).toBe(homeA);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('buildResumeLaunch no-regression with HAPPY_CLAUDE_ACCOUNTS_ROOT set (codex#2)', () => {
    let root: string;
    let savedHome: string | undefined;
    const cwd = '/tmp/repo';
    const sessionId = '93a9705e-bc6a-406d-8dce-8acc014dedbd';
    const projectId = resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-');
    const write = (home: string, records: object[]) => {
        mkdirSync(join(home, 'projects', projectId), { recursive: true });
        writeFileSync(join(home, 'projects', projectId, `${sessionId}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    };
    const claudeSession = () => ({
        id: 'session-root', active: false,
        metadata: { path: cwd, flavor: 'claude', claudeSessionId: sessionId, host: 'localhost', homeDir: '/tmp', happyHomeDir: '/tmp/.happy', happyLibDir: '/tmp/happy', happyToolsDir: '/tmp/happy/tools' } as const,
    });

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'resume-root-'));
        savedHome = process.env.HOME;
        process.env.HOME = join(root, 'home'); // default home = <root>/home/.claude
        mkdirSync(process.env.HOME, { recursive: true });
        process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT = join(root, 'accounts');
        mkdirSync(join(root, 'accounts'), { recursive: true });
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
        if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
    });

    it('single-account session whose only transcript is under the default home injects NO env patch even with accounts-root set', () => {
        write(join(process.env.HOME!, '.claude'), [{ type: 'assistant', uuid: 'a1', timestamp: '2026-07-13T10:00:00.000Z', sessionId }]);
        expect(buildResumeLaunch(claudeSession()).env).toBeUndefined();
    });

    it('still injects the env patch for a NON-default account home discovered via the accounts-root override', () => {
        // richer same-lineage transcript under a non-default account home
        const acctHome = join(root, 'accounts', 'acctA', 'claude');
        write(acctHome, [{ type: 'assistant', uuid: 'a1', timestamp: '2026-07-13T10:00:00.000Z', sessionId }, { type: 'user', isCompactSummary: true, uuid: 'c1', timestamp: '2026-07-13T13:00:00.000Z', sessionId }]);
        write(join(process.env.HOME!, '.claude'), [{ type: 'assistant', uuid: 'a0', timestamp: '2026-07-13T09:00:00.000Z', sessionId }]);
        expect(buildResumeLaunch(claudeSession()).env?.CLAUDE_CONFIG_DIR).toBe(canonicalizeClaudeConfigDir(acctHome));
    });
});

describe('resume spawn sites merge launch.env (M1 / AC2 static)', () => {
    // AC2 hook_check: static_grep for the env-spread pattern at both spawn sites so
    // the recovery child inherits the persisted account home, not the daemon default.
    const pattern = /\.\.\.process\.env, *\.\.\.launch\.env|\.\.\.launch\.env/;
    it('daemon resumeSession (run.ts) spawns with { ...process.env, ...launch.env }', () => {
        expect(readFileSync(resolve('src/daemon/run.ts'), 'utf-8')).toMatch(pattern);
    });
    it('spawnResumeChild (handleResumeCommand.ts) spawns with { ...process.env, ...launch.env }', () => {
        expect(readFileSync(resolve('src/resume/handleResumeCommand.ts'), 'utf-8')).toMatch(pattern);
    });
});

describe('formatResumeHelp', () => {
    it('mentions the session id command shape', () => {
        expect(formatResumeHelp()).toContain('happy resume <happy-session-id>');
    });
});
