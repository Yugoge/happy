#!/usr/bin/env bash
# Patch: write_json_snapshot — add flavor field + correct codex session_file
# Task ID: 20260516-212024
# File: /root/bin/happy-session-recovery.sh (hook-protected, user must apply)
# Lines to replace: 309-321 (the inner while loop body + surrounding if block)
#
# Usage (apply with Python patch):
#   python3 docs/dev/patches/write_json_snapshot-20260516-212024.sh --apply
# Or manually: see the BEFORE/AFTER sections below and use your editor.
#
# Verification commands (run after applying):
#   bash /root/bin/happy-session-recovery.sh save
#   cat $(ls -t ~/.happy/session_backup_history/*.json | head -1) | jq '.sessions[0]'
#   cat $(ls -t ~/.happy/session_backup_history/*.json | head -1) | jq '[.sessions[] | {id: .claude_id, flavor: .flavor}]'
#   cat $(ls -t ~/.happy/session_backup_history/*.json | head -1) | jq '.sessions[] | select(.flavor=="codex")'

set -euo pipefail

TARGET_FILE="/root/bin/happy-session-recovery.sh"

# ============================================================
# BEFORE (current lines 309-321 in write_json_snapshot):
# ============================================================
# This is the EXACT text that will be replaced (spaces preserved):
#
#        sessions_json=$(echo "$sessions" | while IFS=: read -r uuid work_dir home_dir; do
#            local project_encoded
#            project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
#            local session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
#            local file_exists="false"
#            local file_size=0
#            if [ -f "$session_file" ]; then
#                file_exists="true"
#                file_size=$(stat -c%s "$session_file" 2>/dev/null || echo 0)
#            fi
#            echo "{\"claude_id\":\"$uuid\",\"working_dir\":\"$work_dir\",\"home_dir\":\"${home_dir}\",\"session_file\":\"$session_file\",\"session_file_exists\":$file_exists,\"session_file_size\":$file_size}"
#        done | jq -s '.' 2>/dev/null || echo "[]")

# ============================================================
# AFTER (replacement text):
# ============================================================
# This is the EXACT replacement text (spaces preserved):
#
#        sessions_json=$(echo "$sessions" | while IFS=: read -r uuid work_dir home_dir; do
#            local flavor="claude"
#            local session_file=""
#            local file_exists="false"
#            local file_size=0
#
#            local rollout=""
#            rollout=$(find_codex_rollout "$uuid" 2>/dev/null || true)
#
#            if [ -n "$rollout" ]; then
#                # TID has a rollout file → it's codex
#                flavor="codex"
#                if _validate_codex_rollout "$rollout" >/dev/null 2>&1; then
#                    session_file="$rollout"
#                else
#                    session_file=""
#                fi
#            else
#                # No rollout file → treat as claude
#                flavor="claude"
#                local project_encoded
#                project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
#                session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
#            fi
#
#            if [ -n "$session_file" ] && [ -f "$session_file" ]; then
#                file_exists="true"
#                file_size=$(stat -c%s "$session_file" 2>/dev/null || echo 0)
#            fi
#
#            jq -n \
#                --arg id "$uuid" \
#                --arg flavor "$flavor" \
#                --arg wd "$work_dir" \
#                --arg home "$home_dir" \
#                --arg sf "$session_file" \
#                --argjson exists "$file_exists" \
#                --argjson size "$file_size" \
#                '{
#                  claude_id: $id,
#                  flavor: $flavor,
#                  working_dir: $wd,
#                  home_dir: $home,
#                  session_file: $sf,
#                  session_file_exists: $exists,
#                  session_file_size: $size
#                }'
#        done | jq -s '.' 2>/dev/null || echo "[]")

# ============================================================
# Python apply script (recommended — handles exact string match)
# ============================================================

apply_patch() {
python3 - "$TARGET_FILE" <<'PYEOF'
import sys

target = sys.argv[1]

BEFORE = r"""        sessions_json=$(echo "$sessions" | while IFS=: read -r uuid work_dir home_dir; do
            local project_encoded
            project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
            local session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
            local file_exists="false"
            local file_size=0
            if [ -f "$session_file" ]; then
                file_exists="true"
                file_size=$(stat -c%s "$session_file" 2>/dev/null || echo 0)
            fi
            echo "{\"claude_id\":\"$uuid\",\"working_dir\":\"$work_dir\",\"home_dir\":\"${home_dir}\",\"session_file\":\"$session_file\",\"session_file_exists\":$file_exists,\"session_file_size\":$file_size}"
        done | jq -s '.' 2>/dev/null || echo "[]")"""

AFTER = r"""        sessions_json=$(echo "$sessions" | while IFS=: read -r uuid work_dir home_dir; do
            local flavor="claude"
            local session_file=""
            local file_exists="false"
            local file_size=0

            local rollout=""
            rollout=$(find_codex_rollout "$uuid" 2>/dev/null || true)

            if [ -n "$rollout" ]; then
                # TID has a rollout file -> it's codex
                flavor="codex"
                if _validate_codex_rollout "$rollout" >/dev/null 2>&1; then
                    session_file="$rollout"
                else
                    session_file=""
                fi
            else
                # No rollout file -> treat as claude
                flavor="claude"
                local project_encoded
                project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
                session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
            fi

            if [ -n "$session_file" ] && [ -f "$session_file" ]; then
                file_exists="true"
                file_size=$(stat -c%s "$session_file" 2>/dev/null || echo 0)
            fi

            jq -n \
                --arg id "$uuid" \
                --arg flavor "$flavor" \
                --arg wd "$work_dir" \
                --arg home "$home_dir" \
                --arg sf "$session_file" \
                --argjson exists "$file_exists" \
                --argjson size "$file_size" \
                '{
                  claude_id: $id,
                  flavor: $flavor,
                  working_dir: $wd,
                  home_dir: $home,
                  session_file: $sf,
                  session_file_exists: $exists,
                  session_file_size: $size
                }'
        done | jq -s '.' 2>/dev/null || echo "[]")"""

with open(target, 'r') as f:
    content = f.read()

if BEFORE not in content:
    print(f"ERROR: BEFORE text not found in {target}", file=sys.stderr)
    print("The file may have been modified. Please apply the patch manually.", file=sys.stderr)
    sys.exit(1)

count = content.count(BEFORE)
if count > 1:
    print(f"WARNING: BEFORE text found {count} times; replacing first occurrence only.", file=sys.stderr)

new_content = content.replace(BEFORE, AFTER, 1)

# Write via tmp file for atomicity
import os, tempfile
tmpfile = target + '.patch-tmp'
with open(tmpfile, 'w') as f:
    f.write(new_content)
os.rename(tmpfile, target)

print(f"SUCCESS: Patch applied to {target}")
print(f"  Replaced {len(BEFORE.splitlines())} lines with {len(AFTER.splitlines())} lines")

# Verify
with open(target, 'r') as f:
    verify = f.read()
if AFTER in verify:
    print("  Verification: AFTER text found in file OK")
else:
    print("  WARNING: AFTER text not found after replacement", file=sys.stderr)
    sys.exit(1)
PYEOF
}

# ============================================================
# Main: handle --apply flag or print instructions
# ============================================================

if [ "${1:-}" = "--apply" ]; then
    echo "Applying patch to $TARGET_FILE ..."
    if [ ! -f "$TARGET_FILE" ]; then
        echo "ERROR: $TARGET_FILE not found" >&2
        exit 1
    fi
    # Safety: verify we can read the file
    if ! [ -r "$TARGET_FILE" ]; then
        echo "ERROR: $TARGET_FILE is not readable" >&2
        exit 1
    fi
    apply_patch
    echo ""
    echo "Patch applied. Run verification commands:"
    echo "  bash $TARGET_FILE save"
    echo "  cat \$(ls -t ~/.happy/session_backup_history/*.json | head -1) | jq '.sessions[0]'"
    echo "  cat \$(ls -t ~/.happy/session_backup_history/*.json | head -1) | jq '[.sessions[] | {id: .claude_id, flavor: .flavor}]'"
    echo "  cat \$(ls -t ~/.happy/session_backup_history/*.json | head -1) | jq '.sessions[] | select(.flavor==\"codex\")'"
else
    echo "Patch for write_json_snapshot (task 20260516-212024)"
    echo ""
    echo "USAGE:"
    echo "  bash $0 --apply     # Apply the patch to $TARGET_FILE"
    echo ""
    echo "This patch adds:"
    echo "  1. flavor field (\"codex\" or \"claude\") to each snapshot entry"
    echo "  2. Correct session_file for codex entries (rollout path, not Claude project path)"
    echo "  3. jq -n --arg safe JSON construction (injection-safe)"
    echo ""
    echo "NOTE: $TARGET_FILE is hook-protected."
    echo "      This script must be run manually by the user from a shell where the hook is not active."
    echo "      OR: have an operator run it who has permission to modify that file."
    echo ""
    echo "VERIFICATION (after apply):"
    echo "  bash $TARGET_FILE save"
    echo "  SNAP=\$(ls -t ~/.happy/session_backup_history/*.json | head -1)"
    echo "  jq '.sessions[0]' \"\$SNAP\"                              # check first entry has flavor"
    echo "  jq '[.sessions[] | {id: .claude_id, flavor: .flavor}]' \"\$SNAP\"   # all flavor fields"
    echo "  jq '.sessions[] | select(.flavor==\"codex\")' \"\$SNAP\"   # codex entries only"
fi

exit 0
