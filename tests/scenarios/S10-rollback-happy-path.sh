#!/usr/bin/env bash
# S10: rollback-happy-path
# Run a deploy first to produce a real PRE_TAG (annotated, deploy.sh-shaped),
# then bump to a third version, then invoke rollback.sh PRE_TAG.

set -uo pipefail

SCENARIO_NAME="S10-rollback-happy-path"

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

# Step 1: deploy 1.0.1 to produce a deploy.sh-shaped PRE_TAG (= the snapshot
# of v1.0.0 we'll roll back to).
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
assert_exit_code 0 "$deploy1_rc" "step1 deploy.sh"

# Identify the PRE_TAG produced by step 1 — the one ending in -pre-deploy.
PRE_TAG="$(git -C "$SANDBOX/prod/happy" for-each-ref refs/tags --format='%(refname:short)' | grep -E '^stable/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[0-9a-f]{7,40}-pre-deploy$' | head -1)"
assert_str_match "$PRE_TAG" '^stable/' "PRE_TAG was created by deploy step 1"

# Step 2: deploy 1.0.2 so we have something to roll back FROM.
# First sync dev/clone with fork (which now has step1's merge commit + tags).
git -C "$SANDBOX/dev/clone" fetch --quiet fork
git -C "$SANDBOX/dev/clone" reset --hard --quiet fork/main
bump_version_in_dev_clone "1.0.2"
add_dev_file "src/regression.js" "console.log('regression');"
commit_in_dev_clone "C2: bump to 1.0.2 (the one we will roll back FROM)"
push_dev_to_fork
DEV_SHA_2="$(dev_head_sha)"
cd "$SANDBOX/prod/happy"
fetch_in_prod
pre_stage_all_daemons "1.0.2"
# Reset npm/yarn shim logs so step 3's invocation count is clean
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA_2" "step2-deploy" >"$SANDBOX/log/deploy2.stdout" 2>&1
deploy2_rc=$?
set -e
assert_exit_code 0 "$deploy2_rc" "step2 deploy.sh"

# Step 3: rollback to PRE_TAG. Daemons pre-staged at TARGET version 1.0.0.
pre_stage_all_daemons "1.0.0"
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"

set +e
printf 'y\n' | bash "$SANDBOX/scripts/rollback.sh" "$PRE_TAG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

assert_exit_code 0 "$rollback_rc" "rollback.sh exit code"
assert_log_contains "$SANDBOX/log/rollback.log" "ROLLBACK OK" "rollback success marker"
assert_log_contains "$SANDBOX/log/rollback.log" "=== Fork divergence after rollback ===" "fork-divergence advisory present"

# HEAD is now at PRE_TAG.
post_head="$(prod_head_sha)"
expected_head="$(git -C "$SANDBOX/prod/happy" rev-parse "${PRE_TAG}^{commit}")"
assert_str_eq "$expected_head" "$post_head" "HEAD = PRE_TAG commit"

# Safety tag exists.
SAFETY_TAG="$(find_local_tag_matching "$SANDBOX/prod/happy" '^safety/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[0-9a-f]+-pre-rollback')"
assert_str_match "$SAFETY_TAG" '^safety/' "safety tag created"

# Yarn install --frozen-lockfile + workspace happy-cli build called (rollback's rebuild).
assert_log_contains "$SANDBOX/log/yarn.log" "ARGV=install --frozen-lockfile" "yarn install ran during rebuild"
assert_log_contains "$SANDBOX/log/yarn.log" "ARGV=workspace happy-cli build" "yarn build ran"
# npm install -g . called once for the rolled-back tree.
npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 1 "$npm_call_count" "npm install (rollback)"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
