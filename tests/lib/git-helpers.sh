#!/usr/bin/env bash
# tests/lib/git-helpers.sh — M-GIT
# Bare-repo + clone + fixture authoring for the virtual-repo harness.
#
# Topology mirrors deploy.sh's expectations:
#   $SANDBOX/repos/fork.git           bare upstream (file:// remote)
#   $SANDBOX/dev/clone/               developer's working tree
#   $SANDBOX/prod/happy/              production tree (script invocation cwd)
#
# All git invocations run with -c init.defaultBranch=main and isolated
# user.email/user.name so commits succeed in a hermetic shell.

# shellcheck disable=SC2034
_GIT_HELPERS_LIB_LOADED=1

# Hermetic git: never read system/global config; always identify the author.
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Happy Test}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-test@happy.local}"
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Happy Test}"
GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-test@happy.local}"
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

_git_local_config() {
  local dir="$1"
  git -C "$dir" config user.name "$GIT_AUTHOR_NAME"
  git -C "$dir" config user.email "$GIT_AUTHOR_EMAIL"
  git -C "$dir" config commit.gpgsign false
  git -C "$dir" config tag.gpgsign false
  git -C "$dir" config init.defaultBranch main
}

init_bare_fork() {
  : "${SANDBOX:?init_bare_fork requires SANDBOX}"
  git init --bare --initial-branch=main "$SANDBOX/repos/fork.git" >/dev/null
}

init_dev_clone() {
  : "${SANDBOX:?init_dev_clone requires SANDBOX}"
  git clone --quiet "$SANDBOX/repos/fork.git" "$SANDBOX/dev/clone" 2>/dev/null
  _git_local_config "$SANDBOX/dev/clone"
  # Rename origin -> fork so deploy.sh's EXPECTED_REMOTE_NAME=fork works
  # in both dev and prod clones. (Dev only uses 'fork' for pushes; prod
  # uses 'fork' for fetch + push.)
  git -C "$SANDBOX/dev/clone" remote rename origin fork
  # ensure local main exists before any commits land
  git -C "$SANDBOX/dev/clone" symbolic-ref HEAD refs/heads/main
}

init_prod_clone() {
  : "${SANDBOX:?init_prod_clone requires SANDBOX}"
  git clone --quiet "$SANDBOX/repos/fork.git" "$SANDBOX/prod/happy" 2>/dev/null
  _git_local_config "$SANDBOX/prod/happy"
  # deploy.sh / rollback.sh expect a remote named "fork" (EXPECTED_REMOTE_NAME).
  # 'git clone' creates a remote named 'origin' by default; rename it.
  git -C "$SANDBOX/prod/happy" remote rename origin fork
  git -C "$SANDBOX/prod/happy" symbolic-ref HEAD refs/heads/main
}

# Author the baseline commit C0 in dev/clone with version 1.0.0 + push to fork.
# After this, all 3 trees know about the same C0 sha.
seed_baseline() {
  : "${SANDBOX:?seed_baseline requires SANDBOX}"
  local d="$SANDBOX/dev/clone"
  mkdir -p "$d/packages/happy-cli" "$d/docs/dev" "$d/.claude"
  cat >"$d/packages/happy-cli/package.json" <<'JSON'
{"name":"happy-cli","version":"1.0.0","files":["dist/"]}
JSON
  echo 'PROD-CLAUDE-MD-C0' >"$d/CLAUDE.md"
  echo 'PROD-INDEX-MD-C0' >"$d/INDEX.md"
  : >"$d/docs/dev/.gitkeep"
  : >"$d/.claude/.gitkeep"
  # Add a top-level yarn.lock + minimal happy-cli yarn install marker so deploy.sh's
  # frozen-lockfile check finds something to validate against. The yarn shim does
  # not actually consult the lockfile, but the file's presence prevents shell
  # surprises if a future scenario invokes real yarn.
  echo '# placeholder yarn.lock' >"$d/yarn.lock"
  git -C "$d" add -A
  git -C "$d" commit --quiet -m 'C0: baseline'
  git -C "$d" push --quiet fork main:main
  # Synchronize prod/happy with C0 by fetching + fast-forward via reset --hard
  # (clone of empty bare creates no tracking branch).
  git -C "$SANDBOX/prod/happy" fetch --quiet fork main
  git -C "$SANDBOX/prod/happy" reset --hard --quiet FETCH_HEAD
}

commit_in_dev_clone() {
  local message="$1"
  git -C "$SANDBOX/dev/clone" add -A
  git -C "$SANDBOX/dev/clone" commit --quiet -m "$message"
}

bump_version_in_dev_clone() {
  local new_version="$1"
  local pj="$SANDBOX/dev/clone/packages/happy-cli/package.json"
  # Use jq to keep the file legal JSON regardless of formatting.
  local tmp
  tmp="$(mktemp)"
  jq --arg v "$new_version" '.version=$v' "$pj" >"$tmp"
  mv "$tmp" "$pj"
}

bump_version_in_prod() {
  local new_version="$1"
  local pj="$SANDBOX/prod/happy/packages/happy-cli/package.json"
  local tmp
  tmp="$(mktemp)"
  jq --arg v "$new_version" '.version=$v' "$pj" >"$tmp"
  mv "$tmp" "$pj"
}

# Append a non-protected file change in the dev clone.
add_dev_file() {
  local path="$1" content="$2"
  local full="$SANDBOX/dev/clone/$path"
  mkdir -p "$(dirname "$full")"
  printf '%s' "$content" >"$full"
}

push_dev_to_fork() {
  git -C "$SANDBOX/dev/clone" push --quiet fork main:main
}

fetch_in_prod() {
  git -C "$SANDBOX/prod/happy" fetch --quiet fork
}

# Read-only helpers ----------------------------------------------------------

dev_head_sha() {
  git -C "$SANDBOX/dev/clone" rev-parse HEAD
}

prod_head_sha() {
  git -C "$SANDBOX/prod/happy" rev-parse HEAD
}

# Asserts the set of tags in fork.git equals exactly the provided list.
# Usage: assert_fork_tags_exact <tag1> <tag2> ...
assert_fork_tags_exact() {
  local expected_set
  expected_set="$(printf '%s\n' "$@" | LC_ALL=C sort | tr '\n' ' ')"
  local actual_set
  actual_set="$(git -C "$SANDBOX/repos/fork.git" for-each-ref refs/tags --format='%(refname:short)' \
    | LC_ALL=C sort | tr '\n' ' ')"
  if [ "$expected_set" != "$actual_set" ]; then
    fail "$SCENARIO_NAME" "fork tags mismatch: expected [$expected_set] got [$actual_set]"
    return 1
  fi
  return 0
}

# Returns 0 if any tag matches the regex, prints the matching tag.
find_fork_tag_matching() {
  local pattern="$1"
  git -C "$SANDBOX/repos/fork.git" for-each-ref refs/tags --format='%(refname:short)' \
    | grep -E "$pattern" \
    | head -1
}

find_local_tag_matching() {
  local repo="$1" pattern="$2"
  git -C "$repo" for-each-ref refs/tags --format='%(refname:short)' \
    | grep -E "$pattern" \
    | head -1
}

# Invariant baseline fixture used by most deploy scenarios. Per codex iter1
# review #5: extract only the SHARED setup; each scenario keeps its own
# mutation, stdin, failure-injection, and assertions local so the adversarial
# point of the scenario stays visible.
#
# Sets up: bare fork.git + dev clone + prod clone, baseline C0 (v1.0.0) on
# both, and rewrite + path-scan deploy.sh into the sandbox. After this, the
# scenario can author C1 in dev/clone and invoke deploy.sh.
#
# Returns: 0 on clean setup; 2 on rewrite/path-scan failure (caller should
# `exit 2` to propagate harness setup-fail to the runner).
setup_baseline_deploy_fixture() {
  init_bare_fork
  init_dev_clone
  init_prod_clone
  seed_baseline
  if ! rewrite_deploy_sh; then
    fail "$SCENARIO_NAME" "rewrite_deploy_sh failed"
    return 2
  fi
  if ! path_scan_rewritten "$SANDBOX/scripts/deploy.sh"; then
    fail "$SCENARIO_NAME" "path-scan caught a leak in rewritten deploy.sh"
    return 2
  fi
  return 0
}

# Same shape, for rollback scenarios. Rewrites BOTH deploy.sh and rollback.sh
# (deploy is needed by S10 to produce a real PRE_TAG before testing rollback).
setup_baseline_rollback_fixture() {
  init_bare_fork
  init_dev_clone
  init_prod_clone
  seed_baseline
  if ! rewrite_deploy_sh; then
    fail "$SCENARIO_NAME" "rewrite_deploy_sh failed"
    return 2
  fi
  if ! rewrite_rollback_sh; then
    fail "$SCENARIO_NAME" "rewrite_rollback_sh failed"
    return 2
  fi
  if ! path_scan_rewritten "$SANDBOX/scripts/deploy.sh"; then
    fail "$SCENARIO_NAME" "path-scan caught a leak in rewritten deploy.sh"
    return 2
  fi
  if ! path_scan_rewritten "$SANDBOX/scripts/rollback.sh"; then
    fail "$SCENARIO_NAME" "path-scan caught a leak in rewritten rollback.sh"
    return 2
  fi
  return 0
}
