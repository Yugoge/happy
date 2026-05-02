#!/usr/bin/env bash
# S13: rollback-safety-tag-collision-suffix-S2-codex-15
# Pre-create the predicted safety-tag base so rollback's collision-detect
# fires; the script must use the suffixed tag and BOTH must exist after.

set -uo pipefail

SCENARIO_NAME="S13-rollback-safety-tag-collision-suffix"

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

# Step 1: produce a real PRE_TAG via deploy of v1.0.1.
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

# Step 2: deploy v1.0.2 so we have a real to-roll-back HEAD.
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

# Step 3: deterministically force a safety-tag collision. rollback.sh uses
# `date +%Y-%m-%d-%H%M%S` to compute the safety-tag base. To DETERMINISTICALLY
# trigger the collision branch (codex iter3 global review Q5 #4 / Q4: previous
# version of S13 was non-deterministic), shadow `date` in $SANDBOX/bin with a
# stub that returns a fixed timestamp regardless of arguments. Then the
# safety-tag base is fully predictable; planting the same name pre-invocation
# guarantees collision.
HEAD_SHORT="$(git -C "$SANDBOX/prod/happy" rev-parse --short HEAD)"
FROZEN_TS="2026-04-29-103045"
PREDICTED_SAFETY="safety/${FROZEN_TS}-${HEAD_SHORT}-pre-rollback"

# Plant the colliding tag.
git -C "$SANDBOX/prod/happy" tag -a "$PREDICTED_SAFETY" HEAD -m "pre-existing safety tag (S13 collision fixture)"

# Install a date stub that returns the frozen timestamp when called with
# the rollback.sh format string '%Y-%m-%d-%H%M%S' (the only format rollback
# uses for the safety-tag computation). For other format strings (e.g. ISO),
# fall through to /usr/bin/date so log timestamps still work.
cat >"$SANDBOX/bin/date" <<DATESTUB
#!/usr/bin/env bash
if [ \${#} -eq 1 ] && [ "\$1" = "+%Y-%m-%d-%H%M%S" ]; then
  echo "$FROZEN_TS"
  exit 0
fi
exec /usr/bin/date "\$@"
DATESTUB
chmod +x "$SANDBOX/bin/date"

pre_stage_all_daemons "1.0.0"
: > "$SANDBOX/log/npm.log"
: > "$SANDBOX/log/yarn.log"

set +e
printf 'y\n' | bash "$SANDBOX/scripts/rollback.sh" "$PRE_TAG" >"$SANDBOX/log/rollback.stdout" 2>"$SANDBOX/log/rollback.stderr"
rollback_rc=$?
set -e

assert_exit_code 0 "$rollback_rc" "rollback.sh exit code"

# Hard assertion: collision MUST have been detected and logged.
assert_log_contains "$SANDBOX/log/rollback.log" "Safety-tag collision detected on '$PREDICTED_SAFETY'" "S2 collision detected"
assert_log_contains "$SANDBOX/log/rollback.log" "using" "S2 collision suffix message"

# Both the pre-existing AND the suffixed tag must exist after rollback.
safety_tags="$(git -C "$SANDBOX/prod/happy" for-each-ref refs/tags/safety --format='%(refname:short)')"
safety_tag_count="$(echo "$safety_tags" | grep -c . || true)"
assert_count 2 "$safety_tag_count" "exactly 2 safety tags (pre-existing + collision-suffixed)"

if ! grep -F -q -x "$PREDICTED_SAFETY" <<<"$safety_tags"; then
  fail "$SCENARIO_NAME" "pre-existing safety tag '$PREDICTED_SAFETY' was unexpectedly removed"
fi

# The suffixed tag must match safety/<base>-<4-8 hex>
suffixed="$(echo "$safety_tags" | grep -E '^safety/.*-pre-rollback-[0-9a-f]{4,8}$' | head -1)"
assert_str_match "$suffixed" '^safety/.*-pre-rollback-[0-9a-f]{4,8}$' "suffixed tag name pattern"

if [ "$SCENARIO_FAILED" -eq 0 ]; then
  pass "$SCENARIO_NAME" 0
  exit 0
fi
exit 1
