#!/usr/bin/env bash
# tests/bin/recovery-stub.sh — M-RECOVERY
# Mock for /root/bin/happy-session-recovery.sh.
# Default behaviour: print MOCK message and exit 0.
# Failure injection: RECOVERY_FAIL=1 -> exit 1 (used by S14 to test rollback's
# abort-on-snapshot-fail branch).
#
# This stub is the rewriter target for both deploy.sh's RECOVERY_SCRIPT and
# rollback.sh's RECOVERY_SCRIPT after rewrite.

action="${1:-save}"

if [ "${RECOVERY_FAIL:-0}" = "1" ]; then
  echo "MOCK recovery-stub: RECOVERY_FAIL=1, exiting 1 (action=$action)" >&2
  exit 1
fi

echo "MOCK: snapshot saved (action=$action)"
exit 0
