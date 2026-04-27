<!-- AUTO-GENERATED VIEW for ui-specialist | source: docs/dev/specs/spec-20260424-084848.md | extracted: 2026-04-24T08:48:48Z -->

# ui-specialist view of spec-20260424-084848

**Monolith**: docs/dev/specs/spec-20260424-084848.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate (from spec)

ui-specialist is a derived consumer — provides visual design / layout / motion rules for UI-touching requirements extracted from Section 5.

> WHAT: Verbatim quote from user's requirement or focus string.

---

### Cycle 1

Reference screenshot provided by user: `/tmp/happy-attachments/67a57680-cde1-4343-833f-ad5644955740-image.png`
- Settings panel with PERMISSION MODE (`yolo` selected) and MODEL (`haiku 4.5` selected).
- Status row: `● online • 69% left` on the left, `▶▶ yolo` on the right.
- Model label is NOT shown in the status row today.

---

## Visual design briefs per requirement

### 5.3: Right-side Bash popup — command text overflows popup width (verbatim)

**Extracted acceptance points:**

1. When the user opens the right-side slide-over / popup that displays a Bash tool-call, the command line (e.g. `$ ls /root/docs/dev/ba-spec-20260423-080000.md /root/docs/dev/con…`) overflows the popup's horizontal bounds.
2. Expected: the command text must stay inside the popup width. Acceptable implementations: horizontal scroll within the command code block, soft-wrap at word boundaries, or responsive truncation with a way to see the full text (`view full`, hover-reveal, etc.) — whichever the design system prefers, so long as nothing visually exits the popup frame.
3. Applies at all popup widths currently supported by the UI (desktop default, narrow desktop, tablet, mobile).

**Reference screenshot**: `/tmp/happy-attachments/54b9b872-eae0-470d-adcd-f4c3874371ac-4130.png` (popup header "Bash", command line overflows right edge; `FILES_OK` visible on the last output line).

### 5.4: Top bar — happy logo and avatar positions are hardcoded, not responsive

**Extracted acceptance points:**

1. The top navigation bar currently positions the happy logo (leading side) and the user avatar (trailing side) with hardcoded offsets, so they do NOT track the resize/stretch of the content area between them.
2. Expected: both elements must re-layout responsively alongside the content column — their positions/spacing should be a function of the layout container, not absolute/magic-number positioning.
3. Applies across viewport widths (wide desktop, narrow desktop, tablet, mobile) and for the entire range of content-panel resizings supported by the UI (e.g., sidebar collapse/expand, split view, inspector toggle).

**Reference screenshot**: `/tmp/happy-attachments/0326c824-1c24-483c-a59d-27fa5898df36-4131.png`.

### 5.5: Top bar / layout — second non-adaptive case

**Extracted acceptance points:**

1. A second example of non-responsive layout in the same UI region (top-bar / chrome). Treat as a continuation of §5.4: same class of bug, different concrete case captured for dev/QA reproduction.
2. The fix approach for §5.4 must resolve the case shown here too; if not, it is not complete.

**Reference screenshot**: `/tmp/happy-attachments/9d264db4-cc7e-4fc4-abf7-d5f5e393d635-4132.png`.

### 5.6: Codex tool-call popup — not aligned with Claude Code popup redesign

**Extracted acceptance points:**

1. The Codex flavor's tool-call / bash popup has NOT been migrated to the newer visual & interaction treatment that was applied to the Claude Code flavor's popup. The two flavors must share the same popup design.
2. Scope includes: the popup container, header, command rendering, output rendering, any expand/collapse affordance, and — importantly — the width/overflow behaviour from §5.3.
3. Expected: visually and behaviourally Codex's tool-call popup should be indistinguishable from Claude Code's (modulo flavor-specific labels / icons where intentional).

**Reference screenshot**: `/tmp/happy-attachments/7536232a-5bcb-42eb-aed4-090396a91659-4133.png`.

### 5.7: Codex tool-call popup — Description field content is wrong

**Extracted acceptance points:**

1. In the Codex tool-call popup, the `Description` section is populated with the wrong content: it currently mirrors the raw command string (`/bin/bash -lc "mkdir -p /tmp/apply-deploy-test && CANDIDATE_NAME=Yuge_Tang …"`) instead of a human-readable description of what the tool call is doing.
2. Expected: `Description` must show the actual description field (the model-provided natural-language summary). The raw command belongs in the `Input Parameters` / command code block only.
3. Evidence from the reference screenshot: the `Description` block and the `Input Parameters.description` both duplicate the full `/bin/bash -lc "…"` string; they should diverge, with `Description` carrying a real description.

**Reference screenshot**: `/tmp/happy-attachments/ff85f57a-e80a-42a1-ae88-e0c892228d37-4134.png` (title bar shows "application-assistant"; Terminal popup; `Description` and `Input Parameters` sections both contain the raw bash invocation).

### 5.8: Markdown tables overflow width — port the fix already in happy prod

**Extracted acceptance points:**

1. In happy-dev, rendered markdown tables with wide content overflow the message / card horizontal bounds (the visible row "Path / Type / Content" gets clipped on the right edge of the card).
2. This exact problem is already solved in the happy **production** codebase. The fix must be ported over — do NOT re-invent it.
3. Dev step: locate the production treatment (likely a horizontally-scrollable wrapper around the `<table>` / `MarkdownView` renderer) and replicate it in happy-dev for the same renderer.
4. Success condition: any markdown message containing a table wider than the surrounding container gets its table horizontally scrollable inside the container, with no visual bleed outside the card's right edge — matching production behaviour byte-for-byte where reasonable.

**Reference screenshot**: `/tmp/happy-attachments/d44d1648-06e8-48bc-9d9e-3dc2d20a9e58-4135.png` (3-column table `Path / Type / Content`; right column ("Content") is clipped; second paragraph Chinese text also runs off-edge).

### 5.11: Detail panel — long file path overflows the header

**Extracted acceptance points:**

1. The detail / tool-call panel's header displays the full `file_path` verbatim. When the path is long (e.g., `…applio/.claude/worktrees/overnight-20260423-c593e035/docs/dev/overnight/c593e035-9739-48c7-b87f-9c1700252083/user-fe…`), it overflows the detail-panel's horizontal bounds.
2. Expected: keep the full path accessible (tooltip / copy / tap-to-expand are all acceptable) but visually constrain it — truncate with ellipsis in the middle, wrap, or enable horizontal scroll inside a bounded container.
3. Visual success condition: zero horizontal overflow of the detail-panel header at any viewport width.

**Reference screenshot**: `/tmp/happy-attachments/2ca20f3f-22d3-4b31-8e39-deeb6d2d1190-4138.png` (header `Overnight Dev: spec-20260420-213508 (until 05:00)` with a sub-row displaying the long `/dev/shm/dev-workspace/applio/…/user-fe…` path overflowing to the right).

### 5.12: Attachment tray — width inconsistency + silent failure on oversize upload

**Extracted acceptance points:**

1. **Layout inconsistency**: in the message composer's attachment tray (above the text input), the top width of file/image thumbnails and the left/right margin width are still not uniform across attachment types. Expected: a single shared layout primitive — same padding, same gutter, same thumbnail box — whether the attachment is a file or an image.
2. **Silent oversize-upload failure**: when the user attaches a file that exceeds the upload size limit, the upload fails but **no error is shown**. The file appears selected in the tray; the message seems to send; nothing surfaces to indicate the upload did not complete.
3. Expected for (2): when upload fails for ANY reason (size, network, MIME), show a visible, user-readable error (inline in the composer, toast, badge on the failed thumbnail — any of these is acceptable) explaining the failure and the corrective action (e.g., "File exceeds NN MB limit").

**Reference screenshots**:
- `/tmp/happy-attachments/9b30895e-67ee-4ed1-b99a-17ed7c9fd6fe-image.png` (small dark card showing a thumbnail labelled `4138.png` over Chinese text `详情面板文件名超宽导致溢出` — illustrates inconsistent thumbnail framing).
- `/tmp/happy-attachments/7ac59940-3c98-4cac-80ae-cb67ca5fd9eb-image.png` (composer tray with `• conjuring…  • 39% left`, an `image.png` thumbnail, input placeholder `Type a message …`).

### 5.13: Codex subagent tasks are not displayed

**Extracted acceptance points:**

1. In the Codex flavor, subagent tasks (equivalent of Claude Code's `Agent` / Task tool calls that spawn a sub-agent) do not appear in the UI at all — the user cannot see that a subagent is running, its status, or its result.
2. Expected: Codex subagent tasks must render with the same visibility treatment as Claude Code's subagent tasks (header showing subagent name/description, status indicator, result block on completion).
3. Scope: applies both to the in-conversation inline card AND the right-side detail panel.

**No reference screenshot** (absence of UI element — dev must reproduce on a live Codex session).

### 5.14: Codex multi-file edit — no right-sidebar rendering

**Extracted acceptance points:**

1. When Codex performs a multi-file edit operation, the right-side detail panel does NOT render the change set — there is no parallel to Claude Code's multi-file edit detail view.
2. Expected: Codex multi-file edits must open / populate the right-side detail panel with per-file diff (same component, or an equivalent component sharing the same layout / interaction pattern as Claude Code's multi-file edit panel).
3. Interaction parity: clicking the tool-call card in the conversation should open the detail panel; the panel should let the user navigate per file; diff rendering should match Claude Code's treatment (unified or split).

**No reference screenshot** (absence of UI element — dev must reproduce on a live Codex session with a multi-file edit).

### 5.15: Codex tool coverage — only `exec_command` renders; all other Codex tools are invisible

> A. 网页/实时信息工具
> 这些用于联网查询、打开网页、天气、股价、时间、体育等。
>
> | 工具 | 用途 | 简单案例 |
> |---|---|---|
> | `web.search_query` | 搜索网页 | 搜"OpenAI API docs" |
> | `web.open` | 打开搜索结果/链接 | 打开某条搜索结果 |
> | `web.click` | 点击页面中的链接 | 在文档页点"Pricing" |
> | `web.find` | 在页面内查找文本 | 查找"rate limits" |
> | `web.image_query` | 搜索图片 | 搜"red panda"图片 |
> | `web.finance` | 查股价/币价 | 查 `AAPL` 或 `BTC` |
> | `web.weather` | 查天气 | 查"San Francisco, CA"天气 |
> | `web.sports` | 查赛程/排名 | 查 NBA standings |
> | `web.time` | 查时区时间 | 查 `+08:00` 当前时间 |
> | `web.screenshot` | PDF 截图 | 截某 PDF 第 2 页 |
>
> B. 本地执行/工程工具
> 这些用于命令执行、计划、文件/资源访问、图片查看等。
>
> | 工具 | 用途 | 简单案例 |
> |---|---|---|
> | `functions.exec_command` | 执行 shell 命令 | `ls -la /root` |
> | `functions.write_stdin` | 向运行中的命令继续输入 | 给交互式程序输入回车 |
> | `functions.update_plan` | 更新任务计划 | "1. 查看文件 2. 修改 3. 测试" |
> | `functions.request_user_input` | 向你发简短选择题 | "要快速版还是详细版？" |
> | `functions.list_mcp_resources` | 列 MCP 资源 | 列出某 server 的资源 |
> | `functions.list_mcp_resource_templates` | 列 MCP 模板 | 看有哪些参数化资源 |
> | `functions.read_mcp_resource` | 读取 MCP 资源 | 读取某文档/数据资源 |
> | `functions.view_image` | 查看本地图像 | 查看 `/tmp/a.png` |
> | `functions.apply_patch` | 打补丁改文件 | 修改某个 `.py` 文件 |
> | `functions.mcp__happy__change_title` | 修改会话标题 | 改成"工具与渲染展示测试" |
>
> C. 代理/委派工具
> 这些用于开子代理并行工作。
>
> | 工具 | 用途 | 简单案例 |
> |---|---|---|
> | `functions.spawn_agent` | 创建子代理 | 让子代理单独分析代码 |
> | `functions.send_input` | 给子代理发消息 | "继续检查 tests/" |
> | `functions.wait_agent` | 等待子代理完成 | 等 30 秒取结果 |
> | `functions.resume_agent` | 恢复旧代理 | 恢复一个关闭前的 agent |
> | `functions.close_agent` | 关闭代理 | 结束不再需要的 agent |
>
> D. 工具建议/插件相关
>
> | 工具 | 用途 | 简单案例 |
> |---|---|---|
> | `functions.tool_suggest` | 建议安装/启用插件 | 建议安装 GitHub 插件 |
> | `multi_tool_use.parallel` | 并行调用多个开发工具 | 同时跑 `ls` 和更新计划 |

**Extracted acceptance points:**

1. Current state: only `functions.exec_command` (shown as `/bin/bash -lc true` in the screenshot Terminal card) has any UI rendering in the Codex flavor. All other Codex tools invoked by the agent produce no visible UI card in the conversation and no detail-panel entry.
2. Expected coverage: every tool in the four groups above (A Web/realtime, B Local-exec/engineering, C Subagent/delegation, D Tool-suggest/plugin) must have a conversation card AND (where applicable) a right-side detail panel.
3. Inline card requirements:
   - A header identifying the tool by human-readable name + icon appropriate to the category (globe for `web.*`, terminal for `functions.exec_command`, edit for `functions.apply_patch`, agent icon for `functions.spawn_agent / send_input / wait_agent / resume_agent / close_agent`, etc.).
   - A one-line description or argument summary (e.g., `web.search_query "OpenAI API docs"`, `web.weather "San Francisco, CA"`, `functions.view_image /tmp/a.png`).
   - A status indicator (running / complete / error) matching the Claude Code treatment.
4. Right-side detail panel requirements:
   - Raw `Description` (a real description, not the raw arguments — see §5.7).
   - `Input Parameters` (structured, readable).
   - Output / result section (rendered appropriately per tool: HTML/text preview for `web.open`, image preview for `web.screenshot` / `functions.view_image`, diff for `functions.apply_patch`, per-agent status for `functions.spawn_agent` / `wait_agent`, etc.).
5. Alignment with §5.6: the Codex tool rendering layer must share the same redesigned popup / card primitives used by Claude Code — do not build a second divergent rendering tree.
6. Alignment with §5.13: `functions.spawn_agent` / `wait_agent` / `resume_agent` / `close_agent` rendering is what resolves the "Codex subagent tasks not displayed" complaint — implementing §5.15 row-by-row should make §5.13 fall out naturally.
7. Alignment with §5.14: `functions.apply_patch` (when spanning multiple files) must route into the shared multi-file edit detail panel — resolving §5.14.
8. Alignment with §5.7: for every tool above, `Description` and `Input Parameters.description` must NOT share a source — `Description` is always a human-readable summary, never the raw argument blob.

**Reference screenshot**: `/tmp/happy-attachments/8b7c7f5f-23dc-43d2-8d4b-0c71902ed69c-image.png` (shows the user's dropdown with the four category labels 网页/实时信息工具, 本地执行/工程工具, 代理/委派工具, 工具建议/插件相关, and — as the only rendered Codex tool card below — a `Terminal /bin/bash -lc true` card followed by "已按你说的，每类都实际触发了一个最小调用"). Illustrates the ONE tool that does render (`exec_command`) while the other three categories rendered no cards.

### 5.16: Inline LaTeX math is not rendered

**Extracted acceptance points:**

1. Inline math delimited with single dollar signs (`$...$`) currently renders as raw source text (`$a^2 + b^2 = c^2$`) inside the message body, instead of being typeset as math.
2. Expected: inline math must render as proper math (KaTeX / MathJax / equivalent), inline with the surrounding text flow (no block break, no visible `$...$` delimiters). Display math (`$$...$$`) rendering is out of scope for this requirement unless it is broken by the same root cause — if so, fix both.
3. Scope: all message surfaces where markdown is rendered (conversation view, detail panel, user-feedback docs view, any tool-call result preview that runs through `MarkdownView`).

**Reference screenshot**: `/tmp/happy-attachments/73955b72-519e-42bc-9eb9-c95ed537d921-image.png` (heading `2. LaTeX 数学公式`; next line shows `行内:$a^2 + b^2 = c^2$` verbatim, un-rendered).

### 5.17: Several markdown primitives are not rendered

From the two reference screenshots, the following markdown primitives render as raw source instead of their intended form:

1. **Headings** — `# 一级标题`, `## 二级标题`, `### 三级标题` (at minimum H1 and H2 per the user's call-out). Both images show numbered-title lines (`1. Markdown 特殊渲染`, `1.1 文本样式`, `1.2 列表与任务`, `1.3 引用`) that should be typeset as headings but appear as plain bold text. Expected: every heading level (H1–H6) renders with appropriate typography (size, weight, spacing).
2. **Strikethrough** — `~~删除线~~` shows raw tildes around the word. Expected: struck-through text.
3. **Task lists** — `- [x] 已完成任务` and `- [ ] 待办任务` render as raw source. Expected: checkbox UI with checked / unchecked state.
4. **Nested unordered list** — `- 无序列表项 A / - 嵌套项 / - 无序列表项 B` shows every line starting with a literal `- ` and no visual indentation for the nested item. Expected: proper bulleted list with indentation for nested items.
5. **Ordered list** — `1. 有序第一 / 2. 有序第二` should render with list-item styling (not as two plain text lines).
6. **Blockquote** — `> 这是一段引用...` and nested `>> 嵌套引用` show raw `>` / `>>` prefixes. Expected: visual blockquote (left border / indent / muted color), with an additional indent layer for the nested case.
7. **HTML / escaped character rendering** —
   - `<kbd>Ctrl</kbd> + <kbd>C</kbd>` is shown as raw HTML source. Expected: either rendered as keycap-styled kbd spans, OR safely treated as literal text — but NOT displayed as a confusing hybrid that the user must mentally parse.
   - `&lt;div&gt;Hello&lt;/div&gt;` is shown as raw HTML entities. Expected: decoded to `<div>Hello</div>` visible literal text (the user's own demo content shows this as the expected behaviour — "有时可显示", "实际渲染效果取决于客户端").
8. **Inline styles that DO work** (don't regress): `粗体` (bold), `斜体` (italic), `行内代码` (inline code), `链接` (links) — these appear to render correctly in the first screenshot and must continue to do so.
9. Scope: applies wherever `MarkdownView` is used (conversation, detail panel, feedback docs, tool-call result previews).
10. Alignment with §5.16 (LaTeX): this is the same `MarkdownView` / parser pipeline — fixes should be considered together, since a common parser-level gap could explain both.

**Reference screenshots**:
- `/tmp/happy-attachments/a4e972f0-8ffa-4698-8ee1-1719fabab14a-image.png` — "1. Markdown 特殊渲染" header, 1.1 文本样式, 1.2 列表与任务, 1.3 引用; shows failing: ~~删除线~~, [x]/[ ] task list, nested list, ordered list, blockquote, nested blockquote.
- `/tmp/happy-attachments/aed914f2-64fc-4eae-800f-87fe4a334414-image.png` — "HTML/转义字符" section; shows failing: `<kbd>…</kbd>`, `&lt;…&gt;` entities.

### 5.18: CronList tool — inline card is too verbose; move detail to sidebar

**Extracted acceptance points:**

1. **Current state**: the in-conversation CronList tool card renders a full `INPUT` + `OUTPUT` block (e.g., `INPUT: {}`, `OUTPUT: No scheduled jobs.`) directly in the main conversation. This is "rendering很烂" — too heavy for an inline surface.
2. **Simplify the inline card** (main conversation) to match the Bash / subagent rendering pattern:
   - Header with tool name + icon (`CronList` + wrench or clock icon).
   - ONE compact summary line showing the `input` arguments only (e.g., `CronList {}`), in the same style Bash uses for its command line and subagent uses for its invocation line.
   - No separate INPUT / OUTPUT sections inline.
3. **Preserve the current verbose rendering** (INPUT block + OUTPUT block) but move it to the RIGHT-SIDE SIDEBAR only. Clicking the simplified inline card opens the sidebar with the existing `INPUT / OUTPUT` layout.
4. **Pattern generalization**: this establishes the rule for tool cards broadly — inline card = compact summary of input; detail panel = full input + output. §5.15 (Codex tool coverage) should adopt the same rule.
5. Success condition: the CronList inline card in the conversation has a single header + single summary line, and the current `INPUT {}  OUTPUT No scheduled jobs.` content appears only when the right-side sidebar is opened for that tool call.

**Reference screenshot**: `/tmp/happy-attachments/19b9ee44-3da5-47f8-9313-96880a0015e8-image.png` (CronList card with wrench icon in header, then `INPUT` label, `{}`, `OUTPUT` label, `No scheduled jobs.` — all rendered inline; this whole block should become a single summary line inline, with this full detail reserved for the sidebar).
