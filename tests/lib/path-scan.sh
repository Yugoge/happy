#!/usr/bin/env bash
# tests/lib/path-scan.sh — M-PATHSCAN
# Static scan that runs AFTER each rewrite, BEFORE any rewritten-script
# invocation. Catches future-cycle drift where a new /root, /var, /usr
# constant is added to deploy.sh / rollback.sh and the rewriter forgets to
# learn about it.
#
# Pass 1 #6 / Pass 3 #1 reconciled:
#   - regex character class is [A-Za-z._-] (not [a-z]) so /root/.happy is caught
#   - allowlist is line-pattern-aware: comment lines and log/echo/printf
#     argument-string lines are operator hints / instructions, not live paths
#   - failure exits the WHOLE run with code 2 (setup-fail), distinct from
#     scenario FAIL exit 1

# shellcheck disable=SC2034
_PATHSCAN_LIB_LOADED=1

# path_scan_rewritten <rewritten-file>
# returns 0 on clean (no leaked paths), 1 on leak (and prints offenders).
path_scan_rewritten() {
  local file="$1"
  if [ ! -r "$file" ]; then
    echo "[PATHSCAN FAIL] $file: not readable" >&2
    return 1
  fi

  # Stage 1: raw matches. Empty raw = clean.
  local raw
  raw="$(grep -nE '/(root|var|usr)/[A-Za-z._-]' "$file" 2>/dev/null || true)"
  if [ -z "$raw" ]; then
    return 0
  fi

  # Stage 2: filter out comment lines (^#).
  # Stage 3: filter out lines whose primary content is a SIMPLE LITERAL log/echo/
  #          printf/abort call — the argument is operator copy. Per codex iter1
  #          adversarial review, the discriminator is tightened: lines with `;`,
  #          `&&`, `||`, `|`, `>`, command substitution `$(`, or backticks are
  #          NOT allowlisted because a chained command after the log call could
  #          itself touch /root. Bare `$VAR` interpolation IS allowed because
  #          deploy.sh and rollback.sh contain `log "... $PROD_ROOT ..."`-style
  #          message templates routinely.
  # Stage 4: filter out heredoc-opener lines IFF the opener is plain `<<TAG`
  #          with no preceding redirect. Tightened: `cat > /root/foo <<EOF` is
  #          NOT allowlisted because it would create a real /root file.
  # awk-based discriminator. Per codex iter1 review #Q1, the filter must
  # tighten to catch chained-shell-command leaks (e.g. abort "$(cat /root/...)")
  # but NOT over-reject legitimate operator-copy log lines that include `;`
  # or `>` INSIDE a quoted string literal.
  #
  # The key insight: bash injection vectors INSIDE a double-quoted string are
  # `$(...)` (command substitution) and backticks. Other characters (`;`, `|`,
  # `>`, `&&`, `||`) are LITERAL inside `"..."` — they are not interpreted as
  # control flow. So the safe rule for log/echo/printf/abort calls is:
  #
  #   ALLOWLIST IF the call wraps its argument in a quote AND contains no
  #   `$(` and no backticks anywhere on the line.
  #
  # If the line has `$(` or backtick, it MIGHT chain a real /root touch via
  # command substitution — survive into the path-scan FAIL set.
  local survivors
  survivors="$(printf '%s\n' "$raw" | awk -F: '
    {
      lineno = $1
      content = substr($0, length(lineno) + 2)
      stripped = content
      sub(/^[[:space:]]+/, "", stripped)

      # 1) Comment line — allowlist
      if (stripped ~ /^#/) next

      # 2) log/echo/printf/abort call wrapping a quoted string — allowlist
      #    unless the line contains command substitution `$(` or backticks.
      if (stripped ~ /^(log|echo|printf|abort)[[:space:]]+["'\'']/) {
        if (stripped ~ /\$\(/) { print $0; next }
        if (stripped ~ /`/)    { print $0; next }
        next
      }

      # 3) Heredoc opener with no preceding `>` redirect — allowlist
      #    (operator help text body; `cat > /root/foo <<TAG` does NOT pass
      #     because the `>` redirect appears before the `<<`).
      if (stripped ~ /<<[A-Za-z_]/ && stripped !~ />[^>]*<<[A-Za-z_]/) next

      # 4) Real survivor
      print $0
    }')"

  if [ -z "$survivors" ]; then
    return 0
  fi

  echo "[PATHSCAN FAIL] $file: leaked path(s) outside allowlist:" >&2
  echo "$survivors" >&2
  return 1
}

# path_scan_or_die <file1> [file2 ...]
# Returns 2 if any scan fails (used by run-all.sh to abort the whole run).
path_scan_or_die() {
  local f rc=0
  for f in "$@"; do
    if ! path_scan_rewritten "$f"; then
      rc=2
    fi
  done
  return $rc
}
