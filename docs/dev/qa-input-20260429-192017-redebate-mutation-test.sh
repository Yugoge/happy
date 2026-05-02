#!/usr/bin/env bash
# QA re-debate mutation harness for M-REWRITE.5 verification.
# Confirms verify_rewrite_diff actually rejects accidental extra modifications,
# proving the verifier is not a vacuous always-pass.
set -uo pipefail
cd /dev/shm/dev-workspace/happy-dev
SANDBOX=$(mktemp -d /tmp/qa-mutation-XXXX)
mkdir -p "$SANDBOX/scripts"
export SANDBOX

source tests/lib/rewrite.sh

echo "=== Test 1: clean rewrite should PASS verifier ==="
if rewrite_deploy_sh; then
  echo "OK: clean rewrite passed (deploy body=14)"
else
  echo "FAIL: clean rewrite returned non-zero"
  exit 1
fi

echo "=== Test 2: inject 2 extra modifications, verifier should REJECT ==="
sed -i '60s|.*|## INJECTED LINE 1|' "$SANDBOX/scripts/deploy.sh"
sed -i '70s|.*|## INJECTED LINE 2|' "$SANDBOX/scripts/deploy.sh"
new_count=$(diff -u "$SANDBOX/scripts/deploy.sh.orig" "$SANDBOX/scripts/deploy.sh" \
  | awk '/^---/||/^\+\+\+/{next} /^[-+]/{c++} END{print c+0}')
echo "Diff body count after injecting 2 line replacements: $new_count (expected 18 = 14 + 4)"

if verify_rewrite_diff "$SANDBOX/scripts/deploy.sh" 14 2>"$SANDBOX/verifier-stderr"; then
  echo "FAIL: verifier did NOT catch injection (mutation bypassed M-REWRITE.5)"
  exit 2
else
  echo "OK: verifier correctly rejected; stderr first line:"
  head -1 "$SANDBOX/verifier-stderr"
fi

echo "=== Test 3: rollback rewrite clean PASS, then 1-line injection should REJECT ==="
if rewrite_rollback_sh; then
  echo "OK: clean rollback rewrite passed (body=18)"
else
  echo "FAIL: clean rollback rewrite failed"; exit 1
fi
sed -i '100s|.*|## INJECTED ROLLBACK LINE|' "$SANDBOX/scripts/rollback.sh"
if verify_rewrite_diff "$SANDBOX/scripts/rollback.sh" 18 2>"$SANDBOX/rollback-verifier-stderr"; then
  echo "FAIL: rollback verifier did NOT catch single-line injection"
  exit 2
else
  echo "OK: rollback verifier correctly rejected; stderr first line:"
  head -1 "$SANDBOX/rollback-verifier-stderr"
fi

echo "=== ALL MUTATION TESTS PASS ==="
echo "SANDBOX=$SANDBOX (artifacts left for inspection)"
