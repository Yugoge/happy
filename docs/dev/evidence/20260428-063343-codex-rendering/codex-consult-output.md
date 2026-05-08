CODEX_FEEDBACK:

- Draft FAIL is correct but understated: Codex tool results appear dropped in the protocol path. `packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts` emits `tool-call-end` without `output` for `exec_command_end`, patch, dynamic, MCP, plan, and image events. App normalization expects `envelope.ev.output` to become `tool.result`. This means the new renderers may only work on fixtures/stale sessions, not real Codex app-server results.

- Terminal evidence is suspect unless raw tool names/results prove it is a Codex path. The screenshots/text show Terminal-like cards and stderr/exit text, but without proving `tool.name === CodexBash` and real `tool.result` propagation. Given the mapper issue above, live evidence must include raw/debug confirmation of the normalized tool payload, not just visual text.

- The evidence matrix still has hard zeroes for key ACs: patch/diff, `update_plan`, `multi_tool_use`, `view_image`, MCP/resource, unknown/fallback. That is not just “missing coverage”; it is direct non-satisfaction of the BA contract.

- `functions.view_image` is not proven by file attachment evidence. `CodexAttachmentView` renders metadata/icon plus JSON, not an actual image/thumbnail/full image view. “file attachment card” does not satisfy image/view_image acceptance.

- Plan rendering likely loses required semantics. The mapper turns Codex plan items into `{ plan: text, text }`, and `extractPlanItems` string-splits everything into `pending`; actual step statuses/history are not preserved. AC requires current steps and statuses visible.

- `multi_tool_use.parallel` is still effectively dormant/summary-only: no live evidence, no child result drill-down, and no full-view registry entry. Generic raw detail is not enough to prove sequence children/results are discoverable.

- Full happy-app suite failing 7 tests is a release blocker unless each failure is baselined as pre-existing on the same branch/image. Targeted tests are too narrow because changes touched shared primitives: `CodeView`, `CommandView`, `ToolView`, `ToolFullView`, `knownTools`, markdown parser, sidebar routing.

- Scope drift threatens close: dirty `happy-cli/src/codex/*` changes affect daemon/protocol behavior, while the BA contract says app-only/no daemon access. QA must either explicitly exclude those dirty files from this verdict or treat them as unverified daemon-adjacent changes requiring a separate sandbox/no-production validation path.