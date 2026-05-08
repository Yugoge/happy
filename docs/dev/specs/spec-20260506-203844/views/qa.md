<!-- AUTO-GENERATED VIEW for qa | source: docs/dev/specs/spec-20260506-203844.md | extracted: 2026-05-06T20:47:19Z -->

# qa view of spec-20260506-203844

**Monolith**: docs/dev/specs/spec-20260506-203844.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> <!-- WHO WRITES: QA (after each verification) -->
> <!-- WHAT: Actual measured values -- pixel dimensions, computed CSS, console output, screenshot paths. -->
> <!-- This gives the next cycle's Dev concrete data to work with instead of vague "it failed". -->
>
> <!-- WHO WRITES: QA (when verdict is fail) -->
> <!-- WHAT: Specific gap between measured state (Section 4) and acceptance criterion (Section 5). -->
> <!-- Must include evidence: actual value vs expected value. -->
>
> <!-- WHO WRITES: QA (on fail) or PM-Retro -->
> <!-- WHAT: Prescriptive next step for this specific issue. Not generic advice -- a concrete action. -->
> <!-- Example: "Increase padding from 8px to 16px in Chat.tsx:42" not "fix the padding" -->

---

## Section 4: Current State

<!-- WHO WRITES: QA (after each verification) -->
<!-- WHAT: Actual measured values -- pixel dimensions, computed CSS, console output, screenshot paths. -->
<!-- This gives the next cycle's Dev concrete data to work with instead of vague "it failed". -->

### Cycle 1

#### 4.1 成功或部分成功显示的工具形态

- 标题变更成功显示。
- Terminal 卡显示成功。
- MCP/Playwright 工具卡显示成功。
- Playwright screenshot 在最新一次工具输出中，工具调用结果本身包含了截图预览；但用户是否在 Happy 消息流中看到同样内联预览仍需确认。
- apply_patch/update file 卡显示成功，但布局不理想。
- view_image 卡显示成功识别文件，但未 inline 图片。
- subagent 控制工具卡显示成功，但完成态/合并逻辑错误。

#### 4.2 用户明确表示没有看到或看不到的形态

- 除 Terminal 和 MCP 外，很多系统工具/内部工具没有在用户面前形成独立可见内容。
- image_gen 生成结果没有被用户看到。
- update_plan 没有被用户看到或未形成有效可见卡。
- Web search/open 类工具没有明显 Happy 专用 UI。
- MCP resource 工具返回空 resource/template，没有更多可展示内容。
- request_user_input 在 Default mode 不可用，不能展示交互式选择卡。

#### 4.3 Subagent 当前准确结论

- 用户确认：subagent 内部工具调用没有直接泄漏到主 agent 面板。
- 真实问题是：主 agent 调用 subagent 的三个控制工具 `spawn_agent`、`wait_agent`、`close_agent` 被分散显示，并且均显示为普通运行中工具卡，spinner 没停止，耗时错误。

#### 4.4 安全/运维结论

- `/root/bin/safe-daemon-restart.sh` 不存在；此前引用它是基于项目文档，未先验证，属于错误引用。
- `/root/bin/happy-restart.sh` 是生产/全量 Happy restart 脚本，会触碰 main/jade/qijie daemons、production happy-server、production happy-web，不应用于当前 happy-dev 渲染修复。
- 当前 happy-dev daemon 的入口是 `/usr/bin/happy-dev -> /dev/shm/dev-workspace/happy-dev/packages/happy-cli/bin/happy-dev.mjs`。
- 如需加载 happy-cli mapper 修复，应只考虑 dev daemon：`happy-daemon-dev.service`。但从 daemon-managed Claude session 内直接重启仍需要谨慎。


---

## Section 6: Why Not Met

<!-- WHO WRITES: QA (when verdict is fail) -->
<!-- WHAT: Specific gap between measured state (Section 4) and acceptance criterion (Section 5). -->
<!-- Must include evidence: actual value vs expected value. -->

### Cycle 1

当前未满足原因：

- 用户要求展示“全部 tool 工具渲染和所有非文本输出形式”，但实际用户多次表示只看到了 Terminal 和 MCP，很多工具没有形成可见 UI。
- 用户要求继续展示真正图片内联预览，但 `view_image` 只显示路径和 JSON，`image_gen` 未显示，截图也未稳定确认在 Happy 中 inline。
- 用户指出 subagent 显示有大问题，实际截图中 Spawn/Wait/Close 三个控制工具卡完成后仍有 spinner 和 duration。
- 用户指出 view image 和 update file 有重叠/重复显示问题，截图中确实存在文件信息/JSON/路径重复及层级混乱。
- 主 agent 之前给出 `/root/bin/safe-daemon-restart.sh`，但该脚本不存在；这是流程可靠性问题，已记录为避免再次发生的运维验收项。

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

