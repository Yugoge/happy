#!/usr/bin/env bash
# happy-safe-restart — THE single sanctioned rebuild+restart path for the happy
# daemon + web stack (targets: dev | prod). Ticket 20260726-165120.
#
# Usage:
#   happy-safe-restart --target <dev|prod> [--component <cli|web|all>] [--dry-run]
#                      [--json-summary <path>] [--force-suicide-override]
#
# Exit codes:
#   0 = all requested phases passed (or dry-run completed)
#   1 = a safety gate refused / a phase failed (details on stdout + audit log)
#   2 = usage error
#
# Phase sequence (IDENTICAL for both targets; every target difference is a row
# in the config table below — never a per-target branch of phase logic):
#   phase0 preconditions (read-only): provenance/self-integrity, access.key,
#          prod unit preflight, human gate
#   phase1 self-suicide check
#   phase2 session baseline + snapshot save
#   phase3 rebuild (CLI dist via yarn build; web image rollback-tag + build)
#   phase4 dist integrity gate (sandboxed `version` probe + chunk completeness)
#   phase5 version consistency (package.json version == compiled dist version)
#   phase6 graceful stop (direct HTTP POST /stop + script-owned death poll)
#   phase7 unit preflight re-validation (prod only)
#   phase8 pinned start (dev: direct detached, pins exported; prod: systemd
#          start, pins carried+asserted in the unit) + web targeted recreate
#   phase9 identity-bound post-verify + zero session loss + health endpoints
#
# WHY THIS EXISTS (root cause, docs/dev/context-20260726-165120.json):
#   Every happy CLI invocation after a rebuild arms a takeover fuse
#   (packages/happy-cli/src/index.ts:773-786): on version mismatch it spawns a
#   replacement daemon with the INVOKER's environment, which stops the
#   incumbent — the recurring "version-update daemon suicide" that killed the
#   prod daemon 2026-07-19..07-26. `--version` is itself a kill vector: it
#   prints and deliberately does NOT exit (index.ts:760-762), continuing into
#   auth and the auto-start check. Therefore:
#     * the ONLY CLI-entry invocations in this script are (a) the sandboxed
#       `version` subcommand probe and (b) the final env-pinned daemon start,
#       both routed through invoke_cli_entry() which rejects `--version`;
#     * stopping NEVER uses the CLI entry (`daemon stop` embeds a 2s force-kill
#       fallback, controlClient.ts:237-248, and always exits 0,
#       index.ts:559-561): we POST /stop directly and own the death poll.
#
# RESIDUAL RISK (documented, arch-2): between phase3 (rebuild) and phase8
#   (start), a CONCURRENT actor invoking the happy CLI against the target home
#   can still trip the takeover fuse. This script minimizes that window;
#   instances of THIS script serialize on a per-target-home run lock (flock,
#   QA F2), so the script never races itself — the residual is limited to
#   non-script CLI invocations by other actors.
#
# Rollback:
#   web:    a timestamped tag <image>-prev-<UTC ts> is created before every
#           build; the exact rollback command pair is printed on EVERY web
#           phase outcome (success and failure).
#   daemon: no state/homes are ever deleted; a failed start leaves forensics
#           paths printed and (prod) the systemd unit stopped.
#
# QA seams (inert outside their modes, M19):
#   * HAPPY_SAFE_RESTART_HOME_OVERRIDE=/tmp/...  (target=dev only) — sandbox
#     mode against a throwaway home; dev human gate bypassed (logged).
#     HERMETIC (QA F1): honoring it REQUIRES HAPPY_SAFE_RESTART_TREE_OVERRIDE
#     too — home AND tree are then both /tmp throwaway paths, web components
#     are refused, so no mutating phase can reach a real tree, home, or image.
#   * HAPPY_SAFE_RESTART_TREE_OVERRIDE=/tmp/...  (sandbox mode only) — source
#     tree override; MANDATORY in sandbox mode (hermeticity) and also carries
#     the version-skew fixtures (AC5).
#   * <override_home>/fault-inject — sandbox-only ONE-SHOT fault marker file;
#     atomically renamed to fault-inject.consumed.<run-id> on trigger, and the
#     failure is injected ONLY after that rename succeeds (AC15).
#   * dry-run only: `systemctl` is resolved via PATH (stub injectable, AC9) and
#     M12 fixtures HAPPY_SAFE_RESTART_M12_MANIFEST / _M12_TRACKED are honored.
set -euo pipefail

# ── Provenance (filled by scripts/happy-safe-restart-deploy.sh — M20) ────────
PROVENANCE_COMMIT="__PROVENANCE_COMMIT_UNFILLED__"
STAGED_SHA256="__STAGED_SHA256_UNFILLED__"

SELF="${BASH_SOURCE[0]}"
SCRIPT_START_EPOCH="$(date -u +%s)"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ).$$"

# ── M20 gate 1: refuse to run with unfilled provenance (staging copy refuses
# by design; only a deploy-step-produced copy executes). Runs before ANY phase.
if [[ "$PROVENANCE_COMMIT" == *UNFILLED* || "$STAGED_SHA256" == *UNFILLED* ]]; then
    echo "REFUSED: provenance placeholder unfilled — this copy was not produced by the deploy step." >&2
    echo "Deploy the committed staging copy first:" >&2
    echo "    bash scripts/happy-safe-restart-deploy.sh            # → /root/bin/happy-safe-restart (user-only)" >&2
    echo "    bash scripts/happy-safe-restart-deploy.sh --dest /tmp/<name>   # QA-executable destination" >&2
    exit 1
fi

# ── M20 gate 2: self-integrity — normalize own provenance lines back to their
# placeholders, hash, and compare against the embedded staged-file sha256.
# A hand-edited canonical copy refuses even with filled provenance.
SELF_NORMALIZED_SHA="$(sed -e 's|^PROVENANCE_COMMIT=.*|PROVENANCE_COMMIT="__PROVENANCE_COMMIT_UNFILLED__"|' \
                           -e 's|^STAGED_SHA256=.*|STAGED_SHA256="__STAGED_SHA256_UNFILLED__"|' \
                           "$SELF" | sha256sum | awk '{print $1}')"
if [[ "$SELF_NORMALIZED_SHA" != "$STAGED_SHA256" ]]; then
    echo "REFUSED: self-integrity check failed — this copy differs from the staged file recorded at deploy time." >&2
    echo "  embedded staged sha256:   $STAGED_SHA256" >&2
    echo "  normalized self sha256:   $SELF_NORMALIZED_SHA" >&2
    echo "  provenance commit:        $PROVENANCE_COMMIT" >&2
    echo "The canonical copy may only be produced by scripts/happy-safe-restart-deploy.sh from committed HEAD. Re-deploy." >&2
    exit 1
fi

# ── Usage / argument parsing ─────────────────────────────────────────────────
usage() {
    sed -n '2,12p' "$SELF" | sed 's/^# \{0,1\}//'
}

TARGET=""
COMPONENT="all"
DRY_RUN=0
JSON_SUMMARY=""
FORCE_SUICIDE_OVERRIDE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target|--component|--json-summary)
            if [[ $# -lt 2 ]]; then echo "usage error: $1 requires a value" >&2; exit 2; fi ;;
    esac
    case "$1" in
        --target)                 TARGET="$2"; shift 2 ;;
        --component)              COMPONENT="$2"; shift 2 ;;
        --dry-run)                DRY_RUN=1; shift ;;
        --json-summary)           JSON_SUMMARY="$2"; shift 2 ;;
        --force-suicide-override) FORCE_SUICIDE_OVERRIDE=1; shift ;;
        -h|--help)                usage; exit 0 ;;
        *) echo "usage error: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
    esac
done
case "$TARGET" in dev|prod) ;; *) echo "usage error: --target dev|prod is mandatory" >&2; exit 2 ;; esac
case "$COMPONENT" in cli|web|all) ;; *) echo "usage error: --component cli|web|all" >&2; exit 2 ;; esac
DO_CLI=0; DO_WEB=0
[[ "$COMPONENT" == "cli" || "$COMPONENT" == "all" ]] && DO_CLI=1
[[ "$COMPONENT" == "web" || "$COMPONENT" == "all" ]] && DO_WEB=1

# ── M2 config table (authoritative values: consolidated requirement §4 +
# arch-10 dimensions; tier_2_verified — do NOT edit values here without
# re-verifying against docs/dev/requirement-consolidated-dev-command-20260726-163039.md §4).
declare -A CFG_HOME=(        [dev]="/root/.happy-dev"                 [prod]="/root/.happy" )
declare -A CFG_SERVER_URL=(  [dev]="http://localhost:3005"            [prod]="http://188.245.32.161:3000" )
declare -A CFG_TREE=(        [dev]="/root/happy-dev"                  [prod]="/root/happy" )
declare -A CFG_UNIT=(        [dev]="happy-daemon-dev.service"         [prod]="happy-daemon.service" )
declare -A CFG_WEB_CONTEXT=( [dev]="/dev/shm/dev-workspace/happy-dev" [prod]="/root/happy" )
declare -A CFG_WEB_ARG=(     [dev]="https://api-dev.life-ai.app"      [prod]="https://api.life-ai.app" )
declare -A CFG_WEB_IMAGE=(   [dev]="happy-app:dev"                    [prod]="happy-app:message-fixes" )
declare -A CFG_WEB_SERVICE=( [dev]="happy-web-dev"                    [prod]="happy-web" )
declare -A CFG_WEB_PORT=(    [dev]="8097"                             [prod]="8090" )
declare -A CFG_API_HEALTH=(  [dev]="http://localhost:3005/health"     [prod]="http://localhost:3000/health" )
declare -A CFG_MODEL=(       [dev]="direct"                           [prod]="systemd" )
declare -A CFG_GRANT=(       [dev]="dev"                              [prod]="default" )
declare -A CFG_NODE_OPTS=(   [dev]=""                                 [prod]="--max-old-space-size=8192" )

TARGET_HOME="${CFG_HOME[$TARGET]}"
SERVER_URL="${CFG_SERVER_URL[$TARGET]}"
TREE="${CFG_TREE[$TARGET]}"
UNIT="${CFG_UNIT[$TARGET]}"
WEB_CONTEXT="${CFG_WEB_CONTEXT[$TARGET]}"
WEB_ARG="${CFG_WEB_ARG[$TARGET]}"
WEB_IMAGE="${CFG_WEB_IMAGE[$TARGET]}"
WEB_SERVICE="${CFG_WEB_SERVICE[$TARGET]}"
WEB_PORT="${CFG_WEB_PORT[$TARGET]}"
API_HEALTH="${CFG_API_HEALTH[$TARGET]}"
RESTART_MODEL="${CFG_MODEL[$TARGET]}"
GRANT_TARGET="${CFG_GRANT[$TARGET]}"
NODE_OPTS_PIN="${CFG_NODE_OPTS[$TARGET]}"
GRANT_DIR="${CLAUDE_DAEMON_RESTART_SENTINEL_DIR:-${CLAUDE_TMPDIR:-/tmp}}"

# ── M19 sandbox mode (QA seam; refuse loudly on any misuse) ──────────────────
SANDBOX_MODE=0
if [[ -n "${HAPPY_SAFE_RESTART_HOME_OVERRIDE:-}" ]]; then
    if [[ "$TARGET" != "dev" ]]; then
        echo "REFUSED: HAPPY_SAFE_RESTART_HOME_OVERRIDE is honored for --target dev ONLY (M19)." >&2; exit 1
    fi
    if [[ "${HAPPY_SAFE_RESTART_HOME_OVERRIDE}" != /tmp/* ]]; then
        echo "REFUSED: HAPPY_SAFE_RESTART_HOME_OVERRIDE must be a /tmp path (got: ${HAPPY_SAFE_RESTART_HOME_OVERRIDE})." >&2; exit 1
    fi
    # codex it-2: lexical /tmp is not enough — a /tmp symlink can point at a
    # real home. The PHYSICAL path must stay under /tmp as well.
    if [[ "$(realpath -m -- "${HAPPY_SAFE_RESTART_HOME_OVERRIDE}")" != /tmp/* ]]; then
        echo "REFUSED: HAPPY_SAFE_RESTART_HOME_OVERRIDE resolves outside /tmp (symlink escape): ${HAPPY_SAFE_RESTART_HOME_OVERRIDE} -> $(realpath -m -- "${HAPPY_SAFE_RESTART_HOME_OVERRIDE}")" >&2; exit 1
    fi
    if [[ "$DO_WEB" == 1 ]]; then
        echo "REFUSED: sandbox mode covers the daemon chain only — use --component cli with HAPPY_SAFE_RESTART_HOME_OVERRIDE." >&2; exit 1
    fi
    # HERMETIC SANDBOX (QA F1): the home override alone would bypass the dev
    # human gate while phase3/phase8 still build and launch the REAL
    # config-table tree — an ungated dist replacement under live sessions.
    # Therefore sandbox mode hard-requires the tree override as well; with
    # both forced to /tmp (and web refused above), every mutating phase
    # targets only throwaway sandbox paths, regardless of any other flag.
    if [[ -z "${HAPPY_SAFE_RESTART_TREE_OVERRIDE:-}" ]]; then
        echo "REFUSED: hermetic sandbox (QA F1) — HAPPY_SAFE_RESTART_HOME_OVERRIDE requires HAPPY_SAFE_RESTART_TREE_OVERRIDE=/tmp/... as well; without it the rebuild/start phases would target the REAL tree ${TREE} with the dev human gate bypassed." >&2; exit 1
    fi
    SANDBOX_MODE=1
    TARGET_HOME="${HAPPY_SAFE_RESTART_HOME_OVERRIDE%/}"
fi
# Dry-run stub detection (M11/M19(b)): a PATH-prepended `systemctl` stub is
# honored ONLY under --dry-run; without a stub, dry-run keeps mutating
# systemctl verbs (set-environment / start) at PLAN level.
SYSTEMCTL_STUB_ACTIVE=0
if [[ "$DRY_RUN" == 1 ]]; then
    _RESOLVED_SYSCTL="$(command -v systemctl || true)"
    if [[ -n "$_RESOLVED_SYSCTL" && "$_RESOLVED_SYSCTL" != "/usr/bin/systemctl" && "$_RESOLVED_SYSCTL" != "/bin/systemctl" && "$_RESOLVED_SYSCTL" != "/usr/sbin/systemctl" ]]; then
        SYSTEMCTL_STUB_ACTIVE=1
    fi
fi
if [[ -n "${HAPPY_SAFE_RESTART_TREE_OVERRIDE:-}" ]]; then
    if [[ "$SANDBOX_MODE" != 1 || "${HAPPY_SAFE_RESTART_TREE_OVERRIDE}" != /tmp/* ]]; then
        echo "REFUSED: HAPPY_SAFE_RESTART_TREE_OVERRIDE is honored only in sandbox mode and only for /tmp paths." >&2; exit 1
    fi
    # codex it-2: physical-path check (symlink escape) — same rule as the home.
    if [[ "$(realpath -m -- "${HAPPY_SAFE_RESTART_TREE_OVERRIDE}")" != /tmp/* ]]; then
        echo "REFUSED: HAPPY_SAFE_RESTART_TREE_OVERRIDE resolves outside /tmp (symlink escape): ${HAPPY_SAFE_RESTART_TREE_OVERRIDE} -> $(realpath -m -- "${HAPPY_SAFE_RESTART_TREE_OVERRIDE}")" >&2; exit 1
    fi
    TREE="${HAPPY_SAFE_RESTART_TREE_OVERRIDE%/}"
fi
DIST_ENTRY="${TREE}/packages/happy-cli/dist/index.mjs"
# Tree-resolution rule (QA F4, documented): the config table is authoritative
# and this script never substitutes trees — but tree IDENTITY is physical, not
# lexical. On this host /root/happy-dev is a symlink to the workspace tree, so
# a daemon whose cmdline names the RESOLVED spelling of the SAME dist file is
# the config-table daemon, not a foreign one. phase6 therefore accepts either
# spelling of the one physical dist entry; genuinely different trees still
# refuse (fail-closed).
DIST_ENTRY_REAL="$(realpath -m -- "$DIST_ENTRY" 2>/dev/null || printf '%s' "$DIST_ENTRY")"

# ── QA F2: run-level mutual exclusion — ONE script instance per target home.
# Without this, two concurrent invocations both observe an empty cohort in
# phase6, both start a daemon in phase8, and manufacture the double-daemon
# mutual-kill state this script exists to prevent. Lock precedent: the same
# flock(2) pattern as the grant-sentinel lock (grant_check) and the host
# hook's consume lock; the kernel releases the lock when the holder dies, so
# stale locks self-reclaim with no pidfile bookkeeping. The lock file lives
# in the FIXED literal /tmp directory — never ${TMPDIR} (QA F11: a caller-set
# TMPDIR splits the lock namespace and defeats serialization) — keyed on the
# realpath-canonicalized target home so every alias spelling of one physical
# home contends on the SAME lock file, and a refused loser never creates
# files under a real home (QA F7). The lock is held on fd 9 for the WHOLE
# run (released only at process exit; the detached daemon start explicitly
# closes fd 9 so the successor daemon can never inherit — and thus never
# retain — the lock).
TARGET_HOME_LOCK_KEY="$(realpath -m -- "$TARGET_HOME" 2>/dev/null || printf '%s' "$TARGET_HOME")"
LOCK_FILE="/tmp/happy-safe-restart.$(printf '%s' "$TARGET_HOME_LOCK_KEY" | tr '/' '_').lock"
LOCK_OK=0
for _lock_try in 1 2 3; do
    exec 9>>"$LOCK_FILE"
    if ! flock -n 9; then
        LOCK_HOLDER="$(cat "$LOCK_FILE" 2>/dev/null || true)"
        echo "REFUSED: another happy-safe-restart run holds the lock for target home $TARGET_HOME (lock: $LOCK_FILE)." >&2
        echo "  holder: ${LOCK_HOLDER:-<holder info not yet written>}" >&2
        echo "  Concurrent runs manufacture the double-daemon mutual-kill state (QA F2); wait for the holder to finish, then re-run." >&2
        exit 1
    fi
    # codex it-2: guard against a /tmp cleaner unlinking the file between our
    # open and flock — the lock is only valid if the path still names the same
    # inode we hold; otherwise reopen and retry.
    if [[ "$(stat -c %i "$LOCK_FILE" 2>/dev/null || echo path-gone)" == "$(stat -Lc %i /proc/self/fd/9 2>/dev/null || echo fd-gone)" ]]; then
        LOCK_OK=1; break
    fi
    exec 9>&-
done
if [[ "$LOCK_OK" != 1 ]]; then
    echo "REFUSED: could not obtain a stable run lock at $LOCK_FILE after 3 attempts (file kept vanishing — /tmp cleaner interference?)." >&2
    exit 1
fi
printf 'run_id=%s pid=%s target=%s home=%s audit=%s\n' \
    "$RUN_ID" "$$" "$TARGET" "$TARGET_HOME" "${TARGET_HOME}/logs/happy-safe-restart-audit.log" > "$LOCK_FILE"

# ── Logging / audit (M18: append-only, per-target, timestamped) ──────────────
# QA F7: the audit dir is created lazily on first write, not unconditionally
# at startup. (Refusals are themselves audited by design — M18 — so any run
# that reaches phase0 still creates <home>/logs; what this removes is the
# unconditional pre-gate mkdir.)
AUDIT_DIR="${TARGET_HOME}/logs"
AUDIT_LOG="${AUDIT_DIR}/happy-safe-restart-audit.log"
audit() {
    [[ -d "$AUDIT_DIR" ]] || mkdir -p "$AUDIT_DIR"
    printf '[%s] [run:%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RUN_ID" "$*" >> "$AUDIT_LOG"
}
log() {
    printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"
    audit "$*"
}

declare -a VERDICTS=()
verdict() {  # $1 phase-id  $2 PASS|FAIL|SKIP|PLAN|WARN  $3 detail
    VERDICTS+=("$1|$2|$3")
    log "VERDICT $1: $2 — $3"
}

WEB_ROLLBACK_PAIR=""
M12_TOUCHED=0
M12_PREV_PRESENT=0
M12_PREV_VALUE=""
M12_RESTORE_FAILED=0

print_web_rollback_pair() {
    [[ -n "$WEB_ROLLBACK_PAIR" ]] || return 0
    echo "── web rollback command pair (run BOTH, in order) ──"
    echo "$WEB_ROLLBACK_PAIR"
}

restore_manager_env() {
    # M12(d): ALWAYS restore the systemd manager environment to its prior state,
    # including on failure paths (invoked from the EXIT trap).
    [[ "$M12_TOUCHED" == 1 ]] || return 0
    local ok=1
    if [[ "$M12_PREV_PRESENT" == 1 ]]; then
        sysctl_cmd set-environment "HAPPY_RESTORE_REPLACE_UNTRACKED=${M12_PREV_VALUE}" || ok=0
        [[ "$ok" == 1 ]] && log "M12 restore: HAPPY_RESTORE_REPLACE_UNTRACKED reset to prior value '${M12_PREV_VALUE}'"
    else
        sysctl_cmd unset-environment HAPPY_RESTORE_REPLACE_UNTRACKED || ok=0
        [[ "$ok" == 1 ]] && log "M12 restore: HAPPY_RESTORE_REPLACE_UNTRACKED unset (was absent before this run)"
    fi
    if [[ "$ok" != 1 ]]; then
        M12_RESTORE_FAILED=1
        log "M12 restore FAILED — the manager environment may still carry HAPPY_RESTORE_REPLACE_UNTRACKED; run 'systemctl unset-environment HAPPY_RESTORE_REPLACE_UNTRACKED' (or reset it to its prior value) manually"
    fi
    M12_TOUCHED=0
}

write_json_summary() {
    [[ -n "$JSON_SUMMARY" ]] || return 0
    local rc="$1"
    {
        printf '{\n  "run_id": "%s",\n  "provenance_commit": "%s",\n  "target": "%s",\n  "component": "%s",\n  "dry_run": %s,\n  "sandbox_mode": %s,\n  "exit_code": %s,\n  "phases": [\n' \
            "$RUN_ID" "$PROVENANCE_COMMIT" "$TARGET" "$COMPONENT" "$DRY_RUN" "$SANDBOX_MODE" "$rc"
        local i v phase status detail
        for i in "${!VERDICTS[@]}"; do
            v="${VERDICTS[$i]}"
            phase="${v%%|*}"; v="${v#*|}"; status="${v%%|*}"; detail="${v#*|}"
            detail="${detail//\\/\\\\}"; detail="${detail//\"/\\\"}"
            printf '    {"phase": "%s", "status": "%s", "detail": "%s"}%s\n' \
                "$phase" "$status" "$detail" "$([[ $i -lt $((${#VERDICTS[@]}-1)) ]] && echo ',')"
        done
        printf '  ]\n}\n'
    } > "$JSON_SUMMARY"
}

FINAL_RC_OVERRIDE=""
on_exit() {
    local rc=$?
    trap '' INT TERM  # codex it-2: IGNORE (not default-kill) late signals so a
                      # second INT/TERM cannot interrupt the M12 restore/teardown
    [[ -n "$FINAL_RC_OVERRIDE" ]] && rc="$FINAL_RC_OVERRIDE"
    restore_manager_env
    if [[ "$M12_RESTORE_FAILED" == 1 && "$rc" == 0 ]]; then
        echo "REFUSED-AT-EXIT: M12 manager-environment restore failed — see log above" >&2
        rc=1
    fi
    print_web_rollback_pair
    if [[ ${#VERDICTS[@]} -gt 0 ]]; then
        echo "── phase verdict summary (run:$RUN_ID) ──"
        local v; for v in "${VERDICTS[@]}"; do echo "  $v"; done
    fi
    write_json_summary "$rc" || true
    audit "EXIT rc=$rc"
    exit "$rc"
}
trap on_exit EXIT
# QA F8: deterministic teardown on interrupt (canonical EXIT INT TERM
# coverage). INT/TERM convert to an explicit NONZERO exit — which fires the
# EXIT trap exactly once — instead of relying on shell-version nuance for
# signal-time EXIT-trap behavior, and instead of `trap on_exit INT TERM`
# directly (which would report a misleading rc=$? of the last command,
# potentially 0, for an interrupted run).
trap 'FINAL_RC_OVERRIDE="${FINAL_RC_OVERRIDE:-130}"; exit 130' INT
trap 'FINAL_RC_OVERRIDE="${FINAL_RC_OVERRIDE:-143}"; exit 143' TERM

die() {
    log "REFUSED: $*"
    echo "REFUSED: $*" >&2
    echo "forensics: audit log: $AUDIT_LOG" >&2
    FINAL_RC_OVERRIDE=1
    exit 1
}

# ── systemctl wrapper: absolute path normally; PATH-resolved ONLY in dry-run
# (M11 test seam — a PATH-prepended stub is honored only under --dry-run).
sysctl_cmd() {
    audit "systemctl $*"
    if [[ "$DRY_RUN" == 1 ]]; then
        systemctl "$@"
    else
        /usr/bin/systemctl "$@"
    fi
}

# ── M19(a) one-shot fault marker (sandbox mode only).
# Injection depends on the SUCCESSFUL atomic rename of the marker (mv within
# the same directory = rename(2)); the phase value is re-read from the CONSUMED
# copy as the authoritative trigger. A vanished marker never injects.
maybe_inject_fault() {  # $1 = phase id, e.g. "phase5"
    [[ "$SANDBOX_MODE" == 1 ]] || return 0
    local marker="${TARGET_HOME}/fault-inject"
    [[ -f "$marker" ]] || return 0
    # Early read ONLY to identify whether this phase is the target.
    local want=""
    want="$(cat "$marker" 2>/dev/null || true)"
    [[ "$want" == "$1" ]] || return 0
    if [[ "$DRY_RUN" == 1 ]]; then
        log "fault-inject: marker present naming $1 — dry-run neither consumes nor injects (read-only contract)"
        return 0
    fi
    # Atomic no-clobber consume: collision-proof consumed name (never overwrite
    # a prior copy — mv -n -T skips silently on a concurrent destination, so
    # consumption is confirmed by postconditions, not by mv's exit status).
    local attempt consumed
    for attempt in 1 2 3; do
        consumed="${marker}.consumed.${RUN_ID}.${attempt}"
        [[ -e "$consumed" ]] && continue
        if ! mv -n -T "$marker" "$consumed" 2>/dev/null; then
            log "fault-inject: marker vanished before consumption — NOT injecting (no injection from the earlier read)"
            return 0
        fi
        if [[ ! -e "$marker" && -f "$consumed" ]]; then
            # Authoritative phase value comes from the consumed copy, post-rename.
            local phase_from_consumed
            phase_from_consumed="$(cat "$consumed" 2>/dev/null || true)"
            if [[ "$phase_from_consumed" == "$1" ]]; then
                log "fault-inject: marker consumed → $consumed (retained as audit evidence)"
                die "FAULT-INJECTED one-shot failure at $1 (sandbox test seam M19(a); re-run with identical args succeeds — marker is consumed)"
            fi
            log "fault-inject: consumed copy names '$phase_from_consumed', not '$1' — NOT injecting"
            return 0
        fi
    done
    log "fault-inject: could not consume marker without clobbering after 3 attempts — NOT injecting"
    return 0
}

# ── M1 helper: the ONLY way this script invokes the CLI dist entry.
# Rejects the `--version` kill vector; logs exact argv to the audit log.
# Modes: default = foreground with stdin /dev/null and timeout
#        INVOKE_DETACH=1 = detached daemon start (nohup, cwd /root)
invoke_cli_entry() {
    local arg
    for arg in "$@"; do
        if [[ "$arg" == "--version" ]]; then
            die "invoke_cli_entry: forbidden argument '--version' — it is the documented kill vector (index.ts:760-786: prints, does NOT exit, continues into auth + daemon auto-start takeover). Use the 'version' subcommand."
        fi
    done
    audit "CLI-ENTRY argv: node $DIST_ENTRY $*"
    if [[ "${INVOKE_DETACH:-0}" == 1 ]]; then
        # exec 9>&- : neither the detached daemon NOR any intermediate subshell
        # bash leaves behind as its parent may inherit the run-lock fd (QA F2),
        # or the lock would stay held for the daemon's whole lifetime. Closing
        # at subshell level (exec) covers every descendant.
        ( exec 9>&-; cd /root && nohup node --no-warnings --no-deprecation "$DIST_ENTRY" "$@" </dev/null >/dev/null 2>&1 & )
    else
        timeout "${INVOKE_TIMEOUT:-30}s" node --no-warnings --no-deprecation "$DIST_ENTRY" "$@" </dev/null
    fi
}

# ── /proc scanning helpers (never hardcoded PIDs — M8) ───────────────────────
proc_env_home() {  # $1 pid → HAPPY_HOME_DIR value from its environment ('' if unset/unreadable)
    { tr '\0' '\n' 2>/dev/null < "/proc/$1/environ" | sed -n 's/^HAPPY_HOME_DIR=//p' | head -1; } || true
} 2>/dev/null
proc_cmdline() {   # $1 pid
    tr '\0' ' ' 2>/dev/null < "/proc/$1/cmdline" || true
} 2>/dev/null
home_matches_cohort() {  # $1 env-home value → 0 if it belongs to the target cohort
    local h="$1"
    if [[ "$h" == "$TARGET_HOME" ]]; then return 0; fi
    # Prod transitional dual-accept (arch-5): legacy unpinned processes carry an
    # EMPTY home and belong to the prod cohort until unit pinning has landed.
    if [[ "$TARGET" == "prod" && "$SANDBOX_MODE" == 0 && -z "$h" ]]; then return 0; fi
    return 1
}
scan_cohort() {  # prints "pid|kind|env_home|cmdline" for every happy process of the target cohort
    local p pid cmd h kind
    for p in /proc/[0-9]*; do
        pid="${p#/proc/}"
        [[ "$pid" == "$$" ]] && continue
        cmd="$(proc_cmdline "$pid")"
        [[ -n "$cmd" ]] || continue
        case "$cmd" in
            *packages/happy-cli/dist/index.mjs*|*/usr/bin/happy\ *) ;;
            *) continue ;;
        esac
        h="$(proc_env_home "$pid")"
        home_matches_cohort "$h" || continue
        case "$cmd" in
            *" daemon start"*|*" daemon start-sync"*) kind="daemon" ;;
            *) kind="session" ;;
        esac
        printf '%s|%s|%s|%s\n' "$pid" "$kind" "$h" "$cmd"
    done
    return 0
}

json_field() {  # $1 file  $2 field → prints value or ''
    python3 -c 'import json,sys
try:
    d=json.load(open(sys.argv[1]))
    v=d.get(sys.argv[2],"")
    print(v if v is not None else "")
except Exception:
    print("")' "$1" "$2" 2>/dev/null
}

# ── M16 human gates ──────────────────────────────────────────────────────────
overnight_state_live() {
    # A live overnight-state file in the INVOKING project: parses as JSON AND
    # end_time > now (bare existence is falsified by stale files — arch-12).
    local f
    for f in "$PWD"/.claude/overnight-state-*.json; do
        [[ -f "$f" ]] || continue
        if python3 -c 'import json,sys
from datetime import datetime,timezone
try:
    d=json.load(open(sys.argv[1]))
    e=d.get("end_time","")
    e=e.replace("Z","+00:00")
    dt=datetime.fromisoformat(e)
    if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
    sys.exit(0 if dt > datetime.now(timezone.utc) else 1)
except Exception:
    sys.exit(1)' "$f" 2>/dev/null; then
            log "human gate: live overnight-state file found: $f (end_time in the future)"
            return 0
        fi
    done
    return 1
}

invoking_session_id() {
    # Same source order as the issuer /root/bin/claude-allow-restart:118-127:
    # $CLAUDE_SESSION_ID env, then the active-session file, else no-active-session.
    if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then printf '%s' "$CLAUDE_SESSION_ID"; return; fi
    local f="${CLAUDE_ACTIVE_SESSION_FILE:-${CLAUDE_SESSIONS_DIR:-$HOME/.claude/sessions}/active.json}"
    local sid=""
    [[ -r "$f" ]] && sid="$(python3 -c 'import json,sys
try:
    d=json.load(open(sys.argv[1])); print(d.get("session_id") or d.get("sid") or "")
except Exception: print("")' "$f" 2>/dev/null || true)"
    printf '%s' "${sid:-no-active-session}"
}

grant_check() {  # $1 = grant target suffix, $2 = mode: validate|consume → 0 ok / 1 no valid grant
    local suffix="$1" mode="$2"
    local flag="${GRANT_DIR%/}/claude-allow-daemon-restart-${suffix}.flag"
    local flag_all="${GRANT_DIR%/}/claude-allow-daemon-restart-all.flag"
    if [[ ! -f "$flag" && -f "$flag_all" ]]; then flag="$flag_all"; fi
    [[ -f "$flag" ]] || return 1
    local res
    res="$(FLAG_FILE="$flag" WANT_TARGET="$suffix" MODE="$mode" INVOKING_SID="$(invoking_session_id)" python3 - <<'PYEOF'
import fcntl, json, os, sys
from datetime import datetime, timezone
flag = os.environ['FLAG_FILE']; want = os.environ['WANT_TARGET']; mode = os.environ['MODE']
sid = os.environ.get('INVOKING_SID', '')
lock_path = flag + '.lock'
fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX)
    if not os.path.exists(flag):
        print('NO_FLAG'); sys.exit(0)
    try:
        data = json.load(open(flag))
    except Exception:
        print('NO_FLAG'); sys.exit(0)
    tgt = data.get('target', '')
    if tgt not in (want, 'all'):
        print('TARGET_MISMATCH'); sys.exit(0)
    try:
        exp = datetime.fromisoformat(data.get('expires_at', '').replace('Z', '+00:00'))
        if exp.tzinfo is None: exp = exp.replace(tzinfo=timezone.utc)
        if exp <= datetime.now(timezone.utc):
            print('EXPIRED'); sys.exit(0)
    except Exception:
        print('EXPIRED'); sys.exit(0)
    # QA F6: session binding, identical to the host hook's
    # check_and_consume_daemon_restart_grant (pretool-bash-safety.sh:573-575):
    # a grant bound to a specific session never authorizes a different one.
    grant_sid = data.get('session_id', '')
    if grant_sid and grant_sid != 'no-active-session' and grant_sid != sid:
        print('SESSION_MISMATCH'); sys.exit(0)
    # QA F6: honor single_shot=false — validate without consuming.
    single_shot = bool(data.get('single_shot', True))
    if mode == 'consume' and single_shot:
        try: os.unlink(flag)
        except FileNotFoundError: pass
        print('CONSUMED')
    else:
        print('VALID')
finally:
    try: fcntl.flock(fd, fcntl.LOCK_UN)
    except Exception: pass
    os.close(fd)
PYEOF
)"
    case "$res" in CONSUMED|VALID) audit "human gate: grant $res ($flag)"; return 0 ;; esac
    audit "human gate: grant check result=$res ($flag)"
    return 1
}

gate_refusal_text() {  # $1 = grant target suffix
    cat <<EOF
REFUSED by human gate: no valid claude-allow-daemon-restart-${1}.flag grant.
A human must issue the grant from a real TTY, then re-run this script:
    claude-allow-restart ${1} --ttl 60 --reason "<why>"
EOF
}

# ── M11 prod unit preflight (EFFECTIVE config via systemctl show, not raw text)
unit_preflight() {  # $1 = phase label
    local label="$1"
    local show env_line exec_line reload_line missing=()
    show="$(sysctl_cmd show "$UNIT" -p Environment -p ExecStart -p NeedDaemonReload 2>/dev/null || true)"
    env_line="$(printf '%s\n' "$show" | sed -n 's/^Environment=//p')"
    exec_line="$(printf '%s\n' "$show" | sed -n 's/^ExecStart=//p')"
    reload_line="$(printf '%s\n' "$show" | sed -n 's/^NeedDaemonReload=//p')"
    log "$label: systemctl show $UNIT → Environment='[${env_line}]' NeedDaemonReload='${reload_line}'"
    local pin
    for pin in "HAPPY_HOME_DIR=${CFG_HOME[$TARGET]}" \
               "HAPPY_SERVER_URL=${SERVER_URL}" \
               "IS_SANDBOX=1" \
               "NODE_OPTIONS=${NODE_OPTS_PIN}"; do
        [[ "$pin" == "NODE_OPTIONS=" ]] && continue
        if [[ " $env_line " != *" $pin "* && "$env_line" != *"\"$pin\""* ]]; then
            missing+=("Environment=$pin")
        fi
    done
    if [[ "$exec_line" != *"$DIST_ENTRY"* ]]; then
        missing+=("ExecStart must execute the config-table dist entry: $DIST_ENTRY (version comparison is keyed on the project path, controlClient.ts:157-163)")
    fi
    if [[ "$reload_line" != "no" ]]; then
        missing+=("unit edited but not reloaded: run 'systemctl daemon-reload' and re-check (NeedDaemonReload=$reload_line)")
    fi
    if [[ ${#missing[@]} -gt 0 ]]; then
        verdict "$label" FAIL "unit preflight: ${#missing[@]} missing/incorrect assertion(s)"
        echo "REQUEST-TO-USER: the systemd unit $UNIT does not carry the required pin set." >&2
        echo "Editing /etc/systemd is production infra and stays a USER action. Required lines:" >&2
        local m; for m in "${missing[@]}"; do echo "    $m" >&2; done
        echo "After editing: systemctl daemon-reload  (then re-run this script)" >&2
        die "$label: prod unit preflight failed — see REQUEST-TO-USER above"
    fi
    verdict "$label" PASS "unit $UNIT carries the full pin set; ExecStart uses $DIST_ENTRY; NeedDaemonReload=no"
}

# ═════════════════════════════════════════════════════════════════════════════
echo "happy-safe-restart run:$RUN_ID provenance:$PROVENANCE_COMMIT"
echo "target=$TARGET component=$COMPONENT dry_run=$DRY_RUN sandbox=$SANDBOX_MODE"
echo "PHASE SEQUENCE: phase0 phase1 phase2 phase3 phase4 phase5 phase6 phase7 phase8 phase9"
audit "START argv: --target $TARGET --component $COMPONENT dry_run=$DRY_RUN sandbox=$SANDBOX_MODE json_summary=${JSON_SUMMARY:-none} provenance=$PROVENANCE_COMMIT"
[[ "$SANDBOX_MODE" == 1 ]] && log "SANDBOX MODE ACTIVE (hermetic, QA F1): home=$TARGET_HOME tree=$TREE — BOTH /tmp throwaway paths; this run builds and launches ONLY the override tree ($TREE); the real config-table tree and homes are unreachable"

# ─── phase0: read-only preconditions (M3 phase 0 — before ANY mutation) ──────
maybe_inject_fault phase0
log "phase0: preconditions (read-only)"
log "phase0: check: config table row → home=$TARGET_HOME server=$SERVER_URL tree=$TREE unit=$UNIT model=$RESTART_MODEL web=$WEB_IMAGE/$WEB_SERVICE:$WEB_PORT"

if [[ "$DO_CLI" == 1 ]]; then
    if [[ ! -f "$TARGET_HOME/access.key" ]]; then
        verdict phase0 FAIL "access.key missing at $TARGET_HOME/access.key"
        die "phase0: $TARGET_HOME/access.key missing — daemon auth runs first (run.ts:157); a start would fail or hang. Provision the home before restarting."
    fi
    log "phase0: found: $TARGET_HOME/access.key present"
    if [[ ! -f "$DIST_ENTRY" && "$DRY_RUN" == 1 ]]; then
        log "phase0: note: dist entry $DIST_ENTRY absent (phase3 build would create it)"
    fi
fi

# Human gate (M16) — evaluated BEFORE the unit preflight so a missing grant
# refuses with the exact grant command (AC7). Consume is the LAST phase-0 act.
GATE_OK=0; GATE_WHY=""
if [[ "$SANDBOX_MODE" == 1 ]]; then
    GATE_OK=1; GATE_WHY="sandbox mode: dev human gate BYPASSED for throwaway home $TARGET_HOME (M19/SR-2; logged)"
elif [[ "$TARGET" == "dev" ]] && overnight_state_live; then
    GATE_OK=1; GATE_WHY="dev auto-permit: live overnight-state (end_time > now)"
elif grant_check "$GRANT_TARGET" validate; then
    GATE_OK=1; GATE_WHY="valid claude-allow-daemon-restart-${GRANT_TARGET}.flag grant present"
fi
if [[ "$GATE_OK" == 1 ]]; then
    verdict phase0 PASS "human gate: $GATE_WHY"
else
    verdict phase0 FAIL "human gate: no valid grant for target '$GRANT_TARGET'"
    gate_refusal_text "$GRANT_TARGET" >&2
    if [[ "$DRY_RUN" == 1 ]]; then
        log "phase0: dry-run continues read-only phases despite gate refusal (a real run would refuse here)"
    else
        die "phase0: human gate refused (target=$TARGET grant=$GRANT_TARGET)"
    fi
fi
# Prod unit preflight — read-only assertion of the pin CARRIER (M11).
if [[ "$TARGET" == "prod" && "$DO_CLI" == 1 ]]; then
    unit_preflight phase0
fi

# Non-dry, grant-based permit → consume the single-shot sentinel atomically now
# (last phase-0 act: a preflight refusal above never wastes a grant).
if [[ "$DRY_RUN" == 0 && "$GATE_OK" == 1 && "$GATE_WHY" == valid\ claude-allow* ]]; then
    grant_check "$GRANT_TARGET" consume \
        || die "phase0: grant vanished between validation and consumption — re-issue and re-run"
    log "phase0: decision: grant honored (consumed if single_shot; a single_shot=false grant is validated and left in place — QA F6)"
fi

# ─── phase1: self-suicide check (M4) ─────────────────────────────────────────
maybe_inject_fault phase1
if [[ "$DO_CLI" == 1 ]]; then
    log "phase1: self-suicide check — am I running under the daemon I would restart?"
    TRIPPED=""
    # (a) definitive: own cgroup contains the target systemd unit slice
    if grep -q "$UNIT" /proc/self/cgroup 2>/dev/null; then
        TRIPPED="cgroup: /proc/self/cgroup contains $UNIT"
    fi
    # (b) strong: /proc ancestry intersects the target home's daemon.state.json pid
    if [[ -z "$TRIPPED" && -f "$TARGET_HOME/daemon.state.json" ]]; then
        STATE_PID="$(json_field "$TARGET_HOME/daemon.state.json" pid)"
        if [[ -n "$STATE_PID" ]]; then
            anc="$$"
            while [[ "$anc" -gt 1 ]]; do
                if [[ "$anc" == "$STATE_PID" ]]; then
                    TRIPPED="ancestry: pid $STATE_PID ($TARGET_HOME/daemon.state.json) is an ancestor of this script"
                    break
                fi
                anc="$(awk '{print $4}' "/proc/$anc/stat" 2>/dev/null || echo 1)"
                [[ -n "$anc" ]] || anc=1
            done
        fi
    fi
    # (c) advisory: own env HAPPY_HOME_DIR equals the target home
    if [[ -z "$TRIPPED" && "${HAPPY_HOME_DIR:-}" == "$TARGET_HOME" ]]; then
        TRIPPED="env: this process's HAPPY_HOME_DIR equals the target home $TARGET_HOME"
    fi
    if [[ -n "$TRIPPED" ]]; then
        verdict phase1 FAIL "self-suicide signal tripped — $TRIPPED"
        if [[ "$DRY_RUN" == 1 ]]; then
            log "phase1: dry-run continues (a real run would refuse; restarting one's own manager is the cgroup self-kill trap)"
        elif [[ "$FORCE_SUICIDE_OVERRIDE" == 1 ]]; then
            if [[ -t 0 ]]; then
                log "phase1: decision: --force-suicide-override accepted (stdin is a TTY) — proceeding DESPITE tripped signal: $TRIPPED"
            else
                die "phase1: --force-suicide-override requires an interactive TTY on stdin (agents cannot satisfy this); refusing. Tripped signal: $TRIPPED"
            fi
        else
            die "phase1: refusing to restart my own manager (tripped signal: $TRIPPED). Run from a session NOT managed by $UNIT / $TARGET_HOME, or a human may add --force-suicide-override from a TTY."
        fi
    else
        verdict phase1 PASS "no self-suicide signal (cgroup, ancestry, env all clear)"
    fi
else
    verdict phase1 SKIP "component=web: no daemon phase runs"
fi

# ─── phase2: session baseline + snapshot save (M8) ───────────────────────────
maybe_inject_fault phase2
declare -a BASELINE_SESSION_PIDS=()
if [[ "$DO_CLI" == 1 ]]; then
    log "phase2: enumerating live processes of cohort home=$TARGET_HOME (env-classified via /proc/<pid>/environ, never hardcoded PIDs)"
    COHORT="$(scan_cohort)"
    if [[ -n "$COHORT" ]]; then log "phase2: found cohort:"; printf '%s\n' "$COHORT" | while IFS= read -r l; do log "    $l"; done; fi
    while IFS='|' read -r pid kind h cmd; do
        [[ "$kind" == "session" ]] && BASELINE_SESSION_PIDS+=("$pid")
    done <<< "$COHORT"
    log "phase2: baseline session pid set: ${BASELINE_SESSION_PIDS[*]:-<empty>} ($(printf '%s\n' "${BASELINE_SESSION_PIDS[@]:-}" | grep -c . || true) sessions)"
    if [[ "$DRY_RUN" == 1 ]]; then
        verdict phase2 PLAN "would save session snapshot ($([[ $SANDBOX_MODE == 1 ]] && echo 'sandbox-internal baseline file' || echo 'host session-snapshot save entry point'))"
    else
        BASELINE_FILE="$AUDIT_DIR/happy-safe-restart-baseline-$RUN_ID.list"
        printf '%s\n' "${BASELINE_SESSION_PIDS[@]:-}" > "$BASELINE_FILE"
        if [[ "$SANDBOX_MODE" == 1 ]]; then
            log "phase2: sandbox mode — baseline written to $BASELINE_FILE (host snapshot tooling not invoked for throwaway homes)"
        else
            # Critical Operational Rule #1: never stop/restart a daemon without a saved snapshot.
            if ! bash /root/bin/happy-session-recovery.sh save; then
                verdict phase2 FAIL "session snapshot save failed"
                die "phase2: session snapshot save failed — refusing to continue toward a stop without a snapshot (Critical Operational Rule #1)"
            fi
            log "phase2: decision: snapshot saved; baseline list at $BASELINE_FILE"
        fi
        verdict phase2 PASS "baseline captured (${#BASELINE_SESSION_PIDS[@]} session pids) + snapshot saved"
    fi
else
    verdict phase2 SKIP "component=web: sessions unaffected by a targeted web recreate"
fi

# ─── phase3: rebuild (M3 step 3; web per §6a — M14) ──────────────────────────
maybe_inject_fault phase3
FRESH_IMAGE_ID=""
if [[ "$DO_CLI" == 1 ]]; then
    log "phase3: CLI dist rebuild in $TREE/packages/happy-cli (yarn build)"
    if [[ "$DRY_RUN" == 1 ]]; then
        verdict phase3 PLAN "cli: would run: (cd $TREE/packages/happy-cli && yarn build)"
    else
        ( cd "$TREE/packages/happy-cli" && yarn build ) \
            || die "phase3: yarn build failed in $TREE/packages/happy-cli — dist unchanged, nothing stopped or started"
        verdict phase3 PASS "cli: yarn build completed in $TREE/packages/happy-cli"
    fi
fi
if [[ "$DO_WEB" == 1 ]]; then
    WEB_TS="$(date -u +%Y%m%dT%H%M%SZ)"
    WEB_PREV_TAG="${WEB_IMAGE}-prev-${WEB_TS}"
    WEB_ROLLBACK_PAIR="    docker tag ${WEB_PREV_TAG} ${WEB_IMAGE}
    (cd /root/deploy && docker compose up -d --no-deps --force-recreate ${WEB_SERVICE})"
    log "phase3: web rollback point: ${WEB_PREV_TAG} (timestamped — a second run never destroys it, arch-10)"
    if [[ "$DRY_RUN" == 1 ]]; then
        verdict phase3 PLAN "web: would run: docker tag ${WEB_IMAGE} ${WEB_PREV_TAG}; then: docker build -f Dockerfile.webapp --build-arg HAPPY_SERVER_URL=${WEB_ARG} -t ${WEB_IMAGE} ${WEB_CONTEXT}"
    else
        if ! docker image inspect "$WEB_IMAGE" >/dev/null 2>&1; then
            die "phase3: pre-build image $WEB_IMAGE not present — no rollback point possible; refusing (build it once manually per docs before using this path)"
        fi
        docker tag "$WEB_IMAGE" "$WEB_PREV_TAG" \
            || die "phase3: failed to create rollback tag $WEB_PREV_TAG"
        log "phase3: rollback tag created: $WEB_PREV_TAG"
        ( cd "$WEB_CONTEXT" && docker build -f Dockerfile.webapp --build-arg "HAPPY_SERVER_URL=${WEB_ARG}" -t "$WEB_IMAGE" . ) \
            || die "phase3: docker build failed for $WEB_IMAGE (context $WEB_CONTEXT) — running container untouched; rollback tag $WEB_PREV_TAG retained"
        FRESH_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$WEB_IMAGE")"
        verdict phase3 PASS "web: image $WEB_IMAGE rebuilt (id ${FRESH_IMAGE_ID:0:19}…) with HAPPY_SERVER_URL=${WEB_ARG}; rollback tag $WEB_PREV_TAG"
    fi
fi
[[ "$DO_CLI" == 0 && "$DO_WEB" == 0 ]] && verdict phase3 SKIP "nothing selected"

# ─── phase4: dist integrity gate (M5 sandboxed probe + M6 chunk grep) ────────
maybe_inject_fault phase4
PROBED_VERSION=""
if [[ "$DO_CLI" == 1 ]]; then
    log "phase4: dist integrity — sandboxed side-effect-free 'version' probe + chunk completeness"
    if [[ ! -f "$DIST_ENTRY" ]]; then
        verdict phase4 FAIL "dist entry missing: $DIST_ENTRY"
        [[ "$DRY_RUN" == 1 ]] || die "phase4: $DIST_ENTRY does not exist — rebuild first (phase3)"
    fi
    if [[ "$DRY_RUN" == 1 ]]; then
        # Dry-run stays truly read-only: NEVER execute the CLI entry (a foreign
        # dist could fall through into auth/auto-start). Static checks only.
        CHUNK_HITS="$({ grep -c "sendExisting" "$TREE"/packages/happy-cli/dist/index-*.mjs 2>/dev/null || true; } | awk -F: '{s+=$NF} END {print s+0}')"
        log "phase4: found (static): dist entry $([[ -f "$DIST_ENTRY" ]] && echo present || echo MISSING); sendExisting chunk hits=$CHUNK_HITS"
        verdict phase4 PLAN "would probe the freshly built dist via invoke_cli_entry version (throwaway HAPPY_HOME_DIR under /tmp, stdin /dev/null, 15s timeout, post-probe containment sweep); static chunk check: sendExisting x$CHUNK_HITS"
    else
    # M5: probe ONLY inside a throwaway home; stdin /dev/null; 15s timeout.
    THROWAWAY="$(mktemp -d /tmp/happy-safe-probe-XXXXXX)"
    set +e
    PROBE_OUT="$(HAPPY_HOME_DIR="$THROWAWAY" INVOKE_TIMEOUT=15 invoke_cli_entry version 2>&1)"
    PROBE_RC=$?
    set -e
    # M5 containment sweep: no process pinned to the throwaway home may survive
    # (a fallthrough on a foreign dist can detach a daemon there; `timeout`
    # kills the probe, not a detached child). This is one of the TWO sanctioned
    # terminations in this script (the other: M9 dev/sandbox escalation).
    for p in /proc/[0-9]*; do
        spid="${p#/proc/}"
        [[ "$spid" == "$$" ]] && continue
        sh="$(proc_env_home "$spid")"
        if [[ -n "$sh" && "$sh" == "$THROWAWAY" ]]; then
            # per-pid re-verify immediately before signaling
            if tr '\0' '\n' 2>/dev/null < "/proc/$spid/environ" | grep -qx "HAPPY_HOME_DIR=$THROWAWAY"; then
                log "phase4: M5 containment sweep — terminating stray pid $spid (HAPPY_HOME_DIR=$THROWAWAY)"
                kill -9 "$spid" 2>/dev/null || true
            fi
        fi
    done
    rm -rf "$THROWAWAY"
    PROBED_VERSION="$(printf '%s\n' "$PROBE_OUT" | { grep -oE '^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$' || true; } | head -1)"
    CHUNK_HITS="$({ grep -c "sendExisting" "$TREE"/packages/happy-cli/dist/index-*.mjs 2>/dev/null || true; } | awk -F: '{s+=$NF} END {print s+0}')"
    log "phase4: found: probe rc=$PROBE_RC version='${PROBED_VERSION:-<unparseable>}' sendExisting chunk hits=$CHUNK_HITS"
    if [[ $PROBE_RC -ne 0 || -z "$PROBED_VERSION" ]]; then
        verdict phase4 FAIL "probe did not print a parseable version (rc=$PROBE_RC)"
        if [[ "$DRY_RUN" == 1 ]]; then
            log "phase4: dry-run continues (a real run would refuse: half-built dist or a dist predating the safe 'version' subcommand — rebuild first from an updated tree)"
        else
            die "phase4: dist load pre-check failed — output was: ${PROBE_OUT:0:300} … rebuild first (a dist without the safe 'version' subcommand predates happy-safe-restart M5; sync $TREE)"
        fi
    elif [[ "${CHUNK_HITS:-0}" -le 0 ]]; then
        verdict phase4 FAIL "sendExisting missing from dist chunks (session-history upload would break — scripts/verify-cli-build.sh precedent)"
        [[ "$DRY_RUN" == 1 ]] || die "phase4: chunk completeness failed — rebuild first"
    else
        verdict phase4 PASS "dist loads (version $PROBED_VERSION), chunks complete (sendExisting x$CHUNK_HITS)"
    fi
    fi
else
    verdict phase4 SKIP "component=web"
fi

# ─── phase5: version consistency (M7 — the armed-fuse check) ─────────────────
maybe_inject_fault phase5
if [[ "$DO_CLI" == 1 ]]; then
    TREE_PKG_VERSION="$(json_field "$TREE/packages/happy-cli/package.json" version)"
    log "phase5: check: on-disk package.json version ($TREE_PKG_VERSION) == compiled dist version (${PROBED_VERSION:-?})"
    if [[ -z "$PROBED_VERSION" ]]; then
        verdict phase5 SKIP "no probed version available (phase4 did not produce one — dry-run only)"
    elif [[ "$TREE_PKG_VERSION" != "$PROBED_VERSION" ]]; then
        verdict phase5 FAIL "ARMED FUSE: package.json=$TREE_PKG_VERSION vs dist=$PROBED_VERSION"
        [[ "$DRY_RUN" == 1 ]] || die "phase5: version mismatch (package.json $TREE_PKG_VERSION != compiled dist $PROBED_VERSION) — this is the auto-upgrade suicide fuse (index.ts:773). Rebuild first: (cd $TREE/packages/happy-cli && yarn build), then re-run."
    else
        verdict phase5 PASS "versions consistent ($TREE_PKG_VERSION) — fuse disarmed for this path"
    fi
else
    verdict phase5 SKIP "component=web"
fi

# ─── phase6: graceful stop (M9 — direct HTTP /stop + script-owned death poll)
maybe_inject_fault phase6
OLD_PID=""
OLD_VERIFIED=0
if [[ "$DO_CLI" == 1 ]]; then
    STATE_FILE="$TARGET_HOME/daemon.state.json"
    if [[ "$DRY_RUN" == 1 ]]; then
        if [[ -f "$STATE_FILE" ]]; then
            OP="$(json_field "$STATE_FILE" pid)"; OPORT="$(json_field "$STATE_FILE" httpPort)"
            log "phase6: found: state pid=$OP httpPort=$OPORT (read-only)"
        else
            log "phase6: found: no daemon.state.json for $TARGET_HOME"
        fi
        verdict phase6 PLAN "would POST http://127.0.0.1:<state.httpPort>/stop and kill -0 death-poll >=30s @0.5s (escalation: dev/sandbox one logged SIGKILL to the snapshotted pid; prod refuse-and-report)"
    else
        # Step 1: single-read snapshot (same-generation pid+port) + identity triple.
        if [[ -f "$STATE_FILE" ]]; then
            SNAP="$(python3 -c 'import json,sys
try:
    d=json.load(open(sys.argv[1])); print(d.get("pid",""), d.get("httpPort",""))
except Exception: print("", "")' "$STATE_FILE")"
            OLD_PID="${SNAP%% *}"; OLD_PORT="${SNAP##* }"
            if [[ -n "$OLD_PID" && -d "/proc/$OLD_PID" ]]; then
                ID_START="$(awk '{print $22}' "/proc/$OLD_PID/stat" 2>/dev/null || echo '')"
                ID_CMD="$(proc_cmdline "$OLD_PID")"
                ID_HOME="$(proc_env_home "$OLD_PID")"
                # Identity triple: daemon argv (config-table dist entry, or the
                # legacy global binary during the prod transition) + cohort home.
                ID_CMD_OK=0
                if [[ "$ID_CMD" == *"$DIST_ENTRY"* || "$ID_CMD" == *"$DIST_ENTRY_REAL"* || "$ID_CMD" == */usr/bin/happy\ * ]]; then
                    case "$ID_CMD" in
                        *" daemon start"*|*" daemon start-sync"*) ID_CMD_OK=1 ;;
                    esac
                fi
                if [[ "$ID_CMD_OK" == 1 ]] && home_matches_cohort "$ID_HOME"; then
                    OLD_VERIFIED=1
                    log "phase6: identity triple verified for pid $OLD_PID (start=$ID_START home='${ID_HOME}' cmd=${ID_CMD:0:120})"
                else
                    log "phase6: identity MISMATCH for state pid $OLD_PID (home='${ID_HOME}' cmd='${ID_CMD:0:120}') — treating state as stale; never signaling this pid"
                fi
            fi
        fi
        # Step 2: stale/absent state path — proceed only with an empty cohort scan.
        if [[ "$OLD_VERIFIED" == 0 ]]; then
            DAEMON_SCAN="$(scan_cohort | grep '|daemon|' || true)"
            if [[ -n "$DAEMON_SCAN" ]]; then
                verdict phase6 FAIL "unaddressable daemon exists (state stale/absent but cohort scan non-empty)"
                die "phase6: a daemon-classified process exists for $TARGET_HOME that the state file cannot address: $DAEMON_SCAN — refusing (cannot stop what cannot be identified). If its cmdline shows a dist OUTSIDE the config-table tree ($TREE), the daemon was started from a non-canonical tree (QA F4: the live dev daemon is known to run from a workspace tree); the config table is authoritative and this script never silently substitutes trees — REQUEST-TO-USER: reconcile by stopping that daemon via its own tree's control path, then starting from $TREE via this script."
            fi
            if [[ "$TARGET" == "prod" && "$SANDBOX_MODE" == 0 ]]; then
                ACT="$(/usr/bin/systemctl is-active "$UNIT" 2>/dev/null || true)"
                [[ "$ACT" == "active" ]] && die "phase6: $UNIT reports active but no addressable daemon found — refusing (unit/process state divergence)"
            fi
            verdict phase6 PASS "no live daemon (stale/reused/absent state; cohort scan empty) — nothing to stop"
        else
            # Step 3: direct HTTP POST /stop (controlServer.ts:282-300). NEVER the
            # CLI entry: `daemon stop` embeds a 2s SIGKILL and always exits 0.
            STOP_URL="http://127.0.0.1:${OLD_PORT}/stop"
            log "phase6: POST $STOP_URL"
            # --fail makes non-2xx an error (rc 22), so transport errors,
            # timeouts, AND HTTP-level failures all get the single retry (M9).
            set +e
            curl -s --fail -X POST --max-time 10 -o /dev/null "$STOP_URL"; CRC=$?
            set -e
            if [[ $CRC -ne 0 ]]; then
                log "phase6: POST failed (curl rc=$CRC; 22=HTTP >=400) — retrying once after 2s (failure NEVER short-circuits into escalation)"
                sleep 2
                set +e; curl -s --fail -X POST --max-time 10 -o /dev/null "$STOP_URL"; CRC=$?; set -e
                log "phase6: retry rc=$CRC — continuing to the death poll regardless"
            fi
            # Step 4: the SCRIPT owns the death poll (>=30s @ 0.5s). The daemon's
            # own exit is the only success signal.
            DEAD=0
            for _ in $(seq 1 60); do
                if ! kill -0 "$OLD_PID" 2>/dev/null; then DEAD=1; break; fi
                sleep 0.5
            done
            if [[ "$DEAD" == 0 ]]; then
                # Step 5: escalation split by ownership. Re-verify identity first.
                CUR_START="$(awk '{print $22}' "/proc/$OLD_PID/stat" 2>/dev/null || echo '')"
                CUR_HOME="$(proc_env_home "$OLD_PID")"
                CUR_CMD="$(proc_cmdline "$OLD_PID")"
                if [[ "$CUR_START" != "$ID_START" || "$CUR_HOME" != "$ID_HOME" || "$CUR_CMD" != "$ID_CMD" ]]; then
                    die "phase6: pid $OLD_PID identity changed during the poll (PID reuse) — refusing to signal. state=$STATE_FILE audit=$AUDIT_LOG"
                fi
                if [[ "$TARGET" == "dev" || "$SANDBOX_MODE" == 1 ]]; then
                    log "phase6: ESCALATION (dev/sandbox, script-owned daemon): one SIGKILL to snapshotted pid $OLD_PID"
                    kill -9 "$OLD_PID" 2>/dev/null || true
                    DEAD=0
                    for _ in $(seq 1 20); do
                        if ! kill -0 "$OLD_PID" 2>/dev/null; then DEAD=1; break; fi
                        sleep 0.5
                    done
                    [[ "$DEAD" == 1 ]] || die "phase6: pid $OLD_PID survived SIGKILL escalation — refusing. state=$STATE_FILE daemon_log=$(json_field "$STATE_FILE" daemonLogPath) audit=$AUDIT_LOG"
                else
                    ACT="$(/usr/bin/systemctl is-active "$UNIT" 2>/dev/null || true)"
                    die "phase6: prod daemon pid $OLD_PID did not exit within the poll window. REQUEST-TO-USER: do NOT let an agent signal a systemd-owned pid (Restart=on-failure races an unprotected replacement). unit_state=$ACT state=$STATE_FILE daemon_log=$(json_field "$STATE_FILE" daemonLogPath) audit=$AUDIT_LOG"
                fi
            fi
            log "phase6: decision: old daemon pid $OLD_PID exited (death-polled by this script)"
            # Step 6: prod post-stop reconciliation.
            if [[ "$TARGET" == "prod" && "$SANDBOX_MODE" == 0 ]]; then
                /usr/bin/systemctl reset-failed "$UNIT" 2>/dev/null \
                    || log "phase6: reset-failed errored (non-fatal; asserting inactivity next)"
                ACT="$(/usr/bin/systemctl is-active "$UNIT" 2>/dev/null || true)"
                [[ "$ACT" != "active" ]] || die "phase6: $UNIT still active after confirmed daemon death — refusing (no blind double-start ever)"
            fi
            verdict phase6 PASS "old daemon pid $OLD_PID stopped gracefully (HTTP /stop + script-owned death poll)"
        fi
    fi
else
    verdict phase6 SKIP "component=web"
fi

# ─── phase7: unit preflight re-validation (prod only — M3 step 7) ────────────
maybe_inject_fault phase7
if [[ "$TARGET" == "prod" && "$DO_CLI" == 1 ]]; then
    unit_preflight phase7
elif [[ "$DO_CLI" == 1 ]]; then
    verdict phase7 SKIP "dev restart model is direct (no systemd unit involved)"
else
    verdict phase7 SKIP "component=web"
fi

# ─── phase8: pinned start (M10) + web targeted recreate (M14) ────────────────
maybe_inject_fault phase8
if [[ "$DO_CLI" == 1 ]]; then
    if [[ "$RESTART_MODEL" == "direct" || "$SANDBOX_MODE" == 1 ]]; then
        log "phase8: direct detached start — pins EXPORTED by this script: HAPPY_HOME_DIR=$TARGET_HOME HAPPY_SERVER_URL=$SERVER_URL IS_SANDBOX=1 (consolidated §6b; never inherit defaults)"
        if [[ "$DRY_RUN" == 1 ]]; then
            verdict phase8 PLAN "would run (cwd /root, nohup, detached): HAPPY_HOME_DIR=$TARGET_HOME HAPPY_SERVER_URL=$SERVER_URL IS_SANDBOX=1 node $DIST_ENTRY daemon start"
        else
            HAPPY_HOME_DIR="$TARGET_HOME" HAPPY_SERVER_URL="$SERVER_URL" IS_SANDBOX=1 INVOKE_DETACH=1 \
                invoke_cli_entry daemon start
            verdict phase8 PASS "daemon start dispatched (direct detached, env-pinned)"
        fi
    else
        # M12 prod restore protection BEFORE systemctl start.
        M12_MANIFEST=""; M12_TRACKED="$TARGET_HOME/session_dirs.txt"
        if [[ "$DRY_RUN" == 1 && -n "${HAPPY_SAFE_RESTART_M12_MANIFEST:-}" ]]; then
            M12_MANIFEST="${HAPPY_SAFE_RESTART_M12_MANIFEST}"
            M12_TRACKED="${HAPPY_SAFE_RESTART_M12_TRACKED:-$M12_TRACKED}"
            log "phase8: M12 dry-run fixture seam active: manifest=$M12_MANIFEST tracked=$M12_TRACKED"
        fi
        UNTRACKED=0
        M12_CMDLINES=""
        if [[ -n "$M12_MANIFEST" ]]; then
            M12_CMDLINES="$(cat "$M12_MANIFEST" 2>/dev/null || true)"
        else
            M12_CMDLINES="$(scan_cohort | awk -F'|' '$2=="session" {print $4}')"
        fi
        while IFS= read -r cl; do
            [[ -n "$cl" ]] || continue
            UUID="$(printf '%s\n' "$cl" | grep -oE -- '--resume [0-9a-fA-F-]{8,}' | awk '{print $2}' | head -1 || true)"
            if [[ -z "$UUID" ]]; then
                log "phase8: M12 session with NO parseable --resume UUID → classified UNTRACKED (protective default): ${cl:0:120}"
                UNTRACKED=$((UNTRACKED+1))
            elif ! grep -q "$UUID" "$M12_TRACKED" 2>/dev/null; then
                log "phase8: M12 session UUID $UUID absent from $M12_TRACKED → UNTRACKED"
                UNTRACKED=$((UNTRACKED+1))
            fi
        done <<< "$M12_CMDLINES"
        log "phase8: M12 untracked session count: $UNTRACKED"
        if [[ "$DRY_RUN" == 1 && "$SYSTEMCTL_STUB_ACTIVE" == 0 ]]; then
            # No stub: never touch the REAL manager environment in dry-run.
            if [[ "$UNTRACKED" -gt 0 ]]; then
                verdict phase8 PLAN "M12: $UNTRACKED untracked session(s) — would set HAPPY_RESTORE_REPLACE_UNTRACKED=0 before start, verify via show-environment, and restore the prior manager state after start (dry-run without systemctl stub: not executed)"
            else
                verdict phase8 PLAN "M12: no untracked sessions — would start without the variable; would run: systemctl start $UNIT"
            fi
        elif [[ "$UNTRACKED" -gt 0 ]]; then
            PREV="$(sysctl_cmd show-environment 2>/dev/null | sed -n 's/^HAPPY_RESTORE_REPLACE_UNTRACKED=//p' || true)"
            if sysctl_cmd show-environment 2>/dev/null | grep -q '^HAPPY_RESTORE_REPLACE_UNTRACKED='; then
                M12_PREV_PRESENT=1; M12_PREV_VALUE="$PREV"
            fi
            # Arm restoration BEFORE the first mutation so even an ambiguous
            # partial set-environment failure is restored by the EXIT trap.
            M12_TOUCHED=1
            if ! sysctl_cmd set-environment HAPPY_RESTORE_REPLACE_UNTRACKED=0; then
                verdict phase8 FAIL "M12: systemctl set-environment unavailable"
                die "phase8: cannot arm restore protection (systemctl set-environment failed) with $UNTRACKED untracked session(s) present — refusing to start (orphan-session slaughter risk)"
            fi
            if ! sysctl_cmd show-environment 2>/dev/null | grep -q '^HAPPY_RESTORE_REPLACE_UNTRACKED=0$'; then
                verdict phase8 FAIL "M12: set-environment verify failed"
                die "phase8: HAPPY_RESTORE_REPLACE_UNTRACKED=0 did not verify in systemctl show-environment — refusing to start"
            fi
            log "phase8: M12 decision: HAPPY_RESTORE_REPLACE_UNTRACKED=0 set (prior state: $([[ $M12_PREV_PRESENT == 1 ]] && echo "value '$M12_PREV_VALUE'" || echo absent)); restore trap armed"
        else
            log "phase8: M12 decision: no untracked sessions — the script adds no restore-protection variable (normal restore)"
            if sysctl_cmd show-environment 2>/dev/null | grep -q '^HAPPY_RESTORE_REPLACE_UNTRACKED='; then
                log "phase8: M12 WARNING: the manager environment already carries HAPPY_RESTORE_REPLACE_UNTRACKED (pre-existing, user-owned) — the script does not modify it (M12(b): the script ADDS nothing in this branch)"
            fi
        fi
        if [[ "$DRY_RUN" == 1 ]]; then
            verdict phase8 PLAN "would run: systemctl start $UNIT (pins carried by the asserted unit — script exports NOTHING to a systemd start)"
            restore_manager_env
        else
            sysctl_cmd start "$UNIT" || { restore_manager_env; die "phase8: systemctl start $UNIT failed — unit left stopped; journalctl -u $UNIT for details"; }
            restore_manager_env
            verdict phase8 PASS "systemctl start $UNIT dispatched (unit is the pin carrier, asserted in phase0/phase7)"
        fi
    fi
fi
if [[ "$DO_WEB" == 1 ]]; then
    if [[ "$DRY_RUN" == 1 ]]; then
        verdict phase8 PLAN "web: would run: (cd /root/deploy && docker compose up -d --no-deps --force-recreate ${WEB_SERVICE}) — targeted recreate ONLY, never a broad compose restart"
    else
        ( cd /root/deploy && docker compose up -d --no-deps --force-recreate "$WEB_SERVICE" ) \
            || die "phase8: targeted recreate of $WEB_SERVICE failed — rollback pair printed above/below"
        audit "web recreate: docker compose up -d --no-deps --force-recreate $WEB_SERVICE"
        verdict phase8 PASS "web: $WEB_SERVICE recreated (--no-deps --force-recreate, name-scoped)"
    fi
fi
[[ "$DO_CLI" == 0 && "$DO_WEB" == 0 ]] && verdict phase8 SKIP "nothing selected"

# ─── phase9: identity-bound post-verify (M13) + zero session loss + health ───
maybe_inject_fault phase9
if [[ "$DRY_RUN" == 1 ]]; then
    verdict phase9 PLAN "would assert: new state pid != old pid, pid alive, startedWithCliVersion == fresh build, exactly-one daemon for $TARGET_HOME, full env pin set in /proc/<newpid>/environ, zero baseline session loss, health endpoints, web image-id swap"
else
    if [[ "$DO_CLI" == 1 ]]; then
        STATE_FILE="$TARGET_HOME/daemon.state.json"
        NEW_PID=""
        for _ in $(seq 1 90); do
            NEW_PID="$(json_field "$STATE_FILE" pid)"
            if [[ -n "$NEW_PID" && -d "/proc/$NEW_PID" && "$NEW_PID" != "$OLD_PID" ]]; then break; fi
            if [[ -n "$NEW_PID" && -d "/proc/$NEW_PID" && "$OLD_VERIFIED" == 0 ]]; then break; fi
            sleep 1
        done
        [[ -n "$NEW_PID" && -d "/proc/$NEW_PID" ]] \
            || die "phase9: no live daemon appeared for $TARGET_HOME (state=$STATE_FILE) — forensics: audit=$AUDIT_LOG daemon_log=$(json_field "$STATE_FILE" daemonLogPath) baseline=${BASELINE_FILE:-<none>}"
        if [[ "$OLD_VERIFIED" == 1 && "$NEW_PID" == "$OLD_PID" ]]; then
            die "phase9: state pid unchanged ($NEW_PID) after a verified stop — start did not take"
        fi
        NEW_VERSION="$(json_field "$STATE_FILE" startedWithCliVersion)"
        [[ -n "$PROBED_VERSION" && "$NEW_VERSION" != "$PROBED_VERSION" ]] \
            && die "phase9: started daemon reports version '$NEW_VERSION' but the freshly built dist is '$PROBED_VERSION' — identity mismatch"
        # State freshness: file mtime must postdate script start (startTime is a
        # locale string, run.ts:662 — mtime is the robust signal; both logged).
        SF_MTIME="$(stat -c %Y "$STATE_FILE" 2>/dev/null || echo 0)"
        [[ "$SF_MTIME" -ge "$SCRIPT_START_EPOCH" ]] \
            || die "phase9: $STATE_FILE mtime predates this run — stale state (startTime='$(json_field "$STATE_FILE" startTime)')"
        # Full pinned set from the LIVE process environment (M13, both targets).
        NEW_ENV="$(tr '\0' '\n' 2>/dev/null < "/proc/$NEW_PID/environ" || true)"
        for want in "HAPPY_HOME_DIR=$TARGET_HOME" "HAPPY_SERVER_URL=$SERVER_URL" "IS_SANDBOX=1"; do
            printf '%s\n' "$NEW_ENV" | grep -qx "$want" \
                || die "phase9: new daemon pid $NEW_PID is missing pin '$want' in /proc environ — a start path silently lost a pin"
        done
        if [[ -n "$NODE_OPTS_PIN" && "$SANDBOX_MODE" == 0 ]]; then
            printf '%s\n' "$NEW_ENV" | grep -qx "NODE_OPTIONS=$NODE_OPTS_PIN" \
                || die "phase9: new daemon pid $NEW_PID missing pin 'NODE_OPTIONS=$NODE_OPTS_PIN'"
        fi
        # Exactly-one daemon for the cohort (prod dual-accept counts '' too).
        DLIST="$(scan_cohort | grep '|daemon|' || true)"
        DCOUNT="$(printf '%s\n' "$DLIST" | grep -c '|daemon|' || true)"
        [[ "$DCOUNT" == 1 ]] \
            || die "phase9: expected EXACTLY ONE daemon for cohort $TARGET_HOME, found $DCOUNT [${DLIST//$'\n'/ ;; }] — double-daemon states kill each other via version takeover; REQUEST-TO-USER: investigate the listed pid(s) before retrying"
        # Zero session loss (M8 post-check).
        LOST=0
        for spid in "${BASELINE_SESSION_PIDS[@]:-}"; do
            [[ -n "$spid" ]] || continue
            if ! kill -0 "$spid" 2>/dev/null; then
                log "phase9: BASELINE SESSION LOST: pid $spid"
                LOST=$((LOST+1))
            fi
        done
        if [[ "$LOST" -gt 0 ]]; then
            verdict phase9 FAIL "$LOST baseline session(s) lost"
            die "phase9: $LOST baseline session process(es) no longer alive — forensics: audit=$AUDIT_LOG daemon_log=$(json_field "$STATE_FILE" daemonLogPath) baseline_list=${BASELINE_FILE:-<none>}"
        fi
        # API health endpoint.
        HC="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API_HEALTH" || true)"
        [[ "$HC" == "200" ]] || die "phase9: API health $API_HEALTH returned '$HC' (expected 200)"
        verdict phase9 PASS "cli: new daemon pid $NEW_PID (version $NEW_VERSION), full pin set verified, exactly-one daemon, zero session loss (${#BASELINE_SESSION_PIDS[@]} baseline), API health 200"
    fi
    if [[ "$DO_WEB" == 1 ]]; then
        RUNNING_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$WEB_SERVICE" 2>/dev/null || true)"
        [[ -n "$FRESH_IMAGE_ID" && "$RUNNING_IMAGE_ID" == "$FRESH_IMAGE_ID" ]] \
            || die "phase9: container $WEB_SERVICE image id ($RUNNING_IMAGE_ID) != freshly built id ($FRESH_IMAGE_ID) — recreate did not take; rollback pair printed"
        WHC="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:${WEB_PORT}/" || true)"
        [[ "$WHC" == "200" ]] || die "phase9: web port $WEB_PORT returned '$WHC' (expected 200) — rollback pair printed"
        verdict phase9 PASS "web: $WEB_SERVICE runs fresh image ${FRESH_IMAGE_ID:0:19}…, port $WEB_PORT serves 200"
    fi
    [[ "$DO_CLI" == 0 && "$DO_WEB" == 0 ]] && verdict phase9 SKIP "nothing selected"
fi

log "happy-safe-restart run:$RUN_ID completed (target=$TARGET component=$COMPONENT dry_run=$DRY_RUN)"
exit 0
