<!-- AUTO-GENERATED VIEW for orchestrator | source: docs/dev/specs/spec-20260506-203844.md | extracted: 2026-05-06T20:47:19Z -->

# orchestrator view of spec-20260506-203844

**Monolith**: docs/dev/specs/spec-20260506-203844.md
**Extraction**: content-block level (no section-level mapping)

---

## Pipeline Workflow

**Pipeline**: happy-tool-rendering-ui
**Session**: current-happy-dev-tool-rendering-investigation
**Created**: 2026-05-06T20:38:44Z

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

---

## Anti-Patterns

- 不要把工具自身返回的富输出等同于 Happy UI 中用户实际看到的输出。
- 不要只依赖 bundle grep、unit test、tool output；UI 修复必须用 live browser 渲染验证。
- 用户明确要求的是“我面前看到什么”，所以验收必须以用户视角/Happy 截图为准。
- 旧消息不会自动获得新 mapper 产生的 preview；测试应触发新工具调用。
- subagent 内部工具目前未泄漏，不要误修成隐藏所有 subagent 信息；应修的是主控工具卡状态与合并展示。
- `request_user_input` 当前 Default mode 不可用，不应列为渲染失败而应列为模式限制。
- `/root/bin/happy-restart.sh` 是生产全量脚本，不能用于当前 dev UI 修复。
- 所有 dev UI 验证必须使用 `dev.life-ai.app`、`localhost:8097`、`api-dev.life-ai.app`、`localhost:3005`，不得访问 production。

---

## Hard Rules Relevant to Orchestrator

- [ ] 不要运行 `/root/bin/happy-restart.sh` 修 dev 渲染问题。
- [ ] `/root/bin/happy-restart.sh` 是生产/全量 restart 脚本，不适用于 happy-dev。
- [ ] 不要假设 `/root/bin/safe-daemon-restart.sh` 存在；引用脚本前必须先验证。
- [ ] 如需加载 CLI mapper，优先只处理 dev daemon，并明确会影响 dev sessions。
- [ ] 所有 UI 验证必须使用 dev web/API，不访问 production。
- [ ] 触发测试会话/内容应通过正常 UI 或当前 dev session，不绕过安全规则。


- 不要把工具自身返回的富输出等同于 Happy UI 中用户实际看到的输出。
- 不要只依赖 bundle grep、unit test、tool output；UI 修复必须用 live browser 渲染验证。
- 用户明确要求的是“我面前看到什么”，所以验收必须以用户视角/Happy 截图为准。
- 旧消息不会自动获得新 mapper 产生的 preview；测试应触发新工具调用。
- subagent 内部工具目前未泄漏，不要误修成隐藏所有 subagent 信息；应修的是主控工具卡状态与合并展示。
- `request_user_input` 当前 Default mode 不可用，不应列为渲染失败而应列为模式限制。
- `/root/bin/happy-restart.sh` 是生产全量脚本，不能用于当前 dev UI 修复。
- 所有 dev UI 验证必须使用 `dev.life-ai.app`、`localhost:8097`、`api-dev.life-ai.app`、`localhost:3005`，不得访问 production。

---

## Agent Relevance Analysis

| Agent | Relevant | Reason |
|-------|----------|--------|
| architect | no | No separate architecture stage is defined; mapper/renderer integration is assigned to implementation work. |
| ba | yes | Section 5 is explicitly BA-authored and contains the acceptance criterion and checklist. |
| cleaner | no | No cleanup, archive, move, delete, or retention scope is requested. |
| cleanliness-inspector | no | No file-organization inspection or archive-candidate audit is requested. |
| dev | yes | Sections 2, 3, and 7 describe implementation attempts, changed files, and concrete fixes. |
| git-edge-case-analyst | no | No git history, branch, rebase, or merge edge case is part of this spec. |
| pm | yes | The spec contains PM/User/PM-Retro authored baseline and attention notes plus ordered scope constraints. |
| product-owner | no | No separate product-owner approval or business-scope gate is defined. |
| prompt-inspector | no | No prompt-rule or subagent-prompt inspection is requested. |
| qa | yes | Sections 4, 6, and 7 are QA-authored measured state, failure analysis, and verification direction. |
| rule-inspector | no | No folder-rule discovery or INDEX/README rule generation is requested. |
| style-inspector | no | No development-standards audit is requested. |
| test-executor | no | The spec assigns verification to QA rather than a standalone test-executor stage. |
| test-validator | no | No test syntax/dependency validation task is separated from QA. |
| ui-specialist | yes | The work is specifically Happy UI tool-card/image/diff/subagent rendering behavior. |
| user | yes | The spec preserves user-visible screenshots, user quotes, and user-perspective acceptance. |

## Views Created

- docs/dev/specs/spec-20260506-203844/views/pm.md (43 lines)
- docs/dev/specs/spec-20260506-203844/views/user.md (182 lines)
- docs/dev/specs/spec-20260506-203844/views/ba.md (38 lines)
- docs/dev/specs/spec-20260506-203844/views/dev.md (164 lines)
- docs/dev/specs/spec-20260506-203844/views/qa.md (106 lines)
- docs/dev/specs/spec-20260506-203844/views/ui-specialist.md (113 lines)
- docs/dev/specs/spec-20260506-203844/views/orchestrator.md (137 lines)

## Monolith Sections

### ## Section 1: Before

> <!-- WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context) -->
> <!-- WHAT: Screenshot path + text description of the current state BEFORE any fix attempt. -->

### ## Section 2: What Was Attempted

> <!-- WHO WRITES: Dev (after each implementation attempt) -->
> <!-- WHAT: Per-cycle record of what approach was tried, what the rationale was, and why it failed (if it failed). -->

### ## Section 3: What Was Changed

> <!-- WHO WRITES: Dev (after each implementation) -->
> <!-- WHAT: Exact file changes with line numbers and old->new values. -->

### ## Section 4: Current State

> <!-- WHO WRITES: QA (after each verification) -->
> <!-- WHAT: Actual measured values -- pixel dimensions, computed CSS, console output, screenshot paths. -->

### ## Section 5: User's Acceptance Criterion

> <!-- WHO WRITES: BA (on first analysis) -->
> <!-- WHAT: Verbatim quote from user's requirement or focus string. -->

### ## Section 6: Why Not Met

> <!-- WHO WRITES: QA (when verdict is fail) -->
> <!-- WHAT: Specific gap between measured state (Section 4) and acceptance criterion (Section 5). -->

### ## Section 7: What Must Be Done

> <!-- WHO WRITES: QA (on fail) or PM-Retro -->
> <!-- WHAT: Prescriptive next step for this specific issue. Not generic advice -- a concrete action. -->

### ## Section 8: Attention Notes

> <!-- WHO WRITES: PM-Retro -->
> <!-- WHAT: Issue-specific traps, warnings, and things to watch out for in the next cycle/session. -->

