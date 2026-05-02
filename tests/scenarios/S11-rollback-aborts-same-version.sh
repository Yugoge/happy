#!/usr/bin/env bash
# S11: rollback-aborts-same-version-codex-3-symmetric
# rollback.sh's M8 same-version trap: if PRE_ROLLBACK_VERSION ==
# TARGET_VERSION, rollback would be a silent no-op. Script aborts BEFORE reset.

set -uo pipefail

SCENARIO_NAME="S11-rollback-aborts-same-version"

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

# Bump baseline to 1.0.5 directly in dev/clone, push, deploy 1.0.5 to prod.
bump_version_in_dev_clone "1.0.5"
add_dev_file "src/feature.js" "console.log('hi');"
commit_in_dev_clone "C1: bump to 1.0.5"
push_dev_to_fork
DEV_SHA="$(dev_head_sha)"
fetch_in_prod
pre_stage_all_daemons "1.0.5"

cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "step1-deploy" >"$SANDBOX/log/deploy1.stdout" 2>&1
deploy1_rc=$?
set -e
assert_exit_code 0 "$deploy1_rc" "step1 deploy"

PRE_TAG="$(git -C "$SANDBOX/prod/happy" for-each-ref refs/tags --format='%(refname:short)' | grep -E '^stable/.*-pre-deploy$' | head -1)"
assert_str_match "$PRE_TAG" '^stable/' "PRE_TAG created"

# Now construct the same-version trap: HEAD has version 1.0.5; PRE_TAG also
# points at version 1.0.5 (because seed_baseline used 1.0.0 originally, but
# the deploy bumped it — so PRE_TAG actually points at version 1.0.0).
# To force same-version: make a NEW commit that ALSO claims version 1.0.0
# (the version PRE_TAG points at).
git -C "$SANDBOX/dev/clone" fetch --quiet fork
git -C "$SANDBOX/dev/clone" reset --hard --quiet fork/main
bump_version_in_dev_clone "1.0.0"
commit_in_dev_clone "regression: bump back to 1.0.0 (same as PRE_TAG version)"
push_dev_to_fork
DEV_SHA_REGR="$(dev_head_sha)"
cd "$SANDBOX/prod/happy"
fetch_in_prod
pre_stage_all_daemons "1.0.0"
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA_REGR" "step2-deploy" >"$SANDBOX/log/deploy2.stdout" 2>&1
deploy2_rc=$?
set -e
# This second deploy may or may not succeed depending on the version-bump trap.
# Actually: PRE_VERSION now = 1.0.5 (from step 1's tree), POST_VERSION = 1.0.0
# (from regression commit). They DIFFER, so deploy.sh accepts. Good.
assert_exit_code 0 "$deploy2_rc" "step2 deploy succeeds (versions differ 1.0.5 -> 1.0.0)"

# Now PRE_TAG (1.0.0 baseline) and HEAD (1.0.0 regression) have THE SAME
# package.json version string — exactly the same-version trap M8 detects.
# Reset shim logs for the rollback measurement.
PRE_ROLLBACK_HEAD="$(prod_head_sha)"
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"

set +e
printf 'y\n' | bash "$SANDBOX/scripts/rollback.sh" "$PRE_TAG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

assert_exit_code 1 "$rollback_rc" "rollback.sh exit code"
assert_log_contains "$SANDBOX/log/rollback.log" "Same-version trap" "same-version-trap message"
assert_log_contains "$SANDBOX/log/rollback.log" "PRE_ROLLBACK_VERSION (1.0.0)" "PRE_ROLLBACK_VERSION logged"
assert_log_contains "$SANDBOX/log/rollback.log" "TARGET_VERSION (1.0.0)" "TARGET_VERSION logged"
# safe-daemon-restart.sh stub does NOT exist -> systemctl branch fires.
assert_log_contains "$SANDBOX/log/rollback.log" "systemctl restart happy-daemon" "systemctl branch hint"

npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 0 "$npm_call_count" "npm shim count (expect 0 — abort before install)"
post_head="$(prod_head_sha)"
assert_str_eq "$PRE_ROLLBACK_HEAD" "$post_head" "HEAD unchanged"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
