#!/usr/bin/env bash
# S12b: rollback-stale-daemon-emits-safe-daemon-restart-hint  (Pass 2 #5)
# Same setup as S12 but ALSO create the safe-daemon-restart.sh stub so the
# runtime test in rollback.sh:146 takes the IF branch (SOP-available); the
# systemctl branch must NOT fire.

set -uo pipefail

SCENARIO_NAME="S12b-rollback-stale-daemon-emits-safe-daemon-restart-hint"

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

# Plant the SOP stub. Just an empty file with chmod +x — the runtime test
# only checks `[ -x "$SANDBOX/bin/safe-daemon-restart.sh" ]`.
echo '#!/usr/bin/env bash' >"$SANDBOX/bin/safe-daemon-restart.sh"
echo 'exit 0' >>"$SANDBOX/bin/safe-daemon-restart.sh"
chmod +x "$SANDBOX/bin/safe-daemon-restart.sh"

# Same as S12: deploy v1.0.1, deploy v1.0.2, then rollback with stale daemon.
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
assert_exit_code 0 "$deploy1_rc" "step1 deploy"
PRE_TAG="$(git -C "$SANDBOX/prod/happy" for-each-ref refs/tags --format='%(refname:short)' | grep -E '^stable/.*-pre-deploy$' | head -1)"

git -C "$SANDBOX/dev/clone" fetch --quiet fork
git -C "$SANDBOX/dev/clone" reset --hard --quiet fork/main
bump_version_in_dev_clone "1.0.2"
add_dev_file "src/regression.js" "console.log('regression');"
commit_in_dev_clone "C2: bump to 1.0.2"
push_dev_to_fork
DEV_SHA_2="$(dev_head_sha)"
cd "$SANDBOX/prod/happy"
fetch_in_prod
pre_stage_all_daemons "1.0.2"
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"
set +e
printf 'y\n' | bash "$SANDBOX/scripts/deploy.sh" "$DEV_SHA_2" "step2-deploy" >"$SANDBOX/log/deploy2.stdout" 2>&1
deploy2_rc=$?
set -e
assert_exit_code 0 "$deploy2_rc" "step2 deploy"

pre_stage_daemon "$SANDBOX/daemons/default" "1.0.0"
pre_stage_daemon "$SANDBOX/daemons/jade"    "1.0.0"
pre_stage_daemon "$SANDBOX/daemons/qijie"   "1.0.2"   # STALE
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"
: > "$SANDBOX/log/rollback.log" 2>/dev/null || true

set +e
printf 'y\n' | bash "$SANDBOX/scripts/rollback.sh" "$PRE_TAG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

assert_exit_code 1 "$rollback_rc" "rollback.sh exit code (P3 stale)"
# SOP branch fires. The log strings at rollback.sh:148-150 are operator-copy
# instructions that still reference the production /root/bin/safe-daemon-restart.sh
# path (the rewriter intentionally only rewrites the runtime test on line 146,
# not the operator-instruction strings — operators read these to decide what
# command to run on the real production system).
assert_log_contains "$SANDBOX/log/rollback.log" "Per-daemon manual restart (SOP available)" "SOP-branch hint header"
assert_log_contains "$SANDBOX/log/rollback.log" "/root/bin/safe-daemon-restart.sh default" "SOP default daemon operator-copy command"
# systemctl branch does NOT fire
assert_log_not_contains "$SANDBOX/log/rollback.log" "systemctl restart happy-daemon" "systemctl branch did NOT fire"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
