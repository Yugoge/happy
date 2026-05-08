<!-- AUTO-GENERATED VIEW for dev | source: docs/dev/specs/spec-20260506-203844.md | extracted: 2026-05-06T20:47:19Z -->

# dev view of spec-20260506-203844

**Monolith**: docs/dev/specs/spec-20260506-203844.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> <!-- WHO WRITES: Dev (after each implementation attempt) -->
> <!-- WHAT: Per-cycle record of what approach was tried, what the rationale was, and why it failed (if it failed). -->
> <!-- This prevents the next cycle's Dev from repeating the same approach. -->
>
> <!-- WHO WRITES: Dev (after each implementation) -->
> <!-- WHAT: Exact file changes with line numbers and old->new values. -->
> <!-- FORMAT: - **file.tsx:42** -- `property: oldValue` -> `property: newValue` -->

---

## Section 2: What Was Attempted

<!-- WHO WRITES: Dev (after each implementation attempt) -->
<!-- WHAT: Per-cycle record of what approach was tried, what the rationale was, and why it failed (if it failed). -->
<!-- This prevents the next cycle's Dev from repeating the same approach. -->

### Cycle 1

#### 2.1 初始工具渲染展示尝试

主 agent 已经调用/展示过以下工具或工具族：

- `mcp__happy__.change_title`
- `functions.exec_command`
- `functions.write_stdin`
- `functions.update_plan`
- `functions.apply_patch`
- `functions.view_image`
- `functions.spawn_agent`
- `functions.wait_agent`
- `functions.close_agent`
- `functions.list_mcp_resources`
- `functions.list_mcp_resource_templates`
- `functions.request_user_input`（在 Default mode 不可用）
- `mcp__playwright__.browser_tabs`
- `mcp__playwright__.browser_navigate`
- `mcp__playwright__.browser_snapshot`
- `mcp__playwright__.browser_console_messages`
- `mcp__playwright__.browser_network_requests`
- `mcp__playwright__.browser_evaluate`
- `mcp__playwright__.browser_fill_form`
- `mcp__playwright__.browser_click`
- `mcp__playwright__.browser_hover`
- `mcp__playwright__.browser_select_option`
- `mcp__playwright__.browser_file_upload`
- `mcp__playwright__.browser_handle_dialog`
- `mcp__playwright__.browser_resize`
- `mcp__playwright__.browser_wait_for`
- `mcp__playwright__.browser_type`
- `mcp__playwright__.browser_press_key`
- `mcp__playwright__.browser_run_code`
- `mcp__playwright__.browser_drag`
- `mcp__playwright__.browser_take_screenshot`
- `image_gen.imagegen`
- `web.search_query`
- `web.open`

#### 2.2 已经完成过的代码修复尝试

主 agent 之前已针对图片 preview mapper 做过一轮修复，重点是让 happy-cli mapper 能从 Codex 工具输出中提取可预览图片：

- 修改 `packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts`
  - 增加从 markdown link、generated image status text、bare image path 等输出中提取图片路径/preview URI 的逻辑。
- 修改 `packages/happy-cli/src/codex/__tests__/sessionProtocolMapper.test.ts`
  - 添加 file URL、bare path、markdown screenshot link、generated-image text with image path 等 regression tests。
- 已确认 app 端已有相关支持点：
  - `packages/happy-app/sources/components/tools/views/_all.tsx`
  - `packages/happy-app/sources/components/tools/views/CodexAttachmentView.tsx`
  - `packages/happy-app/sources/utils/codexToolRendering.ts`

#### 2.3 已运行过的验证

已运行并通过：

- `yarn --silent vitest run packages/happy-cli/src/codex/__tests__/sessionProtocolMapper.test.ts`
- `yarn --silent workspace happy-app vitest run sources/utils/codexToolRendering.test.ts`
- `yarn --silent workspace happy typecheck`
- `yarn --silent workspace happy-app typecheck`
- `yarn --silent workspace happy build`

已部署 dev frontend：

- `bash scripts/dev-overnight-build-deploy.sh /dev/shm/dev-workspace/happy-dev frontend`

已验证 dev web/backend：

- `http://localhost:8097/` 返回 HTML；
- `http://localhost:3005/health` 返回 ok。

#### 2.4 仍然失败或未加载的点

- 当前 live Happy 会话中的 image_gen 结果仍未显示。
- View image 虽然 Happy 卡识别到了文件名和路径，但仍未显示真实图片内容。
- 这说明：
  - 可能 CLI mapper 修复未被当前 dev daemon/live session 加载；或
  - view_image 的 app renderer 还没有使用 `path` 转换/引用 preview URI；或
  - Happy message envelope 中根本没有携带可被 app 读取的图片 bytes/data URI；或
  - app 正在渲染“附件元数据卡 + 原始 JSON”，但缺少 image preview 子组件。

---

## Section 3: What Was Changed

<!-- WHO WRITES: Dev (after each implementation) -->
<!-- WHAT: Exact file changes with line numbers and old->new values. -->
<!-- FORMAT: - **file.tsx:42** -- `property: oldValue` -> `property: newValue` -->

### Cycle 1

已做过的相关改动：

- `packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts`
  - 增加 image path / preview URI extraction 覆盖面，用于 Playwright screenshot、view_image、image_gen 等输出格式。
- `packages/happy-cli/src/codex/__tests__/sessionProtocolMapper.test.ts`
  - 增加图片路径/图片 markdown link/generation status 的测试覆盖。
- `docs/dev/ticket-20260506-124632.md`
  - 记录本轮工具渲染修复需求。
- `docs/dev/context-20260506-124632.json`
  - 记录相关上下文。
- `docs/dev/ba-qa-report-20260506-124632.json`
  - 记录 BA/QA fallback 报告。
- `docs/dev/dev-report-20260506-124632.json`
  - 记录 dev fallback 报告。
- `docs/dev/qa-report-20260506-124632.json`
  - 记录 QA fallback 报告。
- `docs/dev/completion-20260506-124632.md`
  - 记录完成报告。

注意：本 spec 创建时不继续修改上述代码文件，只总结需求与验收清单。

---

## Section 7: What Must Be Done

<!-- WHO WRITES: QA (on fail) or PM-Retro -->
<!-- WHAT: Prescriptive next step for this specific issue. Not generic advice -- a concrete action. -->
<!-- Example: "Increase padding from 8px to 16px in Chat.tsx:42" not "fix the padding" -->

### Cycle 1

下一步应按以下顺序实施：

1. 建立工具渲染 fixture 页面/fixture session，覆盖 Terminal、MCP、Playwright screenshot、view_image、image_gen、apply_patch、subagent controls、web tools、MCP resources、PTY。
2. 修复通用 tool-call lifecycle 状态：completed 后停止 spinner，duration 固定，failed/unavailable 有明确状态。
3. 修复 subagent control renderer：将 spawn/wait/close 合并或正确分类，避免作为三个普通运行中卡片散落。
4. 修复 `view_image` renderer：将 path/preview URI 转为真实 inline image；raw JSON 默认放入 details，不直接占主视觉区域。
5. 修复 `image_gen` mapper/renderer：从生成图片路径或 tool result 中生成可被 Happy app 读取的 preview attachment。
6. 修复 `browser_take_screenshot` renderer：截图应显示缩略图/内联预览，raw input/output 折叠。
7. 修复 Update file/Patch renderer：去重 header，文件列表和状态清晰分层。
8. 为 web tools / MCP resource / empty results 提供 fallback cards。
9. 在 dev web 上用真实 Happy UI 截图验证 desktop 和 mobile。
10. 若 CLI mapper 更新需要 dev daemon reload，先说明影响范围，只处理 `happy-daemon-dev.service`，绝不使用 `/root/bin/happy-restart.sh`。

