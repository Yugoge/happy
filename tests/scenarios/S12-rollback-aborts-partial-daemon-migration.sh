#!/usr/bin/env bash
# S12: rollback-aborts-partial-daemon-migration-M14-P3
# Run a deploy first to get a real PRE_TAG, then bump again and deploy v1.0.2,
# then invoke rollback to PRE_TAG with 2 of 3 daemons NOT migrated. The
# polling loop with DAEMON_AUTO_UPGRADE_WAIT_SECONDS=0 + DAEMON_POLL_INTERVAL=1
# concludes "stale" within 1 iteration; abort fires P3 hint with systemctl
# branch (since safe-daemon-restart.sh stub doesn't exist).

set -uo pipefail

SCENARIO_NAME="S12-rollback-aborts-partial-daemon-migration"

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

mk_sandbox
trap 'cleanup_sandbox' EXIT
set_env

setup_baseline_rollback_fixture || exit $?

# Step 1: deploy v1.0.1 to produce a real PRE_TAG.
add_dev_file "src/feature.js" "console.log('hi');"
bump_version_in_dev_clone "1.0.1"
commit_in_dev_clone "C1: bump to 1.0.1"
push_dev_to_fork
DEV_SHA_1="$(dev_head_sha)"
fetch_in_prod
pre_stage_all_daemons "1.0.1"

cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA_1" "step1-deploy" >"$SANDBOX/log/deploy1.stdout" 2>&1
deploy1_rc=$?
set -e
assert_exit_code 0 "$deploy1_rc" "step1 deploy"
PRE_TAG="$(git -C "$SANDBOX/prod/happy" for-each-ref refs/tags --format='%(refname:short)' | grep -E '^stable/.*-pre-deploy$' | head -1)"

# Step 2: deploy v1.0.2 so we have something to roll back FROM.
git -C "$SANDBOX/dev/clone" fetch --quiet fork
git -C "$SANDBOX/dev/clone" reset --hard --quiet fork/main
bump_version_in_dev_clone "1.0.2"
add_dev_file "src/regression.js" "console.log('regression');"
commit_in_dev_clone "C2: bump to 1.0.2"
push_dev_to_fork
DEV_SHA_2="$(dev_head_sha)"
cd "$SANDBOX/prod/happy"
fetch_in_prod
pre_stage_all_daemons "1.0.2"
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA_2" "step2-deploy" >"$SANDBOX/log/deploy2.stdout" 2>&1
deploy2_rc=$?
set -e
assert_exit_code 0 "$deploy2_rc" "step2 deploy"

# Step 3: rollback to PRE_TAG (v1.0.0). Pre-stage 2 daemons at TARGET (1.0.0)
# and 1 daemon at the OLD version (1.0.2 — stale from rollback's perspective).
pre_stage_daemon "$SANDBOX/daemons/default" "1.0.0"
pre_stage_daemon "$SANDBOX/daemons/jade"    "1.0.0"
pre_stage_daemon "$SANDBOX/daemons/qijie"   "1.0.2"   # STALE
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"

# Setup never creates safe-daemon-restart.sh stub, so the runtime test in
# rollback.sh:146 (rewritten to check $SANDBOX/bin/safe-daemon-restart.sh)
# fails -> systemctl-branch hint fires.
assert_file_absent "$SANDBOX/bin/safe-daemon-restart.sh" "SOP stub absent (will trigger systemctl branch)"

set +e
printf 'y\n' | bash "$SANDBOX/scripts/rollback.sh" "$PRE_TAG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

assert_exit_code 1 "$rollback_rc" "rollback.sh exit code"
assert_log_contains "$SANDBOX/log/rollback.log" "daemon(s) still STALE at deadline" "stale-daemon abort message"
assert_log_contains "$SANDBOX/log/rollback.log" "Recovery hint (P3 post-install / daemon migration incomplete)" "P3 hint header"
# systemctl branch fires (SOP stub absent)
assert_log_contains "$SANDBOX/log/rollback.log" "systemctl restart happy-daemon" "systemctl restart hint"
assert_log_not_contains "$SANDBOX/log/rollback.log" "Per-daemon manual restart (SOP available)" "SOP branch did NOT fire"

# install ran (we got past P2)
npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 1 "$npm_call_count" "npm install ran (1 call)"
# HEAD is at PRE_TAG (reset succeeded; only daemon migration failed)
post_head="$(prod_head_sha)"
expected_head="$(git -C "$SANDBOX/prod/happy" rev-parse "${PRE_TAG}^{commit}")"
assert_str_eq "$expected_head" "$post_head" "HEAD == PRE_TAG (reset succeeded)"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
