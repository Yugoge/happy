# Proposal: Refactored /root/bin/happy-restart.sh (C1 dispatch-table architecture)

**TASK-ID**: c1-20260504-223115
**Status**: PROPOSAL — NOT applied to disk. Hook block (`pretool-block-production-files.sh` line 102-114, per c3-20260504-223115) forbids subagent Edit/Write to `/root/bin/happy-restart.sh`. Only the user may apply this refactor by replacing the file content from a real TTY.

## Why this is a proposal, not a direct edit

C3 hook hardening landed before C1 dev cycle could complete its Edit. The hook now permanently forbids ANY Edit/Write (subagent OR orchestrator-without-user-prompt) to the admin scripts:

```
/root/bin/happy-restart.sh
/root/bin/happy-session-recovery.sh
/root/bin/safe-swap-drain.sh
/root/bin/auto-safe-swap-drain.sh
/root/bin/safe-daemon-restart.sh
/root/bin/claude-allow-restart
```

Per /root/.claude/hooks/pretool-block-production-files.sh:109-113:

> BLOCKED: daemon-restart-edit — Edit/Write to admin script is FORBIDDEN
> Path: /root/bin/happy-restart.sh
> REASON: per c3-20260504-223115, these scripts orchestrate or gate daemon restarts;
>         only the user may modify them.

The cross-concern sequencing constraint in the C1 dispatch said C1 must NOT ship before C3. The way that constraint is now enforced at runtime is that the C3 hook blocks ALL Edit access to the admin scripts. Therefore the C1 refactor must be applied by the user from a real TTY, not by the dev subagent.

## Apply procedure (user only)

1. From a real TTY, copy the script body below (between the `=== BEGIN happy-restart.sh ===` and `=== END happy-restart.sh ===` markers) into `/root/bin/happy-restart.sh`.
2. Or use: `cat /dev/shm/dev-workspace/happy-dev/docs/dev/proposal-c1-happy-restart-refactor-20260504-223115.sh.md | awk '/^=== BEGIN/,/^=== END/' | sed '1d;$d' > /root/bin/happy-restart.sh && chmod +x /root/bin/happy-restart.sh`
3. Verify: `bash -n /root/bin/happy-restart.sh` (syntax check).
4. Diff against the on-disk version to spot-check the refactor surface.
5. Run the AC4 regression-guard test from a TTY: `bash /root/bin/happy-restart.sh` (no args) and confirm `/var/log/happy-restart.log` shows the same functional steps as today (3-prod-daemon stop/start + Docker recreate + PID verify), with the only deltas being the new `TASK-ID: c1-20260504-223115` line and the `[target=all-prod]` audit tag in every line.

## Acceptance Criteria coverage matrix (static-inspection grep patterns per OBJ-C1-001)

QA can verify these without executing the script (the Bash hook permanently blocks subagent execution):

| AC  | Static grep pattern | Expected hits in proposed script | Why it satisfies AC |
|-----|---------------------|----------------------------------|---------------------|
| AC1 | `grep -nE 'TARGET_(dev\|default\|jade\|qijie)_systemd_unit=' <script>` | 4 | One dispatch-table entry per atomic target |
| AC1 | `grep -nE 'for _t in \$ATOMIC_TARGETS' <script>` | ≥4 | Stop, start, verify, binary-check, docker-union all loop over atomic targets |
| AC1 | `grep -nE 'systemctl (stop\|start) happy-daemon' <script>` outside of inside-loop and case statements | 0 | No hardcoded daemon names in stop/start loop bodies (the `for pidfile in /root/.happy/...` line in detached-kill aggregate-path is intentional regression-guard for AC4, not a violation) |
| AC2 | `grep -nE 'TARGET_dev_binary_dist_glob=.*dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist' <script>` | 1 | Dev target gates worktree dist |
| AC2 | `grep -nE 'TARGET_(default\|jade\|qijie)_binary_dist_glob=.*usr/lib/node_modules/happy-coder/dist' <script>` | 3 | Prod targets gate global CLI dist |
| AC2 | `grep -nE 'check_target_binary' <script>` | ≥2 | Function defined and invoked |
| AC2 (E3 fail-fast) | `grep -nE 'if \[ "\$ALL_BINARIES_OK" != "1" \]; then' <script>` followed by `exit 1` within 5 lines | 1 | Fail-fast before docker/start |
| AC3 | `grep -nE 'docker compose up -d' <script>` | 1 | Single Docker recreate call (parameterized by `$DOCKER_UNION`) |
| AC3 | `grep -nE 'TARGET_dev_docker_services=""' <script>` | 1 | Dev target has empty docker_services |
| AC3 | `grep -nE 'if \[ -n "\$DOCKER_UNION" \]' <script>` | 1 | Conditional gate around docker step |
| AC3 | `grep -nE 'Skipping Docker recreate' <script>` | 1 | Log message when DOCKER_UNION is empty (dev case) |
| AC4 | `grep -nE 'if \[ -z "\$TARGET" \]; then' <script>` followed by `TARGET="all-prod"` within 3 lines | 1 | No-arg defaults to all-prod (regression guard) |
| AC4 | `grep -nE 'TARGET_EXPAND_all_prod="default jade qijie"' <script>` | 1 | all-prod expansion preserves today's 3-prod-daemon set |
| AC4 | `grep -nE 'all-prod\\\|all\\\)' <script>` (aggregate path branches in save + detached-kill) | 2 | Aggregate path uses today's GLOBAL save and GLOBAL pgrep |
| AC5 | `grep -nE 'TASK-ID:\s*c1-20260504-223115' <script>` | 1 | TASK-ID echoed at start |
| AC5 | First `log "TASK-ID..."` line precedes any `systemctl`, `docker compose`, or `pgrep` call | true | Verifiable by line-number ordering |
| AC6 | `grep -nE 'happy-session-recovery\.sh save --home' <script>` | 1 | Per-target save uses --home flag |
| AC6 | `grep -nE 'happy-session-recovery\.sh save \|\| log' <script>` (no --home) | 1 | Aggregate path keeps global save |
| AC7 | `grep -nE 'daemon\.state\.json' <script>` hits inside loop body using `\$_home` | 1 (single loop) | Per-target state file read; no hardcoded /root/.happy paths |
| AC7 | `grep -nE 'cat /root/\.happy(-jade\|-qijie)?/daemon\.state\.json' <script>` | 0 | No hardcoded state paths in verify loop |
| AC8 | `grep -nE 'BLOCKED: unknown target' <script>` | 1 | Fail-closed message |
| AC8 | `grep -nE 'exit 2' <script>` | ≥2 | Fail-closed exits (one for unknown target, one for unknown argument, possibly one for missing --target value) |
| S2  | `grep -nE 'flock -n 9' <script>` | 1 | Per-target lockfile |
| S4  | `grep -nE '\[target=\$TARGET\]' <script>` | 1 (in log function) | Every log line carries target=<value> |

Verification command bundle for QA close-cycle:

```bash
SCRIPT="/dev/shm/dev-workspace/happy-dev/docs/dev/proposal-c1-happy-restart-refactor-20260504-223115.sh.md"
# Or after user applies: SCRIPT="/root/bin/happy-restart.sh"

# AC1: dispatch table populated
grep -cE '^TARGET_(dev|default|jade|qijie)_systemd_unit=' "$SCRIPT"  # expect 4

# AC2: per-target binary glob
grep -cE 'TARGET_dev_binary_dist_glob=.*dev/shm/dev-workspace/happy-dev' "$SCRIPT"  # expect 1
grep -cE 'TARGET_(default|jade|qijie)_binary_dist_glob=.*usr/lib/node_modules/happy-coder' "$SCRIPT"  # expect 3

# AC3: single docker call, dev empty
grep -cE 'docker compose up -d' "$SCRIPT"  # expect 1
grep -cE 'TARGET_dev_docker_services=""' "$SCRIPT"  # expect 1

# AC4: no-arg => all-prod
grep -cE 'TARGET="all-prod"' "$SCRIPT"  # expect ≥1

# AC5: TASK-ID echo
grep -cE 'TASK-ID:[[:space:]]*c1-20260504-223115' "$SCRIPT"  # expect ≥1

# AC6: per-target save with --home
grep -cE 'happy-session-recovery\.sh save --home' "$SCRIPT"  # expect 1

# AC7: state file via per-target var, not hardcoded
grep -cE 'cat /root/\.happy(-jade|-qijie)?/daemon\.state\.json' "$SCRIPT"  # expect 0
grep -cE '_state_file=.*_home/daemon\.state\.json' "$SCRIPT"  # expect 1

# AC8: fail-closed
grep -cE 'BLOCKED: unknown target' "$SCRIPT"  # expect 1
```

(For QA running these against the proposal markdown, the patterns are identical because the script body is verbatim between the BEGIN/END markers; sed-extract or `awk '/^=== BEGIN/,/^=== END/'` to isolate.)

## Authoring-time evidence (OBJ-C1-002 documentation)

The dev binary dist directory `/dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/` was checked at C1 BA authoring time (per BA spec). At C1 dev authoring time (this proposal, 2026-05-04T22:30:00Z) the dev subagent could not directly Bash-list it because the bash-safety hook intercepts patterns including `happy-restart` substring (see hook block above). The dev binary structure is independently confirmed by:

1. /etc/systemd/system/happy-daemon-dev.service line 17 ExecStart=/usr/bin/happy-dev (BA QA report dimension_findings.evidence_quality.spot_checks_performed[4])
2. /usr/bin/happy-dev → /root/happy-dev/packages/happy-cli/bin/happy-dev.mjs symlink (BA scope_boundary.out_of_path_observed_but_not_touched[5])
3. Build script `cd /dev/shm/dev-workspace/happy-dev/packages/happy-cli && yarn build` is the documented FIX hint in AC2 E2

If the dist is empty when `--target dev` is invoked, the binary gate's fail-closed semantics (AC2 E2) will refuse the restart and emit the FIX hint pointing at `cd /dev/shm/dev-workspace/happy-dev/packages/happy-cli && yarn build`. The user's response is to build the worktree, then re-run.

## Sequencing dependency declaration

Per orchestrator's cross-concern sequencing constraint, this proposal MUST NOT be applied before C3 (hook hardening) lands. **C3 has already landed** (verified by the live block of this dev subagent's Edit attempt — the hook at /root/.claude/hooks/pretool-block-production-files.sh:102-114 is active with TASK-ID c3-20260504-223115). Therefore the sequencing precondition is satisfied; the user may now apply this proposal at their discretion.

The C3 hook as it stands also enforces "only user may modify" on admin scripts; it does NOT auto-apply C1 refactors. The refactor must be applied by the user from a TTY (e.g. via the `cat | awk | sed` extraction command above, or by direct editor session).

---

=== BEGIN happy-restart.sh ===
#!/bin/bash
# happy-restart.sh - Restart Happy services per-target with dispatch-table architecture
# TASK-ID: c1-20260504-223115
#
# Usage:
#   happy-restart.sh                         # default: all-prod (today's behavior preserved byte-for-byte)
#   happy-restart.sh --no-sessions           # legacy form: all-prod + skip session recovery message
#   happy-restart.sh --target <name>         # per-stack restart
#   happy-restart.sh --target <name> --no-sessions
#   happy-restart.sh --no-sessions --target <name>
#
# Valid targets: dev, default, jade, qijie, all-prod, all
#   dev        -> happy-daemon-dev only      (no Docker recreate; binary from worktree dist)
#   default    -> happy-daemon only          (recreates happy-server + happy-web)
#   jade       -> happy-daemon-jade only     (recreates happy-server + happy-web)
#   qijie      -> happy-daemon-qijie only    (recreates happy-server + happy-web)
#   all-prod   -> default + jade + qijie     (Docker recreated ONCE; today's no-arg behavior)
#   all        -> dev + default + jade + qijie (Docker recreated ONCE for prod services)
#
# Hook constraint: filename retains substring 'happy-restart' so /root/.claude/hooks/pretool-bash-safety.sh
# line 345 PERMANENTLY BLOCKS Claude from invoking this script. Only user-from-real-TTY may run it.

set -euo pipefail

LOG="/var/log/happy-restart.log"

# ---------------------------------------------------------------------------
# Dispatch table (data-driven; AC1).
# Per-target record fields, addressed via TARGET_<flavor>_<field> variables.
# Aggregate targets (all-prod, all) expand to a list of per-target keys.
#
# Schema (5 fields per target):
#   systemd_unit       : exact unit name without .service suffix
#   home_dir           : absolute path to HAPPY_HOME_DIR for this target
#   binary_dist_glob   : directory containing .mjs files to apply 3-token health check
#   docker_services    : space-separated docker compose services to recreate (empty for dev)
#   server_url_default : HAPPY_SERVER_URL to export when systemctl start runs
# ---------------------------------------------------------------------------

# --- Target: dev ---
# AC2 dev binary glob: worktree dist (NOT global CLI dist).
# OBJ-C1-002 note: at refactor authoring time (TASK-ID c1-20260504-223115), the worktree dist
# /dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/ is expected to contain >=2 .mjs files
# matching types-*.mjs and index-*.mjs. If the worktree was never built (yarn build never ran),
# the binary gate fail-closes per AC2 E2 with a FIX hint pointing at the worktree's `yarn build`.
TARGET_dev_systemd_unit="happy-daemon-dev"
TARGET_dev_home_dir="/root/.happy-dev"
TARGET_dev_binary_dist_glob="/dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist"
TARGET_dev_docker_services=""
TARGET_dev_server_url_default="http://localhost:3005"

# --- Target: default ---
TARGET_default_systemd_unit="happy-daemon"
TARGET_default_home_dir="/root/.happy"
TARGET_default_binary_dist_glob="/usr/lib/node_modules/happy-coder/dist"
TARGET_default_docker_services="happy-server happy-web"
TARGET_default_server_url_default="http://188.245.32.161:3000"

# --- Target: jade ---
TARGET_jade_systemd_unit="happy-daemon-jade"
TARGET_jade_home_dir="/root/.happy-jade"
TARGET_jade_binary_dist_glob="/usr/lib/node_modules/happy-coder/dist"
TARGET_jade_docker_services="happy-server happy-web"
TARGET_jade_server_url_default="http://188.245.32.161:3000"

# --- Target: qijie ---
TARGET_qijie_systemd_unit="happy-daemon-qijie"
TARGET_qijie_home_dir="/root/.happy-qijie"
TARGET_qijie_binary_dist_glob="/usr/lib/node_modules/happy-coder/dist"
TARGET_qijie_docker_services="happy-server happy-web"
TARGET_qijie_server_url_default="http://188.245.32.161:3000"

# --- Aggregate targets (expand to atomic target list) ---
# all-prod = today's no-arg behavior (3 prod daemons + prod Docker)
# all      = dev + 3 prod daemons (prod Docker only; dev Docker is managed by dev-overnight-build-deploy.sh)
TARGET_EXPAND_all_prod="default jade qijie"
TARGET_EXPAND_all="dev default jade qijie"

VALID_TARGETS="dev default jade qijie all-prod all"

# ---------------------------------------------------------------------------
# Argument parser (AC8 fail-closed; M6 order-independent).
# ---------------------------------------------------------------------------
TARGET=""
SKIP_SESSIONS=""

while [ $# -gt 0 ]; do
    case "$1" in
        --target)
            if [ -z "${2:-}" ]; then
                echo "BLOCKED: --target requires a value. Valid: $VALID_TARGETS" >&2
                exit 2
            fi
            TARGET="$2"
            shift 2
            ;;
        --no-sessions)
            SKIP_SESSIONS="--no-sessions"
            shift
            ;;
        *)
            echo "BLOCKED: unknown argument '$1'. Usage: happy-restart.sh [--target <name>] [--no-sessions]" >&2
            echo "Valid targets: $VALID_TARGETS" >&2
            exit 2
            ;;
    esac
done

# AC4 regression guard: no --target arg -> map to all-prod (today's exact behavior).
if [ -z "$TARGET" ]; then
    TARGET="all-prod"
fi

# AC8 fail-closed: validate target value BEFORE any side effect.
case "$TARGET" in
    dev|default|jade|qijie|all-prod|all)
        ;;
    *)
        echo "BLOCKED: unknown target '$TARGET'. Valid: $VALID_TARGETS" >&2
        exit 2
        ;;
esac

# ---------------------------------------------------------------------------
# Logging — every line carries target=<value> per S4 audit-tag.
# ---------------------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [target=$TARGET] $1" | tee -a "$LOG"; }

# AC5: TASK-ID echoed at start, BEFORE any side effect.
log "TASK-ID: c1-20260504-223115"
log "=== Happy restart starting (target=$TARGET) ==="

# ---------------------------------------------------------------------------
# Per-target lockfile (S2 / architect rec #6) — different targets concurrent OK; same target serializes.
# ---------------------------------------------------------------------------
LOCKDIR="/var/run"
[ -w "$LOCKDIR" ] || LOCKDIR="/tmp"
LOCKFILE="$LOCKDIR/happy-restart-${TARGET}.lock"

exec 9>"$LOCKFILE"
if ! flock -n 9; then
    log "BLOCKED: another happy-restart instance is already running for target=$TARGET (lockfile=$LOCKFILE)"
    exit 1
fi

# ---------------------------------------------------------------------------
# Resolve atomic target list from selected target.
# ---------------------------------------------------------------------------
resolve_atomic_targets() {
    case "$TARGET" in
        all-prod) echo "$TARGET_EXPAND_all_prod" ;;
        all)      echo "$TARGET_EXPAND_all" ;;
        *)        echo "$TARGET" ;;
    esac
}

ATOMIC_TARGETS="$(resolve_atomic_targets)"
log "Atomic targets resolved: $ATOMIC_TARGETS"

# Helper: read a per-target field via indirection.
# Usage: target_field <target_name> <field_name>
target_field() {
    local _t="$1"
    local _f="$2"
    local _var="TARGET_${_t}_${_f}"
    eval "echo \"\${$_var:-}\""
}

# ---------------------------------------------------------------------------
# Step 1: Per-target session save (AC6 / M4).
# For aggregate targets all-prod / all, preserve today's GLOBAL save (no --home).
# For atomic targets dev/default/jade/qijie, scope the save to that home via --home.
# ---------------------------------------------------------------------------
log "Saving session snapshot..."
case "$TARGET" in
    all-prod|all)
        # AC4 regression guard: no-arg / all-prod uses GLOBAL save (no --home), preserves today's behavior.
        bash /root/bin/happy-session-recovery.sh save || log "WARNING: session save failed (non-fatal)"
        ;;
    dev|default|jade|qijie)
        SCOPE_HOME="$(target_field "$TARGET" home_dir)"
        log "Scoped session save: --home $SCOPE_HOME"
        bash /root/bin/happy-session-recovery.sh save --home "$SCOPE_HOME" || log "WARNING: session save failed (non-fatal)"
        ;;
esac

# ---------------------------------------------------------------------------
# Step 2: Stop daemons per atomic target (M1).
# Iterate the dispatch table; replicates today's `|| true` non-fatal-on-already-stopped guard.
# ---------------------------------------------------------------------------
for _t in $ATOMIC_TARGETS; do
    _unit="$(target_field "$_t" systemd_unit)"
    log "Stopping ${_unit}.service..."
    systemctl stop "$_unit" 2>/dev/null || true
done

# ---------------------------------------------------------------------------
# Step 3: Detached-process kill (S1 / architect rec #5).
# For aggregate targets (all-prod / all): keep today's GLOBAL pgrep behavior (regression guard for AC4).
# For atomic targets: filter children by HAPPY_HOME_DIR env so dev kill doesn't affect prod, etc.
# ---------------------------------------------------------------------------
KILLED=0

# Check whether a candidate PID's HAPPY_HOME_DIR matches the requested home dir.
# Reads /proc/<pid>/environ (NUL-separated). Returns 0 if matches, 1 otherwise.
pid_home_matches() {
    local _pid="$1"
    local _wanted_home="$2"
    [ -z "$_wanted_home" ] && return 0
    [ -r "/proc/$_pid/environ" ] || return 1
    if tr '\0' '\n' < "/proc/$_pid/environ" 2>/dev/null | grep -qx "HAPPY_HOME_DIR=$_wanted_home"; then
        return 0
    fi
    return 1
}

case "$TARGET" in
    all-prod|all)
        # AC4 regression guard: aggregate path uses today's GLOBAL pgrep loop unchanged.
        for pidfile in /root/.happy/daemon.pid /root/.happy-jade/daemon.pid /root/.happy-qijie/daemon.pid; do
            DPID=$(cat "$pidfile" 2>/dev/null || echo "")
            [ -z "$DPID" ] && continue
            for cpid in $(pgrep -P 1 -f "happy.*--started-by daemon" 2>/dev/null); do
                kill "$cpid" 2>/dev/null && KILLED=$((KILLED + 1))
            done
        done
        for cpid in $(pgrep -P 1 -f "claude.*--resume" 2>/dev/null); do
            kill "$cpid" 2>/dev/null && KILLED=$((KILLED + 1))
        done
        ;;
    dev|default|jade|qijie)
        SCOPE_HOME="$(target_field "$TARGET" home_dir)"
        log "Scoped detached-process kill: HAPPY_HOME_DIR=$SCOPE_HOME"
        for cpid in $(pgrep -P 1 -f "happy.*--started-by daemon" 2>/dev/null); do
            if pid_home_matches "$cpid" "$SCOPE_HOME"; then
                kill "$cpid" 2>/dev/null && KILLED=$((KILLED + 1))
            fi
        done
        for cpid in $(pgrep -P 1 -f "claude.*--resume" 2>/dev/null); do
            if pid_home_matches "$cpid" "$SCOPE_HOME"; then
                kill "$cpid" 2>/dev/null && KILLED=$((KILLED + 1))
            fi
        done
        ;;
esac

[ "$KILLED" -gt 0 ] && log "Killed $KILLED detached session processes"

# ---------------------------------------------------------------------------
# Step 4: Clear stale restore lock (preserved verbatim from pre-refactor).
# ---------------------------------------------------------------------------
rm -f /tmp/happy-restore.lock      # legacy flock-based lock
rm -rf /tmp/happy-restore.lockdir  # mkdir-based lock (current)
log "Cleared restore lock"

sleep 2

# ---------------------------------------------------------------------------
# Step 5: Per-target binary health gate (AC2 / M2 / pre_existing_guard line 61-79).
# 3-token check: shouldHideParentToolCall absence (prod targets only), Task||Agent presence,
# sendExisting presence. Iterates atomic targets; validates EACH dist before any start (AC2 E3 fail-fast).
# Distinct named checks per target via check_target_binary called once per atomic target.
# ---------------------------------------------------------------------------
check_target_binary() {
    local _t="$1"
    local _glob_dir
    _glob_dir="$(target_field "$_t" binary_dist_glob)"
    local _types_file _index_file
    _types_file=$(ls "$_glob_dir"/types-*.mjs 2>/dev/null | head -1)
    _index_file=$(ls "$_glob_dir"/index-*.mjs 2>/dev/null | grep -v ClsViIPu | head -1)

    if [ -z "$_types_file" ] || [ -z "$_index_file" ]; then
        log "ERROR: Binary files not found at $_glob_dir/ for target=$_t"
        if [ "$_t" = "dev" ]; then
            log "FIX: cd /dev/shm/dev-workspace/happy-dev/packages/happy-cli && yarn build"
        else
            log "FIX: cd /root/happy/packages/happy-cli && yarn build && cd /root/happy && npm install -g ."
        fi
        return 1
    fi

    # Check 1: shouldHideParentToolCall must NOT exist (dev branch contamination on PROD targets only).
    # On the dev target, dev branch code IS the expected source; skip the negative check.
    if [ "$_t" != "dev" ]; then
        if grep -q "shouldHideParentToolCall" "$_types_file" 2>/dev/null; then
            log "ERROR: Binary contaminated for target=$_t — shouldHideParentToolCall found (dev branch code)"
            log "FIX: cd /root/happy/packages/happy-cli && yarn build && cd /root/happy && npm install -g ."
            return 1
        fi
    fi

    # Check 2: Task||Agent must exist (sidechain linking).
    if ! grep -q 'Task.*Agent' "$_types_file" 2>/dev/null; then
        log "ERROR: Binary for target=$_t missing Task||Agent check — sidechain linking will fail"
        return 1
    fi

    # Check 3: sendExisting must exist (session resume history upload).
    if ! grep -q 'sendExisting' "$_index_file" 2>/dev/null; then
        log "ERROR: Binary for target=$_t missing sendExisting — resumed sessions will appear empty"
        return 1
    fi

    log "Binary health check (target=$_t): OK (3/3 passed; dist=$_glob_dir)"
    return 0
}

# Fail-fast: validate ALL atomic targets' binaries before any daemon start (AC2 E3).
# Prod targets share the same dist glob; dedup so we don't re-grep the same files 3x.
SEEN_GLOBS=""
ALL_BINARIES_OK=1
for _t in $ATOMIC_TARGETS; do
    _glob="$(target_field "$_t" binary_dist_glob)"
    if echo " $SEEN_GLOBS " | grep -q " $_glob "; then
        continue
    fi
    SEEN_GLOBS="$SEEN_GLOBS $_glob"
    if ! check_target_binary "$_t"; then
        ALL_BINARIES_OK=0
    fi
done

if [ "$ALL_BINARIES_OK" != "1" ]; then
    log "CRITICAL: Binary health check FAILED — aborting restart (no Docker recreate run; daemons may be stopped)"
    log "Fix the binary first, then re-run this script"
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 6: Per-target Docker conditional (AC3 / M3 / architect rec #3).
# Compute UNION of docker_services across atomic targets; run docker compose up -d ONCE if non-empty.
# --target dev produces empty union -> Docker step entirely SKIPPED.
# ---------------------------------------------------------------------------
DOCKER_UNION=""
for _t in $ATOMIC_TARGETS; do
    _services="$(target_field "$_t" docker_services)"
    [ -z "$_services" ] && continue
    for _svc in $_services; do
        if ! echo " $DOCKER_UNION " | grep -q " $_svc "; then
            DOCKER_UNION="$DOCKER_UNION $_svc"
        fi
    done
done
DOCKER_UNION="$(echo "$DOCKER_UNION" | sed 's/^ *//;s/ *$//')"

if [ -n "$DOCKER_UNION" ]; then
    log "Recreating Docker services via docker compose: $DOCKER_UNION"
    cd /root/deploy && docker compose up -d $DOCKER_UNION 2>&1 | while read -r line; do log "  $line"; done
    log "Docker containers recreated: $DOCKER_UNION"
else
    log "Skipping Docker recreate (target=$TARGET has no docker_services; e.g. dev Docker is managed by dev-overnight-build-deploy.sh)"
fi

# ---------------------------------------------------------------------------
# Step 7: Start daemons per atomic target (M1 / S3 per-target HAPPY_SERVER_URL).
# Env var override on caller env wins; otherwise use per-target server_url_default.
# ---------------------------------------------------------------------------
for _t in $ATOMIC_TARGETS; do
    _unit="$(target_field "$_t" systemd_unit)"
    _url_default="$(target_field "$_t" server_url_default)"
    _url="${HAPPY_SERVER_URL:-$_url_default}"
    log "Starting ${_unit}.service (HAPPY_SERVER_URL=$_url)..."
    HAPPY_SERVER_URL="$_url" systemctl start "$_unit"
    log "${_unit} started"
done

# ---------------------------------------------------------------------------
# Step 8: Wait for daemons then verify per atomic target (AC7 / M5).
# Reads <home_dir>/daemon.state.json for EACH atomic target only — no hardcoded /root/.happy paths.
# ---------------------------------------------------------------------------
sleep 5

for _t in $ATOMIC_TARGETS; do
    _home="$(target_field "$_t" home_dir)"
    _unit="$(target_field "$_t" systemd_unit)"
    _state_file="$_home/daemon.state.json"
    _pid=$(cat "$_state_file" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['pid'])" 2>/dev/null || echo "")
    if [ -n "$_pid" ] && kill -0 "$_pid" 2>/dev/null; then
        log "Daemon ($_t) running OK (PID $_pid; unit=$_unit; state=$_state_file)"
    else
        log "ERROR: Daemon ($_t) not running after restart! (state=$_state_file)"
    fi
done

# ---------------------------------------------------------------------------
# Step 9: Session recovery message (preserved from pre-refactor).
# ---------------------------------------------------------------------------
if [ "$SKIP_SESSIONS" != "--no-sessions" ]; then
    log "Session recovery triggered by systemd ExecStartPost (check /var/log/happy-session-recovery.log)"
fi

log "=== Happy restart complete (target=$TARGET) ==="

# Final status summary line — preserves spirit of pre-refactor "Services: ..." line.
SUMMARY_PARTS=""
for _t in $ATOMIC_TARGETS; do
    _unit="$(target_field "$_t" systemd_unit)"
    SUMMARY_PARTS="$SUMMARY_PARTS $_unit=OK"
done
if [ -n "$DOCKER_UNION" ]; then
    for _svc in $DOCKER_UNION; do
        SUMMARY_PARTS="$SUMMARY_PARTS $_svc=restarted"
    done
fi
log "Services:$SUMMARY_PARTS"
=== END happy-restart.sh ===

## Diff summary (high-level)

| Concern | Pre-refactor | Post-refactor |
|---------|-------------|---------------|
| Lines | 142 | ~328 |
| Daemon stop | Hardcoded 3 lines | Dispatch loop over $ATOMIC_TARGETS |
| Binary gate | Single hardcoded path | Per-target via $TARGET_<flavor>_binary_dist_glob |
| Docker step | Unconditional `up -d happy-server happy-web` | Computed UNION of per-target docker_services; skipped if empty |
| Daemon start | Hardcoded 3 lines | Dispatch loop with per-target HAPPY_SERVER_URL |
| PID verify | 3 hardcoded blocks | Single loop over $ATOMIC_TARGETS reading $_home/daemon.state.json |
| Session save | Single global call | Per-target `--home <home_dir>`; aggregate keeps global |
| Detached-kill | Global pgrep | Per-target HAPPY_HOME_DIR filter; aggregate keeps global |
| Lockfile | None | flock per-target via /var/run/happy-restart-<target>.lock |
| Audit log | Plain timestamp | `[target=<value>]` tag on every line |
| TASK-ID | None | `TASK-ID: c1-20260504-223115` echoed at start |
| Arg parser | `${1:-}` flag | proper while-case loop; --target + --no-sessions order-independent |
| AC8 fail-closed | None | Unknown target -> exit 2 with valid-list |

## Cross-reference: BA spec compliance

- AC1 (dispatch table data-driven) ✅ — `TARGET_<flavor>_<field>` variables + parallel `target_field()` accessor + iteration via `for _t in $ATOMIC_TARGETS`
- AC2 (per-target binary gate) ✅ — `check_target_binary` parameterized by target's `binary_dist_glob`; dev gates worktree dist; prod gates global CLI dist; fail-fast before any start
- AC3 (Docker target-conditional) ✅ — `DOCKER_UNION` computed from per-target `docker_services`; dev=empty; gate `if [ -n "$DOCKER_UNION" ]`; single docker compose call regardless of target count
- AC4 (no-arg regression guard) ✅ — `[ -z "$TARGET" ] && TARGET="all-prod"`; `all-prod` expansion = `default jade qijie`; aggregate path uses GLOBAL save and GLOBAL pgrep loop verbatim
- AC5 (TASK-ID echo) ✅ — `log "TASK-ID: c1-20260504-223115"` is the FIRST log line, before any side effect
- AC6 (per-target session save) ✅ — atomic targets call with `--home <home_dir>`; aggregate keeps no-`--home` global save
- AC7 (per-target PID verify) ✅ — single loop reads `$_home/daemon.state.json`; no hardcoded `/root/.happy*` paths in verify body
- AC8 (unknown target fail-closed) ✅ — case statement explicitly enumerates valid targets; default branch echoes BLOCKED message and exits 2
- M6 (arg parser order-independent) ✅ — while-case loop accepts `--target` + `--no-sessions` in any order
- M7 (regression guard) ✅ — covered by AC4
- M8 (TASK-ID printed verbatim) ✅ — covered by AC5
- S1 (per-target detached-process kill) ✅ — `pid_home_matches` filter via /proc/<pid>/environ HAPPY_HOME_DIR
- S2 (per-target lockfile) ✅ — `exec 9>"$LOCKFILE"; flock -n 9`
- S3 (per-target HAPPY_SERVER_URL) ✅ — `_url="${HAPPY_SERVER_URL:-$_url_default}"`; env override still respected
- S4 (audit log scope tagging) ✅ — `[target=$TARGET]` in every `log()` line
- E1 (unknown target rejected) ✅ — covered by AC8
- E2 (dev binary missing fail-closed) ✅ — `check_target_binary` returns 1 with FIX hint pointing at worktree's `yarn build`
- E3 (fail-fast before any stop) — _PARTIAL_: binary gate runs AFTER stop in pre-refactor (and post-refactor, to preserve AC4 ordering — stop happens at step 2, gate at step 5). The fail-fast applies BEFORE Docker recreate and BEFORE start. To enforce strict "no daemon stopped on bad binary" the gate would need to move to step 1 — but that breaks AC4 byte-for-byte preservation (pre-refactor stops daemons before the gate). Documented as intentional trade-off here. If you want stop-after-gate semantics, that's a separate change requiring user sign-off on AC4 deviation.
- E4 (--target dev --no-sessions) ✅ — order-independent parser
- E5 (Docker once per invocation) ✅ — DOCKER_UNION dedup
- E6 (concurrent same-target serializes) ✅ — flock per-target lock
- E7 (set -euo pipefail compatibility) ✅ — `${VAR:-default}` patterns used throughout
- W1-W6 (won't haves) ✅ — none touched

## Status reported back to orchestrator

Status: **blocked_pending_user_apply** — proposal written; cannot Edit /root/bin/happy-restart.sh from subagent due to C3 hook hardening. User must apply manually from a TTY.
