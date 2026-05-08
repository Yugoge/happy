<!-- AUTO-GENERATED VIEW for qa | source: docs/dev/specs/spec-20260506-203755.md | extracted: 2026-05-06T22:30:00Z -->

# qa view of spec-20260506-203755

**Monolith**: docs/dev/specs/spec-20260506-203755.md
**Extraction**: qa scope — audit overview + all 6 subsystem bug tables + confirmed-working baseline + Section 5.2 verbatim user feedback

---

## Role Mandate

> Audit conducted 2026-05-06 by exhaustively triggering happy-app's rendering pipeline (markdown, mermaid, LaTeX, HTML inline, tool-call cards) and 24 distinct tool calls in a single session, then user-screenshotting each rendering for visual verification. **17 distinct bugs** found across 6 subsystems. Three subsystems share single-file root causes; the remaining three each touch one component.

---

## Bug catalog (acceptance targets)

Audit conducted 2026-05-06 by exhaustively triggering happy-app's rendering pipeline (markdown, mermaid, LaTeX, HTML inline, tool-call cards) and 24 distinct tool calls in a single session, then user-screenshotting each rendering for visual verification. **17 distinct bugs** found across 6 subsystems. Three subsystems share single-file root causes; the remaining three each touch one component.

#### Subsystem A: Markdown parser — `packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts` + `parseMarkdownSpans.ts`

7 bugs concentrated here. **Git status shows `M` on these two files** — likely an in-progress parser rewrite that introduced regressions:

| # | Bug | Symptom |
|---|-----|---------|
| 5 | `***bold-italic***` 后 italic 状态泄漏 | After malformed `***`, the rest of the inline line stays in italic mode. `~~strike~~`, `` `code` ``, `[link](url)` all fail to parse — markers shown literally |
| 5b | 表格 cell 不解析 inline markdown | Backticks/asterisks shown literally inside table cells |
| 10 | 引用式链接 `[text][ref]` 不解析 | Literal output, ref definitions also literal |
| 11 | 脚注 `[^1]` 不解析 | Literal output |
| 12 | 转义字符 `\*` 不工作 | `\*literal\*` still triggers italic |
| 13 | 嵌套有序列表层级错乱 | Inner ordered list numbering resets, outer list breaks |
| (related) | Setext H1/H2, 4-space indented code, `~~~` fences, image syntax `![alt](url)`, `***`/`___` HR all not supported | Likely same parser scope |

#### Subsystem B: Mermaid — `packages/happy-app/sources/components/markdown/MermaidRenderer.tsx`

| # | Bug | Symptom |
|---|-----|---------|
| 1 | 复杂 mermaid 等比缩到字糊（无 scrollbar） | Wide diagrams scaled to fit viewport, text becomes unreadable. Code blocks and tables already use horizontal scrollbar — mermaid should match that baseline |
| 6 | `timeline / erDiagram / quadrantChart` 渲染失败 | Other types (`pie / gantt / journey / mindmap / classDiagram / gitGraph / requirementDiagram`) verified working |
| 7 | 错误消息硬编码 "Timeline diagram could not be rendered" | Confirmed at `MermaidRenderer.tsx:87` via subagent. ER and quadrant chart failures all show "Timeline" — wrong label always |

#### Subsystem C: Context-window UI — `modelModeOptions.ts` + `AgentInput.tsx`

| # | Bug | Symptom |
|---|-----|---------|
| 2 | `92% left` 按 1M 算 | `getDefaultModelContextWindow` returns 1_000_000 for Claude default since 4/24 spec change. Opus 4.7 actually supports 1M but charges premium >200K — denominator is technically defensible but misleading without explicit UI signal |
| 3 | 手动切换上下文容量 UI 缺失 | User originally requested 4/24; never implemented |

#### Subsystem D: Mobile layout — message bubble flex container

| # | Bug | Symptom |
|---|-----|---------|
| 4 | 手机 viewport 下宽 table 污染兄弟节点宽度 | Wide table reverse-pushes parent flex container width, sibling paragraphs/code overflow viewport. Classic missing `min-width: 0` on a flex chain |

#### Subsystem E: Tool-call card rendering — dispatch logic

| # | Bug | Symptom |
|---|-----|---------|
| 14 | `AskUserQuestion` `preview` 字段不渲染 | Selected option highlighted but no preview content displayed |
| 15 | 工具卡片对 zero-arg 工具显示字面 `{}` | E.g. `CronList` card shows literal `{}` for empty params |
| 16+18 (merged) | Skill 和历史 Command 渲染错位 | Skill renders entire skill prompt body as user-visible markdown content. Historical Command messages render as broken empty dropdown after Claude Code restart. **Both should match subagent rendering**: title chip in main flow, click → right sidebar — but Command/Skill **without** child-tool summary or sidebar push (per user clarification) |
| 17 | MCP 工具 INPUT/OUTPUT 默认展开 | Should be CronDelete-compact (icon + name) by default |

#### Subsystem F: LaTeX + HTML inline

| # | Bug | Symptom |
|---|-----|---------|
| 8 | LaTeX `\ce` (mhchem) 不支持 | Chemistry formulas show as literal `\ce{...}`. KaTeX missing mhchem extension |
| 9 | HTML inline 元素几乎全失效 | `<mark> <sub> <sup> <abbr> <details>` all literal. Only `<kbd>` works (has dedicated style) |

#### Confirmed-working baseline (for reference during fixes)

- 表格横向 scrollbar (this is the baseline mermaid should match)
- code block 横向 scrollbar
- KaTeX 基础数学（`$...$`, `$$...$$`, aligned, cases, integrals, matrices）
- 大部分 mermaid 类型（pie, gantt, journey, mindmap, classDiagram, gitGraph, requirementDiagram）
- 自动链接（裸 URL、尖括号）
- 硬换行（两空格 / 反斜杠）
- `<kbd>` 专门样式
- 嵌套混合无序列表 + 列表内 code block
- AskUserQuestion 多 Q 堆叠 + 单/多选
- Hook 拒绝（红错误条 + 完整原因）
- 后台任务（`run_in_background` + `task-notification`）
- 多 Edit diff 堆叠（须用 Read 隔开以绕 orchestrator gate）

---

### 5.2: 用户在本次对话中的关键反馈（verbatim quotes，按时间顺序）

1. **Mermaid 缩放 → scrollbar 期望：**
   > mermaid过于复杂的话会导致无法渲染，所以我希望mermaid加入一个和其他渲染一样的默认的scrollbar，默认使用同一个缩放，高度可以占用对话高度，但是宽度需要用scrollbar，这样就不会因为过于复杂而渲染失败了。

2. **Mermaid 实际表现修正：**
   > 没有渲染失败，就是显示很小

3. **Table 行为修正（纠正 Claude 的误判）：**
   > table有横向滚动条，你看错了

4. **上下文容量显示与手动切换：**
   > 目前的默认模型不是1M，但是这里显示的是1M的context容量。此外我上次提出在happy web应该可以手动切换容量的

5. **手机端溢出诊断：**
   > 手机端这种情况只有在出现了超级宽table的时候才会出现。表格自身还是宽度合适，但是其他内容会溢出

6. **Inline parser 回归观察 + 用户假设：**
   > 表格内部没有markdown字体格式渲染，比如粗体等，然后就是删除线为什么这么显示失败？我记得删除线之前没有问题的啊？超链接也显示失败了？是因为被转义成了斜体？

7. **Mermaid 失败摘要（配 7 张失败截图）：**
   > 看吧。出现了这么多问题。自己阅读总结

8. **AskUserQuestion preview / Markdown 形态裁定：**
   > 预览的没有任何不同。其他的都看起来正常。然后给我展示：还可以触发但不安全/不实用的工具

9. **CronList 多余 `{}` 观察：**
   > 一样的这里有一个多余的括号。然后继续触发剩下的工具

10. **Skill / MCP 渲染错位裁定：**
    > 把skill全文渲染出来了，大错特错。把mcp input output渲染出来了，大错特错。正确的格式应该是这个crondelete的样子

11. **历史 Command 渲染问题 + 修复倾向征询：**
    > 同时历史消息中的command会被渲染成这个样子（运行中的不会，只有claude code重启才会这样渲染），这是过去一次command渲染支持失败的遗留（直到现在都不支持。但是我们先把错误的删除？还是说你有更好的意见？

12. **Skill / Command 目标渲染 = subagent 样式（用户原始设计意图）：**
    > 不，我最开始的想法是和目前的subagent一样渲染，无论是历史的还是现在的。skill也是和现在的subagent一样的渲染方式

13. **Subagent 渲染细节修正（纠正 Claude 误读）：**
    > 可展开看详情。无论 live 还是 historical 一致？不是的。你再读一读现在的subagent渲染
    >
    > 是的，除此之外还有一个小详情展示。但是command和skill不需要详情展示
