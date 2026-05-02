#!/usr/bin/env bash
# tests/lib/sandbox.sh — M-SANDBOX
# Per-scenario filesystem sandbox lifecycle.
#
# All harness state lives under $SANDBOX (a fresh mktemp dir per scenario).
# Source script copies, bare repos, working clones, daemon home dirs, log
# files, and PATH-shim binaries all live below $SANDBOX so tests can run
# fully isolated from /root, /var, /usr.
#
# Functions exported:
#   mk_sandbox            -> creates $SANDBOX with subdirs; sets SANDBOX env
#   cleanup_sandbox       -> removes $SANDBOX unless KEEP_SANDBOX=1
#   set_env               -> exports PATH-prepended shims, log paths
#
# Conventions:
# - $SANDBOX must be an absolute path (mktemp -d returns absolute).
# - $ORIGINAL_PATH is captured once at file source time so set_env can prepend
#   the sandbox bin idempotently across scenarios sharing the same shell.

# shellcheck disable=SC2034
_SANDBOX_LIB_LOADED=1

# Capture the original PATH exactly once. Idempotent across re-sources.
if [ -z "${ORIGINAL_PATH:-}" ]; then
  ORIGINAL_PATH="$PATH"
  export ORIGINAL_PATH
fi

# REPO_ROOT auto-derive (run-all.sh sets this; standalone scenarios may not).
if [ -z "${REPO_ROOT:-}" ]; then
  # This file is at <REPO>/tests/lib/sandbox.sh
  _SB_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$_SB_HERE/../.." && pwd)"
  export REPO_ROOT
fi

mk_sandbox() {
  SANDBOX="$(mktemp -d /tmp/happy-test-XXXXXX)"
  export SANDBOX
  mkdir -p \
    "$SANDBOX/prod/happy" \
    "$SANDBOX/repos" \
    "$SANDBOX/dev/clone" \
    "$SANDBOX/daemons/default" \
    "$SANDBOX/daemons/jade" \
    "$SANDBOX/daemons/qijie" \
    "$SANDBOX/bin" \
    "$SANDBOX/log" \
    "$SANDBOX/scripts" \
    "$SANDBOX/scratch"
}

cleanup_sandbox() {
  if [ "${KEEP_SANDBOX:-0}" = "1" ]; then
    echo "  (KEEP_SANDBOX=1; preserved at $SANDBOX)" >&2
    return 0
  fi
  if [ -n "${SANDBOX:-}" ] && [ -d "$SANDBOX" ]; then
    # Belt-and-braces: ensure we never rm a path that doesn't start with /tmp/happy-test-.
    case "$SANDBOX" in
      /tmp/happy-test-*) rm -rf -- "$SANDBOX" ;;
      *) echo "REFUSING to rm SANDBOX with unsafe prefix: $SANDBOX" >&2; return 1 ;;
    esac
  fi
}

set_env() {
  : "${SANDBOX:?set_env requires mk_sandbox first}"
  # Copy shim binaries from REPO/tests/bin into the per-scenario sandbox bin.
  # Done here (rather than as symlinks) so a scenario can chmod/replace shims
  # without affecting the source tree.
  : "${REPO_ROOT:?set_env requires REPO_ROOT (set by run-all.sh)}"
  cp "$REPO_ROOT/tests/bin/npm"               "$SANDBOX/bin/npm"
  cp "$REPO_ROOT/tests/bin/yarn"              "$SANDBOX/bin/yarn"
  cp "$REPO_ROOT/tests/bin/recovery-stub.sh"  "$SANDBOX/bin/recovery-stub.sh"
  chmod +x "$SANDBOX/bin/npm" "$SANDBOX/bin/yarn" "$SANDBOX/bin/recovery-stub.sh"
  # PATH-prepend the sandbox bin so the scenario's npm/yarn/recovery-stub.sh
  # are picked up before any system binary. Use ORIGINAL_PATH (not $PATH) so
  # repeated calls don't accumulate.
  PATH="$SANDBOX/bin:$ORIGINAL_PATH"
  export PATH
  export NPM_SHIM_LOG="$SANDBOX/log/npm.log"
  export YARN_SHIM_LOG="$SANDBOX/log/yarn.log"
  # Initialize log files so shims can append unconditionally.
  : > "$NPM_SHIM_LOG"
  : > "$YARN_SHIM_LOG"
}
