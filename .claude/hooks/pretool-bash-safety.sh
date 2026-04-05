#!/bin/bash
# PreToolUse Safety Hook - Warn or block before dangerous operations
# Reads tool input from stdin as JSON (Claude Code hook protocol)

# Read full JSON from stdin
INPUT=$(cat)

# Extract tool name and command
TOOL_NAME=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null)
COMMAND=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)

# Only act on Bash tool
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

# Block: sensitive file write via Bash redirect or as target
# Matches both: "echo x >> .env" and "cat secrets > credentials.json"
if echo "$COMMAND" | grep -qE '(>|>>)\s*\S*(\.env|credentials|secret|password)'; then
  echo "BLOCKED: Attempting to write to sensitive file via Bash" >&2
  echo "Command: $COMMAND" >&2
  echo "Edit sensitive files manually — never via AI-driven Bash redirection." >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE '(\.env|credentials|secret|password)\S*\s*(>|>>)'; then
  echo "BLOCKED: Attempting to redirect from/to sensitive file via Bash" >&2
  echo "Command: $COMMAND" >&2
  echo "Edit sensitive files manually — never via AI-driven Bash redirection." >&2
  exit 2
fi

# Block: destructive disk operations
if echo "$COMMAND" | grep -qE '^\s*(dd |mkfs|fdisk|shred )'; then
  echo "BLOCKED: Destructive disk operation detected" >&2
  echo "Command: $COMMAND" >&2
  exit 2
fi

# Warn: recursive delete of non-tmp paths
if echo "$COMMAND" | grep -qE 'rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+' && ! echo "$COMMAND" | grep -qE '/tmp/'; then
  echo "WARNING: Recursive delete detected outside /tmp — verify this is intentional" >&2
  echo "Command: $COMMAND" >&2
fi

# Warn: force push
if echo "$COMMAND" | grep -qE 'git push\s+(--force|-f)\b'; then
  echo "WARNING: Force push will rewrite remote history" >&2
  echo "Command: $COMMAND" >&2
fi


# ── ISOLATION: production must NEVER be contaminated by dev ──────────
# 2026-04-04 catastrophe: npm install -g from dev worktree killed all production sessions

# Block: npm install -g (only user may do this manually)
CMD_NO_COMMENTS=$(echo "$COMMAND" | sed 's/#.*$//')
if echo "$CMD_NO_COMMENTS" | grep -qE 'npm\s+install\s+-g' || echo "$CMD_NO_COMMENTS" | grep -qE 'npm\s+install\s+--global'; then
  echo "BLOCKED: npm install -g is FORBIDDEN from agents" >&2
  echo "Command: $COMMAND" >&2
  echo "Only the user may install the global CLI manually." >&2
  exit 2
fi

# Block: invoking /usr/bin/happy directly (triggers auto-upgrade)
if echo "$COMMAND" | grep -qE '(^|[;&|]\s*)/usr/bin/happy\b' || echo "$COMMAND" | grep -qE '(^|[;&|]\s*)happy\s+(daemon|--version|auth)\b'; then
  echo "BLOCKED: Direct invocation of global happy CLI is FORBIDDEN from agents" >&2
  echo "Command: $COMMAND" >&2
  exit 2
fi

# Block: kill with PIDs (use happy-restart.sh or daemon HTTP /stop)
if echo "$COMMAND" | grep -qE '(^|[;&|]\s*)kill\s+[0-9]'; then
  echo "BLOCKED: kill with PIDs is FORBIDDEN — use bash /root/bin/happy-restart.sh" >&2
  echo "Command: $COMMAND" >&2
  exit 2
fi

# Block: rsync/cp from happy-dev into production source
if echo "$COMMAND" | grep -qE '(rsync|cp)\s' && echo "$COMMAND" | grep -qE '(/root/happy-dev/|/dev/shm/|worktree).*(/root/happy/packages/)'; then
  echo "BLOCKED: Copying dev code into production source is FORBIDDEN" >&2
  echo "Command: $COMMAND" >&2
  echo "Use git merge/cherry-pick instead." >&2
  exit 2
fi

# Block: raw systemctl restart for production daemons (use happy-restart.sh)
if echo "$COMMAND" | grep -qE 'systemctl\s+(restart|stop)\s+happy-daemon'; then
  echo "BLOCKED: Raw systemctl for daemon restart is FORBIDDEN — use bash /root/bin/happy-restart.sh" >&2
  echo "Command: $COMMAND" >&2
  exit 2
fi

exit 0
