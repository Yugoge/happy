// Claude account (CLAUDE_CONFIG_DIR) options for per-session account switching.
// One Happy daemon drives several paid Claude accounts by pointing the spawned
// `claude` child at a different account's config dir per session/message. This
// splits each account's 5-hour quota window instead of burning one account.
//
// configDir is the absolute .../<account>/claude subdir (never the parent);
// only `label` is ever shown in the UI (paths stay out of the surface).
export type ClaudeAccountKey = 'yugoge' | 'yugetang' | 'orchestrade';

export interface ClaudeAccountOption {
    key: ClaudeAccountKey;
    label: string;
    configDir: string;
}

export const CLAUDE_ACCOUNTS: ClaudeAccountOption[] = [
    { key: 'yugoge', label: 'yugoge', configDir: '/var/lib/claude-accounts/yugoge/claude' },
    { key: 'yugetang', label: 'yugetang', configDir: '/var/lib/claude-accounts/yugetang/claude' },
    { key: 'orchestrade', label: 'orchestrade', configDir: '/var/lib/claude-accounts/orchestrade/claude' },
];

export const DEFAULT_CLAUDE_ACCOUNT_KEY: ClaudeAccountKey = 'yugoge';

/** Resolve an account option by key, falling back to the first account. */
export function getClaudeAccount(key: string | null | undefined): ClaudeAccountOption {
    return CLAUDE_ACCOUNTS.find(a => a.key === key) ?? CLAUDE_ACCOUNTS[0];
}

/** Config dir for a session's stored account key, or null when none is selected. */
export function resolveClaudeConfigDir(key: string | null | undefined): string | null {
    if (!key) return null;
    return CLAUDE_ACCOUNTS.find(a => a.key === key)?.configDir ?? null;
}

/**
 * Reverse of resolveClaudeConfigDir: map a CLI-reported CLAUDE_CONFIG_DIR back to
 * its tracked account key, or null when it matches no tracked account (e.g. the
 * daemon default /root/.claude). Never fabricate a key for an untracked dir.
 */
export function getClaudeAccountKeyByConfigDir(configDir: string | null | undefined): ClaudeAccountKey | null {
    if (!configDir) return null;
    return CLAUDE_ACCOUNTS.find(a => a.configDir === configDir)?.key ?? null;
}

/**
 * Validate a raw stored account key (e.g. from the MMKV last-claude-account value):
 * return it only when it maps to a known account, else fall back to the default.
 * Guards against a stale/garbage persisted key being used verbatim.
 */
export function normalizeClaudeAccountKey(key: string | null | undefined): ClaudeAccountKey {
    return CLAUDE_ACCOUNTS.some(a => a.key === key) ? (key as ClaudeAccountKey) : DEFAULT_CLAUDE_ACCOUNT_KEY;
}

/** The account key that follows `key` in the cycle order (wraps around). */
export function nextClaudeAccountKey(key: string | null | undefined): ClaudeAccountKey {
    const idx = CLAUDE_ACCOUNTS.findIndex(a => a.key === key);
    return CLAUDE_ACCOUNTS[(idx + 1) % CLAUDE_ACCOUNTS.length].key;
}
