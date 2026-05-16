# Recovery-Script Remediation SOP — Task 20260515-085807

> Filename uses `qa-output-` prefix because QA tool-policy denies the requested `recovery-script-remediation-` prefix. Content is the user-pasteable SOP the orchestrator expected.

**TASK-ID**: 20260515-085807
**Cycle status**: blocked_pending_user_apply — subagents are PERMANENTLY hook-blocked from `Edit`/`Write` on `/root/bin/*` and from `Bash`-invoking `/root/bin/happy-session-recovery.sh` / `/root/bin/happy-restart.sh`. This SOP is the artifact QA produces; the user pastes the blocks from a real TTY.

---

## Preamble

User applied two patches to `/root/bin/happy-session-recovery.sh` (line 749 `is_codex_thread_id`, line 1093 scoped `server_url`). QA + codex audit (`qa-codex-consensus-20260515-085807.md`) confirms both fixes are CORRECT, but the remediation is INCOMPLETE.

This SOP defines **5 incremental patches** (Blocks A through E) the user must apply to close the loop:

| Block | Site | Severity | Required? | Purpose |
|-------|------|----------|-----------|---------|
| A | lines 1176-1197 | HIGH | **YES (required)** | Move flavor classification BEFORE Claude `.jsonl` existence check; branch validation on flavor. Without this, codex auto-restore is dead code. |
| B | lines 1054-1089 | HIGH | **YES (required)** | Scope the "wait for at least one daemon" loop to `homes_to_restore`, not `HAPPY_HOMES`. Same scope-leak class as user's Fix B. |
| C | lines 840-895 | MEDIUM | YES (recommended) | Require `_validate_codex_rollout` evidence in `scan_codex_via_mapping` before emitting a row. Defense-in-depth so snapshots never contain unverifiable codex tids. |
| D | lines 1378-1402 | MEDIUM | YES (recommended) | Manual `recover <id>` without `--home` now requires `--home` (or infers from per-home `session_dirs.txt`) instead of defaulting to first daemon (prod). |
| E | lines 1637 + 1640 | LOW | YES (trivial) | Comment-rot: usage text no longer references obsolete "019d... prefix" heuristic. |

Block F (restart_daemon scope leak) is documented but **OUT OF SCOPE** for this cycle (see § Out-of-Scope below).

---

## Order of operations (mandatory)

```
1. Apply Block A then verify
2. Apply Block B then verify
3. Apply Block C then verify (optional but recommended)
4. Apply Block D then verify (optional but recommended)
5. Apply Block E then verify (trivial)
6. Run /root/bin/happy-restart.sh --target dev to roll out and verify dev daemon health
7. Live test: scoped restore of dev daemon; verify codex tid can auto-restore
```

Each block is presented as the canonical 6-step shell sequence (D1 verify anchor, D2 backup, T1 transform to /tmp, T2 verify transform, C1 commit, V1 post-apply verify). User pauses between D2/T1 and between T2/C1 to inspect diff output before committing.

---

## Block A — Move flavor classification BEFORE session-file validation (HIGH, required)

Without this, the restore loop's unconditional Claude `.jsonl` check at lines 1176-1183 skips any codex tid in `session_dirs.txt` before the flavor classifier at line 1196 ever runs. Codex auto-restore is currently dead code.

### Block A — D1 (verify anchor)

```bash
sed -n '1175,1200p' /root/bin/happy-session-recovery.sh
# Expected to show:
#   <blank or comment>
#   local project_encoded
#   project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
#   local session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
#   if [ ! -f "$session_file" ]; then
#       log "Skip $uuid: .jsonl not found"
#       total_skipped=$((total_skipped + 1))
#       continue
#   fi
#
#   # Kill only THIS session's orphan process if running (prevent duplicate sessions)
#   local existing_pids
#   existing_pids=$(pgrep -f -- "--resume $uuid" 2>/dev/null)
#   if [ -n "$existing_pids" ]; then
#       echo "$existing_pids" | xargs kill 2>/dev/null
#       log "Killed orphan for $uuid before respawn"
#       sleep 1
#   fi
#
#   log "Restoring $uuid in $work_dir via $home"
#   local restore_flavor="claude"
#   is_codex_thread_id "$uuid" && restore_flavor="codex"
#   if daemon_spawn_session "$home" "$work_dir" "$uuid" "$restore_flavor"; then
```

### Block A — D2 (backup)

```bash
cp /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.bak-blockA-$(date +%Y%m%d-%H%M%S)
```

### Block A — T1 (transform; write to /tmp only)

```bash
python3 - <<'PY'
src = open('/root/bin/happy-session-recovery.sh').read()
old = (
    '            local project_encoded\n'
    '            project_encoded=$(echo "$work_dir" | sed \'s|/|-|g\')\n'
    '            local session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"\n'
    '            if [ ! -f "$session_file" ]; then\n'
    '                log "Skip $uuid: .jsonl not found"\n'
    '                total_skipped=$((total_skipped + 1))\n'
    '                continue\n'
    '            fi\n'
    '\n'
    '            # Kill only THIS session\'s orphan process if running (prevent duplicate sessions)\n'
    '            local existing_pids\n'
    '            existing_pids=$(pgrep -f -- "--resume $uuid" 2>/dev/null)\n'
    '            if [ -n "$existing_pids" ]; then\n'
    '                echo "$existing_pids" | xargs kill 2>/dev/null\n'
    '                log "Killed orphan for $uuid before respawn"\n'
    '                sleep 1\n'
    '            fi\n'
    '\n'
    '            log "Restoring $uuid in $work_dir via $home"\n'
    '            local restore_flavor="claude"\n'
    '            is_codex_thread_id "$uuid" && restore_flavor="codex"\n'
)
new = (
    '            # Classify flavor BEFORE session-file validation (Block A, task 20260515-085807).\n'
    '            # Old code unconditionally required a Claude .jsonl, skipping all codex tids\n'
    '            # before flavor classification ever ran. Codex auto-restore is now reachable.\n'
    '            local restore_flavor="claude"\n'
    '            is_codex_thread_id "$uuid" && restore_flavor="codex"\n'
    '\n'
    '            local session_file=""\n'
    '            if [ "$restore_flavor" = "claude" ]; then\n'
    '                local project_encoded\n'
    '                project_encoded=$(echo "$work_dir" | sed \'s|/|-|g\')\n'
    '                session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"\n'
    '                if [ ! -f "$session_file" ]; then\n'
    '                    log "Skip $uuid: Claude .jsonl not found ($session_file)"\n'
    '                    total_skipped=$((total_skipped + 1))\n'
    '                    continue\n'
    '                fi\n'
    '            else\n'
    '                session_file=$(find_codex_rollout "$uuid")\n'
    '                if [ -z "$session_file" ] || ! _validate_codex_rollout "$session_file" >/dev/null 2>&1; then\n'
    '                    log "Skip $uuid: Codex rollout not found or invalid"\n'
    '                    total_skipped=$((total_skipped + 1))\n'
    '                    continue\n'
    '                fi\n'
    '            fi\n'
    '\n'
    '            # Kill only THIS session\'s orphan process if running (prevent duplicate sessions)\n'
    '            local existing_pids\n'
    '            existing_pids=$(pgrep -f -- "--resume $uuid" 2>/dev/null)\n'
    '            if [ -n "$existing_pids" ]; then\n'
    '                echo "$existing_pids" | xargs kill 2>/dev/null\n'
    '                log "Killed orphan for $uuid before respawn"\n'
    '                sleep 1\n'
    '            fi\n'
    '\n'
    '            log "Restoring $uuid (flavor=$restore_flavor) in $work_dir via $home"\n'
)
if old not in src:
    print("ANCHOR MISS — refuse to write Block A")
    raise SystemExit(2)
if src.count(old) != 1:
    print("ANCHOR AMBIGUOUS — refuse to write Block A")
    raise SystemExit(2)
out = src.replace(old, new, 1)
open('/tmp/happy-session-recovery.sh.blockA', 'w').write(out)
print("wrote /tmp/happy-session-recovery.sh.blockA")
PY
```

### Block A — T2 (verify transform; commit NOT yet)

```bash
bash -n /tmp/happy-session-recovery.sh.blockA && echo "syntax OK"
diff /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.blockA
# Expected: flavor classification moved up; codex branch added for session_file resolution.
grep -c 'Block A, task 20260515-085807' /tmp/happy-session-recovery.sh.blockA
# Expected: 1
grep -c 'find_codex_rollout "$uuid"' /tmp/happy-session-recovery.sh.blockA
# Expected: ≥3 (existing call sites + new one in restore loop)
```

**STOP HERE**. Inspect the diff before committing.

### Block A — C1 (commit)

```bash
cp /tmp/happy-session-recovery.sh.blockA /root/bin/happy-session-recovery.sh
```

### Block A — V1 (post-apply verify)

```bash
bash -n /root/bin/happy-session-recovery.sh && echo "syntax OK"
grep -n 'Block A, task 20260515-085807' /root/bin/happy-session-recovery.sh
# Expected: 1 hit in restore_online_sessions
```

---

## Block B — Scope the daemon-wait loop to `homes_to_restore` (HIGH, required)

Without this, scoped dev restore can be satisfied by a prod daemon coming up. The dev home then gets silently skipped at line 1131 if dev daemon hadn't yet started.

### Block B — D1 (verify anchor)

```bash
sed -n '1053,1090p' /root/bin/happy-session-recovery.sh
# Expected to show the current pattern:
#   local max_wait=30 waited=0
#   while [ $waited -lt $max_wait ]; do
#       for home in "${HAPPY_HOMES[@]}"; do
#           local port
#           port=$(get_daemon_port "$home")
#           [ -n "$port" ] && break 2
#       done
#       sleep 2
#       waited=$((waited + 2))
#   done
#   ...
#   local homes_to_restore=("${HAPPY_HOMES[@]}")
#   if [ -n "$SCOPE_HOME" ]; then
#       local valid=0
#       ...
#       homes_to_restore=("$SCOPE_HOME")
#   fi
```

### Block B — D2 (backup)

```bash
cp /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.bak-blockB-$(date +%Y%m%d-%H%M%S)
```

### Block B — T1 (transform, write to /tmp only)

Block B moves the `homes_to_restore` scope-resolution block BEFORE the daemon-wait loop, then changes the wait loop to iterate `homes_to_restore`.

```bash
python3 - <<'PY'
src = open('/root/bin/happy-session-recovery.sh').read()
old = (
    '    log "Starting session recovery..."\n'
    '\n'
    '    # Wait for at least one daemon\n'
    '    local max_wait=30 waited=0\n'
    '    while [ $waited -lt $max_wait ]; do\n'
    '        for home in "${HAPPY_HOMES[@]}"; do\n'
    '            local port\n'
    '            port=$(get_daemon_port "$home")\n'
    '            [ -n "$port" ] && break 2\n'
    '        done\n'
    '        sleep 2\n'
    '        waited=$((waited + 2))\n'
    '    done\n'
    '\n'
    '    if [ $waited -ge $max_wait ]; then\n'
    '        log "ERROR: No daemon found after ${max_wait}s"\n'
    '        rm -rf "$RESTORE_LOCK_DIR"\n'
    '        trap - EXIT\n'
    '        return 1\n'
    '    fi\n'
    '    log "Daemon(s) available, starting restore"\n'
    '\n'
    '    # Determine which homes to restore (scoped or global)\n'
    '    local homes_to_restore=("${HAPPY_HOMES[@]}")\n'
    '    if [ -n "$SCOPE_HOME" ]; then\n'
    '        local valid=0\n'
    '        for h in "${HAPPY_HOMES[@]}"; do\n'
    '            [ "$h" = "$SCOPE_HOME" ] && { valid=1; break; }\n'
    '        done\n'
    '        if [ "$valid" = "0" ]; then\n'
    '            log "ERROR: Unknown home directory: $SCOPE_HOME (not in HAPPY_HOMES)"\n'
    '            rm -rf "$RESTORE_LOCK_DIR"\n'
    '            trap - EXIT\n'
    '            return 1\n'
    '        fi\n'
    '        homes_to_restore=("$SCOPE_HOME")\n'
    '        log "Scoped restore: only processing $SCOPE_HOME"\n'
    '    fi\n'
)
new = (
    '    log "Starting session recovery..."\n'
    '\n'
    '    # Determine which homes to restore (scoped or global) BEFORE the daemon-wait loop.\n'
    '    # Block B (task 20260515-085807): moving scope resolution above the wait loop so\n'
    '    # scoped restore only waits for the scoped daemon, not any global HAPPY_HOMES daemon.\n'
    '    local homes_to_restore=("${HAPPY_HOMES[@]}")\n'
    '    if [ -n "$SCOPE_HOME" ]; then\n'
    '        local valid=0\n'
    '        for h in "${HAPPY_HOMES[@]}"; do\n'
    '            [ "$h" = "$SCOPE_HOME" ] && { valid=1; break; }\n'
    '        done\n'
    '        if [ "$valid" = "0" ]; then\n'
    '            log "ERROR: Unknown home directory: $SCOPE_HOME (not in HAPPY_HOMES)"\n'
    '            rm -rf "$RESTORE_LOCK_DIR"\n'
    '            trap - EXIT\n'
    '            return 1\n'
    '        fi\n'
    '        homes_to_restore=("$SCOPE_HOME")\n'
    '        log "Scoped restore: only processing $SCOPE_HOME"\n'
    '    fi\n'
    '\n'
    '    # Wait for at least one daemon (scoped to homes_to_restore — Block B fix).\n'
    '    local max_wait=30 waited=0\n'
    '    while [ $waited -lt $max_wait ]; do\n'
    '        for home in "${homes_to_restore[@]}"; do\n'
    '            local port\n'
    '            port=$(get_daemon_port "$home")\n'
    '            [ -n "$port" ] && break 2\n'
    '        done\n'
    '        sleep 2\n'
    '        waited=$((waited + 2))\n'
    '    done\n'
    '\n'
    '    if [ $waited -ge $max_wait ]; then\n'
    '        log "ERROR: No daemon found after ${max_wait}s (homes_to_restore=${homes_to_restore[*]})"\n'
    '        rm -rf "$RESTORE_LOCK_DIR"\n'
    '        trap - EXIT\n'
    '        return 1\n'
    '    fi\n'
    '    log "Daemon(s) available, starting restore for homes: ${homes_to_restore[*]}"\n'
)
if old not in src:
    print("ANCHOR MISS — refuse to write Block B")
    raise SystemExit(2)
if src.count(old) != 1:
    print("ANCHOR AMBIGUOUS — refuse to write Block B")
    raise SystemExit(2)
out = src.replace(old, new, 1)
open('/tmp/happy-session-recovery.sh.blockB', 'w').write(out)
print("wrote /tmp/happy-session-recovery.sh.blockB")
PY
```

### Block B — T2 (verify transform)

```bash
bash -n /tmp/happy-session-recovery.sh.blockB && echo "syntax OK"
diff /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.blockB
# Expected: scope-resolution block moves UP; wait-loop iterates homes_to_restore.
grep -c 'Block B (task 20260515-085807)' /tmp/happy-session-recovery.sh.blockB
# Expected: 1
grep -c 'for home in "${homes_to_restore\[@\]}"; do' /tmp/happy-session-recovery.sh.blockB
# Expected: ≥3 (new wait loop + existing scope-filtered server_url loop + restore iteration loop)
```

**STOP HERE**. Inspect the diff.

### Block B — C1 (commit)

```bash
cp /tmp/happy-session-recovery.sh.blockB /root/bin/happy-session-recovery.sh
```

### Block B — V1 (post-apply verify)

```bash
bash -n /root/bin/happy-session-recovery.sh && echo "syntax OK"
grep -n 'Block B (task 20260515-085807)' /root/bin/happy-session-recovery.sh
# Expected: 1 hit
```

---

## Block C — Require `_validate_codex_rollout` in `scan_codex_via_mapping` (MEDIUM, recommended)

Defense-in-depth: `scan_codex_via_mapping` currently emits a row even if no rollout file is found locally (rollout_path stays None and the parent_thread_id check silently skips, but the `print(f'{tid}:{cwd}')` at the bottom fires regardless). Block C requires evidence to emit.

### Block C — D1 (verify anchor)

```bash
sed -n '865,890p' /root/bin/happy-session-recovery.sh
# Expected to show the python block ending with:
#     if rollout_path:
#         try:
#             with open(rollout_path) as fh:
#                 first = fh.readline().strip()
#             ...
#             if parent: continue
#         except Exception:
#             pass
#     print(f'{tid}:{cwd}')
```

### Block C — D2 (backup)

```bash
cp /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.bak-blockC-$(date +%Y%m%d-%H%M%S)
```

### Block C — T1 (transform; write to /tmp only)

```bash
python3 - <<'PY'
src = open('/root/bin/happy-session-recovery.sh').read()
old = (
    '    if rollout_path:\n'
    '        try:\n'
    '            with open(rollout_path) as fh:\n'
    '                first = fh.readline().strip()\n'
    '            meta = json.loads(first) if first else {}\n'
    '            payload = meta.get(\'payload\', {}) if meta.get(\'type\') == \'session_meta\' else {}\n'
    '            parent = ((payload.get(\'source\') or {}).get(\'subagent\') or {}).get(\'thread_spawn\', {}).get(\'parent_thread_id\')\n'
    '            if parent: continue\n'
    '        except Exception:\n'
    '            pass\n'
    '    print(f\'{tid}:{cwd}\')\n'
)
new = (
    '    # Block C (task 20260515-085807): require rollout evidence before emitting.\n'
    '    # Defense-in-depth — without rollout, we cannot prove this is a recoverable codex tid.\n'
    '    if not rollout_path:\n'
    '        continue\n'
    '    try:\n'
    '        with open(rollout_path) as fh:\n'
    '            first = fh.readline().strip()\n'
    '        meta = json.loads(first) if first else {}\n'
    '        if meta.get(\'type\') != \'session_meta\': continue\n'
    '        payload = meta.get(\'payload\', {})\n'
    '        if payload.get(\'id\') != tid: continue\n'
    '        rollout_cwd = payload.get(\'cwd\') or \'\'\n'
    '        if not rollout_cwd or not os.path.isdir(rollout_cwd): continue\n'
    '        parent = ((payload.get(\'source\') or {}).get(\'subagent\') or {}).get(\'thread_spawn\', {}).get(\'parent_thread_id\')\n'
    '        if parent: continue\n'
    '    except Exception:\n'
    '        continue\n'
    '    print(f\'{tid}:{cwd}\')\n'
)
if old not in src:
    print("ANCHOR MISS — refuse to write Block C")
    raise SystemExit(2)
if src.count(old) != 1:
    print("ANCHOR AMBIGUOUS — refuse to write Block C")
    raise SystemExit(2)
out = src.replace(old, new, 1)
open('/tmp/happy-session-recovery.sh.blockC', 'w').write(out)
print("wrote /tmp/happy-session-recovery.sh.blockC")
PY
```

### Block C — T2 (verify transform)

```bash
bash -n /tmp/happy-session-recovery.sh.blockC && echo "syntax OK"
diff /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.blockC
# Expected: the inline python now `continue`s when rollout_path is absent.
grep -c 'Block C (task 20260515-085807)' /tmp/happy-session-recovery.sh.blockC
# Expected: 1
```

**STOP HERE**. Inspect the diff.

### Block C — C1 (commit)

```bash
cp /tmp/happy-session-recovery.sh.blockC /root/bin/happy-session-recovery.sh
```

### Block C — V1 (post-apply verify)

```bash
bash -n /root/bin/happy-session-recovery.sh && echo "syntax OK"
grep -n 'Block C (task 20260515-085807)' /root/bin/happy-session-recovery.sh
# Expected: 1 hit in scan_codex_via_mapping
```

---

## Block D — Manual `recover` requires `--home` (MEDIUM, recommended)

Without this, `recover <dev-uuid>` without `--home` lands the session on prod daemon (first in HAPPY_HOMES order).

### Block D — D1 (verify anchor)

```bash
sed -n '1378,1402p' /root/bin/happy-session-recovery.sh
# Expected:
#   # Spawn on the first available daemon (break after success to prevent duplicates)
#   # If --home is specified, only try that daemon
#   local any_success=1
#   for home in "${HAPPY_HOMES[@]}"; do
#       [ -n "$target_home" ] && [ "$home" != "$target_home" ] && continue
#       ...
```

### Block D — D2 (backup)

```bash
cp /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.bak-blockD-$(date +%Y%m%d-%H%M%S)
```

### Block D — T1 (transform; write to /tmp only)

This block adds a pre-check: if `--home` is not specified, attempt to infer it from per-home `session_dirs.txt`; if still unresolved, error out with a clear message instead of defaulting to prod.

```bash
python3 - <<'PY'
src = open('/root/bin/happy-session-recovery.sh').read()
old = (
    '    # Spawn on the first available daemon (break after success to prevent duplicates)\n'
    '    # If --home is specified, only try that daemon\n'
    '    local any_success=1\n'
    '    for home in "${HAPPY_HOMES[@]}"; do\n'
    '        [ -n "$target_home" ] && [ "$home" != "$target_home" ] && continue\n'
)
new = (
    '    # Block D (task 20260515-085807): manual recover MUST specify or infer --home.\n'
    '    # Old behavior defaulted to first daemon in HAPPY_HOMES (= /root/.happy = prod);\n'
    '    # dev sessions recovered without --home would land on prod. Now we infer from\n'
    '    # per-home session_dirs.txt, and if still unresolvable, fail with a clear error.\n'
    '    if [ -z "$target_home" ]; then\n'
    '        local inferred_home=""\n'
    '        local _h\n'
    '        for _h in "${HAPPY_HOMES[@]}"; do\n'
    '            local _f="$_h/$SESSION_FILE"\n'
    '            [ -f "$_f" ] || continue\n'
    '            if grep -q "^${uuid}:" "$_f" 2>/dev/null; then\n'
    '                inferred_home="$_h"\n'
    '                break\n'
    '            fi\n'
    '        done\n'
    '        if [ -n "$inferred_home" ]; then\n'
    '            target_home="$inferred_home"\n'
    '            echo "Inferred --home $target_home from $target_home/$SESSION_FILE"\n'
    '        else\n'
    '            echo "ERROR: cannot infer --home for $uuid (not present in any session_dirs.txt)."\n'
    '            echo "Specify explicitly: $0 recover $uuid --home /root/.happy-dev"\n'
    '            return 1\n'
    '        fi\n'
    '    fi\n'
    '\n'
    '    # Spawn on the target daemon only (no fallback to other homes — Block D).\n'
    '    local any_success=1\n'
    '    for home in "${HAPPY_HOMES[@]}"; do\n'
    '        [ "$home" != "$target_home" ] && continue\n'
)
if old not in src:
    print("ANCHOR MISS — refuse to write Block D")
    raise SystemExit(2)
if src.count(old) != 1:
    print("ANCHOR AMBIGUOUS — refuse to write Block D")
    raise SystemExit(2)
out = src.replace(old, new, 1)
open('/tmp/happy-session-recovery.sh.blockD', 'w').write(out)
print("wrote /tmp/happy-session-recovery.sh.blockD")
PY
```

### Block D — T2 (verify transform)

```bash
bash -n /tmp/happy-session-recovery.sh.blockD && echo "syntax OK"
diff /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.blockD
# Expected: inserted scope-resolution block ahead of the daemon-spawn loop.
grep -c 'Block D (task 20260515-085807)' /tmp/happy-session-recovery.sh.blockD
# Expected: 1
```

**STOP HERE**. Inspect the diff. Consider: do you want strict "--home required" semantics, or the inference-with-explicit-error fallback shown here? If you prefer strict, replace the inference block with `echo "ERROR: --home required" && return 1`.

### Block D — C1 (commit)

```bash
cp /tmp/happy-session-recovery.sh.blockD /root/bin/happy-session-recovery.sh
```

### Block D — V1 (post-apply verify)

```bash
bash -n /root/bin/happy-session-recovery.sh && echo "syntax OK"
grep -n 'Block D (task 20260515-085807)' /root/bin/happy-session-recovery.sh
# Expected: 1 hit in recover_session
```

---

## Block E — Comment-rot fix (LOW, trivial)

Usage text at line 1640 still references "019d... prefixed ids" — the old heuristic the user replaced. Update to reflect the new evidence-based logic.

### Block E — D1 (verify anchor)

```bash
sed -n '1637,1644p' /root/bin/happy-session-recovery.sh
# Expected:
#   echo "  recover <id>                      - Recover one session (flavor auto-detected from id)"
#   ...
#   echo "  recover <id> --flavor codex       - Force codex flavor (auto for 019d...-prefixed ids)"
```

### Block E — D2 (backup)

```bash
cp /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.bak-blockE-$(date +%Y%m%d-%H%M%S)
```

### Block E — T1 (transform; write to /tmp only)

```bash
python3 - <<'PY'
src = open('/root/bin/happy-session-recovery.sh').read()
old1 = '        echo "  recover <id>                      - Recover one session (flavor auto-detected from id)"\n'
new1 = '        echo "  recover <id>                      - Recover one session (flavor auto-detected from validated codex rollout evidence)"\n'
old2 = '        echo "  recover <id> --flavor codex       - Force codex flavor (auto for 019d...-prefixed ids)"\n'
new2 = '        echo "  recover <id> --flavor codex       - Force codex flavor (auto-detected via /root/.codex/sessions rollout file existence + validation)"\n'
if old1 not in src or old2 not in src:
    print("ANCHOR MISS — refuse to write Block E")
    raise SystemExit(2)
out = src.replace(old1, new1, 1).replace(old2, new2, 1)
open('/tmp/happy-session-recovery.sh.blockE', 'w').write(out)
print("wrote /tmp/happy-session-recovery.sh.blockE")
PY
```

### Block E — T2 (verify transform)

```bash
bash -n /tmp/happy-session-recovery.sh.blockE && echo "syntax OK"
diff /root/bin/happy-session-recovery.sh /tmp/happy-session-recovery.sh.blockE
# Expected: 2 single-line edits in usage text.
grep -c '019d' /tmp/happy-session-recovery.sh.blockE
# Expected: 0
```

### Block E — C1 (commit)

```bash
cp /tmp/happy-session-recovery.sh.blockE /root/bin/happy-session-recovery.sh
```

### Block E — V1 (post-apply verify)

```bash
bash -n /root/bin/happy-session-recovery.sh && echo "syntax OK"
grep -c '019d' /root/bin/happy-session-recovery.sh
# Expected: 0
grep -n 'auto-detected via /root/.codex/sessions' /root/bin/happy-session-recovery.sh
# Expected: 1 hit
```

---

## Final invariant checks (after all blocks applied)

```bash
bash -n /root/bin/happy-session-recovery.sh && echo "syntax OK"

# Block A invariant: flavor classified before session_file resolution
grep -c 'Block A, task 20260515-085807' /root/bin/happy-session-recovery.sh
# Expected: 1

# Block B invariant: wait-loop iterates homes_to_restore
grep -c 'Block B (task 20260515-085807)' /root/bin/happy-session-recovery.sh
# Expected: 1

# Block C invariant: scan_codex_via_mapping requires rollout evidence
grep -c 'Block C (task 20260515-085807)' /root/bin/happy-session-recovery.sh
# Expected: 1

# Block D invariant: recover_session requires inferred or explicit --home
grep -c 'Block D (task 20260515-085807)' /root/bin/happy-session-recovery.sh
# Expected: 1

# Block E invariant: no 019d references in usage text
grep -c '019d' /root/bin/happy-session-recovery.sh
# Expected: 0

# User's prior fixes still in place
grep -c 'Codex recovery requires the local Codex rollout file' /root/bin/happy-session-recovery.sh
# Expected: 1 (Fix A comment)
grep -nE 'for home in "\$\{homes_to_restore\[@\]\}"' /root/bin/happy-session-recovery.sh
# Expected: ≥3 hits (Fix B wait loop, server_url loop, restore iteration)
```

---

## REQUEST to user (TTY-only post-apply steps)

After applying Blocks A through E above, run the following from a real TTY (NOT in a subagent shell). The subagent will NOT attempt these — `/root/bin/happy-restart.sh` is hook-blocked for subagents.

```bash
# Step 1: roll out the new dev daemon binary (no-op if no CLI changes; safe to skip)
# This SOP changes only /root/bin/happy-session-recovery.sh, NOT the CLI dist.
# But if you've also changed packages/happy-cli, run:
# cd /dev/shm/dev-workspace/happy-dev/packages/happy-cli && yarn build

# Step 2: confirm bash-side mapping path firing
bash /root/bin/happy-session-recovery.sh save
# Check /var/log/happy-session-recovery.log for "Snapshot (save): N sessions"

# Step 3: live test scoped restore against dev daemon
bash /root/bin/happy-session-recovery.sh restore --home /root/.happy-dev
# Check /var/log/happy-session-recovery.log:
#   - "Waiting for server at http://localhost:3005" (NOT http://188.245.32.161:3000)
#   - For each codex tid in /root/.happy-dev/session_dirs.txt:
#       "Restoring <tid> (flavor=codex) in <cwd> via /root/.happy-dev"
#     followed by "Spawned via /root/.happy-dev: flavor=codex PID=N sessionId=<tid>"
#   - For each claude UUID:
#       "Restoring <uuid> (flavor=claude) ..."
#       "Spawned via /root/.happy-dev: flavor=claude ..."

# Step 4: end-to-end verification via Playwright (dev.life-ai.app)
# Sessions should NOT be archived after restore. Both claude and codex sessions
# should appear with state=active in the dev UI.
```

---

## Out-of-scope but URGENT — Block F (restart_daemon scope leak)

`/root/bin/happy-session-recovery.sh:1515-1591` (`restart_daemon` function) has a CRITICAL scope leak that codex flagged but is OUT OF SCOPE for this remediation cycle:

- Step 2 (line 1524): kills daemon PIDs across all 4 HAPPY_HOMES (dev, qijie, jade, default)
- Step 3 (line 1545): `pgrep -f 'happy-coder|happy-cli'` kills ALL happy processes globally
- Step 5 (lines 1568-1576): restarts only `happy-daemon` and `happy-daemon-jade`
- Result: `happy-session-recovery.sh restart` will KILL the dev daemon + dev sessions, but never restore them.

This is a different bug from the current incident. The user should invoke a separate remediation cycle to either:
1. Make `restart_daemon` scope-aware (accept `--target dev` / `--target prod`) — preferred, matches existing `happy-restart.sh` API
2. Restrict `restart_daemon` to prod homes only — define `restart_homes=(/root/.happy /root/.happy-jade)` and use it for kill / wait / restore steps

QA recommends OPTION 2 short-term (prevent dev kill on prod-restart) and OPTION 1 long-term (proper scope discipline). Do not bundle this into the current cycle's SOP.

---

## Cross-references

- User report: this cycle's task brief (transcribed in `qa-codex-consensus-20260515-085807.md`)
- Codex audit transcript: `docs/dev/qa-codex-consensus-20260515-085807.md`
- Codex raw output: `/var/tmp/codex-outputs/codex-recovery-audit-20260515-085807.txt`
- Prior cycle SOP being supplemented: `docs/dev/recovery-script-patches-final-20260514-143000.md`
- Per-home daemon-restart entry: `/root/bin/happy-restart.sh --target dev`

---

## Status

`blocked_pending_user_apply` — subagent has produced the SOP. Loop closure requires the user to apply Blocks A–E (mandatory: A, B; recommended: C, D, E), then run scoped dev restore and verify codex auto-restore now works.
