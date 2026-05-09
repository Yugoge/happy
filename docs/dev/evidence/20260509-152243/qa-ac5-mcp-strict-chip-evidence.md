# Cycle 7 — AC5 Evidence (M5 #17 MCP strict chip)

**Spec**: docs/dev/specs/spec-20260509-152243/ba-spec-20260509-152243.md
**Saga**: spec-20260506-203755 — Cycle 7

## What landed

**File**: `packages/happy-app/sources/utils/codexToolRendering.ts`

The `shouldRenderToolContent` function gains an early-return gate (after the existing subagent-control suppression):

```ts
if (!hasSpecializedView && isMcpInlineChipOnlyTool(tool.name)) return false;
```

`isMcpInlineChipOnlyTool` (in `mcpHelpers.ts`) covers `mcp__*` server-prefixed names AND the three codex MCP function tools: `functions.list_mcp_resources`, `functions.list_mcp_resource_templates`, `functions.read_mcp_resource`.

**Behavioral consequence** (per codex M5 advice incorporated):
- MCP-namespace tools render chip-only inline regardless of session source (codex or claude).
- Specialized MCP views (`mcp__playwright__browser_take_screenshot` → `CodexAttachmentView` per `views/_all.tsx`) STILL render content because `hasSpecializedView=true` bypasses the new gate.
- `web.search_query`, `functions.spawn_agent` (already excluded by `CODEX_SUBAGENT_CONTROL_TOOLS`), and other codex source tools NOT in the MCP-chip-only set still render content.

## Test verification

`packages/happy-app/sources/utils/codexToolRendering.test.ts` (lines 228-251 post-edit):
- 2 baseline expectations FLIPPED from `true` to `false`:
  - `functions.list_mcp_resources` (no specialized view) → false
  - `mcp__resources__read` with `metadata.flavor === 'codex'` (no specialized view) → false
- New explicit guards added:
  - `mcp__resources__read` WITH `hasSpecializedView=true` → true (specialized view bypass works)
  - `web.search_query` → true (non-MCP codex source still renders)
  - `functions.list_mcp_resource_templates` → false
  - `functions.read_mcp_resource` → false

`yarn vitest run sources/utils/codexToolRendering.test.ts` → 11/11 PASS.

## Live evidence (dev environment)

URL: `http://localhost:8097/dev/codex-render-fixtures` (deterministic dev fixture page; same ToolView/MessageView components as production session rendering).

Screenshots captured:
- `qa-ac17-mcp-strict-chip-fixtures.png` — desktop viewport, full page
- `qa-ac17-mcp-strict-chip-mobile.png` — 390x844 mobile viewport, full page

In the rendered Playwright accessibility snapshot:
- `mcp__playwright__browser_navigate` (playwright_long_input fixture) → single chip row, no inline body content (e589: "Playwright navigate")
- `functions.list_mcp_resources` (mcp_resource_list_empty fixture) → single chip row "List MCP resources" (e668)
- `functions.list_mcp_resource_templates` → single chip row "List MCP resource templates" (e689)
- `functions.read_mcp_resource` → single chip row "Read MCP resource completed" (e710)
- `web.search_query` (web_tool_search fixture) → renders body content "Example result title" + "Short source snippet" (e431/e432) — confirming the gate correctly preserves non-MCP codex source tool rendering
- `mcp__playwright__browser_take_screenshot` (image_inline_screenshot fixture) → renders inline image preview (e272 img element) — confirming `hasSpecializedView` bypass for screenshot-class tools

## Non-regression

- `CODEX_SUBAGENT_CONTROL_TOOLS` suppression (Cycle 6 D.5) is preserved — `functions.spawn_agent`/`wait_agent`/`close_agent`/etc. continue to suppress at the existing line.
- Specialized views for screenshot/image tools continue to render via `hasSpecializedView` path.
- Claude generic tools (Grep/Glob/WebSearch/ToolSearch) remain collapsed (the test at line 271-279 still passes — those tools never matched MCP-chip-only and are not codex source).
