#!/usr/bin/env bash
# tests/lib/static-audit.sh — defines audit_no_executable() helper used by S17
# (BA spec § S17 + iter3 OBJ-3 implementation hint).
#
# Usage: count=$(audit_no_executable <pattern> <file>) -> echoes count of
# executable matches AFTER excluding allowlisted advisory contexts:
#   - comment lines (^#)
#   - log/echo/printf calls
#   - heredoc-opener lines (`<<` token)
#
# OBJ-3 fix (iter3 BA spec lines 422-440): each grep that may exit 1 in the
# success path (no matches OR all matches filtered) is wrapped in
# `{ ...; || true; }` so set -euo pipefail does not abort the caller.
# `[ -r "$file" ]` precheck catches missing/unreadable file with return 2
# (codex iter3 caveat: the `|| true` wrapper would otherwise mask exit 2 from
# grep regex-compile errors too — accepted scope-creep trade-off, see L14b).

# shellcheck disable=SC2034
_STATIC_AUDIT_LIB_LOADED=1

audit_no_executable() {
  local pattern="$1" file="$2"
  if [ ! -r "$file" ]; then
    echo "[audit_no_executable] file not readable: $file" >&2
    return 2
  fi
  { grep -nE "$pattern" "$file" 2>/dev/null || true; } \
    | { grep -vE '^[0-9]+:[[:space:]]*(#|log[[:space:]]|echo[[:space:]]|printf[[:space:]])' || true; } \
    | { grep -vE '^[0-9]+:.*<<' || true; } \
    | wc -l \
    | tr -d ' '
}
