#!/usr/bin/env bash
# S07: deploy-aborts-on-install-failure-and-restores-codex-14-install-side
# Global `npm install -g .` fails on first call. deploy.sh logs the failure,
# resets HEAD, and re-attempts npm install -g . (the rollback re-install).
# NPM_SHIM_FAIL_FIRST_N=1 makes the first call fail, second succeed.

set -uo pipefail

SCENARIO_NAME="S07-deploy-aborts-on-install-failure-and-restores"

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

setup_baseline_deploy_fixture || exit $?

add_dev_file "src/feature.js" "console.log('hi');"
bump_version_in_dev_clone "1.0.1"
commit_in_dev_clone "C1: bump + feature"
push_dev_to_fork
DEV_SHA="$(dev_head_sha)"
fetch_in_prod
pre_stage_all_daemons "1.0.1"

PRE_HEAD_BEFORE="$(prod_head_sha)"

export NPM_SHIM_FAIL_FIRST_N=1
cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "install-fail-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e
unset NPM_SHIM_FAIL_FIRST_N

assert_exit_code 1 "$deploy_rc" "deploy.sh exit code"
assert_log_contains "$SANDBOX/log/deploy.log" "npm install -g FAILED" "first install failure logged"
assert_log_contains "$SANDBOX/log/deploy.log" "Attempting auto-rollback install" "rollback install attempt logged"

# 2 npm calls: first FAILED (install -g .), then ROLLBACK install (also install -g .).
npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 2 "$npm_call_count" "npm shim count (1 failed + 1 rollback)"

post_head="$(prod_head_sha)"
assert_str_eq "$PRE_HEAD_BEFORE" "$post_head" "prod HEAD restored to PRE_HEAD"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
