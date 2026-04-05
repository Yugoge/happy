#!/bin/bash
# pretool-docker-dev-guard.sh
# Project-level hook (happy-dev only): Block docker build with production URLs
#
# Blocks: docker build ... api.life-ai.app ... (production URL for dev images)
# Allows: docker build ... api-dev.life-ai.app ... (correct dev URL)

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)

# Only check docker build commands
if ! echo "$COMMAND" | grep -q 'docker build'; then
  exit 0
fi

# Block if command contains api.life-ai.app but NOT api-dev.life-ai.app
if echo "$COMMAND" | grep -q 'api\.life-ai\.app' && ! echo "$COMMAND" | grep -q 'api-dev\.life-ai\.app'; then
  echo "BLOCKED: docker build in happy-dev must NEVER use production URL (api.life-ai.app)" >&2
  echo "Command: $COMMAND" >&2
  echo "REASON: Dev images must use HAPPY_SERVER_URL=https://api-dev.life-ai.app" >&2
  echo "FIX: Replace api.life-ai.app with api-dev.life-ai.app in --build-arg" >&2
  exit 2
fi

exit 0
