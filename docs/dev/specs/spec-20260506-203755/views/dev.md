<!-- AUTO-GENERATED VIEW for dev | source: docs/dev/specs/spec-20260506-203755.md | extracted: 2026-05-06T22:30:00Z -->

# dev view of spec-20260506-203755

**Monolith**: docs/dev/specs/spec-20260506-203755.md
**Extraction**: dev scope — Background Explore findings (code-level root causes) + Section 5.4 implementation strategy

---

## Role Mandate

> 子代理深查 tool-card dispatch + Skill envelope + Command envelope，三块的代码定位：

---

#### Background Explore findings (integrated 2026-05-06)

子代理深查 tool-card dispatch + Skill envelope + Command envelope，三块的代码定位：

**Tool-card dispatch architecture（`ToolView.tsx:58-151`, `views/_all.tsx:37-90`, `knownTools.tsx:66-1450`）：**
- 注册表机制：`getToolViewComponent(toolName)` (`_all.tsx:83`) 查 `toolViewRegistry[toolName]`
- 命中 → 走专用 view（如 `BashView`, `EditView`, `SidebarFileView`, `SidebarAgentConversation`）
- 未命中 → fallback 到 `GenericToolPreview` (`ToolView.tsx:295`)
- `minimal: true` 标志控制是否压成 chip（`knownTools.tsx`）

**#16 Skill 根因（`typesRaw.ts:578-588 + 21-36`, `MessageView.tsx:58-73 + 132-149`）：**
1. Skill 工具名（如 `mcp__happy__change_title`）**没有 registry 条目**
2. `getToolViewComponent` 返回 null
3. 走 `GenericToolPreview` fallback
4. `GenericToolPreview` 把 `tool.input` 字面 stringify，过 CodeView 输出
5. 因为没有 markdown-stripping 逻辑，skill prompt body 直接漏成 user-visible text

**#18 Command 根因（`typesRaw.ts:96-100`, `MessageView.tsx:173-174 + 132-149`, `suggestionCommands.ts:81-107`）：**
1. Slash-command 存储为 `wrap` envelope → 转成 `type: 'wrapped'` AgentEvent
2. `WrappedEventBlock` (`MessageView.tsx:132-149`) 渲染折叠 dropdown，从 `session.metadata.slashCommands` 拿 label+content
3. **Live 时正常**：metadata 在内存里有 `slashCommands` 数组
4. **重启后失败**：metadata 没从持久化存储 rehydrate → `slashCommands` 是空数组 → dropdown 空内容
5. 修复路径二选一：(a) 重启时 rehydrate metadata；(b) **把 label+content 在存储时 cache 进 envelope 本身**（更稳妥，避免 metadata 时序耦合）

**#17 MCP 渲染微妙之处（`knownTools.tsx:215`）：**
- `knownTools.tsx:215` 给 MCP namespace 设了 `minimal=true`——意图是 chip 形态
- 但**只对 enumerated 的 MCP 工具生效**；30+ 个 Playwright 子工具大多未注册
- 未注册的 MCP 工具走 `GenericToolPreview` verbose fallback（这是我们截图看到的 INPUT/OUTPUT 块）
- 修复最小代价：给 `mcp__*` 加 wildcard 匹配，让所有未 enumerated 的 MCP 默认 minimal

**架构层面的修复路径合并：** Skill (#16) + 未注册 MCP (#17) 都是 `GenericToolPreview` fallback 太 verbose 的同源问题。修 `GenericToolPreview` 默认行为为 chip-like（仅 icon + 工具名），就同时治了两个 bug。Command (#18) 是不同根因（metadata rehydration），需要单独修。

---

### 5.4: Claude 对工具调用的反馈

**总体：** 24 个不同工具实际触发（含 multi-Edit 堆叠、Skill、MCP、Subagent），渲染基础能力强，但工具卡片层级缺乏一致的"复杂度分层"策略。

**渲染策略不一致表（核心问题）：**

| 工具类别 | 当前渲染 | 期望渲染 |
|---------|---------|---------|
| 简单"操作型"（CronDelete） | 紧凑 chip | ✓ 维持 |
| 复杂"返回型"（Bash, Read, Edit） | 内联结果 + 行号/diff | ✓ 维持 |
| Subagent | chip + 子工具摘要 + sidebar push | ✓ 维持（这是其他工具的目标参考） |
| **Skill** | 整个 skill prompt 当 markdown 注入对话流 | ✗ → **subagent chip 形态，但无子摘要、无 sidebar**（按用户 5.2 #12 + #13 ） |
| **Command（历史消息）** | 空 dropdown | ✗ → 同 Skill |
| **MCP（如 Playwright）** | INPUT/OUTPUT 默认展开 | ✗ → CronDelete chip，点击展开 |
| **Zero-arg（CronList）** | chip + 字面 `{}` | ✗ → chip 不显示 `{}` |

**根本架构问题：** 工具卡片渲染组件没有按工具类型分发的清晰策略。Skill、MCP namespace、Command envelope 都误走了 "verbose 渲染" 分支。

**修复路径建议：** 把分发逻辑明确化为 4 个层级：
1. **不显示型**（仅图标 + 名）：Skill, Command, zero-arg tools
2. **紧凑型**（chip + 简短结果）：CronCreate/Delete, simple Bash
3. **内联结果型**（chip + 结构化返回值）：Read, Edit, WebFetch, WebSearch
4. **Subagent 型**（chip + 子工具摘要 + sidebar push）：Agent

Skill 和 Command 应归入 (1)。MCP 默认应是 (2) 或 (3)，可由用户展开。

**积极发现：**
- Hook 拒绝渲染（红错误条 + 完整拒绝原因）很到位
- 后台任务（`run_in_background` + `task-notification`）状态流清晰
- AskUserQuestion 多 Q 堆叠 + 多选/单选都正常
- 多 Edit diff 在垂直流里清晰可读
- 用户附件渲染好

**Orchestrator gate 副作用观察：** "连续相同工具名第 2 次阻塞" 限制使得多 Edit 工作流必须在每次 Edit 之间插入其他工具调用（典型用 Read 验证）。从工程上其实**强制每次改动后 verify** 是好习惯，但纯内部"批量改" use case 会感到摩擦。

**未触发但值得了解的工具：** `NotebookEdit / TaskStop / TaskOutput / ScheduleWakeup / EnterWorktree / Google Drive auth / 25+ Playwright 子工具 / Plan mode（被 hook 永久禁用）`。
