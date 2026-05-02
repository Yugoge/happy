#!/usr/bin/env bash
# S05: deploy-aborts-dirty-tree-codex-9
# deploy.sh refuses to deploy with uncommitted modifications to tracked files.
# This guards against working-tree state leaking into npm install -g.

set -uo pipefail

SCENARIO_NAME="S05-deploy-aborts-dirty-tree"

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

# Pollute prod tree with an UNSTAGED modification to a tracked file (CLAUDE.md
# is a known tracked file from seed_baseline). This trips deploy.sh's
# `git diff --quiet` gate.
echo 'dirty-modification' >> "$SANDBOX/prod/happy/CLAUDE.md"

PRE_HEAD_BEFORE="$(prod_head_sha)"

cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "dirty-tree-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e

assert_exit_code 1 "$deploy_rc" "deploy.sh exit code"
assert_log_contains "$SANDBOX/log/deploy.log" "Refusing to deploy with uncommitted changes" "dirty-tree guard message"

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
