#!/usr/bin/env bash
# S16: rollback-fork-divergence-and-missing-fork-main  (Pass 2 #10)
# Variant A: standard rollback OK; verify fork-divergence ahead-count matches
#            git rev-list output AND log advisory text contains both forward
#            paths AND the script does NOT fetch.
# Variant B: same setup but DELETE refs/remotes/fork/main locally, so the `?`
#            placeholder + "not configured locally" message fires.

set -uo pipefail

SCENARIO_NAME="S16-rollback-fork-divergence-and-missing-fork-main"

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

# Helper: produce PRE_TAG by deploying v1.0.1, then deploy v1.0.2 so we have
# something to roll back FROM.
_setup_for_rollback() {
  add_dev_file "src/feature.js" "console.log('hi');"
  bump_version_in_dev_clone "1.0.1"
  commit_in_dev_clone "C1"
  push_dev_to_fork
  local sha1
  sha1="$(dev_head_sha)"
  fetch_in_prod
  pre_stage_all_daemons "1.0.1"
  cd "$SANDBOX/prod/happy"
  printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$sha1" "step1-deploy" >"$SANDBOX/log/deploy1.stdout" 2>&1
  PRE_TAG="$(git -C "$SANDBOX/prod/happy" for-each-ref refs/tags --format='%(refname:short)' | grep -E '^stable/.*-pre-deploy$' | head -1)"
  git -C "$SANDBOX/dev/clone" fetch --quiet fork
  git -C "$SANDBOX/dev/clone" reset --hard --quiet fork/main
  bump_version_in_dev_clone "1.0.2"
  commit_in_dev_clone "C2"
  push_dev_to_fork
  local sha2
  sha2="$(dev_head_sha)"
  cd "$SANDBOX/prod/happy"
  fetch_in_prod
  pre_stage_all_daemons "1.0.2"
  printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$sha2" "step2-deploy" >"$SANDBOX/log/deploy2.stdout" 2>&1
}

# ---------- Variant A: standard happy rollback + divergence-count assertion --

mk_sandbox
trap 'cleanup_sandbox' EXIT
set_env
setup_baseline_rollback_fixture || exit $?
_setup_for_rollback

pre_stage_all_daemons "1.0.0"
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"

set +e
printf 'y\n' | bash "$SANDBOX/scripts/rollback.sh" "$PRE_TAG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

assert_exit_code 0 "$rollback_rc" "Variant A: rollback.sh exit code"
assert_log_contains "$SANDBOX/log/rollback.log" "ROLLBACK OK" "Variant A: rollback OK"

# Compute the EXPECTED fork-divergence count AFTER rollback:
# fork/main is unchanged (rollback does not push); HEAD is now at PRE_TAG;
# so fork/main is ahead by (rev-list count from PRE_TAG to fork/main).
EXPECTED_AHEAD="$(git -C "$SANDBOX/prod/happy" rev-list --count "${PRE_TAG}..refs/remotes/fork/main" 2>/dev/null || true)"
assert_log_contains "$SANDBOX/log/rollback.log" "fork/main is now AHEAD of HEAD by ${EXPECTED_AHEAD} commit(s)" \
  "Variant A: divergence count matches rev-list"
assert_log_contains "$SANDBOX/log/rollback.log" "(a) Force-push" "Variant A: forward path (a) present"
assert_log_contains "$SANDBOX/log/rollback.log" "(b) Tag-based forward roll" "Variant A: forward path (b) present"
assert_log_contains "$SANDBOX/log/rollback.log" "--force-with-lease=main:" "Variant A: force-with-lease command"

# Important: rollback MUST NOT fetch (no real network; verify by ensuring
# no .git/FETCH_HEAD was rewritten during this invocation. We approximate
# by checking that the rollback log has no 'Fetching' or 'fetch fork' string.
assert_log_not_contains "$SANDBOX/log/rollback.log" "Fetching from fork" "Variant A: no fetch invocation"

# Cleanup variant A
cleanup_sandbox
trap - EXIT

# ---------- Variant B: missing fork/main local tracking branch --------------

mk_sandbox
trap 'cleanup_sandbox' EXIT
set_env
setup_baseline_rollback_fixture || exit $?
_setup_for_rollback

# Delete refs/remotes/fork/main so the script's optional rev-list can't find it.
git -C "$SANDBOX/prod/happy" update-ref -d refs/remotes/fork/main

pre_stage_all_daemons "1.0.0"
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"

set +e
printf 'y\n' | bash "$SANDBOX/scripts/rollback.sh" "$PRE_TAG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

assert_exit_code 0 "$rollback_rc" "Variant B: rollback.sh exit code"
assert_log_contains "$SANDBOX/log/rollback.log" "AHEAD of HEAD by ? commit(s)" "Variant B: ? placeholder"
assert_log_contains "$SANDBOX/log/rollback.log" "or its main branch not configured locally" "Variant B: not-configured hint"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
