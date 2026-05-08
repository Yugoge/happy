<!-- AUTO-GENERATED VIEW for pm | source: docs/dev/specs/spec-20260506-203755.md | extracted: 2026-05-06T22:30:00Z -->

# pm view of spec-20260506-203755

**Monolith**: docs/dev/specs/spec-20260506-203755.md
**Extraction**: pm scope — Section 5.3 priority table (P0/P1/P2/P3 ranking by bug ID)

---

## Role Mandate

> **建议修复优先级（按影响人数 × 严重度排序）：**

---

**建议修复优先级（按影响人数 × 严重度排序）：**

| 优先级 | Bugs | 理由 |
|--------|------|------|
| **P0**（影响所有日常阅读） | #5/5b/10/11/12/13 inline parser 回归群 | 同源；同时影响所有用户的所有消息 |
| **P0**（手机用户立即可见） | #4 宽 table 污染 | 手机用户高频遇到 |
| **P1**（误导） | #2/#3 上下文容量 | 数字撒谎 + 用户原始 4/24 需求未实现 |
| **P1**（视觉污染） | #16/#17 工具卡片渲染 | 影响所有工具调用的视觉密度 |
| **P2**（功能缺失） | #1/#6/#7 mermaid + #9 HTML + #14 preview | 单点失败 |
| **P3**（小众） | #8 mhchem + #15 zero-arg `{}` | 边缘情况 |
