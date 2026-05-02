#!/usr/bin/env bash
# S01: deploy-happy-path-clean-version-bump
# (Phase 1 self-check; AC1)
#
# GIVEN: fork.git seeded with C0 (version 1.0.0); dev/clone bumps to 1.0.1 +
#        adds a non-protected change + pushes as C1; prod/happy at C0; all 3
#        daemon.state.json pre-staged with version=1.0.1.
# WHEN:  bash $SANDBOX/scripts/deploy.sh <C1-SHA> happy-path-test  invoked
#        from prod/happy with stdin 'y\ny\ny\n' (3 confirms: untracked,
#        post-test, daemon-migration).
# THEN:  exit 0 AND deploy.log contains "DEPLOY OK" AND npm.log shows exactly
#        1 install AND fork has exactly PRE_TAG + DEPLOY_TAG (no extras) AND
#        fork main = prod main HEAD.

set -uo pipefail

SCENARIO_NAME="S01-deploy-happy-path"

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

# Setup ---------------------------------------------------------------------
mk_sandbox
trap 'cleanup_sandbox' EXIT
set_env

# Baseline fixture: bare fork + dev clone + prod clone + C0 + rewrite + path-scan.
# Returns 2 on rewrite/path-scan failure -> propagate to runner as SETUP-FAIL.
setup_baseline_deploy_fixture || exit $?

# Author C1 in dev/clone: bump version + add non-protected file
bump_version_in_dev_clone "1.0.1"
add_dev_file "src/feature.js" "console.log('hi');"
commit_in_dev_clone "C1: bump to 1.0.1 + add feature"
push_dev_to_fork
DEV_SHA="$(dev_head_sha)"
fetch_in_prod                              # prod sees the new commit

# Daemons pre-staged with TARGET version 1.0.1 — so the deploy.sh post-install
# loop sees them as already migrated (mirrors real auto-upgrade completing).
pre_stage_all_daemons "1.0.1"

# Capture pre-deploy fork tag set (should be empty)
pre_tag_count="$(git -C "$SANDBOX/repos/fork.git" for-each-ref refs/tags --format='%(refname:short)' | wc -l | tr -d ' ')"
assert_count 0 "$pre_tag_count" "fork tag count before deploy"

# Run ----------------------------------------------------------------------
# Happy path triggers exactly ONE confirm prompt: the post-test "Proceed with
# global install?" at deploy.sh:298. The other 4 confirms (untracked, dev-SHA
# reachability, recovery-script missing, stale daemons) do NOT fire in this
# fixture because: no untracked files exist, DEV_SHA was pushed to fork, the
# recovery-stub is executable, and all daemons are pre-staged at TARGET.
# Per codex iter1 review #2: feed exactly 1 `y\n` so any new prompt would
# block on EOF and surface as a test failure rather than getting silently
# swallowed.
cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "happy-path-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e

# Assert -------------------------------------------------------------------
assert_exit_code 0 "$deploy_rc" "deploy.sh exit code"
assert_log_contains "$SANDBOX/log/deploy.log" "DEPLOY OK" "deploy log final marker"
assert_log_contains "$SANDBOX/log/deploy.log" "Test gate passed" "test gate executed"

# Exactly 1 install call (the global install). Per codex iter1 review #3:
# also assert the npm call's argv and PWD so a regression to wrong cwd or
# a different npm command would FAIL the scenario rather than silently pass.
npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 1 "$npm_call_count" "npm shim invocation count (expect 1 global install)"
assert_log_contains "$SANDBOX/log/npm.log" "PWD=$SANDBOX/prod/happy" "npm install PWD"
assert_log_contains "$SANDBOX/log/npm.log" "ARGV=install -g ." "npm install argv"

# Yarn shim must see the frozen-lockfile install + workspace test invocation.
assert_log_contains "$SANDBOX/log/yarn.log" "ARGV=install --frozen-lockfile" "yarn frozen-lockfile install"
assert_log_contains "$SANDBOX/log/yarn.log" "ARGV=workspace happy-cli test" "yarn workspace happy-cli test"

# Fork tags = exactly 2 (PRE_TAG + DEPLOY_TAG).
post_tag_count="$(git -C "$SANDBOX/repos/fork.git" for-each-ref refs/tags --format='%(refname:short)' | wc -l | tr -d ' ')"
assert_count 2 "$post_tag_count" "fork tag count after deploy"

# Fork main equals prod main.
fork_head="$(git -C "$SANDBOX/repos/fork.git" rev-parse main)"
prod_head="$(prod_head_sha)"
assert_str_eq "$fork_head" "$prod_head" "fork/main == prod HEAD"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
