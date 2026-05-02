#!/usr/bin/env bash
# S04: deploy-aborts-wrong-cwd-codex-5  (the 2026-04-04 incident)
# deploy.sh requires PWD to realpath-equal $PROD_ROOT. Invoking from any other
# directory (here, dev/clone) MUST trigger the gate at deploy.sh:111 and
# abort BEFORE doing anything destructive.

set -uo pipefail

SCENARIO_NAME="S04-deploy-aborts-wrong-cwd"

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

# Invoke from dev/clone (NOT prod/happy) — triggers the cwd guard.
cd "$SANDBOX/dev/clone"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "wrong-cwd-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e

assert_exit_code 1 "$deploy_rc" "deploy.sh exit code"
assert_log_contains "$SANDBOX/log/deploy.log" "Must run from" "wrong-cwd guard message"

# No npm calls, no tags, no merge in prod.
npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 0 "$npm_call_count" "npm shim count"
post_tag_count="$(git -C "$SANDBOX/repos/fork.git" for-each-ref refs/tags --format='%(refname:short)' | wc -l | tr -d ' ')"
assert_count 0 "$post_tag_count" "fork tag count"
post_head="$(prod_head_sha)"
assert_str_eq "$PRE_HEAD_BEFORE" "$post_head" "prod HEAD unchanged"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
