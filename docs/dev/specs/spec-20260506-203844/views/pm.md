<!-- AUTO-GENERATED VIEW for pm | source: docs/dev/specs/spec-20260506-203844.md | extracted: 2026-05-06T20:47:19Z -->

# pm view of spec-20260506-203844

**Monolith**: docs/dev/specs/spec-20260506-203844.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> <!-- WHO WRITES: PM (autonomous mode) or User (user-spec mode) or BA (if Section 1 empty and BA has context) -->
> <!-- WHAT: Screenshot path + text description of the current state BEFORE any fix attempt. -->
> <!-- This establishes the baseline so later cycles can compare. -->
>
> <!-- WHO WRITES: PM-Retro -->
> <!-- WHAT: Issue-specific traps, warnings, and things to watch out for in the next cycle/session. -->
> <!-- Example: "This file is imported by 12 components -- changes here cascade widely" -->

---

# Spec: Happy 工具调用与非文本/图形渲染问题超级清单

**Pipeline**: happy-tool-rendering-ui
**Session**: current-happy-dev-tool-rendering-investigation
**Created**: 2026-05-06T20:38:44Z

---

## Section 8: Attention Notes

<!-- WHO WRITES: PM-Retro -->
<!-- WHAT: Issue-specific traps, warnings, and things to watch out for in the next cycle/session. -->
<!-- Example: "This file is imported by 12 components -- changes here cascade widely" -->

- 不要把工具自身返回的富输出等同于 Happy UI 中用户实际看到的输出。
- 不要只依赖 bundle grep、unit test、tool output；UI 修复必须用 live browser 渲染验证。
- 用户明确要求的是“我面前看到什么”，所以验收必须以用户视角/Happy 截图为准。
- 旧消息不会自动获得新 mapper 产生的 preview；测试应触发新工具调用。
- subagent 内部工具目前未泄漏，不要误修成隐藏所有 subagent 信息；应修的是主控工具卡状态与合并展示。
- `request_user_input` 当前 Default mode 不可用，不应列为渲染失败而应列为模式限制。
- `/root/bin/happy-restart.sh` 是生产全量脚本，不能用于当前 dev UI 修复。
- 所有 dev UI 验证必须使用 `dev.life-ai.app`、`localhost:8097`、`api-dev.life-ai.app`、`localhost:3005`，不得访问 production。
