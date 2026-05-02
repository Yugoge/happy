#!/usr/bin/env bash
# S15b: rollback-aborts-on-unreachable-tag  (Pass 2 #4 / M4)
# An annotated tag exists locally but points at a commit NOT reachable from
# main. rollback aborts at the M4 reachability gate.

set -uo pipefail

SCENARIO_NAME="S15b-rollback-aborts-on-unreachable-tag"

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

# Create an annotated tag on a commit that is NOT on main. We do this by
# committing on a feature branch in dev/clone, pushing the commit to fork
# under refs/sentinel/feature, fetching it into prod, then tagging that
# commit locally — main does NOT reach it.
add_dev_file "src/feature.js" "console.log('feature');"
commit_in_dev_clone "feature commit (will NOT be merged to main)"
FEATURE_SHA="$(dev_head_sha)"
git -C "$SANDBOX/dev/clone" push --quiet fork "$FEATURE_SHA:refs/sentinel/feature"

# Reset dev/clone main back to the baseline so subsequent push doesn't include
# the feature commit on main.
git -C "$SANDBOX/dev/clone" reset --hard --quiet HEAD~1

# Prod fetches the sentinel and creates an annotated tag on it. The tag must
# follow the canonical shape so it passes argv validation; it points at a
# commit not on main.
git -C "$SANDBOX/prod/happy" fetch --quiet fork '+refs/sentinel/feature:refs/sentinel/feature'
SHORT_SHA="$(git -C "$SANDBOX/prod/happy" rev-parse --short "$FEATURE_SHA")"
UNREACH_TAG="stable/2026-04-29-000000-${SHORT_SHA}-pre-deploy"
git -C "$SANDBOX/prod/happy" tag -a "$UNREACH_TAG" "$FEATURE_SHA" \
  -m "Pre-deploy rollback target before 'feature' (synthetic; not on main)"

PRE_HEAD_BEFORE="$(prod_head_sha)"

cd "$SANDBOX/prod/happy"
set +e
bash "$SANDBOX/scripts/rollback.sh" "$UNREACH_TAG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

assert_exit_code 1 "$rollback_rc" "rollback.sh exit code"
assert_log_contains "$SANDBOX/log/rollback.log" "is not reachable from main" "M4 reachability message"

npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 0 "$npm_call_count" "npm shim count"
post_head="$(prod_head_sha)"
assert_str_eq "$PRE_HEAD_BEFORE" "$post_head" "HEAD unchanged"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
