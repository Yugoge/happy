#!/usr/bin/env bash
# S11b: rollback-bad-argv-exits-2  (Pass 2 #6)
# rollback.sh distinguishes argv error (exit 2) from runtime error (exit 1).
# Verifies M19 + AC2 distinct exit codes.

set -uo pipefail

SCENARIO_NAME="S11b-rollback-bad-argv-exits-2"

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

PRE_HEAD_BEFORE="$(prod_head_sha)"

cd "$SANDBOX/prod/happy"
set +e
bash "$SANDBOX/scripts/rollback.sh" "not-a-stable-tag" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

# Argv error MUST exit 2 (M19) — distinct from runtime abort (exit 1).
assert_exit_code 2 "$rollback_rc" "rollback.sh exit code (argv error)"
assert_log_contains "$SANDBOX/log/rollback.stderr" "ARGV ERROR" "argv error stderr"
assert_log_contains "$SANDBOX/log/rollback.log" "ARGV ERROR" "argv error log"

npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 0 "$npm_call_count" "npm shim count"
post_head="$(prod_head_sha)"
assert_str_eq "$PRE_HEAD_BEFORE" "$post_head" "HEAD unchanged"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
