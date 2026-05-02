#!/usr/bin/env bash
# S08: deploy-no-tag-leak-codex-11
# deploy.sh uses `git push --atomic` with EXPLICIT tag refs only — never
# `--tags`. Sentinel local tags MUST NOT be pushed to fork.

set -uo pipefail

SCENARIO_NAME="S08-deploy-no-tag-leak"

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

# Pre-create sentinel local tags BEFORE invoking. These look local-only and
# look-like-deploy-tag-format respectively. They MUST NOT leak to fork.
git -C "$SANDBOX/prod/happy" tag -a sentinel/never-push -m 'sentinel local-only'
git -C "$SANDBOX/prod/happy" tag -a stable/2020-01-01-000000-deadbeef-pre-deploy -m 'sentinel hand-crafted'

cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "no-tag-leak-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e

assert_exit_code 0 "$deploy_rc" "deploy.sh exit code"

# Fork should have EXACTLY 2 tags (PRE + DEPLOY for THIS run). Sentinels MUST
# NOT have leaked. Rather than disambiguate the deploy.sh-generated tags from
# the look-alike sentinel via regex, just count + check the sentinel names are
# absent from fork.
fork_tag_count="$(git -C "$SANDBOX/repos/fork.git" for-each-ref refs/tags --format='%(refname:short)' | wc -l | tr -d ' ')"
assert_count 2 "$fork_tag_count" "fork tag count after deploy (PRE + DEPLOY only)"

# Specific sentinels MUST be absent from fork.
fork_tags="$(git -C "$SANDBOX/repos/fork.git" for-each-ref refs/tags --format='%(refname:short)')"
if grep -F -q -x 'sentinel/never-push' <<<"$fork_tags"; then
  fail "$SCENARIO_NAME" "sentinel/never-push leaked to fork"
fi
if grep -F -q -x 'stable/2020-01-01-000000-deadbeef-pre-deploy' <<<"$fork_tags"; then
  fail "$SCENARIO_NAME" "look-alike sentinel pre-deploy tag leaked to fork"
fi

# Sentinels still exist locally (not deleted by deploy)
local_tags="$(git -C "$SANDBOX/prod/happy" for-each-ref refs/tags --format='%(refname:short)')"
if ! grep -F -q -x 'sentinel/never-push' <<<"$local_tags"; then
  fail "$SCENARIO_NAME" "sentinel/never-push missing locally (was unexpectedly deleted)"
fi
if ! grep -F -q -x 'stable/2020-01-01-000000-deadbeef-pre-deploy' <<<"$local_tags"; then
  fail "$SCENARIO_NAME" "look-alike sentinel missing locally (was unexpectedly deleted)"
fi

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
