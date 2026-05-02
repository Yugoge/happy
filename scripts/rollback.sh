#!/bin/bash
# rollback.sh — Symmetric companion to deploy.sh
#
# Restores /root/happy production source to a previously-tagged pre-deploy
# snapshot and FORCES all three production daemons (default / jade / qijie)
# onto the rolled-back code via npm install -g + heartbeat-driven auto-upgrade.
#
# Usage:
#   cd /root/happy && bash scripts/rollback.sh <pre-deploy-tag>
#
# Example:
#   cd /root/happy && bash scripts/rollback.sh stable/2026-04-29-103045-41900760-pre-deploy
#
# Out-of-scope rollback surfaces (M16 — these are NOT touched by this script;
# they require separate manual operator action — to be documented in a future
# DEPLOYMENT.md):
#   - database migrations (Prisma migrate down)
#   - Docker images (happy-server / happy-web / happy-web-dev)
#   - /root/bin/ shell scripts
#
# Codex carry-forward findings re-applied here (numbered per ba-spec):
#   #3   same-version silent no-op trap         → ABORT if PRE/TARGET versions match
#   #5   wrong-directory install                → realpath PWD == /root/happy gate
#   M3b  active-merge / detached HEAD / rebase  → git-state gate
#   M5   strict untracked-file policy           → reject untracked under packed paths
#   S2   safety tag with collision avoidance    → safety/<ts>-<sha>-pre-rollback (annotated)
#   M12  bounded daemon-migration polling       → 90s deadline, 10s tick
#   M14  phase-aware abort messages             → P0/P1/P2/P3 distinct hints
#   M14b runtime test-and-degrade for restart   → daemon_restart_hint() picks SOP-or-systemctl
#   M15  no remote push (force-push footgun)    → local-only by design
#
# === Fork divergence after rollback (M15b) ===
# deploy.sh pushes the merged commit to fork/main; rollback.sh does NOT push.
# Therefore, after a successful local rollback, fork/main is AHEAD of HEAD by
# the bad commit(s) the operator just rolled away from. The next deploy.sh run
# will `git fetch fork` and surface those bad commits as merge candidates.
# Block 2 of the success epilogue (M15) names this divergence and enumerates
# the two valid forward paths: (a) operator-driven force-push to symmetrize,
# or (b) tag-based forward roll via a new corrective dev-SHA. The script
# prints; the operator decides. Auto-execution of either path is intentionally
# absent because force-pushing collaborator-visible history is a footgun.
#
# Companion: deploy.sh <dev-SHA> <topic-name>

set -uo pipefail

# ============================================================================
# Configuration (verbatim from deploy.sh per BA spec C1 / S1)
# ============================================================================

PROD_ROOT="/root/happy"
EXPECTED_REMOTE_NAME="fork"
RECOVERY_SCRIPT="/root/bin/happy-session-recovery.sh"
LOG="/var/log/happy-rollback.log"

# Heartbeat is 60s; wait up to 90s for daemon auto-upgrade chain (matches deploy.sh:39).
DAEMON_AUTO_UPGRADE_WAIT_SECONDS=90
DAEMON_POLL_INTERVAL_SECONDS=10

# Daemon home dirs (verbatim from deploy.sh:52-56).
DAEMON_HOMES=(
  "/root/.happy"
  "/root/.happy-jade"
  "/root/.happy-qijie"
)

# Tag-format regex (matches deploy.sh's PRE_TAG emission at deploy.sh:183:
#   stable/${TIMESTAMP}-${PRE_HEAD_SHORT}-pre-deploy
# where TIMESTAMP = date +%Y-%m-%d-%H%M%S and PRE_HEAD_SHORT = git short SHA).
TAG_REGEX='^stable/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[0-9a-f]{7,40}-pre-deploy$'

# Phase tracker for M14 phase-aware abort messages.
# P0 = preflight, P1 = post-snapshot/pre-reset, P2 = post-reset/pre-or-during-install,
# P3 = post-install/daemon-migration. Updated as the script progresses.
PHASE="P0"

# State variables populated as the script runs (referenced in phase-aware hints).
PRE_ROLLBACK_HEAD=""
PRE_ROLLBACK_VERSION=""
TARGET_VERSION=""
SAFETY_TAG=""
TARGET_TAG=""

# ============================================================================
# Helpers (verbatim from deploy.sh:62-68 per BA spec S1)
# ============================================================================

log()    { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }
confirm() {
  local prompt="$1" answer
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" =~ ^[yY](es)?$ ]]
}

# Phase-aware abort. M14 + M19 (exit 1 for runtime errors).
abort() {
  local msg="$1"
  log "ABORT [$PHASE]: $msg"
  case "$PHASE" in
    P0)
      log "Recovery hint (P0 preflight):"
      log "  No source files were modified. Re-run after fixing the named issue."
      ;;
    P1)
      log "Recovery hint (P1 post-snapshot / pre-reset):"
      log "  Source files unchanged; safety tag not yet created."
      log "  Recovery snapshot was saved; see $RECOVERY_SCRIPT output above."
      ;;
    P2)
      log "Recovery hint (P2 post-reset / install or verification failure):"
      log "  HEAD has been reset to ${TARGET_TAG:-<target tag>}."
      log "  Safety tag is ${SAFETY_TAG:-<safety tag pending>}."
      log "  To restore PRE_ROLLBACK_HEAD:"
      log "    cd $PROD_ROOT && git reset --hard ${PRE_ROLLBACK_HEAD:-<PRE_ROLLBACK_HEAD>} && npm install -g ."
      log "  Daemons will then heartbeat back to the prior version."
      ;;
    P3)
      log "Recovery hint (P3 post-install / daemon migration incomplete):"
      log "  HEAD is at ${TARGET_TAG:-<target tag>}; global install succeeded;"
      log "  some daemons did not migrate within ${DAEMON_AUTO_UPGRADE_WAIT_SECONDS}s."
      daemon_restart_hint
      log "  Recheck:"
      log "    for h in /root/.happy /root/.happy-jade /root/.happy-qijie; do \\"
      log "      jq -r .startedWithCliVersion \"\$h/daemon.state.json\"; done"
      ;;
  esac
  exit 1
}

# argv-shape error. M19 exit code 2 (distinct from runtime abort).
# Routes to stderr (AC2 requirement) AND audit log so the operator sees the
# tag-shape error on their TTY without having to tail $LOG.
argv_error() {
  local msg="$1"
  echo "ARGV ERROR: $msg" >&2
  log "ARGV ERROR: $msg"
  echo "Recovery hint (P0 preflight): No source files were modified. Re-run after fixing the named issue." >&2
  exit 2
}

# Runtime test-and-degrade for daemon-restart recovery hint (M14b).
# Tests for /root/bin/safe-daemon-restart.sh at runtime; emits ONE of two
# branches (NEVER both). Centralized so M8's silent-no-op path and M14 P3's
# polling-deadline path share the same test-and-degrade rule.
daemon_restart_hint() {
  if [ -x /root/bin/safe-daemon-restart.sh ]; then
    log "  Per-daemon manual restart (SOP available):"
    log "    bash /root/bin/safe-daemon-restart.sh default --reason 'rollback to ${TARGET_TAG:-<tag>}'"
    log "    bash /root/bin/safe-daemon-restart.sh jade    --reason 'rollback to ${TARGET_TAG:-<tag>}'"
    log "    bash /root/bin/safe-daemon-restart.sh qijie   --reason 'rollback to ${TARGET_TAG:-<tag>}'"
  else
    log "  Per-daemon manual restart via systemd (verified extant unit names):"
    log "    systemctl restart happy-daemon.service"
    log "    systemctl restart happy-daemon-jade.service"
    log "    systemctl restart happy-daemon-qijie.service"
    log "  Or, to restart all three daemons + Docker containers in one shot:"
    log "    bash /root/bin/happy-restart.sh"
  fi
}

# ============================================================================
# Pre-flight: audit log writability (M13)
# ============================================================================

if ! touch "$LOG" 2>/dev/null; then
  echo "ABORT: $LOG not writable; run as root." >&2
  exit 1
fi

# ============================================================================
# Argument validation (M1, M2, M19)
# ============================================================================

if [ $# -ne 1 ]; then
  cat <<USAGE >&2
Usage: $0 <pre-deploy-tag>

  pre-deploy-tag   annotated tag created by deploy.sh, e.g.
                   stable/2026-04-29-103045-9z8y7x6w-pre-deploy
                   (must match: $TAG_REGEX)
USAGE
  argv_error "expected exactly 1 argument (pre-deploy-tag); got $#"
fi

TARGET_TAG="$1"

if ! [[ "$TARGET_TAG" =~ $TAG_REGEX ]]; then
  argv_error "tag '$TARGET_TAG' does not match expected shape: $TAG_REGEX"
fi

# git ref-format sanity (M2 — codex review point 10).
if ! git check-ref-format "refs/tags/$TARGET_TAG" 2>/dev/null; then
  argv_error "tag name '$TARGET_TAG' fails git check-ref-format"
fi

log "=== rollback.sh starting: target tag=$TARGET_TAG ==="

# ============================================================================
# PHASE P0 — PREFLIGHT
# ============================================================================

PHASE="P0"

# --- M3: cwd guard (codex #5 carry-forward) ---
ACTUAL_PWD="$(realpath "$PWD" 2>/dev/null || true)"
EXPECTED_PWD="$(realpath "$PROD_ROOT" 2>/dev/null || true)"
if [ -z "$ACTUAL_PWD" ] || [ -z "$EXPECTED_PWD" ]; then
  abort "Could not realpath PWD or $PROD_ROOT."
fi
[ "$ACTUAL_PWD" = "$EXPECTED_PWD" ] || \
  abort "Must run from $PROD_ROOT, not $ACTUAL_PWD. Did you cd /root/happy first?"

GIT_TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ "$GIT_TOPLEVEL" = "$EXPECTED_PWD" ] || \
  abort "PWD ($ACTUAL_PWD) is not the toplevel of the prod git repo. Refusing."

# --- M3b: git-state gate (codex review point 2) ---
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
[ "$CURRENT_BRANCH" = "main" ] || \
  abort "Must be on 'main'; currently on '$CURRENT_BRANCH' (detached HEAD or other branch)."

[ ! -f .git/MERGE_HEAD ]        || abort "active merge: .git/MERGE_HEAD present. Resolve or abort the merge first."
[ ! -d .git/rebase-merge ]      || abort "active rebase: .git/rebase-merge present. Complete or abort the rebase first."
[ ! -d .git/rebase-apply ]      || abort "active rebase: .git/rebase-apply present. Complete or abort the rebase first."
[ ! -f .git/CHERRY_PICK_HEAD ]  || abort "active cherry-pick: .git/CHERRY_PICK_HEAD present."
[ ! -f .git/REVERT_HEAD ]       || abort "active revert: .git/REVERT_HEAD present."
[ ! -f .git/BISECT_LOG ]        || abort "active bisect: .git/BISECT_LOG present."
[ ! -d .git/sequencer ]         || abort "active sequencer: .git/sequencer present."

# --- M4: tag must exist locally and be reachable from main ---
if ! git rev-parse --verify -q "refs/tags/$TARGET_TAG^{commit}" >/dev/null; then
  abort "tag '$TARGET_TAG' does not exist locally. Have you fetched recent tags?"
fi

# Annotated tag check (M2): %(objecttype) on refs/tags/<tag> must be 'tag', not 'commit'.
TAG_OBJECTTYPE="$(git for-each-ref --format='%(objecttype)' "refs/tags/$TARGET_TAG" 2>/dev/null || true)"
[ "$TAG_OBJECTTYPE" = "tag" ] || \
  abort "tag '$TARGET_TAG' is not annotated (objecttype=$TAG_OBJECTTYPE). deploy.sh emits annotated tags."

if ! git merge-base --is-ancestor "$TARGET_TAG" main 2>/dev/null; then
  abort "tag '$TARGET_TAG' is not reachable from main. Investigate manually before rollback."
fi

# --- M5: strict working-tree clean check (codex review point 9) ---
if ! git diff --cached --quiet 2>/dev/null; then
  log "Working tree has STAGED changes:"
  git diff --cached --stat 2>&1 | tee -a "$LOG"
  abort "Refusing to rollback with staged changes. Stash or commit first."
fi
if ! git diff --quiet 2>/dev/null; then
  log "Working tree has UNSTAGED modifications:"
  git status --short 2>&1 | tee -a "$LOG"
  abort "Refusing to rollback with unstaged modifications. Stash or commit first."
fi

# Reject untracked under sensitive paths that feed `npm install -g .` (M5 strict).
SENSITIVE_UNTRACKED=()
while IFS= read -r line; do
  # porcelain ?? entries
  [ -z "$line" ] && continue
  path="${line#?? }"
  case "$path" in
    packages/happy-cli/*|packages/happy-cli)
      SENSITIVE_UNTRACKED+=("$path") ;;
    package.json|yarn.lock|package-lock.json|npm-shrinkwrap.json)
      SENSITIVE_UNTRACKED+=("$path") ;;
  esac
done < <(git status --porcelain 2>/dev/null | grep '^?? ' || true)

if [ "${#SENSITIVE_UNTRACKED[@]}" -gt 0 ]; then
  log "Rejecting rollback: untracked files under install-feeding paths:"
  for p in "${SENSITIVE_UNTRACKED[@]}"; do
    log "  $p"
  done
  abort "Untracked files in packages/happy-cli/ or top-level package*/yarn.lock would be packed into the global install. Remove or stash them first."
fi

# Untracked files OUTSIDE sensitive paths: same confirm() as deploy.sh:131-136.
OTHER_UNTRACKED_COUNT=$(git status --porcelain 2>/dev/null | grep -c '^?? ' || true)
if [ "${OTHER_UNTRACKED_COUNT:-0}" -gt 0 ]; then
  log "Working tree has $OTHER_UNTRACKED_COUNT untracked file(s) (outside sensitive paths):"
  git status --short 2>/dev/null | grep '^?? ' | head -20 | tee -a "$LOG"
  confirm "Continue anyway? Untracked files are not in git history." || \
    abort "User declined to proceed with untracked files."
fi

# --- M6: mandatory recovery snapshot BEFORE any destructive operation ---
if [ ! -x "$RECOVERY_SCRIPT" ]; then
  abort "$RECOVERY_SCRIPT not available or not executable. Rollback is itself a recovery action and must never run without a snapshot."
fi
log "Saving session snapshot..."
if ! bash "$RECOVERY_SCRIPT" save 2>&1 | tee -a "$LOG"; then
  abort "Session snapshot save failed. Refusing to proceed without a recovery safety net."
fi

# ============================================================================
# PHASE P1 — POST-SNAPSHOT, PRE-RESET
# ============================================================================

PHASE="P1"

# --- M7: capture state BEFORE reset ---
PRE_ROLLBACK_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
[ -n "$PRE_ROLLBACK_HEAD" ] || abort "Could not capture PRE_ROLLBACK_HEAD."

PRE_ROLLBACK_HEAD_SHORT="$(git rev-parse --short HEAD 2>/dev/null || true)"
[ -n "$PRE_ROLLBACK_HEAD_SHORT" ] || abort "Could not capture PRE_ROLLBACK_HEAD_SHORT."

PRE_ROLLBACK_VERSION="$(jq -r .version packages/happy-cli/package.json 2>/dev/null || true)"
if [ -z "$PRE_ROLLBACK_VERSION" ] || [ "$PRE_ROLLBACK_VERSION" = "null" ]; then
  abort "Could not read packages/happy-cli/package.json version (jq installed?)."
fi

TARGET_VERSION="$(git show "$TARGET_TAG":packages/happy-cli/package.json 2>/dev/null | jq -r .version 2>/dev/null || true)"
if [ -z "$TARGET_VERSION" ] || [ "$TARGET_VERSION" = "null" ]; then
  abort "Could not read packages/happy-cli/package.json version at $TARGET_TAG."
fi

log "PRE_ROLLBACK_HEAD: $PRE_ROLLBACK_HEAD ($PRE_ROLLBACK_HEAD_SHORT)"
log "PRE_ROLLBACK_VERSION: $PRE_ROLLBACK_VERSION"
log "TARGET_VERSION: $TARGET_VERSION (from $TARGET_TAG)"

# --- M8: codex #3 carry-forward — same-version silent no-op trap ---
if [ "$TARGET_VERSION" = "$PRE_ROLLBACK_VERSION" ]; then
  log "Same-version trap: PRE_ROLLBACK_VERSION ($PRE_ROLLBACK_VERSION) == TARGET_VERSION ($TARGET_VERSION)."
  log "Daemon auto-upgrade is heartbeat-driven and only fires on version mismatch."
  log "To force daemon migration onto code that is at the same version string:"
  log "  (a) pick a different rollback tag whose package.json version differs,"
  log "  (b) or abort this rollback, run npm install -g . from the desired tag,"
  log "      then restart daemons manually:"
  daemon_restart_hint
  abort "Version not mismatched ($PRE_ROLLBACK_VERSION → $TARGET_VERSION) — would cause silent no-op rollback (codex #3)."
fi

# --- C3: warn if tag does not look deploy.sh-generated (best-effort) ---
TAG_ANNOTATION_MSG="$(git for-each-ref --format='%(contents)' "refs/tags/$TARGET_TAG" 2>/dev/null || true)"
if ! grep -q "Pre-deploy rollback target before" <<< "$TAG_ANNOTATION_MSG"; then
  log "WARN: tag '$TARGET_TAG' does not appear deploy.sh-generated (annotation header missing 'Pre-deploy rollback target before'). Proceed with care."
fi

# --- M9: confirmation BEFORE git reset ---
confirm "Reset HEAD from $PRE_ROLLBACK_HEAD ($PRE_ROLLBACK_VERSION) to $TARGET_TAG ($TARGET_VERSION)?" || \
  abort "User declined the rollback confirmation."

# --- S2: safety tag (annotated) BEFORE git reset, with collision avoidance ---
TIMESTAMP="$(date +%Y-%m-%d-%H%M%S)"
SAFETY_TAG_BASE="safety/${TIMESTAMP}-${PRE_ROLLBACK_HEAD_SHORT}-pre-rollback"
SAFETY_TAG="$SAFETY_TAG_BASE"
if git rev-parse --verify -q "refs/tags/$SAFETY_TAG" >/dev/null 2>&1; then
  # Collision (retry within same second from same HEAD): append random hex suffix.
  if command -v openssl >/dev/null 2>&1; then
    SUFFIX="$(openssl rand -hex 2)"
  else
    SUFFIX="$(printf '%04x' $((RANDOM ^ $$)))"
  fi
  SAFETY_TAG="${SAFETY_TAG_BASE}-${SUFFIX}"
  log "Safety-tag collision detected on '$SAFETY_TAG_BASE'; using '$SAFETY_TAG' instead."
fi

git check-ref-format "refs/tags/$SAFETY_TAG" || \
  abort "Generated safety tag fails ref-format: '$SAFETY_TAG'"

log "Tagging safety snapshot before rollback: $SAFETY_TAG"
if ! git tag -a "$SAFETY_TAG" HEAD -m "Pre-rollback safety snapshot before rolling back to $TARGET_TAG

PRE_ROLLBACK_HEAD: $PRE_ROLLBACK_HEAD
PRE_ROLLBACK_VERSION: $PRE_ROLLBACK_VERSION
Rollback target tag: $TARGET_TAG
Rollback target version: $TARGET_VERSION
Generated by rollback.sh at $(date -Iseconds)" 2>&1 | tee -a "$LOG"; then
  abort "Failed to create safety tag $SAFETY_TAG."
fi

# ============================================================================
# PHASE P2 — POST-RESET, PRE-INSTALL or DURING-INSTALL
# ============================================================================

# NOTE: PHASE remains "P1" until reset has actually succeeded. If `git reset
# --hard` itself fails (filesystem error, permission, etc.), the abort fires
# in P1 — emitting the correct "source files unchanged; safety tag preserved"
# hint instead of the false "HEAD has been reset" message.

log "=== Resetting HEAD to $TARGET_TAG (git reset --hard) ==="
if ! git reset --hard "$TARGET_TAG" 2>&1 | tee -a "$LOG"; then
  abort "git reset --hard $TARGET_TAG failed (HEAD likely unchanged; safety tag $SAFETY_TAG preserved)."
fi

# Reset succeeded — NOW transition to P2 so any subsequent abort emits the
# "HEAD has been reset to <tag>; recover via reset --hard $PRE_ROLLBACK_HEAD" hint.
PHASE="P2"

# --- M10: post-reset HEAD verification ---
POST_RESET_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
EXPECTED_HEAD="$(git rev-parse "$TARGET_TAG^{commit}" 2>/dev/null || true)"
if [ -z "$POST_RESET_HEAD" ] || [ -z "$EXPECTED_HEAD" ] || [ "$POST_RESET_HEAD" != "$EXPECTED_HEAD" ]; then
  abort "Post-reset HEAD verification failed: HEAD=$POST_RESET_HEAD, expected=$EXPECTED_HEAD."
fi
log "Post-reset HEAD verified: $POST_RESET_HEAD == $EXPECTED_HEAD"

# Sanity: re-check that TARGET_VERSION is what we ended up with on disk.
INSTALLED_TARGET_VERSION="$(jq -r .version packages/happy-cli/package.json 2>/dev/null || true)"
if [ "$INSTALLED_TARGET_VERSION" != "$TARGET_VERSION" ]; then
  abort "On-disk package.json version ($INSTALLED_TARGET_VERSION) does not match TARGET_VERSION ($TARGET_VERSION) after reset."
fi

# --- BUILD: rebuild happy-cli after reset (codex finding 1 carry-forward) ---
# `git reset --hard` only restores tracked files. packages/happy-cli/dist/ is
# gitignored AND packaged for the global install (see packages/happy-cli/.gitignore
# and packages/happy-cli/package.json "files" field). Without rebuild, the
# rolled-back tree's tracked sources sit on top of the CURRENT (un-rolled-back)
# compiled output — and `npm install -g .` would then ship the wrong daemon
# code, defeating the rollback. Mirror deploy.sh:279-289 frozen-lockfile +
# build flow, but defensively skip tests (rollback target should already be
# a known-good commit; tests being broken on the rolled-back tree is not a
# reason to refuse rollback if the operator's intent is recovery).
log "=== Rebuilding happy-cli (frozen-lockfile install + build to refresh dist/ before global install) ==="
if ! yarn install --frozen-lockfile 2>&1 | tee -a "$LOG"; then
  abort "yarn install --frozen-lockfile FAILED at $TARGET_TAG. dist/ would be stale; refusing global install."
fi
if ! yarn workspace happy-cli build 2>&1 | tee -a "$LOG"; then
  abort "yarn workspace happy-cli build FAILED at $TARGET_TAG. dist/ would be stale; refusing global install."
fi
log "Rebuild succeeded; dist/ is now in sync with rolled-back source."

# --- M11: npm install -g . ---
log "=== Global install: npm install -g . (will trigger daemon auto-upgrade on heartbeat) ==="
if ! npm install -g . 2>&1 | tee -a "$LOG"; then
  abort "npm install -g . FAILED after reset. Daemons may be in inconsistent state. See P2 hint above."
fi
log "Global install succeeded."

# ============================================================================
# PHASE P3 — POST-INSTALL, DAEMON MIGRATION
# ============================================================================

PHASE="P3"

log "=== Polling daemons for migration to $TARGET_VERSION (deadline ${DAEMON_AUTO_UPGRADE_WAIT_SECONDS}s, tick ${DAEMON_POLL_INTERVAL_SECONDS}s) ==="

# Bounded polling (M12). Log each pass; stop early when all daemons OK or absent.
ELAPSED=0
DAEMONS_OK=0
DAEMONS_STALE=0
DAEMONS_ABSENT=0

while [ "$ELAPSED" -le "$DAEMON_AUTO_UPGRADE_WAIT_SECONDS" ]; do
  DAEMONS_OK=0
  DAEMONS_STALE=0
  DAEMONS_ABSENT=0
  PASS_REPORT=""
  for home in "${DAEMON_HOMES[@]}"; do
    STATE_FILE="$home/daemon.state.json"
    if [ ! -f "$STATE_FILE" ]; then
      DAEMONS_ABSENT=$((DAEMONS_ABSENT + 1))
      PASS_REPORT="${PASS_REPORT}    $home: ABSENT (daemon not running?)\n"
      continue
    fi
    STARTED_VERSION="$(jq -r .startedWithCliVersion "$STATE_FILE" 2>/dev/null || true)"
    if [ "$STARTED_VERSION" = "$TARGET_VERSION" ]; then
      DAEMONS_OK=$((DAEMONS_OK + 1))
      PASS_REPORT="${PASS_REPORT}    $home: OK ($STARTED_VERSION)\n"
    else
      DAEMONS_STALE=$((DAEMONS_STALE + 1))
      PASS_REPORT="${PASS_REPORT}    $home: STALE (running $STARTED_VERSION, expected $TARGET_VERSION)\n"
    fi
  done

  log "  poll t=${ELAPSED}s: OK=$DAEMONS_OK STALE=$DAEMONS_STALE ABSENT=$DAEMONS_ABSENT"
  printf "%b" "$PASS_REPORT" | tee -a "$LOG" >/dev/null

  # Stop early when no daemon is stale (all OK or absent).
  if [ "$DAEMONS_STALE" -eq 0 ]; then
    log "All running daemons reached $TARGET_VERSION (or daemon absent)."
    break
  fi

  # If we've consumed the budget, exit the loop and let the post-loop check decide.
  if [ "$ELAPSED" -ge "$DAEMON_AUTO_UPGRADE_WAIT_SECONDS" ]; then
    break
  fi

  sleep "$DAEMON_POLL_INTERVAL_SECONDS"
  ELAPSED=$((ELAPSED + DAEMON_POLL_INTERVAL_SECONDS))
done

# Post-loop verdict (M12, M14 P3, M19).
if [ "$DAEMONS_STALE" -gt 0 ]; then
  log "$DAEMONS_STALE daemon(s) still STALE at deadline (${DAEMON_AUTO_UPGRADE_WAIT_SECONDS}s)."
  log "OK=$DAEMONS_OK STALE=$DAEMONS_STALE ABSENT=$DAEMONS_ABSENT"
  abort "Daemon migration incomplete: $DAEMONS_STALE daemon(s) did not pick up $TARGET_VERSION. See P3 hint above."
fi

DAEMONS_TOTAL=${#DAEMON_HOMES[@]}
log "Daemon migration: OK=$DAEMONS_OK ABSENT=$DAEMONS_ABSENT of $DAEMONS_TOTAL total."

# ============================================================================
# SUCCESS EPILOGUE (M15 — Block 1 + Block 2)
# ============================================================================

# Block 2 prep: compute fork divergence WITHOUT auto-fetch (the LAST KNOWN
# fetch state is what matters; an in-script fetch would surface other surprise
# commits and is itself a side effect we deliberately avoid).
DIVERGENCE_AHEAD="?"
DIVERGENCE_HINT=""
FORK_MAIN_SHA=""
if git rev-parse --verify -q "refs/remotes/$EXPECTED_REMOTE_NAME/main" >/dev/null 2>&1; then
  if rev_count="$(git rev-list --count HEAD..refs/remotes/$EXPECTED_REMOTE_NAME/main 2>/dev/null)"; then
    DIVERGENCE_AHEAD="$rev_count"
  fi
  FORK_MAIN_SHA="$(git rev-parse --short "refs/remotes/$EXPECTED_REMOTE_NAME/main" 2>/dev/null || true)"
else
  DIVERGENCE_HINT="(fork remote '$EXPECTED_REMOTE_NAME' or its main branch not configured locally; '?' is shown for the count)"
fi
[ -z "$FORK_MAIN_SHA" ] && FORK_MAIN_SHA="<fork/main commit at fetch time>"

log ""
log "=== ROLLBACK OK ==="
log "  HEAD:               $POST_RESET_HEAD (= $TARGET_TAG)"
log "  Rolled back from:   $PRE_ROLLBACK_HEAD ($PRE_ROLLBACK_VERSION)"
log "  Rolled back to:     $TARGET_VERSION"
log "  Safety tag:         $SAFETY_TAG"
log "  Daemons:            OK=$DAEMONS_OK ABSENT=$DAEMONS_ABSENT of $DAEMONS_TOTAL total at $TARGET_VERSION"
log ""

# --- Block 1: no-push warning (carry-forward from prior iter) ---
log "WARNING: Rollback is local-only."
log "Pushing this state to the fork would force-rewrite history (the rolled-back"
log "commit is no longer fast-forward from $EXPECTED_REMOTE_NAME/main). If you need to share this"
log "rollback with collaborators, that is a separate, deliberate decision the"
log "operator must make manually with full understanding of force-push consequences."
log ""

# --- Block 2: fork-divergence advisory (M15 Block 2; QA-iter2 OBJ-2) ---
log "=== Fork divergence after rollback ==="
log "$EXPECTED_REMOTE_NAME/main is now AHEAD of HEAD by ${DIVERGENCE_AHEAD} commit(s). The bad commit(s) you just"
log "rolled away from are still on the fork. Until they are removed from the fork,"
log "the next deploy.sh invocation in $PROD_ROOT will see them via 'git fetch $EXPECTED_REMOTE_NAME'"
log "and they may re-enter your tree."
if [ -n "$DIVERGENCE_HINT" ]; then
  log "  $DIVERGENCE_HINT"
fi
log ""
log "Two forward paths:"
log "  (a) Force-push the rolled-back state to $EXPECTED_REMOTE_NAME/main (symmetrical undo, makes"
log "      fork match local). MANUAL operator decision; rollback.sh did not execute"
log "      it. Operator command (copy and run from $PROD_ROOT in your TTY):"
log ""
log "        git push --force-with-lease=main:$FORK_MAIN_SHA $EXPECTED_REMOTE_NAME main:main"
log ""
log "      Recommended for the common single-commit failed-deploy case."
log ""
log "  (b) Tag-based forward roll — leave fork ahead, plan a NEW dev-SHA that itself"
log "      reverts or fixes the regression, and run a future"
log "        bash scripts/deploy.sh <new-dev-sha> <topic-name>"
log "      from $PROD_ROOT. The next deploy.sh's fetch + merge will land the new"
log "      corrective commit on top of the rolled-back HEAD without surfacing the"
log "      bad commits as a separate merge target. Recommended when collaborators"
log "      have already pulled the bad commits and a force-push would be disruptive."
log ""
log "For the common single-commit failed-deploy case, path (a) is recommended;"
log "for multi-collaborator scenarios, prefer path (b)."
log ""
log "If migration to TARGET_VERSION is incomplete despite this success exit, recheck:"
log "  for h in /root/.happy /root/.happy-jade /root/.happy-qijie; do \\"
log "    jq -r .startedWithCliVersion \"\$h/daemon.state.json\"; done"
log ""

exit 0
