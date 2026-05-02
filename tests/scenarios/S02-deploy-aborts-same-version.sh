#!/usr/bin/env bash
# S02: deploy-aborts-same-version-codex-3
# Verifies the codex #3 same-version trap: if dev's commit changes code but
# does NOT bump packages/happy-cli/package.json version, deploy.sh MUST abort
# AFTER the merge but BEFORE global install (so daemons keep running OLD
# code is impossible).

set -uo pipefail

SCENARIO_NAME="S02-deploy-aborts-same-version"

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

# Author C1 in dev/clone with code change BUT version unchanged at 1.0.0
add_dev_file "src/feature.js" "console.log('hi');"
commit_in_dev_clone "C1: change code, NO version bump"
push_dev_to_fork
DEV_SHA="$(dev_head_sha)"
fetch_in_prod

# Daemons at 1.0.0 (same as prod and target)
pre_stage_all_daemons "1.0.0"

PRE_HEAD_BEFORE="$(prod_head_sha)"

cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "same-version-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e

assert_exit_code 1 "$deploy_rc" "deploy.sh exit code"
assert_log_contains "$SANDBOX/log/deploy.log" "package.json version unchanged" "version-unchanged log line"
assert_log_contains "$SANDBOX/log/deploy.log" "Version not bumped" "abort message"
assert_log_contains "$SANDBOX/log/deploy.log" "rolling back: git reset --hard" "rollback was attempted"

# npm install MUST NOT have been called (script aborts before global install).
npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 0 "$npm_call_count" "npm shim invocation count (expect 0 — abort before install)"

# HEAD reset to PRE_HEAD_BEFORE
post_head="$(prod_head_sha)"
assert_str_eq "$PRE_HEAD_BEFORE" "$post_head" "HEAD restored to PRE_HEAD"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
