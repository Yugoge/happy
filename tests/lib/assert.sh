#!/usr/bin/env bash
# tests/lib/assert.sh — M-ASSERT
# Per-scenario assertion helpers + pass/fail/skip emitters.
#
# Each scenario is expected to set SCENARIO_NAME at the top of its body. All
# helpers honour that name in their output prefix. The scenario subshell
# tracks failures via the SCENARIO_FAILED flag; when non-zero at completion,
# the scenario is reported FAIL.

# shellcheck disable=SC2034
_ASSERT_LIB_LOADED=1

SCENARIO_NAME="${SCENARIO_NAME:-unknown}"
SCENARIO_FAILED=0

# Emitters --------------------------------------------------------------------

pass() {
  local name="${1:-$SCENARIO_NAME}"
  local duration="${2:-?}"
  echo "[PASS] $name (${duration}s)"
}

fail() {
  local name="${1:-$SCENARIO_NAME}"
  local reason="${2:-unspecified}"
  echo "[FAIL] $name: $reason" >&2
  SCENARIO_FAILED=1
}

skip() {
  local name="${1:-$SCENARIO_NAME}"
  local reason="${2:-no reason given}"
  echo "[SKIP] $name: $reason"
}

# Assertions ------------------------------------------------------------------
# Each assertion records a failure on the per-scenario flag rather than
# exiting; scenario can choose to early-out by checking SCENARIO_FAILED.

assert_exit_code() {
  local expected="$1" actual="$2" label="${3:-exit code}"
  if [ "$actual" -ne "$expected" ]; then
    fail "$SCENARIO_NAME" "$label: expected $expected, got $actual"
    return 1
  fi
  return 0
}

assert_log_contains() {
  local file="$1" needle="$2" label="${3:-log contains}"
  if [ ! -f "$file" ]; then
    fail "$SCENARIO_NAME" "$label: file not found: $file"
    return 1
  fi
  if ! grep -F -q -- "$needle" "$file"; then
    fail "$SCENARIO_NAME" "$label: '$needle' not found in $file"
    return 1
  fi
  return 0
}

assert_log_not_contains() {
  local file="$1" needle="$2" label="${3:-log not contains}"
  if [ ! -f "$file" ]; then
    # missing file vacuously satisfies "not contains"
    return 0
  fi
  if grep -F -q -- "$needle" "$file"; then
    fail "$SCENARIO_NAME" "$label: '$needle' unexpectedly present in $file"
    return 1
  fi
  return 0
}

assert_file_eq() {
  local a="$1" b="$2" label="${3:-files equal}"
  if [ ! -f "$a" ]; then fail "$SCENARIO_NAME" "$label: file A not found: $a"; return 1; fi
  if [ ! -f "$b" ]; then fail "$SCENARIO_NAME" "$label: file B not found: $b"; return 1; fi
  if ! cmp -s -- "$a" "$b"; then
    fail "$SCENARIO_NAME" "$label: $a != $b"
    return 1
  fi
  return 0
}

assert_count() {
  local expected="$1" actual="$2" label="${3:-count}"
  if [ "$actual" != "$expected" ]; then
    fail "$SCENARIO_NAME" "$label: expected $expected, got $actual"
    return 1
  fi
  return 0
}

assert_file_exists() {
  local path="$1" label="${2:-file exists}"
  if [ ! -e "$path" ]; then
    fail "$SCENARIO_NAME" "$label: $path"
    return 1
  fi
  return 0
}

assert_file_absent() {
  local path="$1" label="${2:-file absent}"
  if [ -e "$path" ]; then
    fail "$SCENARIO_NAME" "$label: unexpectedly present: $path"
    return 1
  fi
  return 0
}

assert_str_match() {
  # Regex (ERE) match against a string. Used for safety-tag suffix checks.
  local actual="$1" pattern="$2" label="${3:-string matches regex}"
  if ! [[ "$actual" =~ $pattern ]]; then
    fail "$SCENARIO_NAME" "$label: '$actual' does not match '$pattern'"
    return 1
  fi
  return 0
}

assert_str_eq() {
  local expected="$1" actual="$2" label="${3:-string equal}"
  if [ "$actual" != "$expected" ]; then
    fail "$SCENARIO_NAME" "$label: expected '$expected', got '$actual'"
    return 1
  fi
  return 0
}
