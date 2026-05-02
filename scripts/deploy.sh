#!/bin/bash
# deploy.sh — Foolproof dev → prod patch promotion for happy monorepo
#
# Promotes a validated dev-SHA from Yugoge/happy fork into /root/happy production,
# with preflight gates, atomic protected-path handling, version sanity checks,
# test gating, daemon health verification, and rollback on every failure path.
#
# Usage:
#   cd /root/happy && bash deploy.sh <dev-SHA> <topic-name>
#
# Example:
#   cd /root/happy && bash deploy.sh 41900760ab12 codex-watcher-fix
#
# Codex critical findings addressed (numbered per ba-spec):
#   #1   merge=ours unreliable                  → explicit checkout PRE_HEAD -- protected paths
#   #2   .gitattributes glob doesn't recurse    → uses path checkout, ignores .gitattributes
#   #3   same-version deploy silent no-op       → ABORT if package.json version unchanged
#   #5   wrong-directory install (2026-04-04)   → realpath PWD == /root/happy gate
#   #8   push before validate                   → push deferred until daemon health verified
#   #9   dirty tree leaks into deploy           → require clean working tree
#   #11  --tags pushes everything               → push explicit tag refs only, --atomic
#   #14  yarn.lock untested                     → frozen-lockfile install + test gate
#   #15  same-minute tag collision              → seconds + short SHA in tag name
#
# Companion: rollback.sh <pre-deploy-tag>

set -uo pipefail

# ============================================================================
# Configuration
# ============================================================================

PROD_ROOT="/root/happy"
EXPECTED_REMOTE_NAME="fork"
RECOVERY_SCRIPT="/root/bin/happy-session-recovery.sh"
LOG="/var/log/happy-deploy.log"

# Heartbeat is 60s; wait 90s to allow auto-upgrade chain to fully complete.
DAEMON_AUTO_UPGRADE_WAIT_SECONDS=90

# Protected paths: dev versions must NEVER overwrite prod versions during merge.
# This is the load-bearing fix for codex #1+#2: NOT trusting .gitattributes.
PROTECTED_PATHS=(
  "CLAUDE.md"
  "INDEX.md"
  ".claude"
  "docs/dev"
  "docs/spec"
)

# Daemon home dirs for post-deploy verification.
DAEMON_HOMES=(
  "/root/.happy"
  "/root/.happy-jade"
  "/root/.happy-qijie"
)

# ============================================================================
# Helpers
# ============================================================================

log()    { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }
abort()  { log "ABORT: $1"; exit 1; }
confirm() {
  local prompt="$1" answer
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" =~ ^[yY](es)?$ ]]
}

# Reset prod tree to PRE_HEAD (used in many failure paths)
reset_to_pre_head() {
  log "  rolling back: git reset --hard $PRE_HEAD"
  git reset --hard "$PRE_HEAD" 2>&1 | tee -a "$LOG"
}

# ============================================================================
# Argument validation
# ============================================================================

if [ $# -ne 2 ]; then
  cat <<USAGE
Usage: $0 <dev-SHA> <topic-name>

  dev-SHA     full SHA of validated commit on $EXPECTED_REMOTE_NAME (Yugoge/happy)
              use SHA, not branch name (codex finding #10)
  topic-name  short kebab-case description (e.g. 'codex-watcher-fix')
              must satisfy git ref-format rules
USAGE
  exit 2
fi

DEV_SHA="$1"
TOPIC="$2"

if ! [[ "$TOPIC" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
  abort "topic-name must be lowercase kebab-case; got: '$TOPIC'"
fi
if ! [[ "$DEV_SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  abort "dev-SHA must be a hex git SHA (7-40 chars); got: '$DEV_SHA'"
fi

# ============================================================================
# PREFLIGHT
# ============================================================================

log "=== deploy.sh starting: dev-SHA=$DEV_SHA topic=$TOPIC ==="

# --- Bug #5: wrong-directory install (the 2026-04-04 incident) ---
ACTUAL_PWD="$(realpath "$PWD")"
EXPECTED_PWD="$(realpath "$PROD_ROOT")"
[ "$ACTUAL_PWD" = "$EXPECTED_PWD" ] || \
  abort "Must run from $PROD_ROOT, not $ACTUAL_PWD. Did you cd /root/happy first?"

GIT_TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ "$GIT_TOPLEVEL" = "$EXPECTED_PWD" ] || \
  abort "PWD ($ACTUAL_PWD) is not the toplevel of the prod git repo. Refusing."

# --- Must be on main branch ---
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "main" ] || \
  abort "Must be on 'main'; currently on '$CURRENT_BRANCH'."

# --- Bug #9: dirty tree (working-tree state could leak into npm install -g) ---
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "Working tree has uncommitted modifications:"
  git status --short | tee -a "$LOG"
  abort "Refusing to deploy with uncommitted changes. Stash or commit first."
fi

UNTRACKED_COUNT=$(git status --porcelain | grep -c '^??' || true)
if [ "${UNTRACKED_COUNT:-0}" -gt 0 ]; then
  log "Working tree has $UNTRACKED_COUNT untracked file(s):"
  git status --short | grep '^??' | head -20 | tee -a "$LOG"
  confirm "Continue anyway? Untracked files are not in git history." || \
    abort "User declined to proceed with untracked files."
fi

# --- Remote configured ---
git remote get-url "$EXPECTED_REMOTE_NAME" >/dev/null 2>&1 || \
  abort "Expected remote '$EXPECTED_REMOTE_NAME' not configured."

# --- Bug #10 lite: dev-SHA must be reachable on the fork ---
log "Fetching from $EXPECTED_REMOTE_NAME..."
git fetch "$EXPECTED_REMOTE_NAME" 2>&1 | tee -a "$LOG"

git cat-file -e "${DEV_SHA}^{commit}" 2>/dev/null || \
  abort "dev-SHA $DEV_SHA is not a known commit. Push it to $EXPECTED_REMOTE_NAME first."

DEV_SHA_FULL="$(git rev-parse "$DEV_SHA")"
log "dev-SHA resolved to: $DEV_SHA_FULL"

# Verify reachable from a fork branch (defends against dangling commits)
if ! git branch -r --contains "$DEV_SHA_FULL" 2>/dev/null | grep -q "$EXPECTED_REMOTE_NAME/"; then
  log "WARN: $DEV_SHA_FULL is not reachable from any $EXPECTED_REMOTE_NAME/* branch."
  confirm "Continue anyway?" || abort "User declined."
fi

# --- Pre-deploy session snapshot (recovery safety net) ---
if [ -x "$RECOVERY_SCRIPT" ]; then
  log "Saving session snapshot..."
  bash "$RECOVERY_SCRIPT" save 2>&1 | tee -a "$LOG" || \
    abort "Session snapshot save failed. No safety net for rollback."
else
  log "WARN: $RECOVERY_SCRIPT not available; session snapshot skipped."
  confirm "Continue without recovery snapshot?" || abort "User declined."
fi

# ============================================================================
# CAPTURE PRE-DEPLOY STATE
# ============================================================================

PRE_HEAD="$(git rev-parse HEAD)"
PRE_HEAD_SHORT="$(git rev-parse --short HEAD)"
PRE_VERSION="$(jq -r .version packages/happy-cli/package.json 2>/dev/null || true)"

[ -n "$PRE_VERSION" ] || abort "Could not read packages/happy-cli/package.json version (jq installed?)"

log "PRE_HEAD: $PRE_HEAD ($PRE_HEAD_SHORT)"
log "PRE_VERSION: $PRE_VERSION"

# --- Bug #15: tag uniqueness (seconds + short SHA) ---
TIMESTAMP="$(date +%Y-%m-%d-%H%M%S)"
PRE_TAG="stable/${TIMESTAMP}-${PRE_HEAD_SHORT}-pre-deploy"
DEPLOY_TAG="stable/${TIMESTAMP}-${PRE_HEAD_SHORT}-${TOPIC}"

for t in "$PRE_TAG" "$DEPLOY_TAG"; do
  git check-ref-format "refs/tags/$t" || abort "Generated tag fails ref-format: '$t'"
done

log "Tagging rollback target: $PRE_TAG"
git tag -a "$PRE_TAG" HEAD -m "Pre-deploy rollback target before '$TOPIC'

dev-SHA being merged: $DEV_SHA_FULL
PRE_HEAD: $PRE_HEAD
PRE_VERSION: $PRE_VERSION
Generated by deploy.sh at $(date -Iseconds)"

# ============================================================================
# MERGE WITH PROTECTED-PATH RESTORATION (load-bearing for #1+#2)
# ============================================================================

log "Merging $DEV_SHA_FULL with --no-ff --no-commit..."
if ! git merge --no-ff --no-commit "$DEV_SHA_FULL" 2>&1 | tee -a "$LOG"; then
  log "Merge had conflicts or hard-failed."
  git merge --abort 2>/dev/null || true
  abort "Merge failed. Working tree restored. Resolve manually if needed."
fi

# --- Bug #1+#2: restore protected paths to byte-identical PRE_HEAD state ---
# .gitattributes merge=ours only fires on 3-way merge conflicts. If prod hadn't
# touched a protected file but dev did, git auto-takes dev's version. The fix:
# explicitly checkout each protected path from PRE_HEAD AFTER the merge.
log "Restoring protected paths from PRE_HEAD..."
for path in "${PROTECTED_PATHS[@]}"; do
  # Step 1: erase whatever the merge produced (working tree + index)
  if [ -e "$path" ] || git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    git rm -rf --quiet --ignore-unmatch -- "$path" 2>/dev/null || rm -rf "$path"
  fi
  # Step 2: restore from PRE_HEAD if it existed there
  if git rev-parse "${PRE_HEAD}:$path" >/dev/null 2>&1; then
    git checkout "$PRE_HEAD" -- "$path"
    git add -- "$path"
    log "  restored: $path"
  else
    log "  removed dev-added: $path (didn't exist at PRE_HEAD)"
  fi
done

# --- Verify protected paths are now byte-identical to PRE_HEAD ---
PROTECTED_VIOLATION=0
for path in "${PROTECTED_PATHS[@]}"; do
  if [ -e "$path" ] || git rev-parse "${PRE_HEAD}:$path" >/dev/null 2>&1; then
    DIFF_OUT="$(git diff "$PRE_HEAD" -- "$path" 2>/dev/null)"
    if [ -n "$DIFF_OUT" ]; then
      log "FAIL: protected path '$path' still differs from PRE_HEAD."
      PROTECTED_VIOLATION=1
    fi
  fi
done
if [ "$PROTECTED_VIOLATION" -eq 1 ]; then
  log "Protected-path violation. Aborting merge..."
  git merge --abort 2>/dev/null || reset_to_pre_head
  abort "Protected paths leaked from dev despite restoration. Investigate."
fi

# Commit the merge
git commit -m "merge: $TOPIC (dev-SHA $DEV_SHA_FULL)

Promoted via deploy.sh.
PRE_HEAD: $PRE_HEAD
DEV_SHA: $DEV_SHA_FULL

Protected paths restored from PRE_HEAD (codex #1+#2):
$(printf '  - %s\n' "${PROTECTED_PATHS[@]}")
" 2>&1 | tee -a "$LOG"

# ============================================================================
# VERSION SANITY CHECK (Bug #3)
# ============================================================================

POST_VERSION="$(jq -r .version packages/happy-cli/package.json)"
log "POST_VERSION: $POST_VERSION"

if [ "$POST_VERSION" = "$PRE_VERSION" ]; then
  log "ABORT: package.json version unchanged ($PRE_VERSION → $POST_VERSION)."
  log "  Daemon auto-upgrade is triggered ONLY by version mismatch. Same-version"
  log "  deploys install successfully but daemons keep running OLD code (silent"
  log "  no-op). Have the dev branch bump packages/happy-cli/package.json, retry."
  reset_to_pre_head
  abort "Version not bumped — would cause silent no-op deploy"
fi

# ============================================================================
# TEST GATE (Bug #14)
# ============================================================================

log "=== Test gate: frozen-lockfile install + tests ==="

if ! yarn install --frozen-lockfile 2>&1 | tee -a "$LOG"; then
  log "yarn install --frozen-lockfile FAILED (lockfile inconsistency)."
  reset_to_pre_head
  abort "frozen-lockfile install failed (codex #14)"
fi

if ! yarn workspace happy-cli test 2>&1 | tee -a "$LOG"; then
  log "Test suite FAILED."
  reset_to_pre_head
  abort "Tests failed for the merged tree"
fi

log "Test gate passed."

# ============================================================================
# GLOBAL INSTALL + DAEMON VERIFICATION
# ============================================================================

log "=== Global install (will trigger daemon auto-upgrade across all 3 prod daemons) ==="
confirm "Proceed with global install?" || { reset_to_pre_head; abort "User declined post-test confirmation."; }

if ! npm install -g . 2>&1 | tee -a "$LOG"; then
  log "npm install -g FAILED. Daemons may be in inconsistent state."
  log "Attempting auto-rollback install..."
  reset_to_pre_head
  npm install -g . 2>&1 | tee -a "$LOG" || log "Rollback install ALSO failed; manual intervention required."
  abort "Global install failed"
fi

log "Global install succeeded. Sleeping ${DAEMON_AUTO_UPGRADE_WAIT_SECONDS}s for daemon heartbeat..."
sleep "$DAEMON_AUTO_UPGRADE_WAIT_SECONDS"

# Verify each daemon picked up the new version
log "=== Verifying daemons loaded $POST_VERSION ==="
DAEMONS_OK=0
DAEMONS_TOTAL=0
for home in "${DAEMON_HOMES[@]}"; do
  DAEMONS_TOTAL=$((DAEMONS_TOTAL + 1))
  STATE_FILE="$home/daemon.state.json"
  if [ ! -f "$STATE_FILE" ]; then
    log "  $home: no daemon.state.json (daemon not running?)"
    continue
  fi
  STARTED_VERSION="$(jq -r .startedWithCliVersion "$STATE_FILE" 2>/dev/null || true)"
  if [ "$STARTED_VERSION" = "$POST_VERSION" ]; then
    log "  $home: OK ($STARTED_VERSION)"
    DAEMONS_OK=$((DAEMONS_OK + 1))
  else
    log "  $home: STALE (running $STARTED_VERSION, expected $POST_VERSION)"
  fi
done

if [ "$DAEMONS_OK" -lt "$DAEMONS_TOTAL" ]; then
  log "WARN: $DAEMONS_OK/$DAEMONS_TOTAL daemons confirmed at $POST_VERSION."
  log "Some daemons may still be restarting. To recheck manually after waiting:"
  log "  for h in ${DAEMON_HOMES[*]}; do jq -r .startedWithCliVersion \$h/daemon.state.json; done"
  if ! confirm "Continue and push anyway?"; then
    log "Rolling back..."
    reset_to_pre_head
    npm install -g . 2>&1 | tee -a "$LOG"
    abort "Deploy rolled back: daemon migration incomplete"
  fi
else
  log "All $DAEMONS_TOTAL daemons confirmed at $POST_VERSION."
fi

# ============================================================================
# TAG + PUSH (only after all gates passed — Bug #8)
# ============================================================================

log "=== Tagging deploy + pushing to fork ==="

git tag -a "$DEPLOY_TAG" HEAD -m "Deploy: $TOPIC

PRE_HEAD: $PRE_HEAD
DEV_SHA: $DEV_SHA_FULL
PRE_VERSION: $PRE_VERSION → POST_VERSION: $POST_VERSION
Daemons confirmed: $DAEMONS_OK/$DAEMONS_TOTAL at $POST_VERSION

Pre-deploy rollback tag: $PRE_TAG
Generated by deploy.sh at $(date -Iseconds)"

# --- Bug #11: explicit refs only with --atomic; never --tags ---
log "Pushing main + 2 tags to $EXPECTED_REMOTE_NAME (--atomic)..."
if ! git push --atomic "$EXPECTED_REMOTE_NAME" \
     "main:main" \
     "refs/tags/$PRE_TAG:refs/tags/$PRE_TAG" \
     "refs/tags/$DEPLOY_TAG:refs/tags/$DEPLOY_TAG" 2>&1 | tee -a "$LOG"; then
  log "Push FAILED. Local state is correct, daemons are running new code,"
  log "but $EXPECTED_REMOTE_NAME/main is stale. Manually push when ready:"
  log "  git push --atomic $EXPECTED_REMOTE_NAME main refs/tags/$PRE_TAG refs/tags/$DEPLOY_TAG"
  abort "Push failed (local deploy succeeded; fork remote not updated)"
fi

# ============================================================================
# DONE
# ============================================================================

log ""
log "=== DEPLOY OK ==="
log "  Topic:        $TOPIC"
log "  Deployed:     dev-SHA $DEV_SHA_FULL → version $POST_VERSION"
log "  Pre-tag:      $PRE_TAG"
log "  Deploy tag:   $DEPLOY_TAG"
log "  Daemons:      $DAEMONS_OK/$DAEMONS_TOTAL at $POST_VERSION"
log ""
log "If prod misbehaves, rollback with:"
log "  cd $PROD_ROOT && bash $(dirname "$(realpath "$0")")/rollback.sh $PRE_TAG"
log ""
