#!/usr/bin/env bash
# Verify installed happy-coder binary after a CLI build.
set -euo pipefail
send_existing=$(grep -c "sendExisting" /usr/lib/node_modules/happy-coder/dist/index-*.mjs || true)
if [ "${send_existing:-0}" -le 0 ]; then echo "FAIL: sendExisting missing; resumed session history upload is broken" >&2; exit 1; fi

hide_parent=$(grep -c "shouldHideParentToolCall" /usr/lib/node_modules/happy-coder/dist/types-*.mjs || true)
if [ "${hide_parent:-0}" -ne 0 ]; then echo "FAIL: shouldHideParentToolCall exists; binary was built from dev branch code" >&2; exit 1; fi
task_agent=$(grep -c 'Task.*Agent' /usr/lib/node_modules/happy-coder/dist/types-*.mjs || true)
if [ "${task_agent:-0}" -le 0 ]; then echo "FAIL: Task/Agent sidechain linking marker missing" >&2; exit 1; fi
echo "OK: installed happy-coder binary contains sendExisting, excludes shouldHideParentToolCall, and includes Task/Agent linking."
