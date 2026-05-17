#!/usr/bin/env bash
# Patch: flavor 4th field in raw_sessions + stale rollout fix
# Target: /root/bin/happy-session-recovery.sh
# Apply: bash /dev/shm/dev-workspace/happy-dev/docs/dev/patches/flavor-field-and-stale-rollout-20260517.sh --apply
# After: chmod 755 /root/bin/happy-session-recovery.sh

set -euo pipefail

TARGET="/root/bin/happy-session-recovery.sh"
PY_PATCH="/dev/shm/dev-workspace/happy-dev/docs/dev/patches/flavor-field-and-stale-rollout-20260517.py"
BACKUP="${TARGET}.bak.$(date +%Y%m%d-%H%M%S)"

if [ "${1:-}" != "--apply" ]; then
    echo "Dry run. Pass --apply to execute."
    echo "Changes:"
    echo "  1. find_codex_rollout: return newest match (mtime sort, not first-found)"
    echo "  2. Source 1/2 emit :claude, Source 3a/3b emit :codex"
    echo "  3. Parsers (filter_sessions_for_home, strip_home_field) consume 4th field"
    echo "  4. write_json_snapshot reads flavor from 4th field"
    echo "  5. peak merge jq carries flavor from JSON snapshot (both occurrences)"
    exit 0
fi

echo "Backing up $TARGET to $BACKUP ..."
cp "$TARGET" "$BACKUP"

python3 "$PY_PATCH" "$TARGET"
chmod 755 "$TARGET"

echo ""
echo "Verify with:"
echo "  bash /root/bin/happy-session-recovery.sh save"
echo "  jq '[.sessions[] | {id: .claude_id, flavor}]' \$(ls -t ~/.happy/session_backup_history/*.json | head -1)"
