<!-- AUTO-GENERATED VIEW for orchestrator | source: docs/dev/specs/spec-20260506-203755.md | extracted: 2026-05-06T22:30:00Z -->

# orchestrator view of spec-20260506-203755

**Monolith**: docs/dev/specs/spec-20260506-203755.md

---

## Role Mandate

> # Spec: happy-app rendering & tool-call audit — 17 bugs catalogued + verbatim user feedback + Claude's rendering/tool-call analysis

---

## Pipeline Workflow

**架构层面的修复路径合并：** Skill (#16) + 未注册 MCP (#17) 都是 `GenericToolPreview` fallback 太 verbose 的同源问题。修 `GenericToolPreview` 默认行为为 chip-like（仅 icon + 工具名），就同时治了两个 bug。Command (#18) 是不同根因（metadata rehydration），需要单独修。

**修复路径建议：** 把分发逻辑明确化为 4 个层级：
1. **不显示型**（仅图标 + 名）：Skill, Command, zero-arg tools
2. **紧凑型**（chip + 简短结果）：CronCreate/Delete, simple Bash
3. **内联结果型**（chip + 结构化返回值）：Read, Edit, WebFetch, WebSearch
4. **Subagent 型**（chip + 子工具摘要 + sidebar push）：Agent

Skill 和 Command 应归入 (1)。MCP 默认应是 (2) 或 (3)，可由用户展开。

---

## Hard Rules Relevant to Orchestrator

**Pipeline**: <pipeline_index>
**Session**: <session_id>
**Created**: 2026-05-06T20:37:55+00:00

**建议修复优先级（按影响人数 × 严重度排序）：**

| 优先级 | Bugs | 理由 |
|--------|------|------|
| **P0**（影响所有日常阅读） | #5/5b/10/11/12/13 inline parser 回归群 | 同源；同时影响所有用户的所有消息 |
| **P0**（手机用户立即可见） | #4 宽 table 污染 | 手机用户高频遇到 |
| **P1**（误导） | #2/#3 上下文容量 | 数字撒谎 + 用户原始 4/24 需求未实现 |
| **P1**（视觉污染） | #16/#17 工具卡片渲染 | 影响所有工具调用的视觉密度 |
| **P2**（功能缺失） | #1/#6/#7 mermaid + #9 HTML + #14 preview | 单点失败 |
| **P3**（小众） | #8 mhchem + #15 zero-arg `{}` | 边缘情况 |
