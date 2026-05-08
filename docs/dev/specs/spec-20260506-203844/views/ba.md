<!-- AUTO-GENERATED VIEW for ba | source: docs/dev/specs/spec-20260506-203844.md | extracted: 2026-05-06T20:47:19Z -->

# ba view of spec-20260506-203844

**Monolith**: docs/dev/specs/spec-20260506-203844.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> <!-- WHO WRITES: BA (on first analysis) -->
> <!-- WHAT: Verbatim quote from user's requirement or focus string. -->
> <!-- This is the single source of truth for what "done" means. Do not paraphrase. -->

---

### 5.3 超级清单：最终应修复/验证的全部渲染需求

#### A. 总体分类与验收

- [ ] 区分“工具执行成功”和“Happy UI 渲染成功”。
- [ ] 每个工具测试都要记录：工具名、工具输出类型、Happy 是否显示、显示位置、是否 inline、是否重复 JSON、是否状态正确。
- [ ] 对所有已调用工具给出矩阵：成功、部分成功、失败、不可用、未验证。
- [ ] 不再用“我这里工具返回了结果”替代“用户 Happy UI 看到了结果”。


---

#### K. Dev 环境与安全要求

- [ ] 不要运行 `/root/bin/happy-restart.sh` 修 dev 渲染问题。
- [ ] `/root/bin/happy-restart.sh` 是生产/全量 restart 脚本，不适用于 happy-dev。
- [ ] 不要假设 `/root/bin/safe-daemon-restart.sh` 存在；引用脚本前必须先验证。
- [ ] 如需加载 CLI mapper，优先只处理 dev daemon，并明确会影响 dev sessions。
- [ ] 所有 UI 验证必须使用 dev web/API，不访问 production。
- [ ] 触发测试会话/内容应通过正常 UI 或当前 dev session，不绕过安全规则。

