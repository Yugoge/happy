#!/usr/bin/env bash
# S06: deploy-aborts-on-test-gate-failure-codex-14
# When `yarn workspace happy-cli test` fails, deploy.sh MUST abort and reset
# HEAD. The yarn shim's YARN_TEST_FAIL=1 mode exits 1 only on `test` argv,
# letting `install --frozen-lockfile` succeed first.

set -uo pipefail

SCENARIO_NAME="S06-deploy-aborts-on-test-gate-failure"

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

export YARN_TEST_FAIL=1
cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "test-fail-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e
unset YARN_TEST_FAIL

assert_exit_code 1 "$deploy_rc" "deploy.sh exit code"
assert_log_contains "$SANDBOX/log/deploy.log" "Test suite FAILED" "test failure logged"
assert_log_contains "$SANDBOX/log/deploy.log" "rolling back: git reset --hard" "rollback attempted"

# yarn shim should have been called for both install and test
assert_log_contains "$SANDBOX/log/yarn.log" "ARGV=install --frozen-lockfile" "yarn install passed"
assert_log_contains "$SANDBOX/log/yarn.log" "ARGV=workspace happy-cli test" "yarn test was attempted"

# npm install MUST NOT have been called (test gate is BEFORE global install).
npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 0 "$npm_call_count" "npm shim count (expect 0 — test gate is before install)"

post_head="$(prod_head_sha)"
assert_str_eq "$PRE_HEAD_BEFORE" "$post_head" "prod HEAD restored to PRE_HEAD"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
