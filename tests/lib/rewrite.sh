#!/usr/bin/env bash
# tests/lib/rewrite.sh — M-REWRITE
# Sed-rewrites a per-scenario COPY of scripts/deploy.sh + scripts/rollback.sh
# to redirect every absolute /root, /var, /usr path into $SANDBOX. Production
# scripts are NEVER modified.
#
# Each rewrite target is line-anchored and verified BEFORE the substitution
# runs (M-REWRITE.4): if the expected pattern is missing, the rewriter aborts
# the whole run with [REWRITE FAIL]. This catches future-cycle script drift.
#
# Pass 1 findings wired in:
#   #2  DAEMON_HOMES multi-line block replacement (deploy:52-56, rollback:61-65)
#   #4  rollback.sh:146 [ -x /root/bin/safe-daemon-restart.sh ] runtime check
#   #5  DAEMON_AUTO_UPGRADE_WAIT_SECONDS = 0
#   #6/8 absolute-path baking via literal SANDBOX expansion
#
# Functions exported:
#   rewrite_deploy_sh       -> copies scripts/deploy.sh to $SANDBOX/scripts/deploy.sh
#                              + applies M-REWRITE.2 rewrites
#   rewrite_rollback_sh     -> copies scripts/rollback.sh to $SANDBOX/scripts/rollback.sh
#                              + applies M-REWRITE.3 rewrites
#   rewrite_both            -> convenience wrapper

# shellcheck disable=SC2034
_REWRITE_LIB_LOADED=1

# REPO_ROOT must be set by run-all.sh; fall back to git rev-parse for
# stand-alone unit tests.
if [ -z "${REPO_ROOT:-}" ]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  export REPO_ROOT
fi

# Verify a literal pattern occurs exactly once in the source file. Aborts the
# scenario (and ultimately the run) on miss/multi-match — this is the future-
# drift guardrail.
_assert_pattern_unique() {
  local file="$1" pattern="$2"
  local count
  count="$(grep -c -F -- "$pattern" "$file" || true)"
  if [ "$count" -ne 1 ]; then
    echo "[REWRITE FAIL] expected exactly 1 occurrence of '$pattern' in $file, found $count" >&2
    return 1
  fi
  return 0
}

# M-REWRITE.5 — Post-sed diff verifier. Asserts ONLY the named-line changes
# happened (no accidental wildcard matches eating extra lines). Per BA spec
# line 202: diff body line count must equal expected change count.
verify_rewrite_diff() {
  local file="$1" expected="$2" actual
  actual=$(diff -u "$file.orig" "$file" 2>/dev/null \
    | awk '/^---/||/^\+\+\+/{next} /^[-+]/{c++} END{print c+0}' || true)
  if [ "$actual" -ne "$expected" ]; then
    echo "[REWRITE FAIL] $file: expected $expected diff body lines, got $actual (M-REWRITE.5)" >&2
    diff -u "$file.orig" "$file" >&2 || true
    return 2
  fi
  return 0
}

rewrite_deploy_sh() {
  : "${SANDBOX:?rewrite_deploy_sh requires SANDBOX}"
  local src="$REPO_ROOT/scripts/deploy.sh"
  local dst="$SANDBOX/scripts/deploy.sh"
  cp "$src" "$dst.orig"
  cp "$src" "$dst"

  # Pre-flight pattern checks (single-line targets only — the multi-line
  # DAEMON_HOMES block is checked separately below).
  _assert_pattern_unique "$dst" 'PROD_ROOT="/root/happy"' || return 2
  _assert_pattern_unique "$dst" 'RECOVERY_SCRIPT="/root/bin/happy-session-recovery.sh"' || return 2
  _assert_pattern_unique "$dst" 'LOG="/var/log/happy-deploy.log"' || return 2
  _assert_pattern_unique "$dst" 'DAEMON_AUTO_UPGRADE_WAIT_SECONDS=90' || return 2

  # Single-line constants. Use # as delimiter to avoid quoting hell with /.
  sed -i \
    -e "s#^PROD_ROOT=\"/root/happy\"#PROD_ROOT=\"$SANDBOX/prod/happy\"#" \
    -e "s#^RECOVERY_SCRIPT=\"/root/bin/happy-session-recovery.sh\"#RECOVERY_SCRIPT=\"$SANDBOX/bin/recovery-stub.sh\"#" \
    -e "s#^LOG=\"/var/log/happy-deploy.log\"#LOG=\"$SANDBOX/log/deploy.log\"#" \
    -e 's#^DAEMON_AUTO_UPGRADE_WAIT_SECONDS=90#DAEMON_AUTO_UPGRADE_WAIT_SECONDS=0#' \
    "$dst"

  # Multi-line DAEMON_HOMES block. The block is exactly:
  #   DAEMON_HOMES=(
  #     "/root/.happy"
  #     "/root/.happy-jade"
  #     "/root/.happy-qijie"
  #   )
  # We replace from the opening 'DAEMON_HOMES=(' line through the next ')'.
  # Use a Python-free pure-sed range with a label loop (works on GNU sed).
  if ! grep -q '^DAEMON_HOMES=($' "$dst"; then
    echo "[REWRITE FAIL] DAEMON_HOMES block opener not found in $dst" >&2
    return 2
  fi
  # Per codex iter3 global review Q3: assert that a closing `)` follows the
  # opener BEFORE EOF. If the source lost its closing paren (or grew a
  # multi-line comment before it), awk's range-based replacement could
  # silently truncate the rest of the file.
  if ! awk '
    BEGIN { seen_open = 0; seen_close = 0 }
    /^DAEMON_HOMES=\($/ { seen_open = 1; next }
    seen_open && /^\)/ { seen_close = 1; exit }
    END { exit (seen_open && seen_close) ? 0 : 1 }
  ' "$dst"; then
    echo "[REWRITE FAIL] DAEMON_HOMES block: opener seen but no closing ')' before EOF in $dst" >&2
    return 2
  fi
  # Build the replacement block with a unique sentinel; sed range deletes the
  # original; awk+sed approach below is the simplest GNU-portable variant.
  local tmp
  tmp="$(mktemp)"
  awk -v repl_open='DAEMON_HOMES=(' \
      -v sandbox="$SANDBOX" '
    BEGIN { in_block=0; emitted=0 }
    /^DAEMON_HOMES=\($/ {
      print "DAEMON_HOMES=(\n  \"" sandbox "/daemons/default\"\n  \"" sandbox "/daemons/jade\"\n  \"" sandbox "/daemons/qijie\"\n)"
      in_block=1
      emitted=1
      next
    }
    in_block && /^\)/ { in_block=0; next }
    in_block { next }
    { print }
  ' "$dst" >"$tmp"
  mv "$tmp" "$dst"

  # Verify exactly 3 daemon entries in the rewritten block (M-REWRITE.2 assert).
  local entry_count
  entry_count="$(grep -cE "^  \"$SANDBOX/daemons/(default|jade|qijie)\"\$" "$dst" || true)"
  if [ "$entry_count" -ne 3 ]; then
    echo "[REWRITE FAIL] expected 3 daemon home entries after rewrite, found $entry_count in $dst" >&2
    return 2
  fi
  # Defense against future drift: the DAEMON_HOMES array MUST NOT contain any
  # /root/.happy* entry. Only check ARRAY-ENTRY lines (form `^  "/root/.happy..."`),
  # NOT log/comment lines that reference /root/.happy as operator copy.
  if grep -qE '^  "/root/\.happy' "$dst"; then
    echo "[REWRITE FAIL] /root/.happy* array entry survived rewrite in $dst" >&2
    grep -nE '^  "/root/\.happy' "$dst" >&2
    return 2
  fi
  # M-REWRITE.5: 4 single-line subs (8 body lines) + 3 daemon-entry changes (6) = 14
  verify_rewrite_diff "$dst" 14 || return 2
  return 0
}

rewrite_rollback_sh() {
  : "${SANDBOX:?rewrite_rollback_sh requires SANDBOX}"
  local src="$REPO_ROOT/scripts/rollback.sh"
  local dst="$SANDBOX/scripts/rollback.sh"
  cp "$src" "$dst.orig"
  cp "$src" "$dst"

  _assert_pattern_unique "$dst" 'PROD_ROOT="/root/happy"' || return 2
  _assert_pattern_unique "$dst" 'RECOVERY_SCRIPT="/root/bin/happy-session-recovery.sh"' || return 2
  _assert_pattern_unique "$dst" 'LOG="/var/log/happy-rollback.log"' || return 2
  _assert_pattern_unique "$dst" 'DAEMON_AUTO_UPGRADE_WAIT_SECONDS=90' || return 2
  _assert_pattern_unique "$dst" 'DAEMON_POLL_INTERVAL_SECONDS=10' || return 2
  _assert_pattern_unique "$dst" 'if [ -x /root/bin/safe-daemon-restart.sh ]; then' || return 2

  sed -i \
    -e "s#^PROD_ROOT=\"/root/happy\"#PROD_ROOT=\"$SANDBOX/prod/happy\"#" \
    -e "s#^RECOVERY_SCRIPT=\"/root/bin/happy-session-recovery.sh\"#RECOVERY_SCRIPT=\"$SANDBOX/bin/recovery-stub.sh\"#" \
    -e "s#^LOG=\"/var/log/happy-rollback.log\"#LOG=\"$SANDBOX/log/rollback.log\"#" \
    -e 's#^DAEMON_AUTO_UPGRADE_WAIT_SECONDS=90#DAEMON_AUTO_UPGRADE_WAIT_SECONDS=0#' \
    -e 's#^DAEMON_POLL_INTERVAL_SECONDS=10#DAEMON_POLL_INTERVAL_SECONDS=1#' \
    -e "s#if \[ -x /root/bin/safe-daemon-restart.sh \]; then#if [ -x \"$SANDBOX/bin/safe-daemon-restart.sh\" ]; then#" \
    "$dst"

  if ! grep -q '^DAEMON_HOMES=($' "$dst"; then
    echo "[REWRITE FAIL] DAEMON_HOMES block opener not found in $dst" >&2
    return 2
  fi
  # Per codex iter3 global review Q3: assert that a closing `)` follows the
  # opener BEFORE EOF. If the source lost its closing paren (or grew a
  # multi-line comment before it), awk's range-based replacement could
  # silently truncate the rest of the file.
  if ! awk '
    BEGIN { seen_open = 0; seen_close = 0 }
    /^DAEMON_HOMES=\($/ { seen_open = 1; next }
    seen_open && /^\)/ { seen_close = 1; exit }
    END { exit (seen_open && seen_close) ? 0 : 1 }
  ' "$dst"; then
    echo "[REWRITE FAIL] DAEMON_HOMES block: opener seen but no closing ')' before EOF in $dst" >&2
    return 2
  fi
  local tmp
  tmp="$(mktemp)"
  awk -v sandbox="$SANDBOX" '
    BEGIN { in_block=0 }
    /^DAEMON_HOMES=\($/ {
      print "DAEMON_HOMES=(\n  \"" sandbox "/daemons/default\"\n  \"" sandbox "/daemons/jade\"\n  \"" sandbox "/daemons/qijie\"\n)"
      in_block=1
      next
    }
    in_block && /^\)/ { in_block=0; next }
    in_block { next }
    { print }
  ' "$dst" >"$tmp"
  mv "$tmp" "$dst"

  local entry_count
  entry_count="$(grep -cE "^  \"$SANDBOX/daemons/(default|jade|qijie)\"\$" "$dst" || true)"
  if [ "$entry_count" -ne 3 ]; then
    echo "[REWRITE FAIL] expected 3 daemon home entries after rewrite, found $entry_count in $dst" >&2
    return 2
  fi
  # Same array-only check as deploy. Operator-hint log lines containing
  # /root/.happy ARE legitimate (they're for the operator reading the log).
  if grep -qE '^  "/root/\.happy' "$dst"; then
    echo "[REWRITE FAIL] /root/.happy* array entry survived rewrite in $dst" >&2
    grep -nE '^  "/root/\.happy' "$dst" >&2
    return 2
  fi
  # Verify the runtime safe-daemon-restart check was rewritten.
  if grep -q '\[ -x /root/bin/safe-daemon-restart.sh \]' "$dst"; then
    echo "[REWRITE FAIL] /root/bin/safe-daemon-restart.sh runtime check NOT rewritten" >&2
    return 2
  fi
  # M-REWRITE.5: 6 single-line subs (12 body lines) + 3 daemon-entry changes (6) = 18
  verify_rewrite_diff "$dst" 18 || return 2
  return 0
}

rewrite_both() {
  rewrite_deploy_sh || return $?
  rewrite_rollback_sh || return $?
  return 0
}
