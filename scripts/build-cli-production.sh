#!/usr/bin/env bash
# Build and globally install production happy-cli from /root/happy only.
# NEVER build from /root/happy-dev; that can contaminate the installed binary.
set -euo pipefail
cd /root/happy/packages/happy-cli
yarn build
cd /root/happy
npm install -g .
