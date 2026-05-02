#!/usr/bin/env bash
# S09: deploy-push-fails-local-still-good-codex-8
# When push to fork fails (e.g., pre-receive hook returns 1), deploy.sh
# logs the failure but DOES NOT reset HEAD or re-install. The local state
# is correct; only the fork remote is out of sync.

set -uo pipefail

SCENARIO_NAME="S09-deploy-push-fails-local-still-good"

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

# Plant a pre-receive hook on fork.git that always fails the push.
mkdir -p "$SANDBOX/repos/fork.git/hooks"
cat >"$SANDBOX/repos/fork.git/hooks/pre-receive" <<'HOOK'
#!/usr/bin/env bash
echo "pre-receive: rejecting (S09 test)" >&2
exit 1
HOOK
chmod +x "$SANDBOX/repos/fork.git/hooks/pre-receive"

PRE_FORK_MAIN="$(git -C "$SANDBOX/repos/fork.git" rev-parse main)"

cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "push-fails-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e

assert_exit_code 1 "$deploy_rc" "deploy.sh exit code"
assert_log_contains "$SANDBOX/log/deploy.log" "Push FAILED" "push failure logged"
assert_log_contains "$SANDBOX/log/deploy.log" "Local state is correct" "local-state-correct message"

# 1 npm install (no rollback install — local state is preserved).
npm_call_count="$(wc -l < "$SANDBOX/log/npm.log" | tr -d ' ')"
assert_count 1 "$npm_call_count" "npm shim count (1 install, no rollback)"

# Prod HEAD is the merged commit (NOT reset). Local prod has 2 tags.
local_tag_count="$(git -C "$SANDBOX/prod/happy" for-each-ref refs/tags --format='%(refname:short)' | wc -l | tr -d ' ')"
assert_count 2 "$local_tag_count" "prod local tag count (PRE+DEPLOY)"

# Fork main MUST be unchanged (push was rejected).
post_fork_main="$(git -C "$SANDBOX/repos/fork.git" rev-parse main)"
assert_str_eq "$PRE_FORK_MAIN" "$post_fork_main" "fork/main unchanged"

# Fork has 0 deploy tags (the atomic push failed; no tags pushed either).
fork_tag_count="$(git -C "$SANDBOX/repos/fork.git" for-each-ref refs/tags --format='%(refname:short)' | wc -l | tr -d ' ')"
assert_count 0 "$fork_tag_count" "fork tag count (atomic push failed)"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
