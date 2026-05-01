#!/usr/bin/env bash
# Happy service deployment helper.
# Side effects: rebuilds container images/services in /root/deploy or installs happy-coder globally.
# Subcommands: server | web-prod | web-dev | cli-latest
set -euo pipefail
cmd="${1:-}"
case "$cmd" in
  server)
    cd /root/deploy
    docker compose build happy-server
    docker compose up -d happy-server
    ;;
  web-prod)
    cd /root/happy
    docker build -f Dockerfile.webapp --build-arg HAPPY_SERVER_URL=https://api.life-ai.app -t happy-app:message-fixes .
    cd /root/deploy
    docker compose up -d happy-web
    ;;
  web-dev)
    cd /root/happy
    docker build -f Dockerfile.webapp --build-arg HAPPY_SERVER_URL=https://api.life-ai.app -t happy-app:dev .
    cd /root/deploy
    docker compose up -d happy-web-dev
    ;;
  cli-latest)
    npm install -g happy-coder@latest
    ;;
  *)
    echo "Usage: bash scripts/deploy.sh <server|web-prod|web-dev|cli-latest>" >&2
    exit 2
    ;;
esac
