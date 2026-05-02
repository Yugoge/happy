#!/usr/bin/env bash
# AC4 mutation harness: temporarily modify the rewritten deploy.sh to disable
# the wrong-cwd guard, then run S04. Expect the scenario to FAIL.
#
# This script is owned by QA and lives under qa-input- prefix (allowed for QA writes).
# It does NOT modify scripts/deploy.sh on disk; the mutation happens to the
# per-sandbox COPY produced by rewrite_deploy_sh.

set -uo pipefail

cd /dev/shm/dev-workspace/happy-dev

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="/dev/shm/dev-workspace/happy-dev/tests"

# shellcheck disable=SC1091
source "$TESTS_DIR/lib/sandbox.sh"
# shellcheck disable=SC1091
source "$TESTS_DIR/lib/assert.sh"
# shellcheck disable=SC1091
source "$TESTS_DIR/lib/git-helpers.sh"
# shellcheck disable=SC1091
source "$TESTS_DIR/lib/daemon-mock.sh"
# shellcheck disable=SC1091
source "$TESTS_DIR/lib/rewrite.sh"
# shellcheck disable=SC1091
source "$TESTS_DIR/lib/path-scan.sh"

mk_sandbox
trap 'cleanup_sandbox' EXIT
set_env

setup_baseline_deploy_fixture || exit $?

# AC2 PROPER: inject /root/leaked-path line into the rewritten deploy.sh sandbox copy
# and verify path_scan_rewritten flags it (per AC2 verbatim wording).
echo 'INJECTED_LEAK="/root/leaked-path/file.txt"' >> "$SANDBOX/scripts/deploy.sh"
echo
echo "=== AC2 PROPER: path-scan against rewritten+injected deploy.sh ==="
if path_scan_rewritten "$SANDBOX/scripts/deploy.sh"; then
  echo "[AC2 FAIL] path-scan did NOT catch injected /root/leaked-path"
  exit 1
else
  echo "[AC2 PASS] path-scan correctly flagged the injected leak (post-rewrite drift defense works)"
fi

# Reset deploy.sh to remove the leak before AC4 mutation
sed -i '/INJECTED_LEAK="\/root\/leaked-path/d' "$SANDBOX/scripts/deploy.sh"

# AC4 MUTATION: neutralize the wrong-cwd abort in the rewritten deploy.sh.
# Replace the abort message so the assertion in S04 fails.
# Original: '|| abort "Must run from $PROD_ROOT"'  -> changed to: '|| true # mutated'
# This causes deploy to PROCEED past the guard, breaking S04's expectations.
sed -i 's|abort "Must run from .*|true  ## AC4-MUTATION|' "$SANDBOX/scripts/deploy.sh"

# Verify mutation took effect
if ! grep -q "AC4-MUTATION" "$SANDBOX/scripts/deploy.sh"; then
  echo "AC4 PRE-CHECK FAIL: mutation did not apply" >&2
  exit 99
fi

add_dev_file "src/feature.js" "console.log('hi');"
bump_version_in_dev_clone "1.0.1"
commit_in_dev_clone "C1: bump + feature"
push_dev_to_fork
DEV_SHA="$(dev_head_sha)"
fetch_in_prod
pre_stage_all_daemons "1.0.1"

PRE_HEAD_BEFORE="$(prod_head_sha)"

# Invoke from dev/clone as S04 does — but with mutation, deploy will NOT abort
cd "$SANDBOX/dev/clone"
set +e
printf 'y\ny\ny\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA" "ac4-mutated-test" >"$SANDBOX/log/deploy.stdout" 2>"$SANDBOX/log/deploy.stderr"
deploy_rc=$?
set -e

# Now run S04's assertions: they should NOT all pass (proving the harness DOES catch broken gates)
SCENARIO_NAME="AC4-mutated-S04"
SCENARIO_FAILED=0

set +e   # assertions intentionally may fail; we want to keep going to count
assert_exit_code 1 "$deploy_rc" "deploy.sh exit code should be 1 (was: $deploy_rc)"
assert_log_contains "$SANDBOX/log/deploy.log" "Must run from" "wrong-cwd guard message should appear"
set -e

# At least one assertion MUST have failed (because we removed the guard)
if [ "$SCENARIO_FAILED" -eq 1 ]; then
  echo
  echo "[AC4 PASS] mutation broke S04 assertions as expected."
  echo "  This proves the harness exercises the real production gate."
  echo "  deploy_rc=$deploy_rc (expected 1)"
  echo "  Log contains 'Must run from': $(grep -c 'Must run from' "$SANDBOX/log/deploy.log" 2>/dev/null || echo 0)"
  exit 0
else
  echo
  echo "[AC4 FAIL] All assertions passed despite mutation — harness is NOT exercising the real gate."
  exit 1
fi
