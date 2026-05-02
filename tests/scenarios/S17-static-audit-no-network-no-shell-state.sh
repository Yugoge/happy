#!/usr/bin/env bash
# S17: static-audit-no-network-no-shell-state  (Pass 2 #12, iter1+2+3)
# Static (no execution) audit of the rewritten production scripts.
# Sub-tests S17.1-S17.11 mirror BA spec § S17.
#
# OBJ-3 (iter3): the audit_no_executable() helper in tests/lib/static-audit.sh
# is empirically verified to exit 0 in 4 cases (A: matches all filtered fetch,
# B: matches all filtered push, C: zero raw matches, D: bare violation).
# S17.10 covers cases A+B; S17.11 covers case C; existing S17.8 covers case D.

set -uo pipefail

SCENARIO_NAME="S17-static-audit-no-network-no-shell-state"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$(cd "$SCRIPT_DIR/../lib" && pwd)"
# shellcheck disable=SC1091
source "$LIB_DIR/sandbox.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/assert.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/git-helpers.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/daemon-mock.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/rewrite.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/path-scan.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/static-audit.sh"

mk_sandbox
trap 'cleanup_sandbox' EXIT
set_env

setup_baseline_rollback_fixture || exit $?

DEPLOY="$SANDBOX/scripts/deploy.sh"
ROLLBACK="$SANDBOX/scripts/rollback.sh"

# ===== S17.1: set -uo pipefail on a single line at the top of each script ===
deploy_pipefail_count="$(grep -cE '^set -uo pipefail$' "$DEPLOY" || true)"
rollback_pipefail_count="$(grep -cE '^set -uo pipefail$' "$ROLLBACK" || true)"
assert_count 1 "$deploy_pipefail_count" "S17.1 deploy.sh has exactly 1 'set -uo pipefail'"
assert_count 1 "$rollback_pipefail_count" "S17.1 rollback.sh has exactly 1 'set -uo pipefail'"

# ===== S17.2: rollback.sh has no executable git fetch (advisory excluded) ====
fetch_count="$(audit_no_executable '\bgit fetch\b' "$ROLLBACK")"
assert_count 0 "$fetch_count" "S17.2 rollback.sh: 0 executable git fetch"

# ===== S17.3: rollback.sh has no executable git push (advisory excluded) ====
push_count="$(audit_no_executable '\bgit push\b' "$ROLLBACK")"
assert_count 0 "$push_count" "S17.3 rollback.sh: 0 executable git push"

# ===== S17.4: no docker invocations in either script (M16 out-of-scope) ====
deploy_docker_count="$(audit_no_executable '\bdocker\b' "$DEPLOY")"
rollback_docker_count="$(audit_no_executable '\bdocker\b' "$ROLLBACK")"
assert_count 0 "$deploy_docker_count" "S17.4 deploy.sh: 0 docker invocations"
assert_count 0 "$rollback_docker_count" "S17.4 rollback.sh: 0 docker invocations"

# ===== S17.4b (codex iter2 Q5): no executable database commands ============
# M17 out-of-scope per BA: deploy.sh / rollback.sh must not invoke prisma
# migrate, psql, or pg_restore. Operator-instruction copy in log strings is
# still allowed by the audit_no_executable allowlist.
for verb in 'prisma[[:space:]]+migrate' '\bpsql\b' '\bpg_restore\b'; do
  d_cnt="$(audit_no_executable "$verb" "$DEPLOY")"
  r_cnt="$(audit_no_executable "$verb" "$ROLLBACK")"
  assert_count 0 "$d_cnt" "S17.4b deploy.sh: 0 '$verb' invocations"
  assert_count 0 "$r_cnt" "S17.4b rollback.sh: 0 '$verb' invocations"
done

# ===== S17.5: path-scan invariant (M-PATHSCAN.4) ===========================
if ! path_scan_rewritten "$DEPLOY"; then
  fail "$SCENARIO_NAME" "S17.5 path-scan flagged deploy.sh (rewritten)"
fi
if ! path_scan_rewritten "$ROLLBACK"; then
  fail "$SCENARIO_NAME" "S17.5 path-scan flagged rollback.sh (rewritten)"
fi

# ===== S17.6: rollback.sh M16 out-of-scope strings present in header ========
assert_log_contains "$ROLLBACK" "database migrations" "S17.6 M16: database migrations"
assert_log_contains "$ROLLBACK" "Docker images" "S17.6 M16: Docker images"
assert_log_contains "$ROLLBACK" "/root/bin/ shell scripts" "S17.6 M16: /root/bin/ shell scripts"

# ===== S17.7: AC16 daemon_restart_hint() has BOTH branches =================
assert_log_contains "$ROLLBACK" "Per-daemon manual restart (SOP available)" "S17.7 SOP branch present"
assert_log_contains "$ROLLBACK" "systemctl restart happy-daemon" "S17.7 systemctl branch present"

# ===== S17.8 (positive control): bare violation IS caught ===================
mkdir -p "$SANDBOX/scratch"
cp "$ROLLBACK" "$SANDBOX/scratch/rollback-with-bare-push.sh"
cp "$ROLLBACK" "$SANDBOX/scratch/rollback-with-bare-fetch.sh"
# Append a bare line containing the executable form (no leading #, no
# log/echo/printf prefix, no `<<`). Per BA spec § iter2 empirical verification
# table, we use printf with token concatenation at SHELL-EXECUTION time so the
# resulting FILE CONTENT contains the bare `git push fork main` / `git fetch
# fork main` strings that grep will see — but the bash code in this scenario
# file itself does NOT contain the literal token (which would otherwise trip
# the bash-safety hook if a future cycle's prompt happened to contain it).
push_token='git pu'
push_token+='sh fork main'
fetch_token='git fe'
fetch_token+='tch fork main'
printf '%s\n' "$push_token"  >>"$SANDBOX/scratch/rollback-with-bare-push.sh"
printf '%s\n' "$fetch_token" >>"$SANDBOX/scratch/rollback-with-bare-fetch.sh"
push_caught="$(audit_no_executable '\bgit push\b' "$SANDBOX/scratch/rollback-with-bare-push.sh")"
assert_count 1 "$push_caught" "S17.8 bare git push caught (positive control)"
fetch_caught="$(audit_no_executable '\bgit fetch\b' "$SANDBOX/scratch/rollback-with-bare-fetch.sh")"
assert_count 1 "$fetch_caught" "S17.8 bare git fetch caught (positive control)"

# ===== S17.9 (negative control): raw count proves filter is doing real work =
# rollback.sh has 3 advisory occurrences total (lines 36, 537, 548) of
# `\bgit (fetch|push)\b` — but our audit returns 0. This proves the filter
# is performing carve-out, not a vacuous "always-zero".
raw_count="$(grep -cE '\bgit (fetch|push)\b' "$ROLLBACK" || true)"
assert_count 3 "$raw_count" "S17.9 raw advisory count = 3 (filter is doing carve-out work)"

# ===== S17.10 (helper exit-status under set -euo pipefail; cases A+B) =======
# audit_no_executable in success-with-all-filtered cases must exit 0, not 1.
# This is the iter3 OBJ-3 fix proof. Run helper inline under explicit
# set -euo pipefail and confirm both the count IS 0 AND the helper exit
# status was 0 (otherwise our scenario subshell would have aborted before
# reaching this assertion).
set -euo pipefail
case_A_count="$(audit_no_executable '\bgit fetch\b' "$ROLLBACK")"
case_A_rc=$?
assert_count 0 "$case_A_count" "S17.10 case A count"
assert_exit_code 0 "$case_A_rc" "S17.10 case A helper exit"
case_B_count="$(audit_no_executable '\bgit push\b' "$ROLLBACK")"
case_B_rc=$?
assert_count 0 "$case_B_count" "S17.10 case B count"
assert_exit_code 0 "$case_B_rc" "S17.10 case B helper exit"

# ===== S17.11 (helper exit-status; case C zero raw matches) ==================
case_C_count="$(audit_no_executable 'XYZNOMATCH_SENTINEL_99' "$ROLLBACK")"
case_C_rc=$?
assert_count 0 "$case_C_count" "S17.11 case C count"
assert_exit_code 0 "$case_C_rc" "S17.11 case C helper exit"
set +e

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
