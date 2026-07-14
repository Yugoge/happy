/**
 * Shared Claude account-home (CLAUDE_CONFIG_DIR) infrastructure.
 *
 * Root cause (commit 1375854a, 2026-07-04): per-session account switching added
 * `metadata.currentClaudeConfigDir` but only WROTE it; daemon recovery never
 * restored it, so the resumed child ran under the daemon default home and found
 * the stale pre-compact copy instead of the post-compact full history. This
 * module supplies the pieces the recovery path was missing:
 *
 *  - canonicalizeClaudeConfigDir(): one canonical form (expand ~, absolute, no
 *    trailing separator) reused at every ingest/emit/restore/compare + getProjectPath.
 *  - scoreTranscript() / compareTranscriptScore(): a content-derived richness
 *    tuple (compactCount, latestTs, validRecords) + lineage check — NEVER filesystem modification time.
 *  - seedClaudeConfigDirFromEnv() / deriveResumeSeed(): pure helpers for the
 *    runClaude startup seed (M2) and the crash-before-first-query metadata seed (M5b).
 *  - discoverClaudeConfigDirForSession(): bounded backward-compat discovery /
 *    self-heal for legacy/bindingless or dominated bindings (M6/M6.2).
 *
 * Every function is a strict no-op when the account-home value is empty/undefined,
 * so single-account/default sessions are byte-behaviour unchanged.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { logger } from '@/ui/logger';

/**
 * Canonicalize a CLAUDE_CONFIG_DIR value to a single stable form: expand a
 * leading `~`, resolve to an absolute path (collapsing `//`, `.`, `..`) and
 * strip the trailing separator. Idempotent and total. Returns undefined for
 * empty/undefined/whitespace input so the default-home fallback stays untouched.
 */
export function canonicalizeClaudeConfigDir(value: string | null | undefined): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    const trimmed = value.trim();
    if (trimmed === '') {
        return undefined;
    }
    let expanded = trimmed;
    if (expanded === '~') {
        expanded = homedir();
    } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
        expanded = join(homedir(), expanded.slice(2));
    }
    // resolve() makes the path absolute, collapses redundant separators and
    // strips the trailing separator; it is idempotent for already-canonical paths.
    return resolve(expanded);
}

/**
 * The exact projectId encoding used by getProjectPath (path.ts). Duplicated here
 * (rather than imported) to keep claudeConfigDir.ts a leaf of path.ts and avoid
 * an import cycle (path.ts imports canonicalizeClaudeConfigDir from this module).
 */
function projectIdForCwd(cwd: string): string {
    return resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Absolute transcript path for (home, cwd, claudeSessionId). */
export function transcriptPathFor(home: string, cwd: string, claudeSessionId: string): string {
    return join(home, 'projects', projectIdForCwd(cwd), `${claudeSessionId}.jsonl`);
}

/**
 * Content-derived richness of a transcript file. All signals are read from the
 * file's own JSON records — never from filesystem modification/creation time (a
 * migration copy does not preserve the source's file timestamps, so they are
 * meaningless for richness).
 */
export type TranscriptScore = {
    /** Records whose top-level isCompactSummary === true, across ALL record types. */
    compactCount: number;
    /** Max top-level ISO-8601 timestamp seen (lexicographic max for Z-suffixed strings); '' if none. */
    latestTs: string;
    /** Count of parseable JSON lines. */
    validRecords: number;
    /** True iff any record's top-level sessionId equals the target claudeSessionId. */
    lineage: boolean;
    /** Whether the file exists on disk. */
    exists: boolean;
};

export type TranscriptTuple = Pick<TranscriptScore, 'compactCount' | 'latestTs' | 'validRecords'>;

/**
 * Score a transcript file in a single pass, keeping only counts (no parse tree).
 * Missing/unreadable files score as empty + exists:false.
 */
export function scoreTranscript(filePath: string, claudeSessionId: string): TranscriptScore {
    const empty: TranscriptScore = { compactCount: 0, latestTs: '', validRecords: 0, lineage: false, exists: false };
    if (!existsSync(filePath)) {
        return empty;
    }
    let raw: string;
    try {
        raw = readFileSync(filePath, 'utf-8');
    } catch {
        return empty;
    }
    let compactCount = 0;
    let latestTs = '';
    let validRecords = 0;
    let lineage = false;
    for (const line of raw.split('\n')) {
        if (!line.trim()) {
            continue;
        }
        let parsed: any;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        validRecords++;
        if (parsed && parsed.isCompactSummary === true) {
            compactCount++;
        }
        if (parsed && typeof parsed.timestamp === 'string' && parsed.timestamp > latestTs) {
            latestTs = parsed.timestamp;
        }
        if (parsed && parsed.sessionId === claudeSessionId) {
            lineage = true;
        }
    }
    return { compactCount, latestTs, validRecords, lineage, exists: true };
}

/**
 * Total order over content-richness tuples (M6.2 steps 1-3):
 * higher compactCount > newer latestTs > higher validRecords. Returns >0 if a is
 * richer, <0 if b is richer, 0 on an exact triple-tie. Never consults file timestamps.
 */
export function compareTranscriptScore(a: TranscriptScore, b: TranscriptScore): number {
    if (a.compactCount !== b.compactCount) {
        return a.compactCount - b.compactCount;
    }
    if (a.latestTs !== b.latestTs) {
        return a.latestTs < b.latestTs ? -1 : 1;
    }
    if (a.validRecords !== b.validRecords) {
        return a.validRecords - b.validRecords;
    }
    return 0;
}

type ScoredHome = { home: string; score: TranscriptScore };

/**
 * Pick the richest same-lineage home under the M6.2 total order. On an exact
 * triple-tie the winner is the persisted home if it is in the tied set, else the
 * lexicographically smallest canonical home path (deterministic + stable).
 */
function pickRicherHome(candidates: ScoredHome[], persistedCanon: string | undefined): { winner: ScoredHome; tieBreak: boolean } {
    let best = candidates[0];
    for (const candidate of candidates.slice(1)) {
        if (compareTranscriptScore(candidate.score, best.score) > 0) {
            best = candidate;
        }
    }
    const tied = candidates.filter((candidate) => compareTranscriptScore(candidate.score, best.score) === 0);
    if (tied.length === 1) {
        return { winner: best, tieBreak: false };
    }
    const persistedInTied = persistedCanon ? tied.find((candidate) => candidate.home === persistedCanon) : undefined;
    const winner = persistedInTied
        ?? tied.slice().sort((x, y) => (x.home < y.home ? -1 : 1))[0];
    return { winner, tieBreak: true };
}

/**
 * Pure helper for the runClaude startup seed (M2 / AC4). Given a process env,
 * return the canonical account home to seed BOTH the sticky currentClaudeConfigDir
 * and the claudeEnvVars overlay. Unset CLAUDE_CONFIG_DIR yields undefined for both.
 */
export function seedClaudeConfigDirFromEnv(env: { CLAUDE_CONFIG_DIR?: string }): { sticky: string | undefined; overlay: string | undefined } {
    const canonical = canonicalizeClaudeConfigDir(env.CLAUDE_CONFIG_DIR);
    return { sticky: canonical, overlay: canonical };
}

/**
 * Pure helper for the crash-before-first-query metadata seed (M5b / AC11). On the
 * LIVE --resume path, derive the {claudeSessionId, currentClaudeConfigDir} binding
 * from the claude args + env so the new happy session records it before the first
 * query. Returns {} when there is no --resume <uuid> in the args.
 */
export function deriveResumeSeed(
    claudeArgs: string[] | undefined,
    env: { CLAUDE_CONFIG_DIR?: string },
): { claudeSessionId?: string; currentClaudeConfigDir?: string } {
    if (!claudeArgs) {
        return {};
    }
    let claudeSessionId: string | undefined;
    for (let i = 0; i < claudeArgs.length; i++) {
        if (claudeArgs[i] === '--resume' && i + 1 < claudeArgs.length) {
            const next = claudeArgs[i + 1];
            if (!next.startsWith('-') && next.includes('-')) {
                claudeSessionId = next;
                break;
            }
        }
    }
    if (!claudeSessionId) {
        return {};
    }
    const seed: { claudeSessionId?: string; currentClaudeConfigDir?: string } = { claudeSessionId };
    const canonical = canonicalizeClaudeConfigDir(env.CLAUDE_CONFIG_DIR);
    if (canonical) {
        seed.currentClaudeConfigDir = canonical;
    }
    return seed;
}

export type DiscoverySource = 'persisted' | 'discovered' | 'dominated' | 'default-fallback';

export type DiscoveryResult = {
    /** Winning canonical account home, or null when nothing beats the default fallback. */
    home: string | null;
    source: DiscoverySource;
    tuple: TranscriptTuple | null;
    tieBreak: boolean;
    divergent: boolean;
};

export type DiscoveryInputs = {
    /** metadata.currentClaudeConfigDir (raw, un-canonicalized). */
    persisted?: string | null;
    /** process.env.CLAUDE_CONFIG_DIR (raw). */
    env?: string | null;
    /** process.env.HAPPY_CLAUDE_ACCOUNTS_ROOT (raw) — optional accounts-root override. */
    accountsRootEnv?: string | null;
    /** Surface a user-visible session event on divergent lineages (never clobbers). */
    onDivergentEvent?: (message: string) => void;
    /** Audit sink; defaults to logger.debug. Exactly one line per decision. */
    onAudit?: (line: string) => void;
};

/**
 * Build the bounded candidate-home set from real recovery-time inputs only:
 *   1. daemon default join(homedir(), '.claude') — always a candidate;
 *   2. process.env.CLAUDE_CONFIG_DIR (if set);
 *   3. persisted metadata.currentClaudeConfigDir (if present);
 *   4. sibling scan — for each base whose basename === 'claude', one readdirSync
 *      of its grandparent adds each <entry>/claude sibling account home;
 *   5. optional accounts-root override — if accountsRootEnv is set, one
 *      readdirSync(root) adds each <entry>/claude home.
 * No recursive descent, no whole-filesystem walk.
 */
function buildCandidateHomes(inputs: DiscoveryInputs): string[] {
    const homes = new Set<string>();
    homes.add(canonicalizeClaudeConfigDir(join(homedir(), '.claude'))!);
    const envHome = canonicalizeClaudeConfigDir(inputs.env);
    if (envHome) {
        homes.add(envHome);
    }
    const persistedHome = canonicalizeClaudeConfigDir(inputs.persisted);
    if (persistedHome) {
        homes.add(persistedHome);
    }
    // (4) sibling scan of the shared accounts root reachable from any 'claude' base.
    for (const base of [...homes]) {
        if (basename(base) !== 'claude') {
            continue;
        }
        const grandparent = dirname(dirname(base));
        try {
            for (const entry of readdirSync(grandparent)) {
                const sibling = canonicalizeClaudeConfigDir(join(grandparent, entry, 'claude'));
                if (sibling) {
                    homes.add(sibling);
                }
            }
        } catch {
            // grandparent unreadable — skip, stay bounded.
        }
    }
    // (5) optional accounts-root override (the ONLY reach for a zero-pointer legacy session).
    const accountsRoot = inputs.accountsRootEnv?.trim();
    if (accountsRoot) {
        try {
            for (const entry of readdirSync(accountsRoot)) {
                const home = canonicalizeClaudeConfigDir(join(accountsRoot, entry, 'claude'));
                if (home) {
                    homes.add(home);
                }
            }
        } catch {
            // accounts root unreadable — skip.
        }
    }
    return [...homes];
}

/**
 * Bounded backward-compat discovery / self-heal (M6/M6.2). Resolves the account
 * home that actually holds the resumable post-compact transcript for
 * claudeSessionId, using content-richness scoring only (never file timestamps).
 *
 * Precedence:
 *  - A valid persisted binding wins UNLESS a same-lineage candidate strictly
 *    dominates it (self-heals a prior buggy/switch-back binding).
 *  - Divergent-lineage files (a `<uuid>.jsonl` whose content sessionId differs)
 *    are never ranked and never clobbered; on divergence a user-visible event is
 *    surfaced and the target-lineage winner is still chosen.
 *  - When nothing is found, returns home:null (→ default-home fallback, unchanged
 *    behaviour).
 */
export function discoverClaudeConfigDirForSession(
    claudeSessionId: string,
    cwd: string,
    inputs: DiscoveryInputs,
): DiscoveryResult {
    const audit = inputs.onAudit ?? ((line: string) => logger.debug(line));
    const persistedCanon = canonicalizeClaudeConfigDir(inputs.persisted);

    const candidateHomes = buildCandidateHomes(inputs);
    const scored: ScoredHome[] = candidateHomes
        .map((home) => ({ home, score: scoreTranscript(transcriptPathFor(home, cwd, claudeSessionId), claudeSessionId) }))
        .filter((candidate) => candidate.score.exists);
    const sameLineage = scored.filter((candidate) => candidate.score.lineage);
    const divergentHomes = scored.filter((candidate) => !candidate.score.lineage);

    let home: string | null;
    let source: DiscoverySource;
    let tuple: TranscriptTuple | null = null;
    let tieBreak = false;

    const richest = sameLineage.length > 0 ? pickRicherHome(sameLineage, persistedCanon) : null;
    if (richest) {
        tuple = { compactCount: richest.winner.score.compactCount, latestTs: richest.winner.score.latestTs, validRecords: richest.winner.score.validRecords };
        tieBreak = richest.tieBreak;
    }

    if (persistedCanon) {
        const persistedCandidate = sameLineage.find((candidate) => candidate.home === persistedCanon);
        const dominated = richest
            && richest.winner.home !== persistedCanon
            && (!persistedCandidate || compareTranscriptScore(richest.winner.score, persistedCandidate.score) > 0);
        if (dominated) {
            home = richest.winner.home;
            source = 'dominated';
        } else {
            home = persistedCanon;
            source = 'persisted';
            if (persistedCandidate) {
                tuple = { compactCount: persistedCandidate.score.compactCount, latestTs: persistedCandidate.score.latestTs, validRecords: persistedCandidate.score.validRecords };
            }
        }
    } else if (richest) {
        home = richest.winner.home;
        source = 'discovered';
    } else {
        home = null;
        source = 'default-fallback';
    }

    // Divergent lineages compete for the same `<uuid>.jsonl` name — never clobber,
    // surface a user-visible event, still pick the target-lineage winner above.
    const divergent = divergentHomes.length > 0 && (sameLineage.length > 0 || persistedCanon !== undefined);
    if (divergent && inputs.onDivergentEvent) {
        inputs.onDivergentEvent(
            `Claude transcript lineage divergence for session ${claudeSessionId}: `
            + `${divergentHomes.length} home(s) hold a differently-lineaged copy. Keeping all copies; resuming from ${home ?? 'default home'}.`,
        );
    }

    const tupleText = tuple
        ? `(compactCount=${tuple.compactCount},latestTs=${tuple.latestTs || 'none'},validRecords=${tuple.validRecords})`
        : '(none)';
    const markers = `${tieBreak ? ' tie_break' : ''}${divergent ? ' divergent' : ''}`;
    audit(`[claudeConfigDir] discovery decision: chosen_home=${home ?? 'default'} source=${source} tuple=${tupleText}${markers}`);

    return { home, source, tuple, tieBreak, divergent };
}
