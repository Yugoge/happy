# Recovery Script Patches — Final SOP for Blocks 2+3+4

**TASK-ID**: 20260514-143000
**Cycle**: 3 of session-bound /redev for task family 20260513-211054
**Status**: blocked_pending_manual_apply — user-TTY action required to close the loop
**Hook constraint**: subagents are PERMANENTLY blocked from `Edit`/`Write` on `/root/bin/*` and from `Bash`-invoking `/root/bin/happy-session-recovery.sh` / `/root/bin/happy-restart.sh`. This SOP is the artifact dev produces; the user pastes the blocks from a real TTY.

---

## Preamble: BA-deliverable ≠ closure

This SOP is the dev-subagent slice of the codex-mapping recovery loop closure. It produces:

- Verified line-anchor SOP for **Blocks 2 + 3 + 4** (NOT just 3+4 as the orchestrator originally framed — investigation found Block 2's `scan_codex_via_mapping()` function never landed)
- Build + dist-symbol-grep evidence that `packages/happy-cli/dist/` is fresh and contains all required exports
- A REQUEST-format citation of the user-TTY rollout path

Loop closure ALSO requires (user-TTY only):

1. Apply Blocks 2, 3, 4 below to `/root/bin/happy-session-recovery.sh` in that order
2. Run `/root/bin/happy-restart.sh --target dev`
3. Live-curl verify `POST /list` against the running dev daemon

The subagent CANNOT perform steps 1–3. Do not let downstream tooling re-flag this as "complete" until the user reports back having done them.

---

## Discovery state (verified at 2026-05-14T18:00Z)

Baseline: `/root/bin/happy-session-recovery.sh` is 1549 lines. Re-verify with the FIRST step of each block below before committing.

| Block | Target | Current state |
|-------|--------|----------------|
| 1 (M9 comment) | lines 758-759 | **APPLIED** (no action this SOP) |
| 2 (M6 function def) | insert before line 799 (`scan_codex_via_fd() {`) | NOT APPLIED |
| 3 (M6 dispatch / Source 3) | lines 175-183 | NOT APPLIED (still calls `scan_codex_via_fd` only) |
| 4 (M8 flavor-gate) | insert between line 147 and 148 | NOT APPLIED |

**Restart path correction (CLAUDE.md drift)**: project CLAUDE.md cites `/root/bin/safe-daemon-restart.sh` as the authorized restart entry. `Glob /root/bin/*.sh` confirms that filename does NOT exist. The actual entry is `/root/bin/happy-restart.sh --target dev` (verified at the script's line 12 dispatch table: `dev -> happy-daemon-dev only (no Docker recreate; binary from worktree dist)`). A future cycle should update CLAUDE.md to remove the phantom path.

---

## Order of operations (mandatory)

```
1. Apply Blocks 2 + 3 + 4 to /root/bin/happy-session-recovery.sh
2. Run yarn build in packages/happy-cli (already DONE this cycle — re-run if you re-pulled)
3. Run /root/bin/happy-restart.sh --target dev
4. Live-curl POST /list against the running dev daemon
```

**Why this order**: `happy-restart.sh` line 178/183 invokes `bash /root/bin/happy-session-recovery.sh save` during its pre-flight (Step 1 of the restart script). If you run `happy-restart.sh` BEFORE applying the recovery-script blocks, the pre-flight save uses the OLD script and will not capture codex sessions via the new mapping path. The new daemon binary then comes up against a stale session snapshot. Apply-script-first, restart-second is non-optional.

---

## Discovery / destructive separation (Anti-Fraud + Constraint-Substitution rule)

Each block is presented as FOUR separate shell invocations the user pastes in sequence:

- **D1 — verify current state** (read-only grep / `bash -n`; safe to repeat)
- **D2 — backup** (`cp` to `/tmp` with timestamp)
- **T1 — transform** (write transformed file to `/tmp/...` only; live file untouched)
- **T2 — verify transform** (read-only `diff` + `bash -n` against `/tmp/...`)
- **C1 — commit** (`cp /tmp/... /root/bin/happy-session-recovery.sh`)
- **V1 — post-apply verify** (read-only greps against live file)

The user pauses between D2/T1, between T2/C1, and inspects diff output before committing. No block bundles "find anchor + apply patch" in one invocation.

---

## Block 2: M6 `scan_codex_via_mapping()` function definition

Inserts a new function BEFORE the existing `scan_codex_via_fd()` (line 799). Reads each daemon-home's `codex-mapping.json` and emits `tid:cwd:home` rows for `state=bound` entries with live pid.

### Subagent-thread filtering (P-3 resolution)

`upsertCodexMappingEntry` (`packages/happy-cli/src/codex/codexMapping.ts:320`) does NOT filter subagent threads on the write side. It is called from `queueUpsert` in `codexMappingDaemon.ts:101` whose only guard is `if (!metadataIsCodex(metadata) || !metadata.hostPid) return;`. Therefore **codex-mapping.json CAN contain subagent-derived thread entries**.

The fd-scan path filters them via `_validate_codex_rollout` at line 783 (`parent_thread_id` check from the rollout file's `session_meta` payload). The mapping path MUST mirror that filter — otherwise F5 (claude UUIDs preserved + subagent threads NOT emitted as independent sessions) leaks the moment a codex subagent runs on a daemon.

The python block below re-applies the `parent_thread_id` check by reading the rollout JSONL file's first line, mirroring `_validate_codex_rollout`. The comment is corrected to reflect what the code actually does.

### Block 2 — D1 (verify anchor)

```bash
grep -n '^scan_codex_via_fd() {$' /root/bin/happy-session-recovery.sh
# Expected: 1 hit at line 799
grep -c 'scan_codex_via_mapping' /root/bin/happy-session-recovery.sh
# Expected: 0 (function not yet defined)
```

### Block 2 — D2 (backup)

```bash
cp /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.bak-$(date +%Y%m%d-%H%M%S)
ls -la /tmp/happy-session-recovery.sh.bak-* | tail -3
```

### Block 2 — T1 (transform, write to /tmp only)

```bash
awk '
/^scan_codex_via_fd\(\) \{$/ && !inserted {
    print "# scan_codex_via_mapping: PRIMARY codex discovery (task 20260514-143000 M6 / Block 2)."
    print "# Reads $home/codex-mapping.json for each daemon home and emits"
    print "# \"tid:cwd:home_dir\" for entries in state=bound whose pid is alive AND"
    print "# whose rollout file does NOT carry a parent_thread_id (mirrors _validate_codex_rollout"
    print "# at line ~783 — codex-mapping.json itself CAN contain subagent-derived entries"
    print "# because the daemon write-side does not filter them; we filter here on the read-side)."
    print "# Falls through silently when:"
    print "#   - mapping file does not exist (pre-M3 production daemon)"
    print "#   - mapping file is empty"
    print "#   - JSON parse fails (corrupted file)"
    print "# Caller falls back to scan_codex_via_fd in those cases."
    print "scan_codex_via_mapping() {"
    print "    declare -A scan_seen"
    print "    local home map_file rows"
    print "    for home in \"${HAPPY_HOMES[@]}\"; do"
    print "        [ -d \"$home\" ] || continue"
    print "        map_file=\"$home/codex-mapping.json\""
    print "        [ -f \"$map_file\" ] || continue"
    print "        [ -s \"$map_file\" ] || continue"
    print "        rows=$(MAP_FILE=\"$map_file\" CODEX_SESSIONS_DIR=\"$CODEX_SESSIONS_DIR\" python3 -c \""
    print "import sys, json, os"
    print "map_file = os.environ['MAP_FILE']"
    print "try:"
    print "    data = json.load(open(map_file))"
    print "except Exception:"
    print "    sys.exit(0)"
    print "for e in data.get('entries', []):"
    print "    if e.get('state') != 'bound': continue"
    print "    if e.get('flavor') != 'codex': continue"
    print "    pid = e.get('pid')"
    print "    tid = e.get('codexThreadId')"
    print "    cwd = e.get('cwd')"
    print "    if not (pid and tid and cwd): continue"
    print "    try:"
    print "        os.kill(pid, 0)"
    print "    except Exception:"
    print "        continue"
    print "    # Mirror _validate_codex_rollout subagent filter:"
    print "    # read the rollout file's first line and skip if parent_thread_id is set."
    print "    sessions_dir = os.environ.get('CODEX_SESSIONS_DIR', '')"
    print "    rollout_path = None"
    print "    if sessions_dir and os.path.isdir(sessions_dir):"
    print "        for root, _dirs, files in os.walk(sessions_dir):"
    print "            for fn in files:"
    print "                if fn.endswith('.jsonl') and tid in fn:"
    print "                    rollout_path = os.path.join(root, fn)"
    print "                    break"
    print "            if rollout_path: break"
    print "    if rollout_path:"
    print "        try:"
    print "            with open(rollout_path) as fh:"
    print "                first = fh.readline().strip()"
    print "            meta = json.loads(first) if first else {}"
    print "            payload = meta.get('payload', {}) if meta.get('type') == 'session_meta' else {}"
    print "            parent = ((payload.get('source') or {}).get('subagent') or {}).get('thread_spawn', {}).get('parent_thread_id')"
    print "            if parent: continue"
    print "        except Exception:"
    print "            pass"
    print "    print(f'{tid}:{cwd}')"
    print "\" 2>/dev/null)"
    print "        [ -z \"$rows\" ] && continue"
    print "        while IFS= read -r line; do"
    print "            [ -z \"$line\" ] && continue"
    print "            local key=\"${line%%:*}:$home\""
    print "            [ -n \"${scan_seen[$key]}\" ] && continue"
    print "            scan_seen[$key]=1"
    print "            echo \"$line:$home\""
    print "        done <<< \"$rows\""
    print "    done"
    print "}"
    print ""
    inserted = 1
}
{ print }
' /root/bin/happy-session-recovery.sh > /tmp/happy-session-recovery.sh.block2
```

### Block 2 — T2 (verify transform; commit NOT yet)

```bash
bash -n /tmp/happy-session-recovery.sh.block2 && echo "syntax OK"
grep -c '^scan_codex_via_mapping() \{$' /tmp/happy-session-recovery.sh.block2
# Expected: 1
grep -c '^scan_codex_via_fd() \{$' /tmp/happy-session-recovery.sh.block2
# Expected: 1 (unchanged)
diff /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.block2 | head -80
# Expected: a single inserted block immediately above the scan_codex_via_fd line; no other changes.
```

**STOP HERE**. Inspect the diff. The function must appear immediately before `scan_codex_via_fd() {`, with no edits to surrounding code.

### Block 2 — C1 (commit)

```bash
cp /tmp/happy-session-recovery.sh.block2 /root/bin/happy-session-recovery.sh
```

### Block 2 — V1 (post-apply verify)

```bash
# P-1 fix: split into function-def grep + bare-name grep (call site added in Block 3 will bring def+call to ≥2)
grep -c '^scan_codex_via_mapping() \{$' /root/bin/happy-session-recovery.sh
# Expected after Block 2 alone: 1 (function def)
grep -c 'scan_codex_via_mapping' /root/bin/happy-session-recovery.sh
# Expected after Block 2 alone: 1 (function def only; call site lands in Block 3)
bash -n /root/bin/happy-session-recovery.sh && echo "syntax OK"
```

---

## Block 3: M6 dispatch — replace Source 3 at lines 175-183

Replaces the existing 9-line `# Source 3: codex threads via /proc/fd scan` block with the mapping-first + fd-fallback dispatch. The existing block calls `scan_codex_via_fd` only; the new block calls `scan_codex_via_mapping` first, then `scan_codex_via_fd` as fallback, with S2 telemetry counter.

### P-2 resolution: removed `mapping_seen_home` dead variable

The Cycle 1 SOP declared `mapping_seen_home` but never read it — fd fallback ran globally, deduped through the existing `seen` map. The text said "fd-fallback only when mapping returned nothing for a given home" but the code did NOT implement per-home gating. This SOP removes the dead variable and updates the comment to match actual behavior: fd fallback runs globally; dedup uses the `seen` map.

### Block 3 — D1 (verify anchor lines 175-183)

```bash
sed -n '175,183p' /root/bin/happy-session-recovery.sh
# Expected:
#     # Source 3: codex threads via /proc/fd scan (mirrors Source 2 fallback).
#     # Codex thread-id format (^019d...) cannot collide with claude UUIDs.
#     while IFS=: read -r _tid _cwd _home; do
#         [ -z "$_tid" ] && continue
#         local _dedup_key="$_tid:$_home"
#         [ -n "${seen[$_dedup_key]}" ] && continue
#         seen[$_dedup_key]=1
#         echo "$_tid:$_cwd:$_home"
#     done < <(scan_codex_via_fd)
grep -n '^scan_codex_via_mapping' /root/bin/happy-session-recovery.sh
# Expected: 1 hit (function def from Block 2) — call site must NOT exist yet
```

### Block 3 — D2 (backup)

```bash
cp /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.bak-block3-$(date +%Y%m%d-%H%M%S)
```

### Block 3 — T1 (transform, write to /tmp only)

```bash
python3 - <<'PY'
import re
src = open('/root/bin/happy-session-recovery.sh').read()
old = (
    '    # Source 3: codex threads via /proc/fd scan (mirrors Source 2 fallback).\n'
    '    # Codex thread-id format (^019d...) cannot collide with claude UUIDs.\n'
    '    while IFS=: read -r _tid _cwd _home; do\n'
    '        [ -z "$_tid" ] && continue\n'
    '        local _dedup_key="$_tid:$_home"\n'
    '        [ -n "${seen[$_dedup_key]}" ] && continue\n'
    '        seen[$_dedup_key]=1\n'
    '        echo "$_tid:$_cwd:$_home"\n'
    '    done < <(scan_codex_via_fd)\n'
)
new = (
    '    # Source 3a: codex threads via mapping file (PRIMARY, task 20260514-143000 M6 / Block 3).\n'
    '    while IFS=: read -r _tid _cwd _home; do\n'
    '        [ -z "$_tid" ] && continue\n'
    '        local _dedup_key="$_tid:$_home"\n'
    '        [ -n "${seen[$_dedup_key]}" ] && continue\n'
    '        seen[$_dedup_key]=1\n'
    '        echo "$_tid:$_cwd:$_home"\n'
    '    done < <(scan_codex_via_mapping)\n'
    '\n'
    '    # Source 3b: codex threads via /proc/fd scan (FALLBACK, kept until M3 deployed\n'
    '    # across all 3 prod daemons). S2 telemetry: fd fallback runs globally, dedup via\n'
    '    # the same "seen" map as Source 3a — fd_fallback_count counts only emissions that\n'
    '    # were NOT already produced by the mapping path.\n'
    '    local fd_fallback_count=0\n'
    '    while IFS=: read -r _tid _cwd _home; do\n'
    '        [ -z "$_tid" ] && continue\n'
    '        local _dedup_key="$_tid:$_home"\n'
    '        [ -n "${seen[$_dedup_key]}" ] && continue\n'
    '        seen[$_dedup_key]=1\n'
    '        fd_fallback_count=$((fd_fallback_count + 1))\n'
    '        echo "$_tid:$_cwd:$_home"\n'
    '    done < <(scan_codex_via_fd)\n'
    '    if [ "$fd_fallback_count" -gt 0 ]; then\n'
    '        echo "[S2 telemetry] scan_codex_via_fd fallback emitted $fd_fallback_count codex tid(s)" >&2\n'
    '    fi\n'
)
if old not in src:
    print("ANCHOR MISS — refuse to write")
    raise SystemExit(2)
out = src.replace(old, new, 1)
open('/tmp/happy-session-recovery.sh.block3', 'w').write(out)
print("wrote /tmp/happy-session-recovery.sh.block3")
PY
```

### Block 3 — T2 (verify transform)

```bash
bash -n /tmp/happy-session-recovery.sh.block3 && echo "syntax OK"
diff /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.block3 | head -80
# Expected: exactly the Source 3 → Source 3a + 3b replacement at the anchor; no other changes.
grep -c 'scan_codex_via_mapping' /tmp/happy-session-recovery.sh.block3
# Expected: 2 (function def from Block 2 + new call site)
grep -c 'fd_fallback_count' /tmp/happy-session-recovery.sh.block3
# Expected: ≥3 (declaration + increment + post-loop check)
```

**STOP HERE**. Inspect the diff.

### Block 3 — C1 (commit)

```bash
cp /tmp/happy-session-recovery.sh.block3 /root/bin/happy-session-recovery.sh
```

### Block 3 — V1 (post-apply verify)

```bash
# P-1 fix (BA-QA spec defect):
#   AC2a — function-def site uses `scan_codex_via_mapping()` (parens)
#   AC2b — call site uses bare `scan_codex_via_mapping` inside process substitution
grep -c '^scan_codex_via_mapping() \{$' /root/bin/happy-session-recovery.sh
# Expected: 1 (function-def, parens form, line-anchored)
grep -c 'scan_codex_via_mapping' /root/bin/happy-session-recovery.sh
# Expected: 2 (def + call site)
grep -n '<(scan_codex_via_mapping)' /root/bin/happy-session-recovery.sh
# Expected: 1 hit — the Source 3a process-substitution call site
grep -c 'fd_fallback_count' /root/bin/happy-session-recovery.sh
# Expected: ≥3
bash -n /root/bin/happy-session-recovery.sh && echo "syntax OK"
```

---

## Block 4: M8 flavor-gate guard — insert between line 147 and 148

Inserts a 7-line flavor-gate guard immediately AFTER `[ -z "$cwd" ] && continue` (line 147) and BEFORE the `# Try Source 2a: claudeSessionId from daemon /list` comment (currently line 148). Causes v2 rows with `flavor === 'codex'` to skip the claude path (codex rows are captured by Source 3a/3b instead). v1 rows have no `flavor` field, the guard extracts empty string, the `if` is false, and the existing claude path runs unchanged.

### Block 4 — D1 (verify anchor)

```bash
sed -n '146,150p' /root/bin/happy-session-recovery.sh
# Expected (post-Block-3 line numbers may shift by +15 lines; re-anchor by content not number):
#     cwd=$(readlink /proc/$child_pid/cwd 2>/dev/null)
#     [ -z "$cwd" ] && continue
#
#     # Try Source 2a: claudeSessionId from daemon /list (most reliable for fresh sessions)
#     claude_uuid=$(echo "$entry" | python3 -c "...")
grep -n '# Try Source 2a: claudeSessionId from daemon /list' /root/bin/happy-session-recovery.sh
# Expected: exactly 1 hit
grep -c 'entry_flavor=' /root/bin/happy-session-recovery.sh
# Expected: 0 (guard not yet present)
```

### Block 4 — D2 (backup)

```bash
cp /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.bak-block4-$(date +%Y%m%d-%H%M%S)
```

### Block 4 — T1 (transform, write to /tmp only)

```bash
python3 - <<'PY'
src = open('/root/bin/happy-session-recovery.sh').read()
anchor = '            # Try Source 2a: claudeSessionId from daemon /list (most reliable for fresh sessions)\n'
guard = (
    '            # Schema-version-aware row dispatch (task 20260514-143000 M8 / Block 4).\n'
    '            # v1 (no flavor / no schemaVersion) -> implicit claude (existing path runs).\n'
    '            # v2 with flavor=codex -> codex tid capture via Source 3a/3b; skip here.\n'
    '            local entry_flavor\n'
    '            entry_flavor=$(echo "$entry" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get(\'flavor\',\'\'))" 2>/dev/null)\n'
    '            if [ "$entry_flavor" = "codex" ]; then\n'
    '                continue\n'
    '            fi\n'
)
if anchor not in src:
    print("ANCHOR MISS — refuse to write")
    raise SystemExit(2)
if src.count(anchor) != 1:
    print("ANCHOR AMBIGUOUS — refuse to write")
    raise SystemExit(2)
out = src.replace(anchor, guard + anchor, 1)
open('/tmp/happy-session-recovery.sh.block4', 'w').write(out)
print("wrote /tmp/happy-session-recovery.sh.block4")
PY
```

### Block 4 — T2 (verify transform)

```bash
bash -n /tmp/happy-session-recovery.sh.block4 && echo "syntax OK"
diff /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.block4 | head -30
# Expected: 8 added lines immediately before the Source 2a comment.
grep -c 'entry_flavor=' /tmp/happy-session-recovery.sh.block4
# Expected: 1
grep -B1 -A1 'entry_flavor="codex"' /tmp/happy-session-recovery.sh.block4
# Expected: shows the `continue` immediately after the gate
```

**STOP HERE**. Inspect the diff.

### Block 4 — C1 (commit)

```bash
cp /tmp/happy-session-recovery.sh.block4 /root/bin/happy-session-recovery.sh
```

### Block 4 — V1 (post-apply verify, all blocks)

```bash
# Final invariant checks after all three blocks applied:
grep -c '^scan_codex_via_mapping() \{$' /root/bin/happy-session-recovery.sh
# Expected: 1
grep -c 'scan_codex_via_mapping' /root/bin/happy-session-recovery.sh
# Expected: 2
grep -c '^scan_codex_via_fd() \{$' /root/bin/happy-session-recovery.sh
# Expected: 1 (unchanged from Block 1 baseline)
grep -c 'fd_fallback_count' /root/bin/happy-session-recovery.sh
# Expected: ≥3
grep -c 'entry_flavor=' /root/bin/happy-session-recovery.sh
# Expected: 1
grep -c 'generic UUID pattern' /root/bin/happy-session-recovery.sh
# Expected: 1 (Block 1 M9 comment fix — already in place)
bash -n /root/bin/happy-session-recovery.sh && echo "ALL GOOD"
```

---

## REQUEST to user (TTY-only post-apply steps)

REQUEST: subagent is permanently hook-blocked from invoking `/root/bin/happy-restart.sh` and from invoking the recovery script. The user must run the following from a real TTY (NOT in a subagent shell) AFTER applying Blocks 2+3+4 above. The dev subagent will NOT attempt these.

```
# Step A: roll out the new dev daemon binary.
# (yarn build was already run by dev subagent this cycle; re-run if you re-pulled.)
/root/bin/happy-restart.sh --target dev

# Step B: confirm dev daemon health.
journalctl -u happy-daemon-dev -n 50 --no-pager

# Step C: live-curl the /list endpoint.
# DEV_CONTROL_PORT is the dev daemon's local control HTTP port; find it via
#   jq -r '.httpPort' /root/.happy-dev/daemon.state.json
DEV_CONTROL_PORT=$(jq -r '.httpPort' /root/.happy-dev/daemon.state.json)
curl -s "http://127.0.0.1:${DEV_CONTROL_PORT}/list" \
  | jq '{schemaVersion, mappingStats, children: [.children[] | {flavor, codexThreadId, claudeSessionId, cwd}]}'
# Expected: schemaVersion == 2, mappingStats present with entryCount/pendingCount/boundCount/sweepRemovedCount,
# children rows with flavor=codex carry codexThreadId (not claudeSessionId).

# Step D: confirm bash-side mapping path firing (only meaningful if a codex session is running on the dev daemon).
bash /root/bin/happy-session-recovery.sh save
# After save, inspect /var/log/happy-session-recovery.log for absence of S2 fallback log line
# while at least one codex tid appears in /root/.happy-dev/session_dirs.txt.
```

---

## Cross-references

- BA ticket: `docs/dev/ticket-20260514-143000.md`
- BA context: `docs/dev/context-20260514-143000.json`
- BA-QA report (ACCEPT_WITH_OBSERVATIONS): `docs/dev/ba-qa-report-20260514-143000.json` — prescriptions P-1 through P-5 are addressed inline above
- Cycle 1 SOP being re-anchored: `docs/dev/recovery-script-patches-20260513-211054.md`
- Executable reference for per-row dispatch logic: `packages/happy-cli/src/utils/parseListResponse.ts` + `parseListResponse.test.ts` (21 vitest cases)
- Write-side that proves codex-mapping.json can carry subagent threads (P-3 evidence): `packages/happy-cli/src/codex/codexMappingDaemon.ts:101` — `queueUpsert` guard is `metadataIsCodex && hostPid`, NO `parent_thread_id` filter
- Read-side subagent filter being mirrored: `/root/bin/happy-session-recovery.sh:783` — `_validate_codex_rollout` checks `payload.source.subagent.thread_spawn.parent_thread_id`
- Restart entry path: `/root/bin/happy-restart.sh --target dev` (line 12 dispatch table) — supersedes phantom `safe-daemon-restart.sh` cited in CLAUDE.md

---

## Status

`blocked_pending_manual_apply` — closure requires user-TTY application of Blocks 2+3+4 + `/root/bin/happy-restart.sh --target dev` + live `/list` verification per § REQUEST.
