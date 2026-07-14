import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Metadata } from '@/api/types';
import { canonicalizeClaudeConfigDir, discoverClaudeConfigDirForSession } from '@/claude/utils/claudeConfigDir';
import { logger } from '@/ui/logger';
import { spawnHappyCLI } from '@/utils/spawnHappyCLI';

import { resolveHappySession, type ResumableHappySession } from './resolveHappySession';

export type ResumeLaunch = {
    cwd: string;
    args: string[];
    /**
     * Claude-flavor account-home restore (M1). When present, spawn callers MUST
     * merge it as `env: { ...process.env, ...launch.env }` so the recovery child's
     * CLAUDE_CONFIG_DIR is the persisted account home from process init — before
     * the early transcript reads. Absent for codex flavor and for single-account
     * sessions with no account-home signal (no-op).
     */
    env?: Record<string, string>;
};

export type ResumeLaunchOptions = {
    claudeStartingMode?: 'local' | 'remote';
    startedBy?: 'daemon' | 'terminal';
};

export function parseResumeCommandArgs(args: string[]): { showHelp: boolean; sessionId: string } {
    if (args.includes('-h') || args.includes('--help')) {
        return {
            showHelp: true,
            sessionId: '',
        };
    }

    if (args.length === 0) {
        throw new Error('Happy session ID is required: happy resume <session-id>');
    }
    if (args.length > 1) {
        throw new Error(`Unexpected arguments for happy resume: ${args.slice(1).join(' ')}`);
    }

    return {
        showHelp: false,
        sessionId: args[0],
    };
}

function resolveFlavor(metadata: Metadata): 'codex' | 'claude' | null {
    if (metadata.flavor === 'codex' || metadata.codexThreadId) {
        return 'codex';
    }
    if (metadata.flavor === 'claude' || metadata.claudeSessionId) {
        return 'claude';
    }
    return null;
}

export function buildResumeLaunch(session: ResumableHappySession, options: ResumeLaunchOptions = {}): ResumeLaunch {
    const { metadata } = session;
    const flavor = resolveFlavor(metadata);

    if (flavor === 'codex') {
        if (!metadata.codexThreadId) {
            throw new Error(`Happy session ${session.id} is missing its Codex thread ID.`);
        }
        const args = ['codex', '--resume', metadata.codexThreadId];
        if (options.startedBy) {
            args.push('--started-by', options.startedBy);
        }
        return {
            cwd: metadata.path,
            args,
        };
    }

    if (flavor === 'claude') {
        if (!metadata.claudeSessionId) {
            throw new Error(`Happy session ${session.id} is missing its Claude session ID.`);
        }
        const args = ['claude'];
        if (options.claudeStartingMode) {
            args.push('--happy-starting-mode', options.claudeStartingMode);
        }
        if (options.startedBy) {
            args.push('--started-by', options.startedBy);
        }
        args.push('--resume', metadata.claudeSessionId);
        const launch: ResumeLaunch = {
            cwd: metadata.path,
            args,
        };
        const restoredHome = resolveClaudeAccountHome(metadata);
        if (restoredHome) {
            launch.env = { CLAUDE_CONFIG_DIR: restoredHome };
        }
        return launch;
    }

    throw new Error(`Happy session ${session.id} uses unsupported flavor "${metadata.flavor ?? 'unknown'}".`);
}

/**
 * Resolve the Claude account home to restore on resume (M1 + M6). Returns the
 * canonical account home to bake into the child's CLAUDE_CONFIG_DIR, or undefined
 * for single-account/default sessions (no account-home signal → strict no-op).
 *
 * The persisted metadata.currentClaudeConfigDir is the common-case restore; a
 * bounded content-richness discovery self-heals a bindingless/dominated case
 * BEFORE the two early transcript reads (it runs here so the winning home is in
 * the child's process.env from process init).
 */
function resolveClaudeAccountHome(metadata: Metadata): string | undefined {
    const persisted = metadata.currentClaudeConfigDir;
    const envHome = process.env.CLAUDE_CONFIG_DIR;
    const accountsRootEnv = process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT;
    // Gate: only attempt account-home restoration when there is a real signal;
    // otherwise single-account/default sessions inject no env patch (AC13).
    const hasSignal = Boolean(
        canonicalizeClaudeConfigDir(persisted)
        || canonicalizeClaudeConfigDir(envHome)
        || (accountsRootEnv && accountsRootEnv.trim()),
    );
    if (!hasSignal || !metadata.claudeSessionId) {
        return undefined;
    }
    const result = discoverClaudeConfigDirForSession(metadata.claudeSessionId, metadata.path, {
        persisted,
        env: envHome,
        accountsRootEnv,
        onDivergentEvent: (message) => logger.debug(`[resume] ${message}`),
    });
    if (!result.home) {
        return undefined;
    }
    // No-regression guard (codex#2): when the resolved home is merely the daemon
    // default ~/.claude AND no explicit account signal named it (only an
    // accounts-root override was present, e.g. ops hardening on a single-account
    // session), inject NO env patch — the child resolves to the default home
    // anyway, so CLAUDE_CONFIG_DIR must stay unset (AC13). Non-default account
    // homes discovered via the accounts-root override still get injected.
    const canonicalDefaultHome = canonicalizeClaudeConfigDir(join(homedir(), '.claude'));
    if (result.home === canonicalDefaultHome
        && !canonicalizeClaudeConfigDir(persisted)
        && !canonicalizeClaudeConfigDir(envHome)) {
        return undefined;
    }
    return result.home;
}

export function formatResumeHelp(): string {
    return [
        'happy resume - Resume a previous Happy session',
        '',
        'Usage:',
        '  happy resume <happy-session-id>',
        '',
        'Examples:',
        '  happy resume cmmij8olq00dp5jcxr3wtbpau',
        '  happy resume cmmij8',
        '',
        'This reuses the saved worktree/path and resumes the underlying agent session',
        'when the backend supports it.',
    ].join('\n');
}

function spawnResumeChild(launch: ResumeLaunch): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const child = spawnHappyCLI(launch.args, {
            cwd: launch.cwd,
            env: { ...process.env, ...launch.env },
            stdio: 'inherit',
        });

        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Resumed session exited via signal ${signal}`));
                return;
            }
            resolve(code);
        });
    });
}

export async function handleResumeCommand(args: string[]): Promise<void> {
    const parsed = parseResumeCommandArgs(args);
    if (parsed.showHelp) {
        console.log(formatResumeHelp());
        return;
    }

    const session = await resolveHappySession(parsed.sessionId);
    const launch = buildResumeLaunch(session);

    if (!existsSync(launch.cwd)) {
        throw new Error(`Saved session path does not exist: ${launch.cwd}`);
    }

    const exitCode = await spawnResumeChild(launch);
    if (typeof exitCode === 'number' && exitCode !== 0) {
        process.exit(exitCode);
    }
}
