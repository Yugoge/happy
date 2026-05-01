#!/usr/bin/env bash
# Verify installed happy-coder binary after a CLI build.
set -euo pipefail
send_existing=$(grep -c "sendExisting" /usr/lib/node_modules/happy-coder/dist/index-*.mjs || true)
if [ "${send_existing:-0}" -le 0 ]; then echo "FAIL: sendExisting missing; resumed session history upload is broken" >&2; exit 1; fi
echo "OK: installed happy-coder binary contains sendExisting."
