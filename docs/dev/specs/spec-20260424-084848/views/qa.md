<!-- AUTO-GENERATED VIEW for qa | source: docs/dev/specs/spec-20260424-084848.md | extracted: 2026-04-24T08:48:48Z -->

# qa view of spec-20260424-084848

**Monolith**: docs/dev/specs/spec-20260424-084848.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate (from spec)

> WHO WRITES: QA (after each verification)

> WHAT: Actual measured values -- pixel dimensions, computed CSS, console output, screenshot paths.

> This gives the next cycle's Dev concrete data to work with instead of vague "it failed".

> WHO WRITES: QA (when verdict is fail)

> WHAT: Specific gap between measured state (Section 4) and acceptance criterion (Section 5).

> Must include evidence: actual value vs expected value.

> WHO WRITES: QA (on fail) or PM-Retro

> WHAT: Prescriptive next step for this specific issue. Not generic advice -- a concrete action.

> Example: "Increase padding from 8px to 16px in Chat.tsx:42" not "fix the padding"

---

## Section 4: Current State

<!-- WHO WRITES: QA (after each verification) -->
<!-- WHAT: Actual measured values -- pixel dimensions, computed CSS, console output, screenshot paths. -->
<!-- This gives the next cycle's Dev concrete data to work with instead of vague "it failed". -->

### Cycle 1

_Not yet populated._

---

## Section 5: Acceptance criteria reference

### 5.1: Per-session model persistence + model indicator in status bar (verbatim)

> happy-dev 开发需求1：我需要每一个session的模型持久化，也就是说不会因为我切出session再切入就导致模型自动更换为默认模型。同时我要求模型应该能够再状态栏右侧显示（yolo前方）
> 每一次模型只会因为我手动在gui切换模型才会真的改变

**Extracted acceptance points:**

1. **Per-session model persistence**: Each session must remember the model the user last selected for that session. Navigating away from the session and returning must NOT revert the model to the default.
2. **Model indicator in status bar**: The currently selected model must be displayed in the status bar on the right side, immediately to the LEFT of the `yolo` (permission-mode) indicator.
3. **Manual-only changes**: The only event that changes a session's active model is the user manually switching the model in the GUI. No implicit or automatic model changes are allowed (including — but not limited to — re-entering the session, reload, reconnect, machine restart, app restart).

### 5.2: 1M-context Claude models — context-usage display broken (verbatim)

> claude 全部1M系列模型的context占用显示失败，这是因为目前happy-dev不适配1M模型。例如这张图展示的context为0%这是根本不可能的

**Extracted acceptance points:**

1. **Root cause (user-stated)**: happy-dev does not adapt to Claude 1M-context models, so the status-bar context-usage percentage computes incorrectly for every 1M model variant.
2. **Observed symptom**: For at least one 1M-context session the status-bar shows context as 0%, which is impossible (a live session with history must have > 0% used).
3. **Scope**: All 1M-context Claude model variants (every "claude …[1M]" / 1M-context family member) must display a correct, non-degenerate context-usage percentage in the status bar.
4. **Success condition**: When a session is running on any 1M-context Claude model, the status-bar percentage must reflect real token usage (e.g., `● online • N% left` with `N` being a value consistent with actual message history / token budget), identical in behaviour to how the non-1M Claude models display today.

### 5.3: Right-side Bash popup — command text overflows popup width (verbatim)

> 打开右侧弹窗显示的bash命令超出了弹窗宽度

**Extracted acceptance points:**

1. When the user opens the right-side slide-over / popup that displays a Bash tool-call, the command line (e.g. `$ ls /root/docs/dev/ba-spec-20260423-080000.md /root/docs/dev/con…`) overflows the popup's horizontal bounds.
2. Expected: the command text must stay inside the popup width. Acceptable implementations: horizontal scroll within the command code block, soft-wrap at word boundaries, or responsive truncation with a way to see the full text (`view full`, hover-reveal, etc.) — whichever the design system prefers, so long as nothing visually exits the popup frame.
3. Applies at all popup widths currently supported by the UI (desktop default, narrow desktop, tablet, mobile).

### 5.4: Top bar — happy logo and avatar positions are hardcoded, not responsive (verbatim)

> 顶部栏的happy logo和头像元素没有自适应窗口内容元素的伸缩（位置hardcoded）

**Extracted acceptance points:**

1. The top navigation bar currently positions the happy logo (leading side) and the user avatar (trailing side) with hardcoded offsets, so they do NOT track the resize/stretch of the content area between them.
2. Expected: both elements must re-layout responsively alongside the content column — their positions/spacing should be a function of the layout container, not absolute/magic-number positioning.
3. Applies across viewport widths (wide desktop, narrow desktop, tablet, mobile) and for the entire range of content-panel resizings supported by the UI (e.g., sidebar collapse/expand, split view, inspector toggle).

### 5.5: Top bar / layout — second non-adaptive case (verbatim)

> 没有自适应的另外一个案例

**Extracted acceptance points:**

1. A second example of non-responsive layout in the same UI region (top-bar / chrome). Treat as a continuation of §5.4: same class of bug, different concrete case captured for dev/QA reproduction.
2. The fix approach for §5.4 must resolve the case shown here too; if not, it is not complete.

### 5.6: Codex tool-call popup — not aligned with Claude Code popup redesign (verbatim)

> codex窗口bash命令没有学习claude code窗口改造

**Extracted acceptance points:**

1. The Codex flavor's tool-call / bash popup has NOT been migrated to the newer visual & interaction treatment that was applied to the Claude Code flavor's popup. The two flavors must share the same popup design.
2. Scope includes: the popup container, header, command rendering, output rendering, any expand/collapse affordance, and — importantly — the width/overflow behaviour from §5.3.
3. Expected: visually and behaviourally Codex's tool-call popup should be indistinguishable from Claude Code's (modulo flavor-specific labels / icons where intentional).

### 5.7: Codex tool-call popup — Description field content is wrong (verbatim)

> codex窗口description错误

**Extracted acceptance points:**

1. In the Codex tool-call popup, the `Description` section is populated with the wrong content: it currently mirrors the raw command string (`/bin/bash -lc "mkdir -p /tmp/apply-deploy-test && CANDIDATE_NAME=Yuge_Tang …"`) instead of a human-readable description of what the tool call is doing.
2. Expected: `Description` must show the actual description field (the model-provided natural-language summary). The raw command belongs in the `Input Parameters` / command code block only.
3. Evidence from the reference screenshot: the `Description` block and the `Input Parameters.description` both duplicate the full `/bin/bash -lc "…"` string; they should diverge, with `Description` carrying a real description.

### 5.8: Markdown tables overflow width — port the fix already in happy prod (verbatim)

> 表格内容太多会超宽。这点在happy prod已经解决。直接去学习

**Extracted acceptance points:**

1. In happy-dev, rendered markdown tables with wide content overflow the message / card horizontal bounds (the visible row "Path / Type / Content" gets clipped on the right edge of the card).
2. This exact problem is already solved in the happy **production** codebase. The fix must be ported over — do NOT re-invent it.
3. Dev step: locate the production treatment (likely a horizontally-scrollable wrapper around the `<table>` / `MarkdownView` renderer) and replicate it in happy-dev for the same renderer.
4. Success condition: any markdown message containing a table wider than the surrounding container gets its table horizontally scrollable inside the container, with no visual bleed outside the card's right edge — matching production behaviour byte-for-byte where reasonable.

### 5.9: Stop-hook feedback must not be shown to the user (verbatim)

> stop hook不应该展示给用户

**Extracted acceptance points:**

1. The current UI renders "Stop hook feedback" blocks (e.g., `SPEC COVERAGE ENFORCEMENT: spec-verify.py reports < 100% coverage. …`) directly in the user-facing conversation.
2. Expected: stop-hook output belongs in developer logs / internal telemetry only. It must not appear in the user's conversation view at all.
3. Scope: all stop-hook feedback variants, regardless of severity marker (✅, ❌, ⚠️) or whether the hook is a Python script, shell script, or other.

### 5.10: Long background-task disconnect causes out-of-order delivery on reconnect (verbatim)

> 每一次执行背景任务时间太长会导致happy和claude断联、然后只有用户重新发消息才会导致链接。可是这样happy传导的第一个回复是claude对背景任务的自回复，用户实际消息传到了claude但是happy传递次序有问题

**Extracted acceptance points:**

1. **Observed failure sequence**:
   a. A long-running background task keeps Claude busy past happy's idle/connection threshold → happy ↔ claude connection drops.
   b. Reconnection does not happen on a timer — it only occurs when the user sends a new message.
   c. On that reconnect, happy forwards the wrong message first: the reply Claude generated for the **background task** (its self-reply during the disconnected interval) arrives at the user BEFORE the assistant reply that corresponds to the user's new message, even though the user's message did reach Claude and was processed correctly on Claude's side.
2. **Root cause area**: happy's delivery queue / event re-ordering after reconnect. Claude's own ordering is correct — the bug lives in happy's transport/relay layer.
3. **Success conditions**:
   - The reconnect must not require user action — happy should reconnect proactively while the background task runs, so no queue divergence accumulates.
   - Whatever the reconnect trigger, messages forwarded to the user MUST arrive in causal order: every assistant reply is paired with the user message that caused it (or clearly labelled as background output, if it must be shown at all).
4. **Out of scope** (for this requirement alone): whether the user should see background-task self-replies at all is a separate UX question; the immediate bug is the ordering, not the visibility.

### 5.11: Detail panel — long file path overflows the header (verbatim)

> 详情面板文件名超宽导致溢出

**Extracted acceptance points:**

1. The detail / tool-call panel's header displays the full `file_path` verbatim. When the path is long (e.g., `…applio/.claude/worktrees/overnight-20260423-c593e035/docs/dev/overnight/c593e035-9739-48c7-b87f-9c1700252083/user-fe…`), it overflows the detail-panel's horizontal bounds.
2. Expected: keep the full path accessible (tooltip / copy / tap-to-expand are all acceptable) but visually constrain it — truncate with ellipsis in the middle, wrap, or enable horizontal scroll inside a bounded container.
3. Visual success condition: zero horizontal overflow of the detail-panel header at any viewport width.

### 5.12: Attachment tray — width inconsistency + silent failure on oversize upload (verbatim)

> 文件和图片顶部宽度和左右宽度仍然不统一。此外文件太大了无法上传并且没有报错

**Extracted acceptance points:**

1. **Layout inconsistency**: in the message composer's attachment tray (above the text input), the top width of file/image thumbnails and the left/right margin width are still not uniform across attachment types. Expected: a single shared layout primitive — same padding, same gutter, same thumbnail box — whether the attachment is a file or an image.
2. **Silent oversize-upload failure**: when the user attaches a file that exceeds the upload size limit, the upload fails but **no error is shown**. The file appears selected in the tray; the message seems to send; nothing surfaces to indicate the upload did not complete.
3. Expected for (2): when upload fails for ANY reason (size, network, MIME), show a visible, user-readable error (inline in the composer, toast, badge on the failed thumbnail — any of these is acceptable) explaining the failure and the corrective action (e.g., "File exceeds NN MB limit").

### 5.13: Codex subagent tasks are not displayed (verbatim)

> codex subagent任务不显示

**Extracted acceptance points:**

1. In the Codex flavor, subagent tasks (equivalent of Claude Code's `Agent` / Task tool calls that spawn a sub-agent) do not appear in the UI at all — the user cannot see that a subagent is running, its status, or its result.
2. Expected: Codex subagent tasks must render with the same visibility treatment as Claude Code's subagent tasks (header showing subagent name/description, status indicator, result block on completion).
3. Scope: applies both to the in-conversation inline card AND the right-side detail panel.

### 5.14: Codex multi-file edit — no right-sidebar rendering (verbatim)

> codex多文件edit操作没有对应的右侧侧边栏渲染

**Extracted acceptance points:**

1. When Codex performs a multi-file edit operation, the right-side detail panel does NOT render the change set — there is no parallel to Claude Code's multi-file edit detail view.
2. Expected: Codex multi-file edits must open / populate the right-side detail panel with per-file diff (same component, or an equivalent component sharing the same layout / interaction pattern as Claude Code's multi-file edit panel).
3. Interaction parity: clicking the tool-call card in the conversation should open the detail panel; the panel should let the user navigate per file; diff rendering should match Claude Code's treatment (unified or split).

### 5.15: Codex tool coverage — only `exec_command` renders; all other Codex tools are invisible (verbatim)

> codex的全部工具只有exc_command有渲染：

**Extracted acceptance points:**

1. Current state: only `functions.exec_command` (shown as `/bin/bash -lc true` in the screenshot Terminal card) has any UI rendering in the Codex flavor. All other Codex tools invoked by the agent produce no visible UI card in the conversation and no detail-panel entry.
2. Expected coverage: every tool in the four groups above (A Web/realtime, B Local-exec/engineering, C Subagent/delegation, D Tool-suggest/plugin) must have a conversation card AND (where applicable) a right-side detail panel.

### 5.16: Inline LaTeX math is not rendered (verbatim)

> 行内数学公式不渲染

**Extracted acceptance points:**

1. Inline math delimited with single dollar signs (`$...$`) currently renders as raw source text (`$a^2 + b^2 = c^2$`) inside the message body, instead of being typeset as math.
2. Expected: inline math must render as proper math (KaTeX / MathJax / equivalent), inline with the surrounding text flow (no block break, no visible `$...$` delimiters). Display math (`$$...$$`) rendering is out of scope for this requirement unless it is broken by the same root cause — if so, fix both.

### 5.17: Several markdown primitives are not rendered (verbatim)

> markdown一些特殊格式无渲染（包括一级标题二级标题等）

**Extracted acceptance points:**

From the two reference screenshots, the following markdown primitives render as raw source instead of their intended form:

1. **Headings** — `# 一级标题`, `## 二级标题`, `### 三级标题` (at minimum H1 and H2 per the user's call-out). Both images show numbered-title lines (`1. Markdown 特殊渲染`, `1.1 文本样式`, `1.2 列表与任务`, `1.3 引用`) that should be typeset as headings but appear as plain bold text. Expected: every heading level (H1–H6) renders with appropriate typography (size, weight, spacing).

### 5.18: CronList tool — inline card is too verbose; move detail to sidebar (verbatim)

> cronlist工具调用渲染很烂。应该简化主页面的显示内容。学习bash + subagent的渲染模式展示input就行。现在的渲染模式保留但是只加入到右侧侧边栏

**Extracted acceptance points:**

1. **Current state**: the in-conversation CronList tool card renders a full `INPUT` + `OUTPUT` block (e.g., `INPUT: {}`, `OUTPUT: No scheduled jobs.`) directly in the main conversation. This is "rendering很烂" — too heavy for an inline surface.
5. Success condition: the CronList inline card in the conversation has a single header + single summary line, and the current `INPUT {}  OUTPUT No scheduled jobs.` content appears only when the right-side sidebar is opened for that tool call.

---

## Section 6: Why Not Met

<!-- WHO WRITES: QA (when verdict is fail) -->
<!-- WHAT: Specific gap between measured state (Section 4) and acceptance criterion (Section 5). -->
<!-- Must include evidence: actual value vs expected value. -->

### Cycle 1

_Not yet populated._

---

## Section 7: What Must Be Done

<!-- WHO WRITES: QA (on fail) or PM-Retro -->
<!-- WHAT: Prescriptive next step for this specific issue. Not generic advice -- a concrete action. -->
<!-- Example: "Increase padding from 8px to 16px in Chat.tsx:42" not "fix the padding" -->

### Cycle 1

_Not yet populated._
