#!/bin/bash
# Hook: PreToolUse (mcp__playwright__browser_navigate, mcp__playwright__browser_run_code, WebFetch)
# Purpose: Block ALL access to production Happy URLs from this repo
# This exists because subagents accessed production and corrupted data (2026-03-29 incident)

set -euo pipefail

TOOL_NAME="${TOOL_NAME:-}"
TOOL_INPUT="${TOOL_INPUT:-}"

# Production URLs that are ABSOLUTELY FORBIDDEN
PROD_PATTERNS=(
    "life-ai\.app"           # production web (without dev. prefix)
    "localhost:8090"         # production web container
    "api\.life-ai\.app"     # production API (without dev. prefix -- note: api-dev is OK)
)

# Allowed dev URLs (whitelist)
DEV_PATTERNS=(
    "dev\.life-ai\.app"
    "api-dev\.life-ai\.app"
    "localhost:8097"
)

check_url() {
    local input="$1"

    # First check if it matches any dev pattern (whitelist)
    for pattern in "${DEV_PATTERNS[@]}"; do
        if echo "$input" | grep -qE "$pattern"; then
            return 0  # Allowed
        fi
    done

    # Then check if it matches any production pattern (blacklist)
    for pattern in "${PROD_PATTERNS[@]}"; do
        if echo "$input" | grep -qE "$pattern"; then
            echo "BLOCKED: 严禁访问生产环境！Production access is ABSOLUTELY FORBIDDEN." >&2
            echo "Matched production pattern: $pattern" >&2
            echo "ONLY use: https://dev.life-ai.app or http://localhost:8097" >&2
            echo "If dev has no sessions, CREATE ONE via the UI. NEVER fall back to production." >&2
            exit 2
        fi
    done

    return 0  # Not a production URL
}

case "$TOOL_NAME" in
    mcp__playwright__browser_navigate)
        url=$(echo "$TOOL_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
        if [ -n "$url" ]; then
            check_url "$url"
        fi
        ;;
    mcp__playwright__browser_run_code)
        code=$(echo "$TOOL_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || echo "")
        if [ -n "$code" ]; then
            check_url "$code"
        fi
        ;;
    WebFetch)
        url=$(echo "$TOOL_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
        if [ -n "$url" ]; then
            check_url "$url"
        fi
        ;;
esac

exit 0
