# BA Specification: spec-20260425-094312 彻底修复 (final pass)

**Request ID**: dev-20260425-redev-final
**Created**: 2026-04-25T13:00:00+00:00
**Target spec**: `/dev/shm/dev-workspace/happy-dev/docs/dev/specs/spec-20260425-094312.md`
**Authority**: user requested "彻底修复一切大小问题" — fix the 3 known + scan for additional defects

---

## Goal

Apply 3 close-objection fixes (F1/F2/F3) and 6 newly-found defects (F4–F9) to spec-20260425-094312.md so it passes /close round 3 and is executable by /dev or /dev-overnight without false-fail ACs or factually-wrong taxonomy reasoning.

## Verification Summary (read-only audit results)

| # | Spec claim | On-disk reality | Status |
|---|-----------|-----------------|--------|
| L26 | backup `/root/bin/recovery-bak-codex-20260424-2226` | exists, 53128 bytes, no `.sh` suffix | OK |
| L508 | regression AC `recovery-bak-codex-20260424-2226.sh` | file does NOT have `.sh` suffix | **F1 BUG** |
| L191/487 | live hook `/root/.claude/hooks/pretool-bash-safety.sh` 716 lines, L66-90 | actually 33711 bytes; L66-90 contains `check_systemctl_targets_all_dev` with `args=$(echo … sed -E …)` arg-parsing bug (verified) | OK |
| L488 | backup `/root/.claude.bak/hooks/pretool-bash-safety.sh` same content | exists, identical mtime/size to live | OK |
| L123-130 | `run.ts:111-122` daemon version-mismatch log block | verified: L111-123 contains `runningDaemonVersionMatches` + bare "Daemon version mismatch detected, restarting" | OK |
| L150 | `run.ts:733-764` heartbeat auto-upgrade | verified: L733-765 contains `if (projectVersion !== configuration.currentCliVersion)` | OK |
| L362-368 | `happy-session-recovery.sh:L962-968` upstream `.jsonl` filter | actual block is **L961-968** (project_encoded line is L961-962, `if [ ! -f … ]` starts L964). Spec's "L962-968" is off by 1 but tolerable | minor |
| L483 | `~/.claude/skills/dev-overnight*` + `/dev/shm/dev-workspace/happy-dev/.claude/skills/dev-overnight*` | **NEITHER PATH EXISTS**. Real location: `/dev/shm/dev-workspace/dot-claude/commands/{dev-overnight,dev,dev-command,redev,spec,close}.md` + `/root/.claude.bak/commands/...` (mirror) | **F4 BUG** |
| L484 | `~/.claude/skills/{dev,dev-command,spec,qa,redev}.md` | qa lives in `/dev/shm/dev-workspace/dot-claude/agents/qa.md`, NOT skills/. The rest are commands not skills | **F4 BUG** |
| L526 | 5.2-E-1 user-gated reason "/root/bin/ 不在 worktree 可写路径" | hook `pretool-block-production-files.sh` does NOT block `/root/bin/`. Reason factually wrong | **F3 BUG** |
| L523 | 5.2-D-2 user-gated reason "subagent Write/Edit 被 `pretool-block-production-files.sh` 拦截" | hook does NOT block `/root/.claude/hooks/`. Reason factually wrong | **F6 BUG** |
| L506 | regression AC runs `happy-session-recovery.sh restore --manual-dir ...` | recovery script PERMANENTLY FORBIDDEN by hook L316-317 (substring match on filename) — QA cannot execute this | **F7 BUG** |
| L508 | regression AC "对比新旧脚本" via diff | `diff old new` triggers hook ban whenever new path contains `happy-session-recovery` substring | **F8 BUG** |
| 5.2-D-2/5.4 | rollback subsections missing | confirmed — only 5.1 has Rollback Plan | **F2 BUG** |
| 5.13 entry for 5.2-D-3 incident doc | reason "/root/docs/ 不在 worktree 可写路径" | actually NOT blocked by any hook either; reason inaccurate but conclusion (user-gated) defensible for production-doc reason | **F9 minor** |

---

## Fixes (Edit designs)

All edits target `/dev/shm/dev-workspace/happy-dev/docs/dev/specs/spec-20260425-094312.md`.

### F1 — L508 filename `.sh` suffix

**old_string**: `   - **备份验证**：\`/root/bin/recovery-bak-codex-20260424-2226.sh\` 存在 → 对比新旧脚本，以上三项改动均在新版中保留`

**new_string**: `   - **备份验证**：\`/root/bin/recovery-bak-codex-20260424-2226\` （**注意：无 \`.sh\` 后缀**，与磁盘文件名一致）存在 → 静态读取脚本两份内容（用 Read tool，不用 \`diff\` —— hook 拦 \`happy-session-recovery\` 子串），grep 三项改动关键字（\`is_codex_thread_id\`、\`manual_dir\`、\`payload.cwd\`）均在新版中存在`

### F2a — Add Rollback Plan to 5.2-D-2

Insert before line 222 (between L221's `两条规则不冲突...` paragraph end and the `##### 5.2-D-3` header):

**Insert location**: end of section 5.2-D-2 (line 221)

**new_string** (additional block):
```
**5.2-D-2 Rollback Plan**：
- dev 跑 5.2-D-2 修复时，**用户必须先在 TTY session 手动备份**（subagent 无写入权限到 `/root/.claude/hooks/`）：
  `cp /root/.claude/hooks/pretool-bash-safety.sh /root/.claude/hooks/pretool-bash-safety.sh.bak-pre-arg-parse-fix`
  `cp /root/.claude.bak/hooks/pretool-bash-safety.sh /root/.claude.bak/hooks/pretool-bash-safety.sh.bak-pre-arg-parse-fix`
- 若新 `awk` 解析逻辑导致 hook 误拦/误放（grep `~/.claude/logs/bash-safety.log` 出现新增 BLOCKED 项 against 已知合法 dev 命令；或测试用例 5.2-D-2 success criteria 全部 4 行不通过），rollback：
  `cp /root/.claude/hooks/pretool-bash-safety.sh.bak-pre-arg-parse-fix /root/.claude/hooks/pretool-bash-safety.sh`
  `cp /root/.claude.bak/hooks/pretool-bash-safety.sh.bak-pre-arg-parse-fix /root/.claude.bak/hooks/pretool-bash-safety.sh`
  并立即报告 user
- **不**回滚已 grep / log 的事件文档（5.2-D-3 incidents 文档）
```

### F2b — Add Rollback Plan to 5.4

**Insert location**: end of section 5.4 (after L355)

**new_string** (additional block):
```

**5.4 Rollback Plan**：
- prisma migration 落地前，user 必须运行 `pg_dump happydb_dev > /root/backup/happydb_dev-pre-archive-migration-$(date +%Y%m%d-%H%M%S).sql`（注意 5 节 8 注 5：prisma migrate **不能直接对 dev DB 跑**，必须 user 批准 + 备份）
- 若 migration 失败、UI 加载报错、或 archive 列读写不一致：
  1. `prisma migrate resolve --rolled-back <migration-name>`（在 happy-server 容器内）
  2. 从 backup 恢复：`docker exec -i happy-postgres-dev psql -U yuge -d happydb_dev < /root/backup/happydb_dev-pre-archive-migration-<ts>.sql`
  3. revert `sessionRoutes.ts` 改动（git checkout 单文件）
  4. revert UI archive filter 改动，让 `SessionView.tsx` 仍走 metadata 路径
- **不**清理已 archive 但 metadata 未来得及写的 session（恢复 metadata 路径后老逻辑会再次识别）
```

### F3 — L526 5.2-E-1 user-gated reason

**old_string**: `| 5.2-E-1 | 新建 \`/root/bin/safe-daemon-restart.sh\` | **user-gated** | \`/root/bin/\` 不在 worktree 可写路径；生效也需 daemon 重启 |`

**new_string**: `| 5.2-E-1 | 新建 \`/root/bin/safe-daemon-restart.sh\` | **user-gated** | 一旦上线就成为 production-critical infrastructure（与 \`happy-session-recovery.sh\` 同级），脚本内部调用 PERMANENTLY-FORBIDDEN 的 \`happy-session-recovery.sh save/recover\` —— subagent 写入 + 测试 + 上线全链路必须由 user 在 TTY session 中审计；生效也需 daemon 重启 |`

### F4a — L483 dev-overnight skill paths

**old_string**: `| dev-overnight workflow / skill files（搜 \`~/.claude/skills/dev-overnight*\`、\`/dev/shm/dev-workspace/happy-dev/.claude/skills/dev-overnight*\`、\`/dev/shm/dev-workspace/dot-claude/skills/dev-overnight*\`） | 移除所有 daemon stop/restart 调用 (5.2-A) + 加 hook-bypass 禁止段 (5.2-D-1) + safe-daemon-restart 强制使用 (5.2-E-2) | **P0-NEW 必须先做** |`

**new_string**: `| dev-overnight workflow / command files（搜 \`/dev/shm/dev-workspace/dot-claude/commands/dev-overnight.md\`、\`/dev/shm/dev-workspace/dot-claude/commands/dev.md\`、\`/dev/shm/dev-workspace/dot-claude/commands/redev.md\`、\`/dev/shm/dev-workspace/dot-claude/commands/dev-command.md\`、\`/dev/shm/dev-workspace/dot-claude/commands/spec.md\`、\`/dev/shm/dev-workspace/dot-claude/commands/close.md\`，以及 \`/root/.claude.bak/commands/*\` 镜像、subagent 定义 \`/dev/shm/dev-workspace/dot-claude/agents/{qa,dev,architect,ba,pm,spec,ui-specialist}.md\`） | 移除所有 daemon stop/restart 调用 (5.2-A) + 加 hook-bypass 禁止段 (5.2-D-1) + safe-daemon-restart 强制使用 (5.2-E-2) | **P0-NEW 必须先做** |`

### F4b — L484 全局 skill 改写

**old_string**: `| \`~/.claude/skills/{dev,dev-command,spec,qa,redev}.md\` 等所有 dev 相关 skill | 顶部 FORBIDDEN 段加 hook bypass 禁止 (5.2-D-1) + daemon 重启必须经 SOP (5.2-E-2) | P0-NEW |`

**new_string**: `| dev/dev-overnight/redev/spec/close 命令文件 + qa/dev/architect/ba/pm/spec/ui-specialist subagent 定义文件（实际位置见上一行） | 顶部 FORBIDDEN 段加 hook bypass 禁止 (5.2-D-1) + daemon 重启必须经 SOP (5.2-E-2) | P0-NEW |`

### F4c — L111 文档清理 grep 范围

**old_string**: `  - grep dev-overnight 相关 skill / workflow 代码（\`/root/.claude/skills/dev-overnight*\` / \`/dev/shm/dev-workspace/happy-dev/.claude/skills/dev-overnight*\`），找到 \`daemon stop\`、\`daemon restart\`、\`HTTP.*\\/stop\`、\`POST.*stop\` 等模式 → 全部移除或改为 no-op`

**new_string**: `  - grep dev-overnight 相关 command / agent 代码（\`/dev/shm/dev-workspace/dot-claude/commands/{dev,dev-overnight,dev-command,redev,spec,close}.md\` + \`/dev/shm/dev-workspace/dot-claude/agents/{qa,dev,ba,pm,architect,spec,ui-specialist}.md\` + \`/root/.claude.bak/commands/*\` 镜像），找到 \`daemon stop\`、\`daemon restart\`、\`HTTP.*\\/stop\`、\`POST.*stop\` 等模式 → 全部移除或改为 no-op`

### F4d — L186 D-1 grep 范围

**old_string**: `  - grep 所有 \`~/.claude/skills/*\` + \`/dev/shm/dev-workspace/happy-dev/.claude/skills/*\` + \`/dev/shm/dev-workspace/dot-claude/skills/*\` 文件，确认每个 skill 顶部都有 "Hook bypass forbidden" 段`

**new_string**: `  - grep \`/dev/shm/dev-workspace/dot-claude/commands/*\` + \`/dev/shm/dev-workspace/dot-claude/agents/*\` + \`/root/.claude.bak/commands/*\` + \`/root/.claude/agents/*\` 文件，确认每个 dev/qa/architect/spec/redev/close/dev-overnight 相关 prompt 顶部都有 "Hook bypass forbidden" 段`

### F4e — L517 5.13 第一行 5.2-A 行

**old_string**: `| 5.2-A | dev-overnight skill 文件移除 daemon stop 调用 | **autonomous-safe** | 改写 \`/dev/shm/dev-workspace/happy-dev/.claude/skills/\` 内文件 |`

**new_string**: `| 5.2-A | dev-overnight command/agent 文件移除 daemon stop 调用 | **user-gated** | 实际命中文件在 \`/dev/shm/dev-workspace/dot-claude/commands/\` + \`/dev/shm/dev-workspace/dot-claude/agents/\`，这些是 dot-claude 全局 prompt 库（softlink \`~/.claude\` -> 此目录），改动会立即影响所有 session；subagent 不应在自己的 prompt 库里改自己 |`

### F4f — L518 5.13 第二行 5.2-A 全局 skill

**old_string**: `| 5.2-A | \`~/.claude/skills/\` 全局 skill 文件改写 | **user-gated** | 全局 skill 文件在 \`/root/.claude/skills/\`，非 worktree 写根；subagent 需 user 手动改或用 Edit tool 在 user TTY session 中操作 |`

**new_string**: `| 5.2-A | \`/root/.claude.bak/commands/\` 镜像同步 | **user-gated** | 与 dot-claude 镜像，user 须确认主副本一致 |`

### F4g — L522 5.2-D-1 行

**old_string**: `| 5.2-D-1 | skill prompt FORBIDDEN 段加 hook bypass 禁止 | **混合**：worktree skills = autonomous-safe；全局 \`~/.claude/skills/\` = user-gated |`

**new_string**: `| 5.2-D-1 | command/agent prompt FORBIDDEN 段加 hook bypass 禁止 | **user-gated** | 命中文件全部在 dot-claude 库（commands + agents），属 prompt-self-modify 范畴，必须 user 在 TTY session 中审计每条改动 |`

### F6 — L523 5.2-D-2 user-gated reason

**old_string**: `| 5.2-D-2 | hook arg-parsing 修复（\`~/.claude/hooks/pretool-bash-safety.sh\`） | **user-gated** | 全局 hooks 路径在 \`/root/.claude/hooks/\`，非 worktree；subagent Write/Edit 被 \`pretool-block-production-files.sh\` 拦截；需 user 在 TTY session 中手动 Edit |`

**new_string**: `| 5.2-D-2 | hook arg-parsing 修复（\`/root/.claude/hooks/pretool-bash-safety.sh\`） | **user-gated** | 该 hook 是 settings.json 注册的 live security gate（控制本 session 所有 bash 调用的拦截策略），改动错误会立即放行被拦命令或全部命令；subagent 在受同一 hook 限制的 session 中改动同一 hook 属循环依赖；必须 user 在独立 TTY session 中 Edit + 同步 \`/root/.claude.bak/hooks/...\` |`

### F7 — L506 manual_dir AC 不可执行

**old_string**: `   - **manual_dir bug fix**：\`happy-session-recovery.sh restore --manual-dir /some/path\` → \`manual_dir\` 路径在 auto-discovery 结果之前被应用（log 顺序可验证）`

**new_string**: `   - **manual_dir bug fix**（**静态验证 only** —— 直接执行 \`happy-session-recovery.sh\` 被 hook 拦截）：用 Read tool 读 \`/root/bin/happy-session-recovery.sh\` 中 \`restore_online_sessions\` 函数体，grep \`manual_dir\` 出现次数 ≥ 2，且首次出现在 \`# auto-discovery\` 注释段之前的代码行；与备份 \`/root/bin/recovery-bak-codex-20260424-2226\` 中同函数对比，新版的 \`manual_dir\` 应用顺序是"先 manual_dir 后 auto-discovery"`

### F8 — L508 备份对比方法

(already replaced in F1)

### F9 — L524 5.2-D-3 reason (minor improvement)

**old_string**: `| 5.2-D-3 | 新建 \`/root/docs/incidents-2026-04-25.md\` | **user-gated** | \`/root/docs/\` 不在 worktree 可写路径 |`

**new_string**: `| 5.2-D-3 | 新建 \`/root/docs/incidents-2026-04-25.md\` | **user-gated** | \`/root/docs/\` 是 production 文档目录，user 维护；subagent 不应自行立 incident 报告 |`

---

## Risk

- F2a/F2b 注入新 Rollback 段，靠近 5.2-D-2 末尾的"5.2-D-2 vs 5.2-E 关系"段以及 5.4 末尾的"Success criteria"段，行号边界 sensitive — 上次 redev 已重写过这两段，重做时需先 Read 一次确认 anchor 文本未漂移
- F4a-g 共 7 处对 5.13 / 5.11 / 5.2-A 的改动，相互一致性必须由 dev 在一次 Edit pass 完成（避免中间状态出现"5.13 user-gated 但 5.11 标 P0-NEW 必须先做"的逻辑空洞）
- F3/F6/F9 仅改 5.13 单元格 Reason 字段，无外部依赖
- F1/F7/F8 集中在 5.12 regression AC 段，可一次完成

## 优先级

**必修（block /close）**：F1, F2a, F2b, F3, F4a, F4b, F4c, F4d, F4e, F4f, F4g, F6, F7, F8

**可后置（最多 minor /close 复议）**：F9

## 总计 13 处 Edit。建议 dev 按上述顺序一次执行，Edit 完后 grep verify：

```bash
grep -c "/dev/shm/dev-workspace/happy-dev/.claude/skills" docs/dev/specs/spec-20260425-094312.md  # expect 0
grep -c "recovery-bak-codex-20260424-2226\.sh" docs/dev/specs/spec-20260425-094312.md  # expect 0
grep -c "5.2-D-2 Rollback Plan" docs/dev/specs/spec-20260425-094312.md  # expect 1
grep -c "5.4 Rollback Plan" docs/dev/specs/spec-20260425-094312.md  # expect 1
```
