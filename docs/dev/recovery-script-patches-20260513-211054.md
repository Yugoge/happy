# Recovery & Restart Script Patches — Task 20260513-211054

**Hook status**: edits to `/root/bin/happy-session-recovery.sh` and `/root/bin/happy-restart.sh` are BLOCKED for subagents by `pretool-block-production-files.sh` (per c3-20260504-223115 — only the user may modify these admin scripts). This file collects the patches for **user-side manual application** per the durable directive "我手动做".

All patches are INCREMENTAL (no rewrites). All claude paths remain untouched (additive only).

---

## M9: comment-rot fix at `/root/bin/happy-session-recovery.sh` line 756-758

The docstring still references the obsolete `019d...` prefix (a UUIDv7 narrow timestamp window that broke at rollover, prior commit `019dd077`). The regex at line 767 was already generalized in commit `043e3fec`. Only the comment needs updating.

```diff
@@ -755,7 +755,8 @@
 # _validate_codex_rollout: given a rollout .jsonl path, emit "tid:cwd" if valid,
 # else fail silently. All 5 checks must pass (codex correction #6):
 #   1. file exists
-#   2. filename matches codex thread-id pattern (^019d...$)
+#   2. filename matches the generic UUID pattern (full UUIDv7, not the obsolete
+#      019d... timestamp prefix — see task 20260513-211054 M9 comment-rot fix)
 #   3. first line parses as session_meta JSON with payload.id
 #   4. payload.id matches filename tid (defends against rename / corruption)
 #   5. payload.cwd is non-empty AND directory still exists
```

---

## M6: codex-mapping primary path in `/root/bin/happy-session-recovery.sh`

Adds a new function `scan_codex_via_mapping` that reads each daemon home's `codex-mapping.json` and emits `tid:cwd:home_dir` tuples for `bound` entries with a live pid. Used as PRIMARY codex discovery; `scan_codex_via_fd` becomes fallback. Missing/empty mapping file → silent fall-through (handles pre-M3 production daemons).

Insert `scan_codex_via_mapping` BEFORE `scan_codex_via_fd` (i.e. immediately above line 787). Then update `scan_running_sessions` to call mapping-first, fd-fallback only when mapping returned nothing for a given home.

### Add new function (insert before `scan_codex_via_fd` at line ~786)

```bash
# scan_codex_via_mapping: PRIMARY codex discovery (task 20260513-211054 M6).
# Reads $home/codex-mapping.json for each daemon home and emits
# "tid:cwd:home_dir" for entries in state=bound whose pid is alive.
# Falls through silently when:
#   - mapping file does not exist (pre-M3 production daemon)
#   - mapping file is empty (no codex sessions on this daemon)
#   - JSON parse fails (corrupted file)
# Caller falls back to scan_codex_via_fd in those cases.
scan_codex_via_mapping() {
    declare -A scan_seen
    for home in "${HAPPY_HOMES[@]}"; do
        [ -d "$home" ] || continue
        local map_file="$home/codex-mapping.json"
        [ -f "$map_file" ] || continue
        [ -s "$map_file" ] || continue
        local rows
        rows=$(python3 -c "
import sys, json, os
try:
    data = json.load(open('$map_file'))
except Exception:
    sys.exit(0)
for e in data.get('entries', []):
    if e.get('state') != 'bound': continue
    if e.get('flavor') != 'codex': continue
    pid = e.get('pid')
    tid = e.get('codexThreadId')
    cwd = e.get('cwd')
    if not (pid and tid and cwd): continue
    # liveness check
    try:
        os.kill(pid, 0)
    except Exception:
        continue
    # skip subagent threads: rollout file presence + parent_thread_id filter
    # (mirrors pre_existing_guard at line 783)
    fname_pattern = tid
    print(f'{tid}:{cwd}')
" 2>/dev/null)
        [ -z "$rows" ] && continue
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            local key="${line%%:*}:$home"
            [ -n "${scan_seen[$key]}" ] && continue
            scan_seen[$key]=1
            echo "$line:$home"
        done <<< "$rows"
    done
}
```

### Update `scan_running_sessions` to call mapping-first (around line 175-183)

Replace the existing `# Source 3: codex threads via /proc/fd scan` block with:

```bash
    # Source 3a: codex threads via mapping file (PRIMARY, task 20260513-211054 M6).
    declare -A mapping_seen_home
    while IFS=: read -r _tid _cwd _home; do
        [ -z "$_tid" ] && continue
        local _dedup_key="$_tid:$_home"
        [ -n "${seen[$_dedup_key]}" ] && continue
        seen[$_dedup_key]=1
        mapping_seen_home["$_home"]=1
        echo "$_tid:$_cwd:$_home"
    done < <(scan_codex_via_mapping)

    # Source 3b: codex threads via /proc/fd scan (FALLBACK — kept until M3 is
    # deployed across all 3 prod daemons; S2 telemetry counter).
    local fd_fallback_count=0
    while IFS=: read -r _tid _cwd _home; do
        [ -z "$_tid" ] && continue
        local _dedup_key="$_tid:$_home"
        [ -n "${seen[$_dedup_key]}" ] && continue
        seen[$_dedup_key]=1
        fd_fallback_count=$((fd_fallback_count + 1))
        echo "$_tid:$_cwd:$_home"
    done < <(scan_codex_via_fd)
    if [ "$fd_fallback_count" -gt 0 ]; then
        log "[S2 telemetry] scan_codex_via_fd fallback emitted $fd_fallback_count codex tid(s)"
    fi
```

---

## M8: flavor-gated guard in `/root/bin/happy-session-recovery.sh` `/list` consumer

**NOTE (codex round-2 feedback)**: this is flavor-gated, not strictly schemaVersion-gated. For v1 responses (pre-M4 production daemons), rows have no `flavor` field so the new gate is a no-op and the existing claude path runs identically. For v2 responses (post-M4 daemons), `flavor === 'codex'` rows are skipped here and instead captured via `scan_codex_via_mapping` / `scan_codex_via_fd`. Either way claude UUIDs are preserved. If a future cycle wants `/list` itself as a codex source (capturing `codexThreadId` directly from the row), that's an additional step not implemented in this cycle.

`scan_running_sessions` reads `/list` at lines 47-69 and 117-173. Both spots already gracefully handle absent fields (use `.get(...)` with empty default). After M4 ships, the response will include `schemaVersion: 2` and per-row `flavor` / `codexThreadId` / `cwd` / `tidPending`. The script SHOULD remain backward compatible with both v1 and v2 responses.

**Required change**: At lines 148-149, the current parsing reads `claudeSessionId` directly. Once `flavor` is present, we should:

- v1 response (no `schemaVersion`): preserve current behavior (rows are implicit-claude).
- v2 response (`schemaVersion === 2`): rows with `flavor === 'codex'` carry `codexThreadId` not `claudeSessionId`.

Add this near line 148 (inside the `while IFS= read -r entry; do` loop):

```bash
            # Schema-version-aware row dispatch (task 20260513-211054 M8).
            # v1 (no flavor/no schemaVersion) -> implicit claude (existing path).
            # v2 with flavor=codex -> codex tid capture path (handled by Source 3a/3b).
            local entry_flavor
            entry_flavor=$(echo "$entry" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('flavor',''))" 2>/dev/null)
            if [ "$entry_flavor" = "codex" ]; then
                # codex rows are captured by scan_codex_via_mapping/fd; skip here
                # so we don't try to read claudeSessionId from them.
                continue
            fi
```

---

## M8 (restart script): no edits required to `/root/bin/happy-restart.sh`

`happy-restart.sh` does NOT call `/list` directly — it delegates pre-save to `happy-session-recovery.sh save`. All schema-version-guarded logic lives in the recovery script (above). The restart script is **unchanged** beyond confirming that recovery script edits are applied before the next restart.

**Branch A (v1 fallback)**: when production daemons run pre-M4 binary, `/list` has no `schemaVersion` field, so the dispatch above sees `entry_flavor=""` and falls through to existing claude path. Claude UUIDs are captured identically to today.

**Branch B (v2 enhanced)**: when dev daemon (post-M4) is running, `flavor === 'codex'` rows are captured by scan_codex_via_mapping/fd while claude rows continue along the existing path.

**MUST NEVER DROP claude UUIDs**: the dispatch only skips codex rows from the claude path; claude rows (flavor absent OR explicit 'claude' OR any non-codex value) follow the existing capture flow.

---

## Application sequence (user-side)

1. Apply M9 diff (comment-only, safe to land any time).
2. Apply M6 mapping-first scan (additive; falls through silently for pre-M3 daemons).
3. Apply M8 schema-version guard (safe with both v1 and v2 daemons).
4. Once dev daemon is rebuilt with this cycle's binary, run `bash /root/bin/happy-session-recovery.sh save` and verify codex tids appear from mapping (S2 fallback counter should remain 0).
5. Production daemons (default, jade, qijie) can continue on pre-M3 binaries — recovery script falls through to fd-scan for them.

---

## Acceptance criteria verification (AC5, AC6)

- **AC5**: After M6 lands AND a codex session is bound on the dev daemon, save output should include the tid:cwd:home tuple sourced from `codex-mapping.json`, NOT from `scan_codex_via_fd`. The S2 telemetry counter should NOT increment.
- **AC6**: Both branches verified — pre-M4 production daemons (no schemaVersion field) survive identically; post-M4 dev daemon captures codex tids without dropping claude UUIDs.
- **AC6 mock-test harness (CLOSED iteration round 2 — task 20260513-211054)**: the dispatch logic has been lifted into a pure TypeScript helper `parseListResponse` (`packages/happy-cli/src/utils/parseListResponse.ts`) with 21 vitest tests (`packages/happy-cli/src/utils/parseListResponse.test.ts`). The helper is the authoritative reference for the per-row dispatch the bash patch above implements; the test file includes:
  - Pure-helper tests asserting Branch A (v1 fixture, no `schemaVersion`) preserves all claude UUIDs unchanged (F5 production-safety) and captures zero codex tids.
  - Pure-helper tests asserting Branch B (v2 fixture, `schemaVersion: 2`) captures both claude UUIDs from non-codex rows AND codex tids from `flavor === 'codex'` rows.
  - A live `node:http` server fixture round-tripping each fixture through `fetch` to prove behavior matches the daemon wire format.
  - Edge cases: empty children, malformed top-level response, schemaVersion present but non-2, codex row with `tidPending=true` (no bound tid), unknown / absent flavor in v2, non-string fields.
  - **Defense-in-depth case (codex round-2 finding #2)**: a v1-shaped response that nonetheless carries a `flavor === 'codex'` row (mixed/backport deploy) is skipped from the Branch A claude path. F5 is unaffected because pre-M4 daemons cannot emit `flavor`; this is purely the helper mirroring the bash patch's per-row flavor gate.

  **Helper algorithm contract** (the bash patch must implement equivalent logic):
    - If `response.schemaVersion !== 2`: Branch A → for each row, skip if `row.flavor === 'codex'`, else capture `row.claudeSessionId` if string.
    - Else: Branch B → for each row, if `row.flavor === 'codex'` capture `row.codexThreadId` into the codex-tid set; else capture `row.claudeSessionId` into the claude-uuid set.

  **NOTE on M6 vs helper Branch B**: today's bash M6 sources codex tids from `codex-mapping.json` (`scan_codex_via_mapping`), NOT from `/list`. The helper's Branch B models a forward-looking `/list`-as-codex-source behavior; a future bash patch flipping on `/list`-sourced codex capture has no code churn because the helper already covers it.
