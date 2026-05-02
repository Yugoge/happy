#!/usr/bin/env bash
# S03: deploy-restores-protected-paths-codex-1-2
# Verifies the load-bearing fix for codex #1+#2: protected paths from PRE_HEAD
# are restored byte-identical after merge, AND dev-added files under those
# paths are removed.

set -uo pipefail

SCENARIO_NAME="S03-deploy-restores-protected-paths"

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

# Capture the canonical PRE_HEAD CLAUDE.md content (must survive untouched).
PROD_CLAUDE_BEFORE="$(cat "$SANDBOX/prod/happy/CLAUDE.md")"

# Author C1 in dev/clone:
#  - mutate CLAUDE.md (protected; must be restored)
#  - add .claude/dev.txt (under protected dir; must be removed)
#  - bump version
#  - add a NON-protected file (must survive)
echo 'DEV-CLAUDE-MD-CONTENT-MUST-NOT-LEAK' > "$SANDBOX/dev/clone/CLAUDE.md"
mkdir -p "$SANDBOX/dev/clone/.claude"
echo 'dev-added-secret' > "$SANDBOX/dev/clone/.claude/dev.txt"
add_dev_file "src/feature.js" "console.log('feature');"
bump_version_in_dev_clone "1.0.1"
commit_in_dev_clone "C1: mutate CLAUDE.md, add .claude/dev.txt, add feature, bump version"
push_dev_to_fork
DEV_SHA="$(dev_head_sha)"
fetch_in_prod

pre_stage_all_daemons "1.0.1"

cd "$SANDBOX/prod/happy"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "protected-paths-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e

assert_exit_code 0 "$deploy_rc" "deploy.sh exit code"
assert_log_contains "$SANDBOX/log/deploy.log" "restored: CLAUDE.md" "CLAUDE.md restoration logged"
# Note: .claude exists at PRE_HEAD (seed_baseline put .gitkeep there), so the
# entire .claude tree is RESTORED from PRE_HEAD, which has the side effect of
# removing the dev-added dev.txt without logging "removed dev-added" — that
# log line only fires for paths that DID NOT exist at PRE_HEAD. The behavioral
# assertion below (.claude/dev.txt absent) covers the actual semantics.
assert_log_contains "$SANDBOX/log/deploy.log" "restored: .claude" ".claude restoration logged (subsumes dev.txt removal)"

# Protected: CLAUDE.md byte-identical to PRE_HEAD's content
PROD_CLAUDE_AFTER="$(cat "$SANDBOX/prod/happy/CLAUDE.md")"
assert_str_eq "$PROD_CLAUDE_BEFORE" "$PROD_CLAUDE_AFTER" "CLAUDE.md byte-identical to PRE_HEAD"

# Protected: .claude/dev.txt does NOT exist
assert_file_absent "$SANDBOX/prod/happy/.claude/dev.txt" ".claude/dev.txt removed"

# Non-protected: src/feature.js survives the merge
assert_file_exists "$SANDBOX/prod/happy/src/feature.js" "non-protected feature file survives"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
