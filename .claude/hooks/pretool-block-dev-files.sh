#!/bin/bash
# PreToolUse hook: Block Write/Edit to dev paths from production environment
# Prevents prod agents from accidentally modifying dev source or state
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null)
case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac
FILE_PATH=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null)
case "$FILE_PATH" in
  /root/happy-dev/*|/dev/shm/dev-workspace/happy-dev/*)
    echo "BLOCKED: Write/Edit to dev source from production environment is FORBIDDEN" >&2
    echo "Path: $FILE_PATH" >&2
    exit 2 ;;
  /root/.happy-dev/*)
    echo "BLOCKED: Write/Edit to dev daemon home from production environment is FORBIDDEN" >&2
    echo "Path: $FILE_PATH" >&2
    exit 2 ;;
esac
exit 0
