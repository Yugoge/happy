#!/usr/bin/env bash
# tests/run-all.sh — M-RUNNER
# Single entry-point for the virtual-repo end-to-end harness.
#
# Flags:
#   --list                 list scenario names (annotated with what each covers) + exit 0
#   --filter <regex>       run only scenarios whose name matches the regex
#   --scenario <exact>     run exactly one scenario by exact-name match
#   --keep-sandbox         skip cleanup_sandbox for every scenario (debug)
#   --parallel             background scenarios + collect results in original order (Phase 4)
#   (no flag)              run all scenarios sequentially
#
# Exit codes:
#   0  all selected scenarios PASS
#   1  at least one scenario FAILed
#   2  harness setup failure (--filter matched nothing, dependency missing,
#      rewrite/path-scan failed pre-flight, or scenario timeout-on-setup)
#
# Per-scenario timeout: SCENARIO_TIMEOUT_SECONDS (default 45).

set -uo pipefail

# Repo root resolution. This file lives at <REPO>/tests/run-all.sh.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export REPO_ROOT

# Source libs (order matters: sandbox first so SANDBOX env defines after).
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/sandbox.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/assert.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/git-helpers.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/daemon-mock.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/rewrite.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/path-scan.sh"
# static-audit.sh is sourced lazily by S17 (Phase 3 lib).
if [ -f "$SCRIPT_DIR/lib/static-audit.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lib/static-audit.sh"
fi

# ---------------------------------------------------------------------------
# Dependency preflight
# ---------------------------------------------------------------------------

_check_deps() {
  local missing=()
  for cmd in bash git jq sed grep awk timeout mktemp realpath date; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing+=("$cmd")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "[HARNESS FAIL] missing required commands: ${missing[*]}" >&2
    return 2
  fi
  # GNU sed sanity (L10 documented assumption).
  if ! sed --version 2>/dev/null | grep -q 'GNU sed'; then
    echo "[HARNESS WARN] non-GNU sed detected; rewrite may behave unexpectedly (L10)" >&2
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Scenario discovery
# ---------------------------------------------------------------------------

_list_scenarios() {
  # Names are derived from filenames: SXX-foo-bar.sh -> SXX-foo-bar
  find "$SCRIPT_DIR/scenarios" -maxdepth 1 -name 'S[0-9]*.sh' -type f \
    | LC_ALL=C sort \
    | while read -r f; do
        basename "$f" .sh
      done
}

_scenario_path() {
  echo "$SCRIPT_DIR/scenarios/$1.sh"
}

# Annotation table — what each scenario covers. SH-RUNNER.3.
# Per codex iter3 global review Q5 #5: scenario names from _list_scenarios()
# are full filenames (e.g. "S01-deploy-happy-path"); strip the suffix to the
# bare ID before lookup so --list output shows real annotations not "(no annotation)".
_scenario_annotation() {
  local id="${1%%-*}"
  case "$id" in
    S01) echo "deploy happy-path (codex #11/#15 tag uniqueness)" ;;
    S02) echo "deploy aborts same-version (codex #3)" ;;
    S03) echo "deploy restores protected paths (codex #1+#2)" ;;
    S03b) echo "deploy aborts unreachable dev-SHA (codex #10, Pass 2 #2)" ;;
    S04) echo "deploy aborts wrong cwd (codex #5; 2026-04-04 incident)" ;;
    S05) echo "deploy aborts dirty tree (codex #9)" ;;
    S06) echo "deploy aborts on test-gate failure (codex #14)" ;;
    S06b) echo "deploy aborts on frozen-lockfile install fail (Pass 2 #1)" ;;
    S07) echo "deploy aborts on install fail + auto-rollback install (codex #14)" ;;
    S08) echo "deploy no tag leak — only PRE_TAG/DEPLOY_TAG pushed (codex #11)" ;;
    S09) echo "deploy push-fails / local state still good (codex #8)" ;;
    S10) echo "rollback happy-path" ;;
    S11) echo "rollback aborts same-version (codex #3 symmetric)" ;;
    S11b) echo "rollback bad argv -> exit 2 (Pass 2 #6)" ;;
    S12) echo "rollback aborts partial daemon migration (M14 P3, systemctl branch)" ;;
    S12b) echo "rollback emits SOP-branch hint when safe-daemon-restart present (Pass 2 #5)" ;;
    S13) echo "rollback safety-tag collision suffix (S2/codex #15)" ;;
    S14) echo "rollback aborts on recovery snapshot fail (M6)" ;;
    S14b) echo "rollback aborts on install fail post-reset (Pass 2 #7, M14 P2)" ;;
    S15) echo "rollback aborts on active merge (M3b)" ;;
    S15b) echo "rollback aborts on unreachable tag (M4)" ;;
    S15c) echo "rollback aborts on sensitive untracked (M5)" ;;
    S16) echo "rollback fork-divergence advisory + missing fork/main (M15 Block 2)" ;;
    S17) echo "static audit (M16 no-network, M17 no-shell-state, helper exit-status)" ;;
    *) echo "(no annotation)" ;;
  esac
}

# ---------------------------------------------------------------------------
# Scenario runner
# ---------------------------------------------------------------------------

_run_one_scenario() {
  # Returns:
  #   0 = scenario PASS
  #   1 = scenario FAIL (assertion failed)
  #   2 = harness setup failure inside the scenario (rewrite/path-scan/missing fixture)
  local name="$1"
  local path
  path="$(_scenario_path "$name")"
  if [ ! -f "$path" ]; then
    echo "[FAIL] $name: scenario file not found at $path" >&2
    return 1
  fi

  local timeout_s="${SCENARIO_TIMEOUT_SECONDS:-45}"
  local start_ts end_ts duration rc
  start_ts="$(date +%s)"

  # Each scenario runs in a fresh subshell so an `exit` inside cannot kill the runner.
  set +e
  (
    set -uo pipefail
    timeout "$timeout_s" bash "$path"
  )
  rc=$?
  set -e
  end_ts="$(date +%s)"
  duration=$((end_ts - start_ts))

  if [ $rc -eq 124 ]; then
    echo "[FAIL] $name: timeout after ${timeout_s}s" >&2
    return 1
  fi
  if [ $rc -eq 2 ]; then
    # Scenario itself signalled "harness setup failure" (e.g. rewrite_deploy_sh
    # returned 2 because pattern was missing). Propagate as setup-fail.
    echo "[SETUP-FAIL] $name: scenario exit code 2 (harness setup) (duration ${duration}s)" >&2
    return 2
  fi
  if [ $rc -ne 0 ]; then
    echo "[FAIL] $name: scenario exit code $rc (duration ${duration}s)" >&2
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Coverage limitations footer
# ---------------------------------------------------------------------------

_emit_known_limitations() {
  cat <<'FOOTER'

=== Known Coverage Limitations (BA spec § Known Coverage Limitations) ===
Production-script gate gaps:
  L1  deploy bad-argv exit-2 table (partial via S03b)
  L2  deploy untracked-files-confirm-y branch
  L3  deploy missing-remote gate
  L4  deploy merge-failure gate
  L5  deploy post-test install-confirm decline
  L15 deploy recovery-script-missing branch (deploy.sh:163-165)
  L16 deploy recovery-snapshot-FAIL branch (deploy.sh:158-162)
  L17 deploy stale-daemons confirm y/n (deploy.sh:331-340)
  L18 deploy missing-daemon.state.json branch (deploy.sh:318-320)
Platform-isolation deliberate gaps (W1-W4):
  L6  real systemd interaction
  L7  real npm registry / install-g side effects
  L8  real GitHub network remote
  L9  dev-daemon binary actual auto-upgrade
Environment / assumption gaps:
  L10 GNU sed/grep assumed
  L11 real /var/log permissions / disk-full / inode exhaustion
  L12 bash version variance (assume >= 4.0)
  L13 locale / encoding (assume UTF-8)
Static-audit residuals:
  L14  multi-line log continuation false-positive / heredoc-body false-negative
  L14b audit_no_executable masks grep regex-compilation errors (codex iter3)
  L19  audit_no_executable regex `\bgit (fetch|push)\b` is literal-only;
       does not catch optioned forms like `git -C "$DIR" push` or `git -c x=y push`.
       Current scripts use no such forms; future drift would slip past S17.2/S17.3.
       Documented per codex iter2 Q5 (dev) review; tighter regex deferred to
       follow-up cycle to keep harness in pure portable bash.

See docs/dev/ba-spec-20260429-192017.md § Known Coverage Limitations for full text.
FOOTER
}

# ---------------------------------------------------------------------------
# CLI parser
# ---------------------------------------------------------------------------

opt_list=0
opt_filter=""
opt_scenario=""
opt_keep_sandbox=0
opt_parallel=0

while [ $# -gt 0 ]; do
  case "$1" in
    --list) opt_list=1; shift ;;
    --filter) opt_filter="${2:-}"; shift 2 ;;
    --scenario) opt_scenario="${2:-}"; shift 2 ;;
    --keep-sandbox) opt_keep_sandbox=1; shift ;;
    --parallel) opt_parallel=1; shift ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *)
      echo "[HARNESS FAIL] unknown flag: $1" >&2
      exit 2 ;;
  esac
done

if [ -n "$opt_filter" ] && [ -n "$opt_scenario" ]; then
  echo "[HARNESS FAIL] --filter and --scenario are mutually exclusive" >&2
  exit 2
fi

if [ "$opt_keep_sandbox" = "1" ]; then
  export KEEP_SANDBOX=1
fi

# Build the selection list.
all=()
while IFS= read -r s; do
  all+=("$s")
done < <(_list_scenarios)

if [ "$opt_list" = "1" ]; then
  for s in "${all[@]}"; do
    printf '%-8s %s\n' "$s" "$(_scenario_annotation "$s")"
  done
  exit 0
fi

selected=()
if [ -n "$opt_scenario" ]; then
  for s in "${all[@]}"; do
    if [ "$s" = "$opt_scenario" ]; then
      selected+=("$s")
      break
    fi
  done
  if [ "${#selected[@]}" -eq 0 ]; then
    echo "[HARNESS FAIL] --scenario '$opt_scenario' not found" >&2
    exit 2
  fi
elif [ -n "$opt_filter" ]; then
  for s in "${all[@]}"; do
    if [[ "$s" =~ $opt_filter ]]; then
      selected+=("$s")
    fi
  done
  if [ "${#selected[@]}" -eq 0 ]; then
    echo "[HARNESS FAIL] --filter '$opt_filter' matched zero scenarios" >&2
    exit 2
  fi
else
  selected=("${all[@]}")
fi

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

_check_deps || exit 2

pass_count=0
fail_count=0
setup_fail_count=0
skip_count=0
declare -a results=()

run_start_ts="$(date +%s)"

if [ "$opt_parallel" = "1" ]; then
  # Phase 4 — background each scenario, collect ordered results.
  declare -a outs=()
  for s in "${selected[@]}"; do
    out_file="$(mktemp)"
    outs+=("$out_file:$s")
    (
      _run_one_scenario "$s" >"$out_file" 2>&1
      echo "RC=$?" >>"$out_file"
    ) &
  done
  wait
  for entry in "${outs[@]}"; do
    out_file="${entry%%:*}"
    s="${entry#*:}"
    cat "$out_file"
    if grep -q '^RC=0$' "$out_file"; then
      pass_count=$((pass_count + 1))
      results+=("PASS:$s")
    elif grep -q '^RC=2$' "$out_file"; then
      setup_fail_count=$((setup_fail_count + 1))
      results+=("SETUP-FAIL:$s")
    else
      fail_count=$((fail_count + 1))
      results+=("FAIL:$s")
    fi
  done
else
  for s in "${selected[@]}"; do
    set +e
    _run_one_scenario "$s"
    rc=$?
    set -e
    case $rc in
      0) pass_count=$((pass_count + 1)); results+=("PASS:$s") ;;
      2) setup_fail_count=$((setup_fail_count + 1)); results+=("SETUP-FAIL:$s") ;;
      *) fail_count=$((fail_count + 1)); results+=("FAIL:$s") ;;
    esac
  done
fi

run_end_ts="$(date +%s)"
total_duration=$((run_end_ts - run_start_ts))

echo
echo "Summary: $pass_count PASS / $fail_count FAIL / $setup_fail_count SETUP-FAIL / $skip_count SKIP / total ${#selected[@]} (${total_duration}s)"

# Soft warning when total runtime exceeds the BA spec's 60s target. Per
# codex iter1 review #4: per-scenario timeout is enforced; a global hard cap
# would risk killing real-world slow scenarios, so we surface as a warning.
if [ $total_duration -gt 60 ]; then
  echo "  WARN: total runtime ${total_duration}s exceeds 60s target (BA spec § Should Have)" >&2
fi

if [ $fail_count -gt 0 ] || [ $setup_fail_count -gt 0 ]; then
  echo
  echo "Failed scenarios:"
  for r in "${results[@]}"; do
    case "$r" in FAIL:*|SETUP-FAIL:*) echo "  $r" ;; esac
  done
fi

_emit_known_limitations

# Exit code precedence: setup-fail (2) > scenario fail (1) > all-pass (0).
if [ $setup_fail_count -gt 0 ]; then
  exit 2
fi
if [ $fail_count -gt 0 ]; then
  exit 1
fi
exit 0
