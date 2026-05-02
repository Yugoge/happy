#!/usr/bin/env bash
# S03b: deploy-aborts-unreachable-dev-sha-codex-10  (Pass 2 #2)
# A commit that exists locally in dev/clone but has NOT been pushed to fork
# is "dangling" — deploy.sh's git-cat-file lookup succeeds locally because
# fetch happened, but the branch-reachability check (`git branch -r --contains`)
# fails. Operator sees a WARN+confirm; declining (n) aborts.
#
# IMPORTANT TEST-DESIGN NOTE (codex iter3 Q3 sub-finding, BA L17):
# To exercise this gate, the commit must be locally KNOWN to prod (via fetch
# of any ref containing the commit) but NOT on any fork/* BRANCH. We achieve
# this by creating a non-branch ref `refs/sentinel/dangling` in fork.git that
# points at the commit, then fetching it explicitly into prod via that
# fully-qualified refspec. fork's main is unchanged so the commit is NOT on
# fork/main; the refs/sentinel/* namespace is NOT mirrored under refs/remotes/
# so `git branch -r --contains` does not see it.

set -uo pipefail

SCENARIO_NAME="S03b-deploy-aborts-unreachable-dev-sha"

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

# Author C-DANGLING in dev/clone — DO NOT push to fork's main.
add_dev_file "src/dangling.js" "console.log('dangling');"
bump_version_in_dev_clone "1.0.1"
commit_in_dev_clone "C-DANGLING: dangling commit (not on fork main)"
DEV_SHA="$(dev_head_sha)"

# Push the commit to fork via a non-branch ref. This makes the object reachable
# in fork.git's object store (so prod's fetch can pull it) but it is NOT under
# refs/heads/ so prod's `git branch -r --contains` returns nothing for fork/*.
git -C "$SANDBOX/dev/clone" push --quiet fork "$DEV_SHA:refs/sentinel/dangling"

# Prod fetches the sentinel ref explicitly. This populates prod's object store
# with the commit AND creates a local refs/sentinel/dangling, but does NOT
# create any refs/remotes/fork/* branch containing it.
git -C "$SANDBOX/prod/happy" fetch --quiet fork '+refs/sentinel/dangling:refs/sentinel/dangling'

pre_stage_all_daemons "1.0.1"

cd "$SANDBOX/prod/happy"
set +e
# Two confirms fire here:
#  1) untracked-files (NO untracked, will not fire)
#  2) dev-SHA reachability WARN+confirm — feed `n` to decline
printf 'n\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "unreachable-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e

assert_exit_code 1 "$deploy_rc" "deploy.sh exit code"
assert_log_contains "$SANDBOX/log/deploy.log" "is not reachable from any" "unreachable-warning logged"
assert_log_contains "$SANDBOX/log/deploy.log" "User declined" "user-decline abort"

npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 0 "$npm_call_count" "npm shim invocation count (expect 0 — abort before install)"

# No tags created in fork.git
post_tag_count="$(git -C "$SANDBOX/repos/fork.git" for-each-ref refs/tags --format='%(refname:short)' | wc -l | tr -d ' ')"
assert_count 0 "$post_tag_count" "fork tag count after aborted deploy (expect 0)"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
