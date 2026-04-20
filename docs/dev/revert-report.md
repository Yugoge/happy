# Revert Report

**Timestamp:** 2026-04-19
**Baseline commit:** `925f5960`
**Scope:** Two happy-cli source files + verify happy-app `_all.tsx` registration.

## Files touched

### 1. `packages/happy-cli/src/claude/claudeRemoteLauncher.ts`

- **Action:** Fully reverted to baseline `925f5960`.
- **Verification:** `diff <(git show 925f5960:...) ...` reports **IDENTICAL**.
- **Line count:** baseline 569 → before revert 347 → after revert **569** (matches baseline exactly).
- **Reverted changes (not re-applied):**
  - `sentSidechainUuids` dedup set
  - Scanner callback sidechain forwarding
  - Removal of `convertSidechainUserMessage` fake-Task sidechain root (the original function is restored)
  - Large function-extraction refactoring

### 2. `packages/happy-cli/src/claude/utils/sessionScanner.ts`

- **Action:** Reverted to baseline, then re-applied **only** subagent log scanning.
- **Line count:** baseline 224 → before revert 259 → after revert 224 → after re-apply **301**.
- **Reverted (not re-applied):**
  - `isJSONLOnlyMessage` helper
  - `isSidechain` forwarding in the `sendExisting=false` path
- **Re-applied (intentional):**
  - New import `readdir` from `node:fs/promises`
  - New helper `parseJSONLContent(content, sourceLabel)` factoring the
    baseline's inline line parser so it can be shared between main log and
    subagent logs (minimal extraction — required because `readSessionLog` now
    has two data sources).
  - New function `readSubagentLogs(projectDir, sessionId)` which lists
    `<projectDir>/<sessionId>/subagents/*.jsonl` (returns `[]` if the directory
    does not exist) and parses each file with the same schema as the main log.
  - `readSessionLog` now calls `readSubagentLogs` and, when any subagent
    messages exist, merges them with the main log sorted by `timestamp` (schema
    uses `passthrough()` so the field is preserved on the raw object).
  - Additional small helpers (`seedInitialMessages`, `collectActiveSessions`,
    `processAndDispatch`, `buildPublicInterface`, `handleNewSession`,
    `mergeByTimestamp`, `ensureWatchers`, `runSyncCycle`, etc.) were introduced
    **only** as required by the repo's quality-gate hook, which rejected larger
    functions / deep nesting when writing the file. Behaviour is preserved:
    identical log messages, identical sidechain/meta-forwarding semantics as
    baseline (isMeta is still forwarded when `sendExisting=false`, isSidechain
    forwarding remains OFF as baseline).
  - The `startFileWatcher` callback still calls `sync.invalidate()`
    (verified — this was the critical baseline behaviour).

### 3. `packages/happy-app/sources/components/tools/views/_all.tsx`

- **Action:** Verified and resolved a stash-pop merge conflict.
- **Final state vs baseline 925f5960:**
  - Added `import { TaskViewFull } from './TaskViewFull';`
  - `toolFullViewRegistry`: `Task: TaskViewFull`, `Agent: TaskViewFull`
  - Added `export { TaskViewFull } from './TaskViewFull';`
- This is "Fix A" — user approved. No other edits to this file.

## TypeScript verification

| Package | Command | Result |
|---------|---------|--------|
| `happy-cli` | `npx tsc --noEmit` | **0 errors** |
| `happy-app` | `yarn typecheck` | 10 errors — **all pre-existing at baseline 925f5960** (verified via stash-and-check). None of the 10 errors are in `_all.tsx`, `sessionScanner.ts`, or `claudeRemoteLauncher.ts`. |

Pre-existing errors (unchanged by this revert):
- `RightSidebar.tsx:75` — unknown translation key `sidebar.toolDetail`
- `SessionActionsNativeMenu.android.tsx:2` — missing exports from `@expo/ui/jetpack-compose`
- `SidebarNavigator.tsx:15` — unknown setting key `sidebarCollapsed`
- `sidebar/SidebarAgentConversation.tsx:80,88` — `text` on `Message` union
- `sidebar/SidebarFileView.tsx:239` — missing `background` on theme type
- `tools/views/TaskViewFull.tsx:11,49` — `useFilteredTools` not exported + unknown translation key
- `sync/sync.ts:2272` — `applySessionUsage` does not exist (user intended `applySessions`)

## Line-count summary

| File | Baseline | Before revert | After revert | After re-apply |
|------|----------|---------------|--------------|----------------|
| `claudeRemoteLauncher.ts` | 569 | 347 | 569 | 569 (no re-apply) |
| `sessionScanner.ts` | 224 | 259 | 224 | 301 |
| `_all.tsx` | 84 | 84 | n/a | 86 (import + export + 2 reg lines change) |

## Behavioural deltas after this revert

1. CLI no longer de-duplicates sidechain UUIDs, no longer forwards sidechain
   messages in the scanner callback, and `convertSidechainUserMessage` is back
   to emitting its original fake-Task sidechain root — identical to baseline.
2. CLI scanner now also reads `<projectDir>/<sessionId>/subagents/*.jsonl`
   when present, interleaving those events into the normal message stream by
   timestamp. This is the only net-new behaviour relative to baseline.
3. Web app still renders `Task` / `Agent` tools via `TaskViewFull` in the full
   view (Fix A preserved).

## Not done per instructions

- No rebuild, no deploy, no `npm install -g`, no `/usr/bin/happy` invocation.
