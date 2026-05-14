/**
 * parseListResponse — pure dispatch helper for the recovery-script `/list`
 * consumer (task 20260513-211054 M8).
 *
 * The bash recovery script (`/root/bin/happy-session-recovery.sh`) queries each
 * daemon's HTTP control server `/list` endpoint and must decide, per row,
 * whether to capture a claude session UUID or skip the row for the codex
 * mapping path. This helper expresses the BRANCHING LOGIC in TypeScript so it
 * is unit-testable; the bash patch in
 * `docs/dev/recovery-script-patches-20260513-211054.md` mirrors the same
 * algorithm via `jq` filters.
 *
 * Algorithm (subagent-feasible via vitest per ticket AC6):
 *
 *   Branch A (response has NO `schemaVersion` field — pre-M4 production
 *   daemon emitting implicit-v1):
 *     - rows are implicit-claude
 *     - capture every row's `claudeSessionId` (if present)
 *     - NEVER capture codex tids (no codex tracking pre-M4)
 *     - F5 PRODUCTION-SAFETY: claude UUIDs MUST be preserved unchanged
 *
 *   Branch B (response has `schemaVersion === 2` — post-M4 dev daemon):
 *     - rows are flavor-discriminated
 *     - `flavor === 'codex'` rows  → capture `codexThreadId` into `codexTids`
 *     - all other rows             → capture `claudeSessionId` into `claudeUuids`
 *
 *   NOTE on Branch B codex capture: the M6 bash patch currently sources codex
 *   tids from `codex-mapping.json` (`scan_codex_via_mapping`) NOT from `/list`.
 *   The helper models a stronger "future" behavior in which `/list` itself is
 *   also a codex tid source (per codex round-2 finding #3). For today's wire
 *   this is dead-but-consistent — the bash patch's `/list` consumer only
 *   SKIPS flavor=codex rows from the claude path; it does not read
 *   codexThreadId. Tests assert helper behavior for both branches so a future
 *   bash patch can flip on `/list`-sourced codex capture without code churn.
 *
 * Any rows missing both `claudeSessionId` and `codexThreadId` are skipped
 * silently (a tidPending codex row has codexThreadId === undefined; it does
 * NOT pollute the claude side).
 *
 * The function is intentionally defensive: malformed input (non-object, missing
 * `children`, non-array `children`, non-object rows) returns the empty result
 * rather than throwing, matching the bash patch's silent fall-through behavior.
 */

export interface ParseListResult {
    /** Claude session UUIDs captured from this response. */
    claudeUuids: string[];
    /** Codex thread ids captured from this response (only populated in Branch B). */
    codexTids: string[];
    /** Which branch of the dispatch algorithm fired. */
    branch: 'A' | 'B';
}

interface NormalizedRow {
    claudeSessionId?: string;
    codexThreadId?: string;
    flavor?: string;
}

function normalizeRow(row: unknown): NormalizedRow | undefined {
    if (!row || typeof row !== 'object') return undefined;
    const r = row as Record<string, unknown>;
    return {
        claudeSessionId: typeof r.claudeSessionId === 'string' ? r.claudeSessionId : undefined,
        codexThreadId: typeof r.codexThreadId === 'string' ? r.codexThreadId : undefined,
        flavor: typeof r.flavor === 'string' ? r.flavor : undefined
    };
}

function captureBranchA(row: NormalizedRow, result: ParseListResult): void {
    // Branch A: implicit-claude. Capture claudeSessionId if present.
    // codex tids are NEVER captured in Branch A (pre-M4 daemons have no
    // codex tracking, so the field would not exist anyway).
    //
    // DEFENSIVE: also skip rows whose flavor=='codex'. Pre-M4 production
    // daemons emit no flavor field at all, so this gate is normally a no-op
    // in Branch A. But if a backport / mixed deployment leaks a flavor=codex
    // row into a v1-shaped response, we skip it from the claude capture path
    // to faithfully mirror the bash patch (which is per-row flavor-gated, not
    // schemaVersion-gated; see codex round-2 finding #2). This is defense in
    // depth — F5 is unaffected because pre-M4 daemons cannot emit `flavor`.
    if (row.flavor === 'codex') return;
    if (row.claudeSessionId) {
        result.claudeUuids.push(row.claudeSessionId);
    }
}

function captureBranchB(row: NormalizedRow, result: ParseListResult): void {
    // Branch B: flavor-discriminated.
    if (row.flavor === 'codex') {
        // Pending codex rows (codexThreadId undefined) intentionally
        // contribute neither claude nor codex captures.
        if (row.codexThreadId) {
            result.codexTids.push(row.codexThreadId);
        }
        return;
    }
    // flavor in {'claude', 'gemini', 'opencode', 'openclaw', 'acp', 'unknown'}
    // OR absent — treat as claude-capture path. This matches the bash patch
    // which skips ONLY codex-flavored rows from the claude path.
    if (row.claudeSessionId) {
        result.claudeUuids.push(row.claudeSessionId);
    }
}

/**
 * Parse a `/list` response and return the recovery-script's capture sets.
 *
 * @param response  Already-parsed JSON object returned by daemon HTTP `/list`.
 *                  Pass `unknown`; we defend against malformed shapes.
 */
export function parseListResponse(response: unknown): ParseListResult {
    const result: ParseListResult = { claudeUuids: [], codexTids: [], branch: 'A' };

    if (!response || typeof response !== 'object') return result;
    const obj = response as Record<string, unknown>;
    const children = obj.children;
    if (!Array.isArray(children)) return result;

    // Branch dispatch: presence of schemaVersion === 2 is the discriminator.
    // Any other shape (absent, !==2) is treated as Branch A (v1 fallback).
    // This mirrors the bash patch's `if [ "$schemaVersion" = "2" ]; then ...`
    // gate but tolerates older daemons emitting nothing.
    result.branch = obj.schemaVersion === 2 ? 'B' : 'A';
    const capture = result.branch === 'A' ? captureBranchA : captureBranchB;

    for (const raw of children) {
        const row = normalizeRow(raw);
        if (!row) continue;
        capture(row, result);
    }

    return result;
}
