# Codex Systematic Refactor — happy-session-recovery.sh — 20260515-085807

## 1. Invariants (3-5 statements)

- **I1: Evidence-only flavor classification.** Every UUID-shaped value is treated as Claude unless a local Codex rollout file exists and `_validate_codex_rollout` verifies `payload.id`, `payload.cwd`, and non-subagent status; UUID shape alone is never flavor evidence.
- **I2: Restore/restart iteration is scope-bounded.** Restore-time daemon loops iterate `homes_to_restore`, and restart-time daemon loops iterate `restart_homes`; neither path uses global `HAPPY_HOMES` after the requested scope is resolved.
- **I3: Manual recover never defaults to first daemon.** `recover <id>` resolves `target_home` from per-home `session_dirs.txt` or JSON snapshots; if unresolved or ambiguous, it requires explicit `--home`.
- **I4: `restart_daemon` kill set equals restart set.** A daemon home is killed only if the function has a restart service for that same home; child process kills are filtered to the same home set.
- **I5: Discovery emits evidence-validated rows only.** Codex mapping and fd discovery emit rows only after rollout validation, preventing snapshot pollution by unverifiable Codex-looking IDs.

## 2. Replacement function bodies

#### Classifier replacement: `is_codex_thread_id`

```bash
# Refactor 20260515-085807 — enforces I1. Replaces lines 749-756.
# Classifies Codex only when a local rollout file validates; UUID shape alone is never evidence.
is_codex_thread_id() {
    local tid="$1"
    [ -n "$tid" ] || return 1
    local rollout
    rollout=$(find_codex_rollout "$tid" 2>/dev/null || true)
    [ -n "$rollout" ] || return 1
    _validate_codex_rollout "$rollout" >/dev/null 2>&1
}
```
#### Mapping discovery replacement: `scan_codex_via_mapping`

```bash
# Refactor 20260515-085807 — enforces I1, I5. Replaces lines 840-895.
# Mapping discovery now emits only live bound codex rows with validated rollout evidence.
scan_codex_via_mapping() {
    declare -A scan_seen
    local home map_file rows
    for home in "${HAPPY_HOMES[@]}"; do
        [ -d "$home" ] || continue
        map_file="$home/codex-mapping.json"
        [ -f "$map_file" ] || continue
        [ -s "$map_file" ] || continue

        rows=$(MAP_FILE="$map_file" python3 -c "
import json, os, sys
map_file = os.environ['MAP_FILE']
try:
    data = json.load(open(map_file))
except Exception:
    sys.exit(0)
for e in data.get('entries', []):
    if e.get('state') != 'bound':
        continue
    if e.get('flavor') != 'codex':
        continue
    pid = e.get('pid')
    tid = e.get('codexThreadId')
    cwd = e.get('cwd')
    if not (pid and tid and cwd):
        continue
    try:
        os.kill(int(pid), 0)
    except Exception:
        continue
    print(f'{tid}\t{cwd}\t{pid}')
" 2>/dev/null)
        [ -z "$rows" ] && continue

        while IFS=$'\t' read -r tid _mapping_cwd _pid; do
            [ -n "$tid" ] || continue
            local rollout tid_cwd valid_tid valid_cwd key
            rollout=$(find_codex_rollout "$tid" 2>/dev/null || true)
            [ -n "$rollout" ] || continue
            tid_cwd=$(_validate_codex_rollout "$rollout" 2>/dev/null) || continue
            valid_tid="${tid_cwd%%:*}"
            valid_cwd="${tid_cwd#*:}"
            [ "$valid_tid" = "$tid" ] || continue
            [ -d "$valid_cwd" ] || continue
            key="$tid:$home"
            [ -n "${scan_seen[$key]}" ] && continue
            scan_seen[$key]=1
            echo "$tid:$valid_cwd:$home"
        done <<< "$rows"
    done
}
```
#### Restore replacement: `restore_online_sessions`

```bash
# Refactor 20260515-085807 — enforces I1, I2. Replaces lines 1034-1212.
# Scoped restore resolves homes before daemon waits and classifies flavor before session-file checks.
restore_online_sessions() {
    # Acquire lock via mkdir (atomic, no fd inheritance)
    if ! mkdir "$RESTORE_LOCK_DIR" 2>/dev/null; then
        # Check if holding process is still alive (stale lock protection)
        local lock_pid=""
        [ -f "$RESTORE_LOCK_DIR/pid" ] && lock_pid=$(cat "$RESTORE_LOCK_DIR/pid" 2>/dev/null)
        if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
            log "Restore already running (pid $lock_pid), skipping"
            return 0
        fi
        # Stale lock — previous holder died without cleanup
        log "Removing stale restore lock (old pid: ${lock_pid:-unknown})"
        rm -rf "$RESTORE_LOCK_DIR"
        mkdir "$RESTORE_LOCK_DIR" 2>/dev/null || { log "Restore lock contention, skipping"; return 0; }
    fi
    echo $$ > "$RESTORE_LOCK_DIR/pid"
    trap 'rm -rf "$RESTORE_LOCK_DIR"' EXIT

    log "Starting session recovery..."

    # Determine which homes to restore (scoped or global) before any daemon wait.
    local homes_to_restore=("${HAPPY_HOMES[@]}")
    if [ -n "$SCOPE_HOME" ]; then
        local valid=0 h
        for h in "${HAPPY_HOMES[@]}"; do
            [ "$h" = "$SCOPE_HOME" ] && { valid=1; break; }
        done
        if [ "$valid" = "0" ]; then
            log "ERROR: Unknown home directory: $SCOPE_HOME (not in HAPPY_HOMES)"
            rm -rf "$RESTORE_LOCK_DIR"
            trap - EXIT
            return 1
        fi
        homes_to_restore=("$SCOPE_HOME")
        log "Scoped restore: only processing $SCOPE_HOME"
    fi

    # Wait for at least one daemon in the requested restore scope.
    local max_wait=30 waited=0
    while [ $waited -lt $max_wait ]; do
        for home in "${homes_to_restore[@]}"; do
            local port
            port=$(get_daemon_port "$home")
            [ -n "$port" ] && break 2
        done
        sleep 2
        waited=$((waited + 2))
    done

    if [ $waited -ge $max_wait ]; then
        log "ERROR: No daemon found after ${max_wait}s for homes: ${homes_to_restore[*]}"
        rm -rf "$RESTORE_LOCK_DIR"
        trap - EXIT
        return 1
    fi
    log "Daemon(s) available, starting restore for homes: ${homes_to_restore[*]}"

    # Wait for the scoped happy-server URL before spawning sessions.
    # In scoped mode this can only read the scoped daemon's HAPPY_SERVER_URL.
    local server_url=""
    for home in "${homes_to_restore[@]}"; do
        local dpid
        dpid=$(python3 -c "import json; print(json.load(open('$home/daemon.state.json'))['pid'])" 2>/dev/null)
        [ -n "$dpid" ] && [ -d "/proc/$dpid" ] && {
            server_url=$(tr '\0' '\n' < /proc/$dpid/environ 2>/dev/null | grep '^HAPPY_SERVER_URL=' | cut -d= -f2-)
            [ -n "$server_url" ] && break
        }
    done

    if [ -n "$server_url" ]; then
        local sw=0 smax=60
        log "Waiting for server at $server_url ..."
        while [ $sw -lt $smax ]; do
            if curl -sf -o /dev/null --connect-timeout 3 "$server_url/health" 2>/dev/null || \
               curl -sf -o /dev/null --connect-timeout 3 "$server_url/" 2>/dev/null; then
                break
            fi
            sleep 3
            sw=$((sw + 3))
        done
        if [ $sw -ge $smax ]; then
            log "WARNING: Server not reachable after ${smax}s, proceeding anyway"
        else
            log "Server reachable after ${sw}s"
        fi
    fi

    # Get already-running UUIDs (with home info for accurate per-home dedup)
    local running_raw
    running_raw=$(scan_running_sessions)

    local total_restored=0 total_skipped=0 total_already=0 total_failed=0 grand_total=0
    declare -A globally_spawned  # Cross-home UUID dedup: prevents spawning same session on multiple daemons

    for home in "${homes_to_restore[@]}"; do
        [ -d "$home" ] || continue
        local port
        port=$(get_daemon_port "$home")
        [ -z "$port" ] && { log "Skip $home: daemon not running"; continue; }

        # Read this home's session_dirs.txt
        local saved=""
        local file="$home/$SESSION_FILE"
        if [ -f "$file" ]; then
            saved=$(grep -v '^#' "$file" | grep -v '^$')
        fi

        # Fallback: peak JSON snapshot
        if [ -z "$saved" ]; then
            log "$home: session_dirs.txt empty, trying peak JSON snapshot..."
            local peak_info
            peak_info=$(find_peak_snapshot)
            if [ -n "$peak_info" ]; then
                local peak_file="${peak_info#*:}"
                log "Using peak snapshot: $(basename "$peak_file")"
                # Extract with home_dir, filter for this home, then strip to uuid:cwd
                saved=$(jq -r '.sessions[] | "\(.claude_id):\(.working_dir):\(.home_dir // "")"' "$peak_file" 2>/dev/null \
                    | filter_sessions_for_home "$home")
            fi
        fi

        [ -z "$saved" ] && { log "$home: no sessions to restore"; continue; }

        local home_total
        home_total=$(echo "$saved" | wc -l)
        grand_total=$((grand_total + home_total))
        log "Restoring $home_total sessions for $home"

        local running_home=""
        [ -n "$running_raw" ] && running_home=$(echo "$running_raw" | filter_sessions_for_home "$home")

        while IFS=: read -r uuid work_dir; do
            [ -z "$uuid" ] && continue

            # Cross-home dedup: skip if already spawned by a previous home iteration
            if [ -n "${globally_spawned[$uuid]+x}" ]; then
                total_already=$((total_already + 1))
                continue
            fi

            if [ -n "$running_home" ] && echo "$running_home" | cut -d: -f1 | grep -Fxq "$uuid"; then
                log "Already running $uuid in $home; not respawning"
                globally_spawned[$uuid]=1
                total_already=$((total_already + 1))
                continue
            fi

            if [ ! -d "$work_dir" ]; then
                log "Skip $uuid: dir $work_dir missing"
                total_skipped=$((total_skipped + 1))
                continue
            fi

            # Classify flavor before resolving/verifying the session file. Claude UUIDs and
            # Codex thread IDs are both UUID-shaped; evidence, not shape, chooses the branch.
            local restore_flavor="claude"
            local session_file=""
            if is_codex_thread_id "$uuid"; then
                restore_flavor="codex"
                session_file=$(find_codex_rollout "$uuid" 2>/dev/null || true)
                if [ -z "$session_file" ] || ! _validate_codex_rollout "$session_file" >/dev/null 2>&1; then
                    log "Skip $uuid: Codex rollout not found or invalid"
                    total_skipped=$((total_skipped + 1))
                    continue
                fi
            else
                local project_encoded
                project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
                session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
                if [ ! -f "$session_file" ]; then
                    log "Skip $uuid: Claude .jsonl not found at $session_file"
                    total_skipped=$((total_skipped + 1))
                    continue
                fi
            fi

            # Kill only THIS home's orphan process if running (prevent duplicate sessions)
            local existing_pids
            existing_pids=$(pgrep -f -- "--resume $uuid" 2>/dev/null || true)
            if [ -n "$existing_pids" ]; then
                while IFS= read -r existing_pid; do
                    [ -z "$existing_pid" ] && continue
                    [ -d "/proc/$existing_pid" ] || continue
                    local existing_home=""
                    existing_home=$(pid_to_happy_home "$existing_pid" 2>/dev/null || true)
                    if [ -z "$existing_home" ]; then
                        existing_home=$(tr '\0' '\n' < /proc/$existing_pid/environ 2>/dev/null | grep '^HAPPY_HOME_DIR=' | cut -d= -f2-)
                        existing_home="${existing_home:-/root/.happy}"
                    fi
                    [ "$existing_home" = "$home" ] || continue
                    kill "$existing_pid" 2>/dev/null || true
                    log "Killed orphan for $uuid before respawn (pid=$existing_pid home=$home)"
                done <<< "$existing_pids"
                sleep 1
            fi

            log "Restoring $uuid (flavor=$restore_flavor) in $work_dir via $home"
            if daemon_spawn_session "$home" "$work_dir" "$uuid" "$restore_flavor"; then
                total_restored=$((total_restored + 1))
                globally_spawned[$uuid]=1
            else
                total_failed=$((total_failed + 1))
            fi
            sleep 5  # 5s spacing prevents resource contention on mass spawn
        done <<< "$saved"
    done

    log "Recovery: total=$grand_total running=$total_already restored=$total_restored skipped=$total_skipped failed=$total_failed"

    # Release lock
    rm -rf "$RESTORE_LOCK_DIR"
    trap - EXIT
}
```
#### Manual recover replacement: `recover_session`

```bash
# Refactor 20260515-085807 — enforces I1, I3. Replaces lines 1216-1410.
# Manual recovery now resolves the daemon home from saved snapshots or requires explicit --home.
recover_session() {
    local uuid="$1"
    local target_home=""
    local flavor=""

    # Parse args: pick out --home <path>, --flavor <name>, and positional working-dir
    local pos_args=()
    shift || true
    while [ $# -gt 0 ]; do
        case "$1" in
            --home)
                [ -n "${2:-}" ] || { echo "ERROR: --home requires a path"; return 1; }
                target_home="$2"; shift 2 ;;
            --flavor)
                [ -n "${2:-}" ] || { echo "ERROR: --flavor requires claude or codex"; return 1; }
                flavor="$2"; shift 2 ;;
            *)
                pos_args+=("$1"); shift ;;
        esac
    done
    local manual_dir="${pos_args[0]:-}"

    if [ -z "$uuid" ]; then
        echo "Usage: $0 recover <session-id> [working-dir] [--home /root/.happy-jade] [--flavor claude|codex]"
        echo ""
        echo "Recent sessions from history:"
        for home in "${HAPPY_HOMES[@]}"; do
            local hf="$home/$HISTORY_FILE"
            [ -f "$hf" ] || continue
            python3 -c "
import json
seen = {}
for line in reversed(open('$hf').readlines()):
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        uid = d['id']
        if uid not in seen:
            seen[uid] = d
    except Exception:
        pass
for uid, d in list(seen.items())[:20]:
    mark = '+' if d['e'] == 'add' else '-'
    print(f\"  {d['id']}  {d['dir']}  ({d['t']} {mark})\")
" 2>/dev/null
            break
        done
        return 1
    fi

    case "$flavor" in
        ""|claude|codex) ;;
        *) echo "ERROR: --flavor must be claude or codex"; return 1 ;;
    esac

    # Auto-detect flavor from validated evidence if not explicitly set.
    if [ -z "$flavor" ]; then
        if is_codex_thread_id "$uuid"; then
            flavor="codex"
        else
            flavor="claude"
        fi
    fi

    # Validate explicit --home if supplied.
    if [ -n "$target_home" ]; then
        local known_home=0 h
        for h in "${HAPPY_HOMES[@]}"; do
            [ "$h" = "$target_home" ] && { known_home=1; break; }
        done
        [ "$known_home" = "1" ] || { echo "ERROR: unknown --home $target_home"; return 1; }
    fi

    # Check if already running.
    local running
    running=$(scan_running_sessions)
    if [ -n "$running" ] && echo "$running" | cut -d: -f1 | grep -Fxq "$uuid"; then
        echo "Session $uuid is already running"
        return 0
    fi

    # Resolve target_home if omitted. We only trust per-home saved state
    # (session_dirs.txt or JSON snapshots with home_dir), never HAPPY_HOMES order.
    local work_dir=""
    local session_file=""
    [ -n "$manual_dir" ] && work_dir="$manual_dir"

    if [ -z "$target_home" ]; then
        declare -A inferred_dirs_by_home
        local -a inferred_homes=()
        local home

        for home in "${HAPPY_HOMES[@]}"; do
            local f="$home/$SESSION_FILE"
            [ -f "$f" ] || continue
            local hit_dir
            hit_dir=$(awk -F: -v id="$uuid" '$1 == id { sub("^[^:]*:", ""); print; exit }' "$f" 2>/dev/null)
            [ -n "$hit_dir" ] || continue
            if [ -z "${inferred_dirs_by_home[$home]+x}" ]; then
                inferred_homes+=("$home")
            fi
            inferred_dirs_by_home[$home]="$hit_dir"
        done

        for home in "${HAPPY_HOMES[@]}"; do
            local dir="$home/$SNAPSHOT_DIR"
            [ -d "$dir" ] || continue
            while IFS=$'\t' read -r snap_home snap_dir; do
                [ -n "$snap_dir" ] || continue
                snap_home="${snap_home:-/root/.happy}"
                local valid_snap_home=0 h2
                for h2 in "${HAPPY_HOMES[@]}"; do
                    [ "$h2" = "$snap_home" ] && { valid_snap_home=1; break; }
                done
                [ "$valid_snap_home" = "1" ] || continue
                if [ -z "${inferred_dirs_by_home[$snap_home]+x}" ]; then
                    inferred_homes+=("$snap_home")
                    inferred_dirs_by_home[$snap_home]="$snap_dir"
                fi
            done < <(find "$dir" -name "*.json" -type f -printf '%T@ %p\n' 2>/dev/null \
                | sort -rn | head -20 | awk '{print $2}' | while read -r snap_file; do
                    jq -r --arg id "$uuid" '.sessions[]? | select(.claude_id == $id) | [(.home_dir // ""), .working_dir] | @tsv' "$snap_file" 2>/dev/null
                done)
        done

        if [ "${#inferred_homes[@]}" -eq 1 ]; then
            target_home="${inferred_homes[0]}"
            [ -z "$work_dir" ] && work_dir="${inferred_dirs_by_home[$target_home]}"
            echo "Inferred --home $target_home from saved snapshot state"
        elif [ "${#inferred_homes[@]}" -gt 1 ] && [ -n "$manual_dir" ]; then
            local matched_home="" match_count=0 h3
            for h3 in "${inferred_homes[@]}"; do
                if [ "${inferred_dirs_by_home[$h3]}" = "$manual_dir" ]; then
                    matched_home="$h3"
                    match_count=$((match_count + 1))
                fi
            done
            if [ "$match_count" -eq 1 ]; then
                target_home="$matched_home"
                echo "Inferred --home $target_home from saved snapshot state and manual working directory"
            fi
        fi

        if [ -z "$target_home" ]; then
            echo "ERROR: cannot infer --home for $uuid from per-home saved snapshots."
            if [ "${#inferred_homes[@]}" -gt 1 ]; then
                echo "Ambiguous homes found: ${inferred_homes[*]}"
            fi
            echo "Specify explicitly: $0 recover $uuid ${manual_dir:+$manual_dir }--home /root/.happy-dev"
            return 1
        fi
    fi

    # If work_dir is still missing, search only evidence associated with target_home.
    if [ -z "$work_dir" ]; then
        local f="$target_home/$SESSION_FILE"
        if [ -f "$f" ]; then
            work_dir=$(awk -F: -v id="$uuid" '$1 == id { sub("^[^:]*:", ""); print; exit }' "$f" 2>/dev/null)
        fi
    fi

    if [ -z "$work_dir" ]; then
        local dir="$target_home/$SNAPSHOT_DIR"
        if [ -d "$dir" ]; then
            work_dir=$(find "$dir" -name "*.json" -type f -printf '%T@ %p\n' 2>/dev/null \
                | sort -rn | head -20 | awk '{print $2}' | while read -r snap_file; do
                    jq -r --arg id "$uuid" --arg home "$target_home" '.sessions[]? | select(.claude_id == $id) | select(((.home_dir // "/root/.happy") == $home)) | .working_dir' "$snap_file" 2>/dev/null
                done | head -1)
        fi
    fi

    # History is only a working-directory hint after target_home is explicit/inferred.
    if [ -z "$work_dir" ]; then
        local hf="$target_home/$HISTORY_FILE"
        if [ -f "$hf" ]; then
            work_dir=$(python3 -c "
import json
for line in reversed(open('$hf').readlines()):
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        if d.get('id') == '$uuid':
            print(d.get('dir', ''))
            break
    except Exception:
        pass
" 2>/dev/null)
        fi
    fi

    # Scan project dirs only for Claude. Codex uses rollout metadata below.
    if [ -z "$work_dir" ] && [ "$flavor" = "claude" ]; then
        local found_file
        found_file=$(find "$CLAUDE_PROJECTS_DIR" -maxdepth 2 -name "$uuid.jsonl" -print -quit 2>/dev/null)
        if [ -n "$found_file" ]; then
            local encoded_name
            encoded_name=$(basename "$(dirname "$found_file")")
            for candidate in /root /root/*/; do
                candidate="${candidate%/}"
                local candidate_encoded
                candidate_encoded=$(echo "$candidate" | sed 's|/|-|g')
                if [ "$candidate_encoded" = "$encoded_name" ]; then
                    work_dir="$candidate"
                    break
                fi
            done
            [ -z "$work_dir" ] && work_dir="/root"
        fi
    fi

    # Codex rollout session_meta.payload.cwd is authoritative for codex work_dir.
    if [ "$flavor" = "codex" ]; then
        session_file=$(find_codex_rollout "$uuid" 2>/dev/null || true)
        if [ -z "$session_file" ] || ! _validate_codex_rollout "$session_file" >/dev/null 2>&1; then
            echo "Codex rollout not found or invalid for thread-id: $uuid"
            echo "Looked under: $CODEX_SESSIONS_DIR/YYYY/MM/DD/rollout-*-${uuid}.jsonl"
            return 1
        fi
        [ -z "$work_dir" ] && work_dir=$(head -n 1 "$session_file" \
            | jq -r 'select(.type == "session_meta") | .payload.cwd // empty' 2>/dev/null)
    fi

    if [ -z "$work_dir" ]; then
        echo "Cannot find working directory for session $uuid"
        echo "Specify manually: $0 recover $uuid /path/to/dir --home $target_home"
        return 1
    fi

    if [ ! -d "$work_dir" ]; then
        echo "Working directory does not exist: $work_dir"
        return 1
    fi

    if [ "$flavor" = "claude" ]; then
        local project_encoded
        project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
        session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
        if [ ! -f "$session_file" ]; then
            echo "Session file not found: $session_file"
            return 1
        fi
    fi

    local port
    port=$(get_daemon_port "$target_home")
    if [ -z "$port" ]; then
        echo "No running daemon found for target home: $target_home"
        return 1
    fi

    echo "Recovering session:"
    echo "  ID:     $uuid"
    echo "  Flavor: $flavor"
    echo "  Dir:    $work_dir"
    echo "  Home:   $target_home"
    echo "  File:   $session_file ($(du -h "$session_file" | cut -f1))"
    echo ""

    if daemon_spawn_session "$target_home" "$work_dir" "$uuid" "$flavor"; then
        echo "Session recovered on $target_home"
        echo "Session recovered successfully"
    else
        echo "Failed to recover on $target_home"
        return 1
    fi
}
```
#### Restart replacement: `restart_daemon`

```bash
# Refactor 20260515-085807 — enforces I2, I4. Replaces lines 1515-1591.
# Restart kill targets are derived from restartable homes only; no global orphan kill remains.
restart_daemon() {
    log "=== Daemon Restart (scope-safe peak recovery) ==="

    local dry_run="${HAPPY_RECOVERY_DRY_RUN:-0}"
    local -a restart_homes=()
    local -a restart_services=()
    local home service

    _restart_service_for_home() {
        local _home="$1"
        if [ -f "$_home/restart.service" ]; then
            head -n 1 "$_home/restart.service" 2>/dev/null
            return 0
        fi
        case "$_home" in
            /root/.happy)        echo "happy-daemon" ;;
            /root/.happy-jade)   echo "happy-daemon-jade" ;;
            /root/.happy-dev)    echo "happy-daemon-dev" ;;
            /root/.happy-qijie)  echo "happy-daemon-qijie" ;;
            *)                   return 1 ;;
        esac
    }

    _home_in_restart_set() {
        local _needle="$1" _h
        for _h in "${restart_homes[@]}"; do
            [ "$_h" = "$_needle" ] && return 0
        done
        return 1
    }

    # Build the restart set first. A home without a service mapping or installed
    # systemd unit is not killed, because this function cannot restart it.
    for home in "${HAPPY_HOMES[@]}"; do
        [ -n "$SCOPE_HOME" ] && [ "$home" != "$SCOPE_HOME" ] && continue
        [ -d "$home" ] || continue
        service=$(_restart_service_for_home "$home" 2>/dev/null || true)
        if [ -z "$service" ]; then
            log "Skip $home: no restart service mapping; refusing to kill it"
            continue
        fi
        if [ "$dry_run" != "1" ]; then
            if ! systemctl list-unit-files "${service}.service" >/dev/null 2>&1 && \
               [ ! -f "/etc/systemd/system/${service}.service" ]; then
                log "Skip $home: ${service}.service is not installed; refusing to kill it"
                continue
            fi
        fi
        restart_homes+=("$home")
        restart_services+=("$service")
    done

    if [ -n "$SCOPE_HOME" ] && [ "${#restart_homes[@]}" -eq 0 ]; then
        log "ERROR: scoped restart requested for $SCOPE_HOME, but it is not restartable"
        return 1
    fi
    if [ "${#restart_homes[@]}" -eq 0 ]; then
        log "ERROR: no restartable homes found; refusing to kill anything"
        return 1
    fi

    log "Restart scope homes: ${restart_homes[*]}"
    [ "$dry_run" = "1" ] && log "DRY-RUN: no processes will be killed and no services will be started"

    # Step 1: find peak snapshot BEFORE killing anything.
    local peak_info
    peak_info=$(find_peak_snapshot)

    # Step 2: kill daemon main PIDs only for homes in the restart set.
    for home in "${restart_homes[@]}"; do
        local dpid=""
        local pid_file="$home/daemon.pid"
        if [ -f "$pid_file" ]; then
            dpid=$(cat "$pid_file" 2>/dev/null)
        fi
        if [ -z "$dpid" ] && [ -f "$home/daemon.state.json" ]; then
            dpid=$(python3 -c "import json; print(json.load(open('$home/daemon.state.json')).get('pid',''))" 2>/dev/null)
        fi
        if [ -n "$dpid" ] && [ -d "/proc/$dpid" ]; then
            if [ "$dry_run" = "1" ]; then
                log "DRY-RUN would kill daemon PID $dpid ($home)"
            else
                log "Killing daemon PID $dpid ($home)"
                kill "$dpid" 2>/dev/null || true
            fi
        fi
    done

    # Step 3: reset failed state only for services in the restart set.
    local idx
    for idx in "${!restart_services[@]}"; do
        service="${restart_services[$idx]}"
        if [ "$dry_run" = "1" ]; then
            log "DRY-RUN would reset-failed ${service}.service"
        else
            systemctl reset-failed "$service" 2>/dev/null || true
        fi
    done
    [ "$dry_run" = "1" ] || sleep 2

    # Step 4: kill only happy child processes owned by homes in the restart set.
    log "Killing happy child processes only for restart scope..."
    local own_ppids
    own_ppids="$$ $(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')"
    local pid
    for pid in $(pgrep -f 'happy-coder|happy-cli' 2>/dev/null || true); do
        [ -d "/proc/$pid" ] || continue
        echo "$own_ppids" | grep -qw "$pid" && continue
        local owned_home=""
        owned_home=$(pid_to_happy_home "$pid" 2>/dev/null || true)
        if [ -z "$owned_home" ]; then
            owned_home=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep '^HAPPY_HOME_DIR=' | cut -d= -f2-)
            owned_home="${owned_home:-/root/.happy}"
        fi
        _home_in_restart_set "$owned_home" || continue
        local cmd
        cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null)
        if [ "$dry_run" = "1" ]; then
            log "DRY-RUN would kill child PID $pid home=$owned_home cmd=${cmd:0:80}"
        else
            log "Killing child PID $pid home=$owned_home cmd=${cmd:0:80}"
            kill "$pid" 2>/dev/null || true
        fi
    done
    [ "$dry_run" = "1" ] || sleep 2

    # Step 5: write peak snapshot only to homes in the restart set.
    if [ -n "$peak_info" ]; then
        local peak_count="${peak_info%%:*}"
        local peak_file="${peak_info#*:}"
        log "Peak snapshot: $(basename "$peak_file") ($peak_count sessions)"
        local peak_sessions
        peak_sessions=$(jq -r '.sessions[] | "\(.claude_id):\(.working_dir):\(.home_dir // "")"' "$peak_file" 2>/dev/null)
        if [ -n "$peak_sessions" ]; then
            for home in "${restart_homes[@]}"; do
                local filtered home_count
                filtered=$(echo "$peak_sessions" | filter_sessions_for_home "$home")
                home_count=0
                [ -n "$filtered" ] && home_count=$(echo "$filtered" | wc -l)
                if [ "$dry_run" = "1" ]; then
                    log "DRY-RUN would write $home_count peak sessions to $home/$SESSION_FILE"
                else
                    {
                        echo "# Happy Session Snapshot - $(date '+%Y-%m-%d %H:%M:%S')"
                        echo "# Format: claude_uuid:working_dir"
                        echo "# Count: $home_count"
                        [ -n "$filtered" ] && echo "$filtered"
                    } > "$home/$SESSION_FILE.tmp"
                    mv "$home/$SESSION_FILE.tmp" "$home/$SESSION_FILE"
                fi
            done
        fi
    else
        log "No peak snapshot found within ${PEAK_PROTECT_SECONDS}s — will restore from existing session_dirs.txt"
    fi

    # Step 6: start exactly the services in the restart set.
    for idx in "${!restart_services[@]}"; do
        home="${restart_homes[$idx]}"
        service="${restart_services[$idx]}"
        if [ "$dry_run" = "1" ]; then
            log "DRY-RUN would start ${service}.service for $home"
        else
            log "Starting ${service}.service for $home..."
            systemctl start "$service" 2>&1 || log "WARNING: systemctl start $service failed"
        fi
    done

    # Step 7: wait for each restarted daemon, then run restore scoped per home.
    if [ "$dry_run" = "1" ]; then
        for home in "${restart_homes[@]}"; do
            log "DRY-RUN would wait for daemon and restore --home $home"
        done
        log "=== Restart dry-run complete ==="
        return 0
    fi

    for home in "${restart_homes[@]}"; do
        log "Waiting for daemon to be ready: $home"
        local waited=0
        while [ $waited -lt 30 ]; do
            local port
            port=$(get_daemon_port "$home" 2>/dev/null)
            [ -n "$port" ] && break
            sleep 2
            waited=$((waited + 2))
        done
        if [ $waited -ge 30 ]; then
            log "WARNING: daemon not ready after 30s: $home"
        fi
    done

    local old_scope="$SCOPE_HOME"
    for home in "${restart_homes[@]}"; do
        SCOPE_HOME="$home"
        restore_online_sessions
    done
    SCOPE_HOME="$old_scope"

    log "=== Restart complete ==="
}
```
#### Usage/help text replacement (case arm, not a function)

Replaces lines 1631-1644; this is not a function, so the 2-line function header requirement does not apply. It removes the obsolete `019d...` heuristic wording.

```bash
        echo "Usage: $0 {save|watch|restore|restart|recover|check|history|snapshots}"
        echo ""
        echo "  save                - Save snapshot now (called by ExecStartPre)"
        echo "  watch               - Continuous monitoring (every ${POLL_INTERVAL}s)"
        echo "  restore             - Restore all saved sessions via daemon"
        echo "  restart             - Restart only daemon homes that this script can also start"
        echo "  recover <id>                      - Recover one session (flavor auto-detected from validated rollout evidence)"
        echo "  recover <id> <dir>                - Recover with manual working directory"
        echo "  recover <id> --home <path>        - Recover on specific daemon (e.g. /root/.happy-jade)"
        echo "  recover <id> --flavor codex       - Force codex flavor (auto-detected via local Codex rollout validation)"
        echo "  recover <id> <dir> --home <path>  - Overrides combined"
        echo "  check               - Show saved vs running"
        echo "  history [N]         - Show last N change events (default 30)"
        echo "  snapshots [hours]   - Show JSON snapshots (default 24h)"
```

## 3. Application heredoc (single transaction model)

Paste the following as one command block from a real TTY. It backs up the live script, applies one string replacement per function plus one usage-text replacement, runs `bash -n` on a temporary file, and atomically replaces the live file only after syntax success.

```bash
TS=$(date +%Y%m%d-%H%M%S)
SCRIPT=/root/bin/happy-session-recovery.sh
BACKUP=/tmp/happy-session-recovery.sh.bak-refactor-$TS
cp "$SCRIPT" "$BACKUP"
python3 - "$SCRIPT" "$BACKUP" <<'PY'
import os, re, shutil, stat, subprocess, sys
path = sys.argv[1]
backup = sys.argv[2]
with open(path) as f:
    src = f.read()

function_replacements = [
    ('is_codex_thread_id', '# Refactor 20260515-085807 — enforces I1. Replaces lines 749-756.\n# Classifies Codex only when a local rollout file validates; UUID shape alone is never evidence.\nis_codex_thread_id() {\n    local tid="$1"\n    [ -n "$tid" ] || return 1\n    local rollout\n    rollout=$(find_codex_rollout "$tid" 2>/dev/null || true)\n    [ -n "$rollout" ] || return 1\n    _validate_codex_rollout "$rollout" >/dev/null 2>&1\n}\n'),
    ('scan_codex_via_mapping', '# Refactor 20260515-085807 — enforces I1, I5. Replaces lines 840-895.\n# Mapping discovery now emits only live bound codex rows with validated rollout evidence.\nscan_codex_via_mapping() {\n    declare -A scan_seen\n    local home map_file rows\n    for home in "${HAPPY_HOMES[@]}"; do\n        [ -d "$home" ] || continue\n        map_file="$home/codex-mapping.json"\n        [ -f "$map_file" ] || continue\n        [ -s "$map_file" ] || continue\n\n        rows=$(MAP_FILE="$map_file" python3 -c "\nimport json, os, sys\nmap_file = os.environ[\'MAP_FILE\']\ntry:\n    data = json.load(open(map_file))\nexcept Exception:\n    sys.exit(0)\nfor e in data.get(\'entries\', []):\n    if e.get(\'state\') != \'bound\':\n        continue\n    if e.get(\'flavor\') != \'codex\':\n        continue\n    pid = e.get(\'pid\')\n    tid = e.get(\'codexThreadId\')\n    cwd = e.get(\'cwd\')\n    if not (pid and tid and cwd):\n        continue\n    try:\n        os.kill(int(pid), 0)\n    except Exception:\n        continue\n    print(f\'{tid}\\t{cwd}\\t{pid}\')\n" 2>/dev/null)\n        [ -z "$rows" ] && continue\n\n        while IFS=$\'\\t\' read -r tid _mapping_cwd _pid; do\n            [ -n "$tid" ] || continue\n            local rollout tid_cwd valid_tid valid_cwd key\n            rollout=$(find_codex_rollout "$tid" 2>/dev/null || true)\n            [ -n "$rollout" ] || continue\n            tid_cwd=$(_validate_codex_rollout "$rollout" 2>/dev/null) || continue\n            valid_tid="${tid_cwd%%:*}"\n            valid_cwd="${tid_cwd#*:}"\n            [ "$valid_tid" = "$tid" ] || continue\n            [ -d "$valid_cwd" ] || continue\n            key="$tid:$home"\n            [ -n "${scan_seen[$key]}" ] && continue\n            scan_seen[$key]=1\n            echo "$tid:$valid_cwd:$home"\n        done <<< "$rows"\n    done\n}\n'),
    ('restore_online_sessions', '# Refactor 20260515-085807 — enforces I1, I2. Replaces lines 1034-1212.\n# Scoped restore resolves homes before daemon waits and classifies flavor before session-file checks.\nrestore_online_sessions() {\n    # Acquire lock via mkdir (atomic, no fd inheritance)\n    if ! mkdir "$RESTORE_LOCK_DIR" 2>/dev/null; then\n        # Check if holding process is still alive (stale lock protection)\n        local lock_pid=""\n        [ -f "$RESTORE_LOCK_DIR/pid" ] && lock_pid=$(cat "$RESTORE_LOCK_DIR/pid" 2>/dev/null)\n        if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then\n            log "Restore already running (pid $lock_pid), skipping"\n            return 0\n        fi\n        # Stale lock — previous holder died without cleanup\n        log "Removing stale restore lock (old pid: ${lock_pid:-unknown})"\n        rm -rf "$RESTORE_LOCK_DIR"\n        mkdir "$RESTORE_LOCK_DIR" 2>/dev/null || { log "Restore lock contention, skipping"; return 0; }\n    fi\n    echo $$ > "$RESTORE_LOCK_DIR/pid"\n    trap \'rm -rf "$RESTORE_LOCK_DIR"\' EXIT\n\n    log "Starting session recovery..."\n\n    # Determine which homes to restore (scoped or global) before any daemon wait.\n    local homes_to_restore=("${HAPPY_HOMES[@]}")\n    if [ -n "$SCOPE_HOME" ]; then\n        local valid=0 h\n        for h in "${HAPPY_HOMES[@]}"; do\n            [ "$h" = "$SCOPE_HOME" ] && { valid=1; break; }\n        done\n        if [ "$valid" = "0" ]; then\n            log "ERROR: Unknown home directory: $SCOPE_HOME (not in HAPPY_HOMES)"\n            rm -rf "$RESTORE_LOCK_DIR"\n            trap - EXIT\n            return 1\n        fi\n        homes_to_restore=("$SCOPE_HOME")\n        log "Scoped restore: only processing $SCOPE_HOME"\n    fi\n\n    # Wait for at least one daemon in the requested restore scope.\n    local max_wait=30 waited=0\n    while [ $waited -lt $max_wait ]; do\n        for home in "${homes_to_restore[@]}"; do\n            local port\n            port=$(get_daemon_port "$home")\n            [ -n "$port" ] && break 2\n        done\n        sleep 2\n        waited=$((waited + 2))\n    done\n\n    if [ $waited -ge $max_wait ]; then\n        log "ERROR: No daemon found after ${max_wait}s for homes: ${homes_to_restore[*]}"\n        rm -rf "$RESTORE_LOCK_DIR"\n        trap - EXIT\n        return 1\n    fi\n    log "Daemon(s) available, starting restore for homes: ${homes_to_restore[*]}"\n\n    # Wait for the scoped happy-server URL before spawning sessions.\n    # In scoped mode this can only read the scoped daemon\'s HAPPY_SERVER_URL.\n    local server_url=""\n    for home in "${homes_to_restore[@]}"; do\n        local dpid\n        dpid=$(python3 -c "import json; print(json.load(open(\'$home/daemon.state.json\'))[\'pid\'])" 2>/dev/null)\n        [ -n "$dpid" ] && [ -d "/proc/$dpid" ] && {\n            server_url=$(tr \'\\0\' \'\\n\' < /proc/$dpid/environ 2>/dev/null | grep \'^HAPPY_SERVER_URL=\' | cut -d= -f2-)\n            [ -n "$server_url" ] && break\n        }\n    done\n\n    if [ -n "$server_url" ]; then\n        local sw=0 smax=60\n        log "Waiting for server at $server_url ..."\n        while [ $sw -lt $smax ]; do\n            if curl -sf -o /dev/null --connect-timeout 3 "$server_url/health" 2>/dev/null || \\\n               curl -sf -o /dev/null --connect-timeout 3 "$server_url/" 2>/dev/null; then\n                break\n            fi\n            sleep 3\n            sw=$((sw + 3))\n        done\n        if [ $sw -ge $smax ]; then\n            log "WARNING: Server not reachable after ${smax}s, proceeding anyway"\n        else\n            log "Server reachable after ${sw}s"\n        fi\n    fi\n\n    # Get already-running UUIDs (with home info for accurate per-home dedup)\n    local running_raw\n    running_raw=$(scan_running_sessions)\n\n    local total_restored=0 total_skipped=0 total_already=0 total_failed=0 grand_total=0\n    declare -A globally_spawned  # Cross-home UUID dedup: prevents spawning same session on multiple daemons\n\n    for home in "${homes_to_restore[@]}"; do\n        [ -d "$home" ] || continue\n        local port\n        port=$(get_daemon_port "$home")\n        [ -z "$port" ] && { log "Skip $home: daemon not running"; continue; }\n\n        # Read this home\'s session_dirs.txt\n        local saved=""\n        local file="$home/$SESSION_FILE"\n        if [ -f "$file" ]; then\n            saved=$(grep -v \'^#\' "$file" | grep -v \'^$\')\n        fi\n\n        # Fallback: peak JSON snapshot\n        if [ -z "$saved" ]; then\n            log "$home: session_dirs.txt empty, trying peak JSON snapshot..."\n            local peak_info\n            peak_info=$(find_peak_snapshot)\n            if [ -n "$peak_info" ]; then\n                local peak_file="${peak_info#*:}"\n                log "Using peak snapshot: $(basename "$peak_file")"\n                # Extract with home_dir, filter for this home, then strip to uuid:cwd\n                saved=$(jq -r \'.sessions[] | "\\(.claude_id):\\(.working_dir):\\(.home_dir // "")"\' "$peak_file" 2>/dev/null \\\n                    | filter_sessions_for_home "$home")\n            fi\n        fi\n\n        [ -z "$saved" ] && { log "$home: no sessions to restore"; continue; }\n\n        local home_total\n        home_total=$(echo "$saved" | wc -l)\n        grand_total=$((grand_total + home_total))\n        log "Restoring $home_total sessions for $home"\n\n        local running_home=""\n        [ -n "$running_raw" ] && running_home=$(echo "$running_raw" | filter_sessions_for_home "$home")\n\n        while IFS=: read -r uuid work_dir; do\n            [ -z "$uuid" ] && continue\n\n            # Cross-home dedup: skip if already spawned by a previous home iteration\n            if [ -n "${globally_spawned[$uuid]+x}" ]; then\n                total_already=$((total_already + 1))\n                continue\n            fi\n\n            if [ -n "$running_home" ] && echo "$running_home" | cut -d: -f1 | grep -Fxq "$uuid"; then\n                log "Already running $uuid in $home; not respawning"\n                globally_spawned[$uuid]=1\n                total_already=$((total_already + 1))\n                continue\n            fi\n\n            if [ ! -d "$work_dir" ]; then\n                log "Skip $uuid: dir $work_dir missing"\n                total_skipped=$((total_skipped + 1))\n                continue\n            fi\n\n            # Classify flavor before resolving/verifying the session file. Claude UUIDs and\n            # Codex thread IDs are both UUID-shaped; evidence, not shape, chooses the branch.\n            local restore_flavor="claude"\n            local session_file=""\n            if is_codex_thread_id "$uuid"; then\n                restore_flavor="codex"\n                session_file=$(find_codex_rollout "$uuid" 2>/dev/null || true)\n                if [ -z "$session_file" ] || ! _validate_codex_rollout "$session_file" >/dev/null 2>&1; then\n                    log "Skip $uuid: Codex rollout not found or invalid"\n                    total_skipped=$((total_skipped + 1))\n                    continue\n                fi\n            else\n                local project_encoded\n                project_encoded=$(echo "$work_dir" | sed \'s|/|-|g\')\n                session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"\n                if [ ! -f "$session_file" ]; then\n                    log "Skip $uuid: Claude .jsonl not found at $session_file"\n                    total_skipped=$((total_skipped + 1))\n                    continue\n                fi\n            fi\n\n            # Kill only THIS home\'s orphan process if running (prevent duplicate sessions)\n            local existing_pids\n            existing_pids=$(pgrep -f -- "--resume $uuid" 2>/dev/null || true)\n            if [ -n "$existing_pids" ]; then\n                while IFS= read -r existing_pid; do\n                    [ -z "$existing_pid" ] && continue\n                    [ -d "/proc/$existing_pid" ] || continue\n                    local existing_home=""\n                    existing_home=$(pid_to_happy_home "$existing_pid" 2>/dev/null || true)\n                    if [ -z "$existing_home" ]; then\n                        existing_home=$(tr \'\\0\' \'\\n\' < /proc/$existing_pid/environ 2>/dev/null | grep \'^HAPPY_HOME_DIR=\' | cut -d= -f2-)\n                        existing_home="${existing_home:-/root/.happy}"\n                    fi\n                    [ "$existing_home" = "$home" ] || continue\n                    kill "$existing_pid" 2>/dev/null || true\n                    log "Killed orphan for $uuid before respawn (pid=$existing_pid home=$home)"\n                done <<< "$existing_pids"\n                sleep 1\n            fi\n\n            log "Restoring $uuid (flavor=$restore_flavor) in $work_dir via $home"\n            if daemon_spawn_session "$home" "$work_dir" "$uuid" "$restore_flavor"; then\n                total_restored=$((total_restored + 1))\n                globally_spawned[$uuid]=1\n            else\n                total_failed=$((total_failed + 1))\n            fi\n            sleep 5  # 5s spacing prevents resource contention on mass spawn\n        done <<< "$saved"\n    done\n\n    log "Recovery: total=$grand_total running=$total_already restored=$total_restored skipped=$total_skipped failed=$total_failed"\n\n    # Release lock\n    rm -rf "$RESTORE_LOCK_DIR"\n    trap - EXIT\n}\n'),
    ('recover_session', '# Refactor 20260515-085807 — enforces I1, I3. Replaces lines 1216-1410.\n# Manual recovery now resolves the daemon home from saved snapshots or requires explicit --home.\nrecover_session() {\n    local uuid="$1"\n    local target_home=""\n    local flavor=""\n\n    # Parse args: pick out --home <path>, --flavor <name>, and positional working-dir\n    local pos_args=()\n    shift || true\n    while [ $# -gt 0 ]; do\n        case "$1" in\n            --home)\n                [ -n "${2:-}" ] || { echo "ERROR: --home requires a path"; return 1; }\n                target_home="$2"; shift 2 ;;\n            --flavor)\n                [ -n "${2:-}" ] || { echo "ERROR: --flavor requires claude or codex"; return 1; }\n                flavor="$2"; shift 2 ;;\n            *)\n                pos_args+=("$1"); shift ;;\n        esac\n    done\n    local manual_dir="${pos_args[0]:-}"\n\n    if [ -z "$uuid" ]; then\n        echo "Usage: $0 recover <session-id> [working-dir] [--home /root/.happy-jade] [--flavor claude|codex]"\n        echo ""\n        echo "Recent sessions from history:"\n        for home in "${HAPPY_HOMES[@]}"; do\n            local hf="$home/$HISTORY_FILE"\n            [ -f "$hf" ] || continue\n            python3 -c "\nimport json\nseen = {}\nfor line in reversed(open(\'$hf\').readlines()):\n    line = line.strip()\n    if not line: continue\n    try:\n        d = json.loads(line)\n        uid = d[\'id\']\n        if uid not in seen:\n            seen[uid] = d\n    except Exception:\n        pass\nfor uid, d in list(seen.items())[:20]:\n    mark = \'+\' if d[\'e\'] == \'add\' else \'-\'\n    print(f\\"  {d[\'id\']}  {d[\'dir\']}  ({d[\'t\']} {mark})\\")\n" 2>/dev/null\n            break\n        done\n        return 1\n    fi\n\n    case "$flavor" in\n        ""|claude|codex) ;;\n        *) echo "ERROR: --flavor must be claude or codex"; return 1 ;;\n    esac\n\n    # Auto-detect flavor from validated evidence if not explicitly set.\n    if [ -z "$flavor" ]; then\n        if is_codex_thread_id "$uuid"; then\n            flavor="codex"\n        else\n            flavor="claude"\n        fi\n    fi\n\n    # Validate explicit --home if supplied.\n    if [ -n "$target_home" ]; then\n        local known_home=0 h\n        for h in "${HAPPY_HOMES[@]}"; do\n            [ "$h" = "$target_home" ] && { known_home=1; break; }\n        done\n        [ "$known_home" = "1" ] || { echo "ERROR: unknown --home $target_home"; return 1; }\n    fi\n\n    # Check if already running.\n    local running\n    running=$(scan_running_sessions)\n    if [ -n "$running" ] && echo "$running" | cut -d: -f1 | grep -Fxq "$uuid"; then\n        echo "Session $uuid is already running"\n        return 0\n    fi\n\n    # Resolve target_home if omitted. We only trust per-home saved state\n    # (session_dirs.txt or JSON snapshots with home_dir), never HAPPY_HOMES order.\n    local work_dir=""\n    local session_file=""\n    [ -n "$manual_dir" ] && work_dir="$manual_dir"\n\n    if [ -z "$target_home" ]; then\n        declare -A inferred_dirs_by_home\n        local -a inferred_homes=()\n        local home\n\n        for home in "${HAPPY_HOMES[@]}"; do\n            local f="$home/$SESSION_FILE"\n            [ -f "$f" ] || continue\n            local hit_dir\n            hit_dir=$(awk -F: -v id="$uuid" \'$1 == id { sub("^[^:]*:", ""); print; exit }\' "$f" 2>/dev/null)\n            [ -n "$hit_dir" ] || continue\n            if [ -z "${inferred_dirs_by_home[$home]+x}" ]; then\n                inferred_homes+=("$home")\n            fi\n            inferred_dirs_by_home[$home]="$hit_dir"\n        done\n\n        for home in "${HAPPY_HOMES[@]}"; do\n            local dir="$home/$SNAPSHOT_DIR"\n            [ -d "$dir" ] || continue\n            while IFS=$\'\\t\' read -r snap_home snap_dir; do\n                [ -n "$snap_dir" ] || continue\n                snap_home="${snap_home:-/root/.happy}"\n                local valid_snap_home=0 h2\n                for h2 in "${HAPPY_HOMES[@]}"; do\n                    [ "$h2" = "$snap_home" ] && { valid_snap_home=1; break; }\n                done\n                [ "$valid_snap_home" = "1" ] || continue\n                if [ -z "${inferred_dirs_by_home[$snap_home]+x}" ]; then\n                    inferred_homes+=("$snap_home")\n                    inferred_dirs_by_home[$snap_home]="$snap_dir"\n                fi\n            done < <(find "$dir" -name "*.json" -type f -printf \'%T@ %p\\n\' 2>/dev/null \\\n                | sort -rn | head -20 | awk \'{print $2}\' | while read -r snap_file; do\n                    jq -r --arg id "$uuid" \'.sessions[]? | select(.claude_id == $id) | [(.home_dir // ""), .working_dir] | @tsv\' "$snap_file" 2>/dev/null\n                done)\n        done\n\n        if [ "${#inferred_homes[@]}" -eq 1 ]; then\n            target_home="${inferred_homes[0]}"\n            [ -z "$work_dir" ] && work_dir="${inferred_dirs_by_home[$target_home]}"\n            echo "Inferred --home $target_home from saved snapshot state"\n        elif [ "${#inferred_homes[@]}" -gt 1 ] && [ -n "$manual_dir" ]; then\n            local matched_home="" match_count=0 h3\n            for h3 in "${inferred_homes[@]}"; do\n                if [ "${inferred_dirs_by_home[$h3]}" = "$manual_dir" ]; then\n                    matched_home="$h3"\n                    match_count=$((match_count + 1))\n                fi\n            done\n            if [ "$match_count" -eq 1 ]; then\n                target_home="$matched_home"\n                echo "Inferred --home $target_home from saved snapshot state and manual working directory"\n            fi\n        fi\n\n        if [ -z "$target_home" ]; then\n            echo "ERROR: cannot infer --home for $uuid from per-home saved snapshots."\n            if [ "${#inferred_homes[@]}" -gt 1 ]; then\n                echo "Ambiguous homes found: ${inferred_homes[*]}"\n            fi\n            echo "Specify explicitly: $0 recover $uuid ${manual_dir:+$manual_dir }--home /root/.happy-dev"\n            return 1\n        fi\n    fi\n\n    # If work_dir is still missing, search only evidence associated with target_home.\n    if [ -z "$work_dir" ]; then\n        local f="$target_home/$SESSION_FILE"\n        if [ -f "$f" ]; then\n            work_dir=$(awk -F: -v id="$uuid" \'$1 == id { sub("^[^:]*:", ""); print; exit }\' "$f" 2>/dev/null)\n        fi\n    fi\n\n    if [ -z "$work_dir" ]; then\n        local dir="$target_home/$SNAPSHOT_DIR"\n        if [ -d "$dir" ]; then\n            work_dir=$(find "$dir" -name "*.json" -type f -printf \'%T@ %p\\n\' 2>/dev/null \\\n                | sort -rn | head -20 | awk \'{print $2}\' | while read -r snap_file; do\n                    jq -r --arg id "$uuid" --arg home "$target_home" \'.sessions[]? | select(.claude_id == $id) | select(((.home_dir // "/root/.happy") == $home)) | .working_dir\' "$snap_file" 2>/dev/null\n                done | head -1)\n        fi\n    fi\n\n    # History is only a working-directory hint after target_home is explicit/inferred.\n    if [ -z "$work_dir" ]; then\n        local hf="$target_home/$HISTORY_FILE"\n        if [ -f "$hf" ]; then\n            work_dir=$(python3 -c "\nimport json\nfor line in reversed(open(\'$hf\').readlines()):\n    line = line.strip()\n    if not line: continue\n    try:\n        d = json.loads(line)\n        if d.get(\'id\') == \'$uuid\':\n            print(d.get(\'dir\', \'\'))\n            break\n    except Exception:\n        pass\n" 2>/dev/null)\n        fi\n    fi\n\n    # Scan project dirs only for Claude. Codex uses rollout metadata below.\n    if [ -z "$work_dir" ] && [ "$flavor" = "claude" ]; then\n        local found_file\n        found_file=$(find "$CLAUDE_PROJECTS_DIR" -maxdepth 2 -name "$uuid.jsonl" -print -quit 2>/dev/null)\n        if [ -n "$found_file" ]; then\n            local encoded_name\n            encoded_name=$(basename "$(dirname "$found_file")")\n            for candidate in /root /root/*/; do\n                candidate="${candidate%/}"\n                local candidate_encoded\n                candidate_encoded=$(echo "$candidate" | sed \'s|/|-|g\')\n                if [ "$candidate_encoded" = "$encoded_name" ]; then\n                    work_dir="$candidate"\n                    break\n                fi\n            done\n            [ -z "$work_dir" ] && work_dir="/root"\n        fi\n    fi\n\n    # Codex rollout session_meta.payload.cwd is authoritative for codex work_dir.\n    if [ "$flavor" = "codex" ]; then\n        session_file=$(find_codex_rollout "$uuid" 2>/dev/null || true)\n        if [ -z "$session_file" ] || ! _validate_codex_rollout "$session_file" >/dev/null 2>&1; then\n            echo "Codex rollout not found or invalid for thread-id: $uuid"\n            echo "Looked under: $CODEX_SESSIONS_DIR/YYYY/MM/DD/rollout-*-${uuid}.jsonl"\n            return 1\n        fi\n        [ -z "$work_dir" ] && work_dir=$(head -n 1 "$session_file" \\\n            | jq -r \'select(.type == "session_meta") | .payload.cwd // empty\' 2>/dev/null)\n    fi\n\n    if [ -z "$work_dir" ]; then\n        echo "Cannot find working directory for session $uuid"\n        echo "Specify manually: $0 recover $uuid /path/to/dir --home $target_home"\n        return 1\n    fi\n\n    if [ ! -d "$work_dir" ]; then\n        echo "Working directory does not exist: $work_dir"\n        return 1\n    fi\n\n    if [ "$flavor" = "claude" ]; then\n        local project_encoded\n        project_encoded=$(echo "$work_dir" | sed \'s|/|-|g\')\n        session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"\n        if [ ! -f "$session_file" ]; then\n            echo "Session file not found: $session_file"\n            return 1\n        fi\n    fi\n\n    local port\n    port=$(get_daemon_port "$target_home")\n    if [ -z "$port" ]; then\n        echo "No running daemon found for target home: $target_home"\n        return 1\n    fi\n\n    echo "Recovering session:"\n    echo "  ID:     $uuid"\n    echo "  Flavor: $flavor"\n    echo "  Dir:    $work_dir"\n    echo "  Home:   $target_home"\n    echo "  File:   $session_file ($(du -h "$session_file" | cut -f1))"\n    echo ""\n\n    if daemon_spawn_session "$target_home" "$work_dir" "$uuid" "$flavor"; then\n        echo "Session recovered on $target_home"\n        echo "Session recovered successfully"\n    else\n        echo "Failed to recover on $target_home"\n        return 1\n    fi\n}\n'),
    ('restart_daemon', '# Refactor 20260515-085807 — enforces I2, I4. Replaces lines 1515-1591.\n# Restart kill targets are derived from restartable homes only; no global orphan kill remains.\nrestart_daemon() {\n    log "=== Daemon Restart (scope-safe peak recovery) ==="\n\n    local dry_run="${HAPPY_RECOVERY_DRY_RUN:-0}"\n    local -a restart_homes=()\n    local -a restart_services=()\n    local home service\n\n    _restart_service_for_home() {\n        local _home="$1"\n        if [ -f "$_home/restart.service" ]; then\n            head -n 1 "$_home/restart.service" 2>/dev/null\n            return 0\n        fi\n        case "$_home" in\n            /root/.happy)        echo "happy-daemon" ;;\n            /root/.happy-jade)   echo "happy-daemon-jade" ;;\n            /root/.happy-dev)    echo "happy-daemon-dev" ;;\n            /root/.happy-qijie)  echo "happy-daemon-qijie" ;;\n            *)                   return 1 ;;\n        esac\n    }\n\n    _home_in_restart_set() {\n        local _needle="$1" _h\n        for _h in "${restart_homes[@]}"; do\n            [ "$_h" = "$_needle" ] && return 0\n        done\n        return 1\n    }\n\n    # Build the restart set first. A home without a service mapping or installed\n    # systemd unit is not killed, because this function cannot restart it.\n    for home in "${HAPPY_HOMES[@]}"; do\n        [ -n "$SCOPE_HOME" ] && [ "$home" != "$SCOPE_HOME" ] && continue\n        [ -d "$home" ] || continue\n        service=$(_restart_service_for_home "$home" 2>/dev/null || true)\n        if [ -z "$service" ]; then\n            log "Skip $home: no restart service mapping; refusing to kill it"\n            continue\n        fi\n        if [ "$dry_run" != "1" ]; then\n            if ! systemctl list-unit-files "${service}.service" >/dev/null 2>&1 && \\\n               [ ! -f "/etc/systemd/system/${service}.service" ]; then\n                log "Skip $home: ${service}.service is not installed; refusing to kill it"\n                continue\n            fi\n        fi\n        restart_homes+=("$home")\n        restart_services+=("$service")\n    done\n\n    if [ -n "$SCOPE_HOME" ] && [ "${#restart_homes[@]}" -eq 0 ]; then\n        log "ERROR: scoped restart requested for $SCOPE_HOME, but it is not restartable"\n        return 1\n    fi\n    if [ "${#restart_homes[@]}" -eq 0 ]; then\n        log "ERROR: no restartable homes found; refusing to kill anything"\n        return 1\n    fi\n\n    log "Restart scope homes: ${restart_homes[*]}"\n    [ "$dry_run" = "1" ] && log "DRY-RUN: no processes will be killed and no services will be started"\n\n    # Step 1: find peak snapshot BEFORE killing anything.\n    local peak_info\n    peak_info=$(find_peak_snapshot)\n\n    # Step 2: kill daemon main PIDs only for homes in the restart set.\n    for home in "${restart_homes[@]}"; do\n        local dpid=""\n        local pid_file="$home/daemon.pid"\n        if [ -f "$pid_file" ]; then\n            dpid=$(cat "$pid_file" 2>/dev/null)\n        fi\n        if [ -z "$dpid" ] && [ -f "$home/daemon.state.json" ]; then\n            dpid=$(python3 -c "import json; print(json.load(open(\'$home/daemon.state.json\')).get(\'pid\',\'\'))" 2>/dev/null)\n        fi\n        if [ -n "$dpid" ] && [ -d "/proc/$dpid" ]; then\n            if [ "$dry_run" = "1" ]; then\n                log "DRY-RUN would kill daemon PID $dpid ($home)"\n            else\n                log "Killing daemon PID $dpid ($home)"\n                kill "$dpid" 2>/dev/null || true\n            fi\n        fi\n    done\n\n    # Step 3: reset failed state only for services in the restart set.\n    local idx\n    for idx in "${!restart_services[@]}"; do\n        service="${restart_services[$idx]}"\n        if [ "$dry_run" = "1" ]; then\n            log "DRY-RUN would reset-failed ${service}.service"\n        else\n            systemctl reset-failed "$service" 2>/dev/null || true\n        fi\n    done\n    [ "$dry_run" = "1" ] || sleep 2\n\n    # Step 4: kill only happy child processes owned by homes in the restart set.\n    log "Killing happy child processes only for restart scope..."\n    local own_ppids\n    own_ppids="$$ $(ps -o ppid= -p $$ 2>/dev/null | tr -d \' \')"\n    local pid\n    for pid in $(pgrep -f \'happy-coder|happy-cli\' 2>/dev/null || true); do\n        [ -d "/proc/$pid" ] || continue\n        echo "$own_ppids" | grep -qw "$pid" && continue\n        local owned_home=""\n        owned_home=$(pid_to_happy_home "$pid" 2>/dev/null || true)\n        if [ -z "$owned_home" ]; then\n            owned_home=$(tr \'\\0\' \'\\n\' < /proc/$pid/environ 2>/dev/null | grep \'^HAPPY_HOME_DIR=\' | cut -d= -f2-)\n            owned_home="${owned_home:-/root/.happy}"\n        fi\n        _home_in_restart_set "$owned_home" || continue\n        local cmd\n        cmd=$(tr \'\\0\' \' \' < /proc/$pid/cmdline 2>/dev/null)\n        if [ "$dry_run" = "1" ]; then\n            log "DRY-RUN would kill child PID $pid home=$owned_home cmd=${cmd:0:80}"\n        else\n            log "Killing child PID $pid home=$owned_home cmd=${cmd:0:80}"\n            kill "$pid" 2>/dev/null || true\n        fi\n    done\n    [ "$dry_run" = "1" ] || sleep 2\n\n    # Step 5: write peak snapshot only to homes in the restart set.\n    if [ -n "$peak_info" ]; then\n        local peak_count="${peak_info%%:*}"\n        local peak_file="${peak_info#*:}"\n        log "Peak snapshot: $(basename "$peak_file") ($peak_count sessions)"\n        local peak_sessions\n        peak_sessions=$(jq -r \'.sessions[] | "\\(.claude_id):\\(.working_dir):\\(.home_dir // "")"\' "$peak_file" 2>/dev/null)\n        if [ -n "$peak_sessions" ]; then\n            for home in "${restart_homes[@]}"; do\n                local filtered home_count\n                filtered=$(echo "$peak_sessions" | filter_sessions_for_home "$home")\n                home_count=0\n                [ -n "$filtered" ] && home_count=$(echo "$filtered" | wc -l)\n                if [ "$dry_run" = "1" ]; then\n                    log "DRY-RUN would write $home_count peak sessions to $home/$SESSION_FILE"\n                else\n                    {\n                        echo "# Happy Session Snapshot - $(date \'+%Y-%m-%d %H:%M:%S\')"\n                        echo "# Format: claude_uuid:working_dir"\n                        echo "# Count: $home_count"\n                        [ -n "$filtered" ] && echo "$filtered"\n                    } > "$home/$SESSION_FILE.tmp"\n                    mv "$home/$SESSION_FILE.tmp" "$home/$SESSION_FILE"\n                fi\n            done\n        fi\n    else\n        log "No peak snapshot found within ${PEAK_PROTECT_SECONDS}s — will restore from existing session_dirs.txt"\n    fi\n\n    # Step 6: start exactly the services in the restart set.\n    for idx in "${!restart_services[@]}"; do\n        home="${restart_homes[$idx]}"\n        service="${restart_services[$idx]}"\n        if [ "$dry_run" = "1" ]; then\n            log "DRY-RUN would start ${service}.service for $home"\n        else\n            log "Starting ${service}.service for $home..."\n            systemctl start "$service" 2>&1 || log "WARNING: systemctl start $service failed"\n        fi\n    done\n\n    # Step 7: wait for each restarted daemon, then run restore scoped per home.\n    if [ "$dry_run" = "1" ]; then\n        for home in "${restart_homes[@]}"; do\n            log "DRY-RUN would wait for daemon and restore --home $home"\n        done\n        log "=== Restart dry-run complete ==="\n        return 0\n    fi\n\n    for home in "${restart_homes[@]}"; do\n        log "Waiting for daemon to be ready: $home"\n        local waited=0\n        while [ $waited -lt 30 ]; do\n            local port\n            port=$(get_daemon_port "$home" 2>/dev/null)\n            [ -n "$port" ] && break\n            sleep 2\n            waited=$((waited + 2))\n        done\n        if [ $waited -ge 30 ]; then\n            log "WARNING: daemon not ready after 30s: $home"\n        fi\n    done\n\n    local old_scope="$SCOPE_HOME"\n    for home in "${restart_homes[@]}"; do\n        SCOPE_HOME="$home"\n        restore_online_sessions\n    done\n    SCOPE_HOME="$old_scope"\n\n    log "=== Restart complete ==="\n}\n')
]

old_usage = '        echo "Usage: $0 {save|watch|restore|restart|recover|check|history|snapshots}"\n        echo ""\n        echo "  save                - Save snapshot now (called by ExecStartPre)"\n        echo "  watch               - Continuous monitoring (every ${POLL_INTERVAL}s)"\n        echo "  restore             - Restore all saved sessions via daemon"\n        echo "  restart             - Kill daemon+orphans, start fresh, restore from peak snapshot"\n        echo "  recover <id>                      - Recover one session (flavor auto-detected from id)"\n        echo "  recover <id> <dir>                - Recover with manual working directory"\n        echo "  recover <id> --home <path>        - Recover on specific daemon (e.g. /root/.happy-jade)"\n        echo "  recover <id> --flavor codex       - Force codex flavor (auto for 019d...-prefixed ids)"\n        echo "  recover <id> <dir> --home <path>  - Overrides combined"\n        echo "  check               - Show saved vs running"\n        echo "  history [N]         - Show last N change events (default 30)"\n        echo "  snapshots [hours]   - Show JSON snapshots (default 24h)"\n'
new_usage = '        echo "Usage: $0 {save|watch|restore|restart|recover|check|history|snapshots}"\n        echo ""\n        echo "  save                - Save snapshot now (called by ExecStartPre)"\n        echo "  watch               - Continuous monitoring (every ${POLL_INTERVAL}s)"\n        echo "  restore             - Restore all saved sessions via daemon"\n        echo "  restart             - Restart only daemon homes that this script can also start"\n        echo "  recover <id>                      - Recover one session (flavor auto-detected from validated rollout evidence)"\n        echo "  recover <id> <dir>                - Recover with manual working directory"\n        echo "  recover <id> --home <path>        - Recover on specific daemon (e.g. /root/.happy-jade)"\n        echo "  recover <id> --flavor codex       - Force codex flavor (auto-detected via local Codex rollout validation)"\n        echo "  recover <id> <dir> --home <path>  - Overrides combined"\n        echo "  check               - Show saved vs running"\n        echo "  history [N]         - Show last N change events (default 30)"\n        echo "  snapshots [hours]   - Show JSON snapshots (default 24h)"\n'

def replace_function(text, name, new):
    pattern = re.compile(r'(?ms)^' + re.escape(name) + r'\(\) \{\n.*?^\}\n')
    match = pattern.search(text)
    if not match:
        raise SystemExit(f'ANCHOR MISS: function {name} not found')
    old = match.group(0)
    if text.count(old) != 1:
        raise SystemExit(f'ANCHOR AMBIGUOUS: function {name} matched {text.count(old)} times')
    return text.replace(old, new, 1)

def replace_literal(text, label, old, new):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'ANCHOR {"MISS" if count == 0 else "AMBIGUOUS"}: {label} matched {count} times')
    return text.replace(old, new, 1)

for name, new in function_replacements:
    src = replace_function(src, name, new)
src = replace_literal(src, 'usage/help text block', old_usage, new_usage)

st = os.stat(path)
tmp = f"{path}.tmp-refactor-20260515-085807-{os.getpid()}"
with open(tmp, 'w') as f:
    f.write(src)
os.chmod(tmp, stat.S_IMODE(st.st_mode))
try:
    result = subprocess.run(['bash', '-n', tmp], text=True, capture_output=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit('bash -n failed; live file not modified')
    os.replace(tmp, path)
except Exception:
    try:
        os.unlink(tmp)
    except FileNotFoundError:
        pass
    raise
print(f'OK refactor 20260515-085807 applied atomically; backup={backup}; functions=5; usage_blocks=1')
PY
```

## 4. Smoke tests

These tests run only against temporary state. They do not write `/root/bin`, do not call live daemon HTTP APIs, and set `HAPPY_RECOVERY_DRY_RUN=1` for restart behavior.

```bash
# Paste into a shell after applying the refactor. It sources only the function section
# of SCRIPT_UNDER_TEST, then overrides all paths to temporary state.
SCRIPT_UNDER_TEST=${SCRIPT_UNDER_TEST:-/root/bin/happy-session-recovery.sh}

_load_recovery_functions_for_smoke() {
    local harness="$1/functions.sh"
    sed '/^case "${1:-}" in/,$d' "$SCRIPT_UNDER_TEST" > "$harness"
    # shellcheck disable=SC1090
    source "$harness"
}

smoke_test_codex_classifier() {
    local tmp
    tmp=$(mktemp -d /tmp/recovery-refactor-classifier-XXXXXX)
    (
        set -euo pipefail
        _load_recovery_functions_for_smoke "$tmp"
        CODEX_SESSIONS_DIR=/tmp/codex-test-sessions
        rm -rf "$CODEX_SESSIONS_DIR"
        mkdir -p "$CODEX_SESSIONS_DIR/2026/05/15" "$tmp/work"

        local claude_ids=(
            11111111-1111-4111-8111-111111111111
            22222222-2222-4222-8222-222222222222
            33333333-3333-4333-8333-333333333333
            44444444-4444-4444-8444-444444444444
            55555555-5555-4555-8555-555555555555
        )
        local codex_ids=(
            aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
            bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
            cccccccc-cccc-4ccc-8ccc-cccccccccccc
            dddddddd-dddd-4ddd-8ddd-dddddddddddd
            eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
        )

        local id i=0 cwd file
        for id in "${codex_ids[@]}"; do
            i=$((i + 1))
            cwd="$tmp/work/codex-$i"
            mkdir -p "$cwd"
            file="$CODEX_SESSIONS_DIR/2026/05/15/rollout-2026-05-15T08-58-07-${id}.jsonl"
            printf '{"type":"session_meta","payload":{"id":"%s","cwd":"%s","source":{}}}\n' "$id" "$cwd" > "$file"
        done

        for id in "${codex_ids[@]}"; do
            is_codex_thread_id "$id" || { echo "FAIL codex not detected: $id"; exit 1; }
        done
        for id in "${claude_ids[@]}"; do
            if is_codex_thread_id "$id"; then
                echo "FAIL claude misclassified as codex: $id"
                exit 1
            fi
        done
        echo "PASS classifier evidence test"
    )
    local rc=$?
    rm -rf "$tmp" /tmp/codex-test-sessions
    return $rc
}

smoke_test_scoped_restore_server_url() {
    local tmp
    tmp=$(mktemp -d /tmp/recovery-refactor-restore-XXXXXX)
    local pids=()
    cleanup() { kill "${pids[@]}" 2>/dev/null || true; rm -rf "$tmp"; }
    trap cleanup RETURN
    (
        set -euo pipefail
        _load_recovery_functions_for_smoke "$tmp"
        LOG_FILE="$tmp/recovery.log"
        RESTORE_LOCK_DIR="$tmp/restore.lockdir"
        SESSION_FILE=session_dirs.txt
        SNAPSHOT_DIR=session_backup_history
        local h_prod="$tmp/home-prod" h_dev="$tmp/home-dev" h_jade="$tmp/home-jade"
        mkdir -p "$h_prod" "$h_dev" "$h_jade"
        HAPPY_HOMES=("$h_prod" "$h_dev" "$h_jade")

        env HAPPY_SERVER_URL=http://prod.example sleep 120 & local p_prod=$!; pids+=("$p_prod")
        env HAPPY_SERVER_URL=http://dev.example sleep 120 & local p_dev=$!; pids+=("$p_dev")
        env HAPPY_SERVER_URL=http://jade.example sleep 120 & local p_jade=$!; pids+=("$p_jade")
        printf '{"pid":%s,"httpPort":4101}\n' "$p_prod" > "$h_prod/daemon.state.json"
        printf '{"pid":%s,"httpPort":4102}\n' "$p_dev" > "$h_dev/daemon.state.json"
        printf '{"pid":%s,"httpPort":4103}\n' "$p_jade" > "$h_jade/daemon.state.json"
        : > "$h_dev/$SESSION_FILE"

        scan_running_sessions() { :; }
        find_peak_snapshot() { :; }
        daemon_spawn_session() { echo "unexpected spawn"; return 1; }

        mkdir -p "$tmp/bin"
        cat > "$tmp/bin/curl" <<'SH'
#!/bin/sh
echo "$@" >> "$SMOKE_CURL_LOG"
exit 0
SH
        chmod +x "$tmp/bin/curl"
        export SMOKE_CURL_LOG="$tmp/curl.log"
        PATH="$tmp/bin:$PATH"

        SCOPE_HOME="$h_dev"
        restore_online_sessions

        grep -q 'http://dev.example/health' "$SMOKE_CURL_LOG" || { echo "FAIL scoped restore did not check dev URL"; exit 1; }
        ! grep -q 'http://prod.example' "$SMOKE_CURL_LOG" || { echo "FAIL scoped restore leaked prod URL"; exit 1; }
        ! grep -q 'http://jade.example' "$SMOKE_CURL_LOG" || { echo "FAIL scoped restore leaked jade URL"; exit 1; }
        echo "PASS scoped restore URL test"
    )
}

smoke_test_restart_daemon_dry_run_scope() {
    local tmp
    tmp=$(mktemp -d /tmp/recovery-refactor-restart-XXXXXX)
    local pids=()
    cleanup() { kill "${pids[@]}" 2>/dev/null || true; rm -rf "$tmp"; }
    trap cleanup RETURN
    (
        set -euo pipefail
        _load_recovery_functions_for_smoke "$tmp"
        LOG_FILE="$tmp/restart.log"
        SESSION_FILE=session_dirs.txt
        SNAPSHOT_DIR=session_backup_history
        PEAK_PROTECT_SECONDS=28800
        local h1="$tmp/restartable-a" h2="$tmp/restartable-b" h3="$tmp/unrestartable"
        mkdir -p "$h1" "$h2" "$h3"
        echo smoke-a > "$h1/restart.service"
        echo smoke-b > "$h2/restart.service"
        HAPPY_HOMES=("$h1" "$h2" "$h3")

        env HAPPY_HOME_DIR="$h1" bash -c 'exec -a happy-daemon sleep 120' & local d1=$!; pids+=("$d1")
        env HAPPY_HOME_DIR="$h2" bash -c 'exec -a happy-daemon sleep 120' & local d2=$!; pids+=("$d2")
        env HAPPY_HOME_DIR="$h3" bash -c 'exec -a happy-daemon sleep 120' & local d3=$!; pids+=("$d3")
        echo "$d1" > "$h1/daemon.pid"
        echo "$d2" > "$h2/daemon.pid"
        echo "$d3" > "$h3/daemon.pid"

        env HAPPY_HOME_DIR="$h1" bash -c 'exec -a happy-cli sleep 120' & local c1=$!; pids+=("$c1")
        env HAPPY_HOME_DIR="$h2" bash -c 'exec -a happy-cli sleep 120' & local c2=$!; pids+=("$c2")
        env HAPPY_HOME_DIR="$h3" bash -c 'exec -a happy-cli sleep 120' & local c3=$!; pids+=("$c3")

        pid_to_happy_home() { return 1; }
        find_peak_snapshot() { return 1; }
        HAPPY_RECOVERY_DRY_RUN=1 restart_daemon

        grep -q "DRY-RUN would kill daemon PID $d1 ($h1)" "$LOG_FILE" || { echo "FAIL dry-run did not target restartable daemon A"; exit 1; }
        grep -q "DRY-RUN would kill daemon PID $d2 ($h2)" "$LOG_FILE" || { echo "FAIL dry-run did not target restartable daemon B"; exit 1; }
        grep -q "DRY-RUN would kill child PID $c1 home=$h1" "$LOG_FILE" || { echo "FAIL dry-run did not target restartable child A"; exit 1; }
        grep -q "DRY-RUN would kill child PID $c2 home=$h2" "$LOG_FILE" || { echo "FAIL dry-run did not target restartable child B"; exit 1; }
        ! grep -q "$d3\|$c3" "$LOG_FILE" || { echo "FAIL dry-run targeted unrestartable home"; exit 1; }
        echo "PASS restart dry-run scope test"
    )
}

run_recovery_refactor_smoke_tests() {
    smoke_test_codex_classifier
    smoke_test_scoped_restore_server_url
    smoke_test_restart_daemon_dry_run_scope
}

```

## 5. Risk register

- **R1:** Anchor drift if `/root/bin/happy-session-recovery.sh` changes before application; mitigation: the heredoc refuses missing/ambiguous anchors and leaves the backup plus live file untouched.
- **R2:** Function-name or main-case refactors could leave callers expecting old behavior; mitigation: replacement preserves existing function names and only changes the usage echo block outside functions.
- **R3:** `restart_daemon` default semantics become stricter: homes without an installed/mapped restart service are skipped instead of killed; mitigation: logs explicitly list `restart_homes` and dry-run mode shows the kill/start set first.
- **R4:** Rollout validation can false-negative old or corrupted Codex rollouts because `find_codex_rollout` still honors the existing 14-day mtime window; mitigation: false-negative skips are safer than false-positive Codex spawns for Claude UUIDs.
- **R5:** Performance cost from mapping scan validation walking `$CODEX_SESSIONS_DIR`; mitigation: mapping rows are filtered to live bound PIDs first, and existing `find_codex_rollout` keeps the search bounded by mtime/depth.
- **R6:** Bash portability risk from associative arrays and process substitution; mitigation: the original script already requires Bash and uses these features, and `bash -n` is mandatory before atomic replacement.
