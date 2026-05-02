#!/usr/bin/env bash
# S14b: rollback-aborts-on-install-failure-P2  (Pass 2 #7)
# Set NPM_SHIM_FAIL=1 so global install fails AFTER reset succeeds. Verifies
# rollback.sh's M14 P2 hint emission (HEAD reset, install failed).

set -uo pipefail

SCENARIO_NAME="S14b-rollback-aborts-on-install-failure-P2"

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

# Same setup as S14: deploy v1.0.1 (PRE_TAG), deploy v1.0.2.
add_dev_file "src/feature.js" "console.log('hi');"
bump_version_in_dev_clone "1.0.1"
commit_in_dev_clone "C1"
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

git -C "$SANDBOX/dev/clone" fetch --quiet fork
git -C "$SANDBOX/dev/clone" reset --hard --quiet fork/main
bump_version_in_dev_clone "1.0.2"
commit_in_dev_clone "C2"
push_dev_to_fork
DEV_SHA_2="$(dev_head_sha)"
cd "$SANDBOX/prod/happy"
fetch_in_prod
pre_stage_all_daemons "1.0.2"
: > "$SANDBOX/log/npm.log"; : > "$SANDBOX/log/yarn.log"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA_2" "step2-deploy" >"$SANDBOX/log/deploy2.stdout" 2>&1
deploy2_rc=$?
set -e
assert_exit_code 0 "$deploy2_rc" "step2 deploy"

pre_stage_all_daemons "1.0.0"
: > "$SANDBOX/log/npm.log"; : > "$SANDBOX/log/yarn.log"

export NPM_SHIM_FAIL=1
set +e
printf 'y\n' | bash "$SANDBOX/scripts/rollback.sh" "$PRE_TAG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e
unset NPM_SHIM_FAIL

assert_exit_code 1 "$rollback_rc" "rollback.sh exit code"
assert_log_contains "$SANDBOX/log/rollback.log" "npm install -g . FAILED after reset" "P2 install failure log"
assert_log_contains "$SANDBOX/log/rollback.log" "Recovery hint (P2 post-reset / install or verification failure)" "P2 hint header"

# 1 npm install attempt
npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 1 "$npm_call_count" "npm install (1 attempt)"
# HEAD is at PRE_TAG (reset succeeded; install failed; M14b P2 design = no auto-rollback)
post_head="$(prod_head_sha)"
expected_head="$(git -C "$SANDBOX/prod/happy" rev-parse "${PRE_TAG}^{commit}")"
assert_str_eq "$expected_head" "$post_head" "HEAD == PRE_TAG (reset succeeded)"
# Safety tag exists
SAFETY_TAG="$(find_local_tag_matching "$SANDBOX/prod/happy" '^safety/.*pre-rollback')"
assert_str_match "$SAFETY_TAG" '^safety/' "safety tag exists"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
