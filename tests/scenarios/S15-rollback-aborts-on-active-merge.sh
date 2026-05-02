#!/usr/bin/env bash
# S15: rollback-aborts-on-active-merge-M3b
# .git/MERGE_HEAD presence -> rollback aborts at the M3b git-state gate.

set -uo pipefail

SCENARIO_NAME="S15-rollback-aborts-on-active-merge"

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

# Plant a fake .git/MERGE_HEAD to simulate an in-progress merge.
echo "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" > "$SANDBOX/prod/happy/.git/MERGE_HEAD"

PRE_HEAD_BEFORE="$(prod_head_sha)"
# A made-up tag — the script will abort at M3b BEFORE checking tag existence.
TAG_ARG="stable/2026-01-01-000000-deadbeef-pre-deploy"

cd "$SANDBOX/prod/happy"
set +e
bash "$SANDBOX/scripts/rollback.sh" "$TAG_ARG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

assert_exit_code 1 "$rollback_rc" "rollback.sh exit code"
assert_log_contains "$SANDBOX/log/rollback.log" "active merge: .git/MERGE_HEAD present" "M3b merge guard"

npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 0 "$npm_call_count" "npm shim count"
post_head="$(prod_head_sha)"
assert_str_eq "$PRE_HEAD_BEFORE" "$post_head" "HEAD unchanged"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
