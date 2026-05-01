#!/usr/bin/env bash
# Build and deploy happy-dev frontend/backend directly from a worktree context.
# Side effects: rebuilds happy-app:dev and/or happy-server-dev:latest and restarts dev containers only.
set -euo pipefail
if [ $# -lt 1 ] || [ $# -gt 2 ]; then echo "Usage: bash scripts/dev-overnight-build-deploy.sh <worktree-path> [frontend|backend|all]" >&2; exit 2; fi
WORKTREE_PATH="$1"; target="${2:-all}"
[ -d "$WORKTREE_PATH" ] || { echo "No such worktree path: $WORKTREE_PATH" >&2; exit 2; }
build_frontend() { docker build -f "${WORKTREE_PATH}/Dockerfile.webapp" --build-arg HAPPY_SERVER_URL=https://api-dev.life-ai.app -t happy-app:dev "${WORKTREE_PATH}"; cd /root/deploy; docker compose up -d happy-web-dev; }
build_backend() { docker build -f "${WORKTREE_PATH}/Dockerfile.server-slim" -t happy-server-dev:latest "${WORKTREE_PATH}"; cd /root/deploy; docker compose up -d happy-server-dev; }
case "$target" in frontend) build_frontend ;; backend) build_backend ;; all) build_frontend; build_backend ;; *) echo "target must be frontend, backend, or all" >&2; exit 2 ;; esac
echo "Wait 5s, then verify backend http://localhost:3005/health and frontend http://localhost:8097/."
