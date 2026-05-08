<!-- AUTO-GENERATED VIEW for ui-specialist | source: docs/dev/specs/spec-20260506-203755.md | extracted: 2026-05-06T22:30:00Z -->

# ui-specialist view of spec-20260506-203755

**Monolith**: docs/dev/specs/spec-20260506-203755.md
**Extraction**: ui-specialist scope — Section 5.3 visual rendering analysis (overall + strengths + weaknesses)

---

## Role Mandate

> 表格的横向 scrollbar 已经做对了——这是 mermaid 应该参考的修复目标

---

### 5.3: Claude 对图形渲染的反馈

**总体：** 渲染基础能力 ~70% 工作良好，30% 存在 bug 或缺失。失败模式高度集中——两个文件（`parseMarkdownBlock.ts` + `MermaidRenderer.tsx`）+ 一个布局父容器（手机断点的 message bubble），其余分散。

**隐性强项（应保护，作为基线参考）：**
- 表格的横向 scrollbar 已经做对了——这是 mermaid 应该参考的修复目标
- code block 的横向 scrollbar 同样工作
- KaTeX 基础数学全部正常
- 大部分 mermaid 类型正常（17 种里 14 种 OK）
- 嵌套无序列表 + 列表内 code block 正确
- 用户附件渲染（缩略图 + `@/tmp/...` 路径）

**隐性弱项（未列入 17 bug 但值得标记）：**
- KaTeX 不识别 `\(...\)` / `\[...\]` 替代分隔符（仅 `$...$` 和 `$$...$$`）
- Mermaid 失败诊断信息硬编码为 "Timeline" 不论实际类型——给排错增加难度
- 渲染失败的降级策略不一致：HTML inline 失败 = 字面输出，markdown image 失败 = 字面输出，mermaid 失败 = 友好错误卡片。三者应统一选择降级策略
- 表格内不解析 inline markdown 是高频限制——若不实现，至少应在文档明确声明
