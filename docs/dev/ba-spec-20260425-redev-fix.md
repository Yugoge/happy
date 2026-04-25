# BA Spec: spec-20260425-094312 Redev Fix (9 Objections)

**Request ID**: redev-20260425-redev-fix
**Created**: 2026-04-25T10:30:00+00:00
**Target spec**: `/dev/shm/dev-workspace/happy-dev/docs/dev/specs/spec-20260425-094312.md`
**Purpose**: Revise the spec so it passes the next `/close` gate

---

## 1. Problem Inventory

| ID | Source | Verbatim objection | Severity | Resolution category |
|----|--------|--------------------|----------|---------------------|
| O1 | Codex hard | 5.2-D-2 names dead file `/root/.claude/hooks/pretool-bash-safety.sh` but live hook is at `/root/happy/.claude/hooks/pretool-bash-safety.sh:86-90` | CRITICAL — fix targets wrong file, AC can falsely PASS | **Rewrite** 5.2-D-2 with verified path |
| O2 | Codex hard | 5.2-D-2 success criteria require `systemctl restart happy-daemon-dev` to pass through hook; 5.2-E forbids direct systemctl for daemon restarts | CRITICAL — two ACs contradict | **Split** D-2 success criteria: hook-syntax correctness vs daemon-restart policy |
| O3 | Codex hard | 5.5 only adds flavor-autodetect at spawn time; `restore_online_sessions` has upstream `.jsonl` existence check (L964) that drops codex threads before spawn | CRITICAL — AC can pass without fixing the actual bug | **Rewrite** 5.5 to target the upstream filter at L962-968 |
| O4 | Codex hard | 5.6 fallback resolves to same symlink target; after `/dev/shm` wipe both paths are gone | CRITICAL — non-fix shipped as fix | **Replace** 5.6 with deferred-to-persistent-path approach |
| O5 | Codex hard | 5.2-A cleanup only greps skills/workflows; prior BA/spec artifact files still contain restart instructions | HIGH — future BA runs will re-learn wrong SOPs | **Expand** 5.2-A grep scope to `docs/dev/` artifacts |
| O6 | QA soft | Multiple ACs are user-gated (5.4, 5.2-D-3, 5.2-E-1) but spec has no taxonomy; autonomous /dev will stall or violate | HIGH — blocks autonomous execution | **Add** new Section 5.13 with autonomous-safe vs user-gated taxonomy |
| O7 | QA soft | 5.2-E (safe-daemon-restart.sh) needs HTTP /stop token from 5.2-C, but 5.2-C is ordered after 5.2-E | HIGH — chicken-and-egg ordering | **Reorder** 5.2-C before 5.2-E or split 5.2-E into v0 (no token) / v1 (token) |
| O8 | QA soft | 5.9 says "5.2-C 可后置" but also says "5.2-E 依赖 5.2-C" — contradiction | MEDIUM — confuses dev agent on ordering | **Rewrite** 5.9 ordering block to be internally consistent |
| O9 | QA soft | 5.1.2 mtime threshold undefined; 5.1 has no rollback plan; already-applied patches lack regression AC | MEDIUM — spec incomplete, dev cannot proceed autonomously | **Supplement** 5.1.2 with concrete default, add rollback section, add regression ACs |

---

## 2. Verification: O1 — Which Hook Is Actually Live?

**Finding from session investigation:**

`settings.json` (`~/.claude/settings.json`) PreToolUse Bash hooks:
```
bash "$HOME/.claude/hooks/pretool-bash-safety.sh"
```

This resolves to `/root/.claude/hooks/pretool-bash-safety.sh`.

File sizes:
- `/root/.claude/hooks/pretool-bash-safety.sh` — 716 lines (LIVE, referenced by settings.json)
- `/root/.claude.bak/hooks/pretool-bash-safety.sh` — 716 lines (identical content, backup copy)
- `/root/happy/.claude/hooks/pretool-bash-safety.sh` — 93 lines (small stub, NOT referenced by settings.json for this session)

**`check_systemctl_targets_all_dev` location in live hook:**
- `/root/.claude/hooks/pretool-bash-safety.sh` L66-90 — the function exists and is called at L407
- The arg-parsing bug (redirect/pipe tokens leaking into service-name loop) exists in the LIVE file

**Codex finding was wrong**: Codex said the live hook is at `/root/happy/.claude/hooks/...`. This is incorrect. The settings.json registration confirms `/root/.claude/hooks/pretool-bash-safety.sh` is the operative file. The function `check_systemctl_targets_all_dev` at L66-90 is real and buggy in the live file.

**Spec fix**: Keep the path as `/root/.claude/hooks/pretool-bash-safety.sh` (it is correct). Add a note that `/root/.claude.bak/hooks/pretool-bash-safety.sh` is an identical copy and must be patched in sync. Remove the false claim about `/root/happy/.claude/hooks/...`.

---

## 3. Per-Objection Edit Specifications

### 3.1 O1: Correct Hook File Path Reference

**File to edit**: `docs/dev/specs/spec-20260425-094312.md`
**Section anchor**: `##### 5.2-D-2：修复 hook 的 arg-parsing bug`

**Before** (lines 176-177 approx):
```
**bug 定位**：`/root/.claude/hooks/pretool-bash-safety.sh` L66-90 `check_systemctl_targets_all_dev`：
```

**After**:
```
**bug 定位**：`/root/.claude/hooks/pretool-bash-safety.sh` L66-90 `check_systemctl_targets_all_dev`（**此文件是 settings.json 注册的 live hook**；`/root/.claude.bak/hooks/pretool-bash-safety.sh` 是同内容的 backup，必须同步修改；`/root/happy/.claude/hooks/pretool-bash-safety.sh` 是独立 stub，不在本次修改范围）：
```

**Also update** Section 5.11 影响文件清单，hook 那行：

**Before**:
```
| `~/.claude/hooks/pretool-bash-safety.sh` | 修 `check_systemctl_targets_all_dev` 的 arg-parsing bug，遇 redirect/pipe 后停止 token 收集 (5.2-D-2) | P0-NEW |
```

**After**:
```
| `~/.claude/hooks/pretool-bash-safety.sh` (live, settings.json 注册) | 修 `check_systemctl_targets_all_dev` L66-90 的 arg-parsing bug (5.2-D-2) | P0-NEW |
| `~/.claude.bak/hooks/pretool-bash-safety.sh` (backup, must be kept in sync) | 同上，同步修改防止 backup 覆盖 | P0-NEW |
```

**Verification**: `grep -c "settings.json" docs/dev/specs/spec-20260425-094312.md` should now show the reference; `grep "claude.bak" docs/dev/specs/spec-20260425-094312.md` should return the sync note.

---

### 3.2 O2: Resolve 5.2-D-2 ↔ 5.2-E Contradiction

**Root issue**: D-2's success criteria `systemctl restart happy-daemon-dev → 通过` means the hook should ALLOW this command. But 5.2-E says subagents MUST use `safe-daemon-restart.sh` instead. These two cannot both be true simultaneously.

**Resolution design**: Split into two orthogonal concerns:

1. **D-2 is about syntax correctness only** — the bug is that redirect tokens leak into service name parsing, causing false blocks even for correctly-whitelisted dev commands. The fix is purely about parsing accuracy. The success criteria should validate that the parser identifies service names correctly, NOT that the command is ultimately allowed.

2. **The policy question** (who may call `systemctl restart happy-daemon-dev`) is governed by 5.2-E. The answer is: user TTY may call it directly (or via `safe-daemon-restart.sh`); subagents may not.

**The hook's current behavior at L405-413**: it calls `check_systemctl_targets_all_dev` which returns 0 (allow) if all service names are in the dev whitelist. So `systemctl restart happy-daemon-dev` DOES pass through the hook at L405-413. But there is ALSO a separate earlier check at the `/root/happy/.claude/hooks/...` stub (which is a simpler file). The L405-413 path in the live hook is what needs the awk fix.

**File to edit**: `docs/dev/specs/spec-20260425-094312.md`
**Section anchor**: `##### 5.2-D-2：修复 hook 的 arg-parsing bug` — Success criteria block

**Before**:
```
**Success criteria**：
- `systemctl restart happy-daemon-dev` → 通过（无 redirect 也能正确解析）
- `systemctl restart happy-daemon-dev 2>&1 | head -5` → 通过（redirect 后被忽略）
- `systemctl restart happy-server` → 拦截
- `systemctl restart happy-daemon-dev happy-server` → 拦截（多 service 任一非白名单都拦）
- `systemctl restart happy-daemon-dev && systemctl restart happy-server` → 拦截（split 后第二段非白名单）
```

**After**:
```
**Success criteria（仅验证解析正确性，政策约束见 5.2-E）**：
- `systemctl restart happy-daemon-dev` → hook `check_systemctl_targets_all_dev` 正确解析 service 名为 `happy-daemon-dev`，匹配白名单，函数返回 0（**注意：hook 不拦不代表 subagent 可以调；subagent 调用仍受 5.2-E 约束**）
- `systemctl restart happy-daemon-dev 2>&1 | head -5` → redirect 后 token 被忽略，service 名仍正确解析为 `happy-daemon-dev`，函数返回 0
- `systemctl restart happy-server` → 解析为非白名单 service，函数返回 1，命令被拦截
- `systemctl restart happy-daemon-dev happy-server` → 存在非白名单 service，函数返回 1，命令被拦截
- `systemctl restart happy-daemon-dev && systemctl restart happy-server` → split 后第二个子命令含非白名单 service，被拦截

**5.2-D-2 vs 5.2-E 关系**（必须显式写进 spec）：
- 5.2-D-2 修的是"解析正确性"——hook 不再因为 redirect/pipe 把合法的白名单命令误判为非白名单
- 5.2-E 修的是"谁有权调"——subagent 即使命令能通过 hook，仍不允许直接调 `systemctl restart happy-daemon-*`
- 两条规则不冲突：hook 允许通过 + subagent 政策禁止 = subagent 不调，user TTY 调 = 通过
```

**Verification**: `grep -A3 "5.2-D-2 vs 5.2-E 关系" docs/dev/specs/spec-20260425-094312.md` must return the relationship note.

---

### 3.3 O3: Fix 5.5 to Target Upstream .jsonl Filter

**Finding**: `restore_online_sessions` in `/root/bin/happy-session-recovery.sh` L962-968:
```bash
local project_encoded
project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
local session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
if [ ! -f "$session_file" ]; then
    log "Skip $uuid: .jsonl not found"
    total_skipped=$((total_skipped + 1))
    continue
fi
```

This check runs BEFORE the `daemon_spawn_session` call. It assumes every session has a `.jsonl` file in `~/.claude/projects/...`. Codex sessions (thread-id `019d...`) use a different project directory layout or may have no `.jsonl` at all. This drops codex UUIDs BEFORE the flavor-detection spawn logic runs.

**File to edit**: `docs/dev/specs/spec-20260425-094312.md`
**Section anchor**: `### 5.5 P2：`restore` 子命令仍是 claude-only`

**Before**:
```
### 5.5 P2：`restore` 子命令仍是 claude-only

- **现状**：`session_dirs.txt` 格式 `UUID:work_dir` 没 flavor 字段。`restore_online_sessions` 默认按 claude 处理。
- **修法**：在 `restore_online_sessions` 内对每个 UUID 调 `is_codex_thread_id`（已有 helper），自动判断 flavor 再调 `daemon_spawn_session "$home" "$work_dir" "$uuid" "$flavor"`
- **Success criteria**：
  - session_dirs.txt 同时含 claude UUID 和 codex `019d…` thread-id，restore 应分别用对的命令 spawn
  - log 中每条 spawn 显示 `flavor=claude` 或 `flavor=codex`
```

**After**:
```
### 5.5 P2：`restore` 子命令仍是 claude-only

- **现状（两层 bug）**：
  1. **上游过滤（更严重）**：`restore_online_sessions` L962-968 在 spawn 前做 `.jsonl` 存在性检查：
     ```bash
     local session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
     if [ ! -f "$session_file" ]; then
         log "Skip $uuid: .jsonl not found"
         continue
     fi
     ```
     Codex thread-id 的 session 可能无对应 `.jsonl`（或路径不同），导致被丢弃。**此上游过滤在 flavor 检测之前运行**，加 flavor-autodetect 无效。
  2. **下游 spawn 路径**：即使通过了上游过滤，`daemon_spawn_session` 当前不传 flavor 参数。

- **修法（必须按顺序）**：
  1. **先修上游过滤**：在 `.jsonl` 检查之前调 `is_codex_thread_id "$uuid"`。若为 codex flavor，跳过该 `.jsonl` 检查（codex 用 `CODEX_HOME` 路径，不是 `CLAUDE_PROJECTS_DIR`），直接进入 rollout 检查分支：
     ```bash
     # codex sessions do not have claude .jsonl files — skip the check
     if ! is_codex_thread_id "$uuid"; then
         local project_encoded
         project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
         local session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
         if [ ! -f "$session_file" ]; then
             log "Skip $uuid: .jsonl not found (claude session)"
             total_skipped=$((total_skipped + 1))
             continue
         fi
     fi
     ```
  2. **再修下游 spawn**：`daemon_spawn_session` 调用加 flavor 参数（已有 `is_codex_thread_id` helper）：
     ```bash
     local flavor="claude"
     is_codex_thread_id "$uuid" && flavor="codex"
     if daemon_spawn_session "$home" "$work_dir" "$uuid" "$flavor"; then
     ```

- **Success criteria**：
  - session_dirs.txt 同时含 claude UUID 和 codex `019d…` thread-id
  - codex UUID 不因 `.jsonl not found` 被跳过（log 不出现 `Skip <codex-uuid>: .jsonl not found`）
  - restore 后 log 中每条 spawn 显示 `flavor=claude` 或 `flavor=codex`
  - 现有 claude session restore 行为不变（仍做 .jsonl 检查）
```

**Verification**: `grep -c "上游过滤" docs/dev/specs/spec-20260425-094312.md` must return >= 1; `grep "is_codex_thread_id.*uuid" docs/dev/specs/spec-20260425-094312.md` must return the fix snippet.

---

### 3.4 O4: Replace 5.6 Non-Fix with Deferred Persistent-Path Note

**Finding**: `/root/happy-dev` is a symlink to `/dev/shm/dev-workspace/happy-dev`. The proposed fallback in the spec falls back from the symlink to the direct `/dev/shm` path — which is the same underlying filesystem. After reboot or `/dev/shm` clear, both paths point to nothing. The fallback achieves zero resilience.

**Real fix**: Move the source tree to a persistent sda1 path (e.g. `/root/happy-dev-stable`). This is out of scope for the current fix cycle (it requires a git clone and daemon config change).

**File to edit**: `docs/dev/specs/spec-20260425-094312.md`
**Section anchor**: `### 5.6 P2：cli_path symlink 脆弱`

**Replace entire section** with:
```
### 5.6 P2：cli_path symlink 脆弱 — DEFERRED

- **现状**：`/root/happy-dev → /dev/shm/dev-workspace/happy-dev`。`/dev/shm` 清空或重启后 → symlink dangling → spawn 全失败
- **原提案缺陷（已废弃）**：spec 原提案 "fallback `/root/happy-dev/...` → `/dev/shm/dev-workspace/happy-dev/...`" 解析到同一 inode，`/dev/shm` 清空后两条路径同时失效，fallback 无实际效果。
- **真正的修法**：把 happy-dev 源码克隆到 sda1 持久路径（如 `/root/happy-dev-stable`），更新 daemon systemd unit 的 `ExecStart` 路径，更新 `happy-session-recovery.sh` 的 `cli_path` 映射。此为架构变更，需独立 spec。
- **本次处置**：降级为 P3-DEFERRED，不在本 spec 修复范围。
- **临时缓解**：dev daemon 重启后，user 手动运行 `ls /dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/index.mjs` 确认路径存在，或在 daemon 启动脚本加 pre-check + 明确报错日志（不做 silent fallback）。
- **Success criteria（本 spec 仅验证文档）**：
  - 5.11 影响文件清单里 `cli_path` 那行标注 DEFERRED
  - 不存在任何代码 PR 实现原来那段 `[ -f "$cli_path" ] || cli_path=...` 双路径 fallback（因为无效）
```

**Also update** Section 5.11 影响文件清单中 5.6 对应行 Priority 改为 `P3-DEFERRED（本 spec 不修）`.

**Verification**: `grep "DEFERRED" docs/dev/specs/spec-20260425-094312.md` must return the 5.6 deferred note.

---

### 3.5 O5: Expand 5.2-A Cleanup Scope to Include docs/dev/ Artifacts

**Finding**: Prior BA/spec documents (`spec-20260424-084848.md`, `ba-spec-20260425-030000-0.md`) contain daemon restart instructions. Autonomous BA agents reading these files will learn incorrect SOPs.

**File to edit**: `docs/dev/specs/spec-20260425-094312.md`
**Section anchor**: `#### 5.2-A：dev-overnight workflow 严禁 stop/restart dev daemon（真正的根因）` — `修法` bullet and `Success criteria` block

**Expand the Success criteria block** — after the existing three bullets, add:

```
- **文档清理（扩展范围）**：
  - grep `/dev/shm/dev-workspace/happy-dev/docs/dev/` 目录下所有 `*.md` `*.json` 文件，模式：`happy daemon stop|systemctl restart happy-daemon`
  - 对每个命中文件，在文件顶部或对应段落**加 DEPRECATED 标注**：`<!-- DEPRECATED: daemon stop/restart 指令已废止，请使用 /root/bin/safe-daemon-restart.sh —— see spec-20260425-094312.md §5.2-E -->`
  - **不**删除原内容（保留历史记录），仅加标注
  - 命中文件预期包含（但不限于）：`ba-spec-20260425-030000-0.md`、任何含 `happy daemon stop` 的 spec 文件
  - 完成后 grep 同样模式不再返回未标注的命中（已标注行含 `DEPRECATED` 关键字，可从结果中排除）
```

**Verification**: `grep -rn "happy daemon stop\|systemctl restart happy-daemon" /dev/shm/dev-workspace/happy-dev/docs/dev/ | grep -v DEPRECATED` must return 0 lines after fix.

---

### 3.6 O6: Add Section 5.13 Autonomous-Safe vs User-Gated Taxonomy

**File to edit**: `docs/dev/specs/spec-20260425-094312.md`
**Insertion point**: After Section 5.12 (验证策略), before the closing `---`

**New content**:

```markdown
### 5.13 Autonomous-safe vs User-gated AC 分类

每个 AC 必须明确是否可在 autonomous `/dev` 或 `/dev-overnight` cycle 中完成，还是需要 user 介入。

| Block | AC / Deliverable | Category | Autonomous-safe 理由 / User-gated 原因 |
|-------|-----------------|----------|-----------------------------------------|
| 5.1 peak-merge | PEAK_PROTECT_SECONDS 常量改写、增量 merge 算法、0-session 跳过逻辑 | **autonomous-safe** | 纯脚本改写，在 `/root/bin/happy-session-recovery.sh`，worktree 可写 |
| 5.2-A | dev-overnight skill 文件移除 daemon stop 调用 | **autonomous-safe** | 改写 `/dev/shm/dev-workspace/happy-dev/.claude/skills/` 内文件 |
| 5.2-A | `~/.claude/skills/` 全局 skill 文件改写 | **user-gated** | 全局 skill 文件在 `/root/.claude/skills/`，非 worktree 写根；subagent 需 user 手动改或用 Edit tool 在 user TTY session 中操作 |
| 5.2-A | docs/dev/ 旧 artifact 加 DEPRECATED 标注 | **autonomous-safe** | 目标文件在 worktree 可写路径 |
| 5.2-B | `packages/happy-cli/src/daemon/run.ts` log 改写 | **autonomous-safe** | 源码在 worktree；build 不触发 daemon 重启（version 不变） |
| 5.2-C | daemon `/stop` token 保护实现 | **autonomous-safe** | 源码改写（controlServer.ts + controlClient.ts）；**但**生效需 daemon 重启，重启是 user-gated（见 5.2-E） |
| 5.2-D-1 | skill prompt FORBIDDEN 段加 hook bypass 禁止 | **混合**：worktree skills = autonomous-safe；全局 `~/.claude/skills/` = user-gated |
| 5.2-D-2 | hook arg-parsing 修复（`~/.claude/hooks/pretool-bash-safety.sh`） | **user-gated** | 全局 hooks 路径在 `/root/.claude/hooks/`，非 worktree；subagent Write/Edit 被 `pretool-block-production-files.sh` 拦截；需 user 在 TTY session 中手动 Edit |
| 5.2-D-3 | 新建 `/root/docs/incidents-2026-04-25.md` | **user-gated** | `/root/docs/` 不在 worktree 可写路径 |
| 5.2-D-3 | 全局 `~/.claude/CLAUDE.md` 加第 14 条 | **user-gated** | 全局 CLAUDE.md 非 worktree 路径 |
| 5.2-E-1 | 新建 `/root/bin/safe-daemon-restart.sh` | **user-gated** | `/root/bin/` 不在 worktree 可写路径；生效也需 daemon 重启 |
| 5.4 | `prisma migrate` + schema 改动 | **user-gated** | Section 8 注意 5：prisma migrate 前必须 `pg_dump` 备份，需 user 批准 |
| 5.5 | `.jsonl` 过滤逻辑改写 | **autonomous-safe** | 脚本在 `/root/bin/`；但读取需 Read tool（hook 拦 bash cat） |
| 5.6 | DEFERRED | N/A | 不在本 spec 范围 |
| 5.7 | spawn env 路径统一 | **autonomous-safe** | 脚本改写 |
| 5.8 | CLAUDE.md 文档同步 | **autonomous-safe** | `/dev/shm/dev-workspace/happy-dev/CLAUDE.md` 在 worktree 可写路径 |

**Autonomous /dev cycle 实施边界**：
- autonomous cycle 只处理 `autonomous-safe` 行；user-gated 行直接跳过
- 遇到 user-gated AC，cycle 输出 `USER_ACTION_REQUIRED: <描述>` 并继续其他任务
- 所有 user-gated 交付物必须在 cycle 结束报告里列出，待 user 手动完成
```

**Verification**: `grep "5.13" docs/dev/specs/spec-20260425-094312.md` must return the section header.

---

### 3.7 O7: Resolve 5.2-C / 5.2-E Ordering Chicken-and-Egg

**Issue**: `safe-daemon-restart.sh` (5.2-E) step 3 says "优先 HTTP `POST /stop` with token（依赖 5.2-C）". But `safe-daemon-restart.sh` is listed before 5.2-C in implementation order (Section 5.9). This is circular.

**Resolution**: Split 5.2-E into two phases, making phase 0 independent of 5.2-C:

**File to edit**: `docs/dev/specs/spec-20260425-094312.md`
**Section anchor**: `##### 5.2-E-1：新工具 /root/bin/safe-daemon-restart.sh` — step 3 "Graceful stop"

**Before** (step 3 bullet):
```
3. **Graceful stop**：
   - 优先 HTTP `POST /stop` with token（依赖 5.2-C；token 从 `daemon.state.json` 读）
   - HTTP /stop 失败 → fallback `systemctl stop happy-daemon-<X>.service`
```

**After**:
```
3. **Graceful stop（两阶段实现）**：
   - **v0（5.2-C 上线前）**：直接 `systemctl stop happy-daemon-<X>.service`（无 token，但此调用由脚本发起，不是 subagent 直接调 systemctl，因此不违反 5.2-E-2 的 subagent 禁令）
   - **v1（5.2-C 上线后）**：先 HTTP `POST /stop` with token（token 从 `daemon.state.json` 读），失败则 fallback `systemctl stop happy-daemon-<X>.service`
   - 脚本内用 `SAFE_RESTART_USE_TOKEN=${SAFE_RESTART_USE_TOKEN:-0}` env var 控制阶段切换
```

**Also update** Section 5.2-E-4 step 4 来引用 `safe-daemon-restart.sh dev ...` 并注明当前 v0 不需 token.

**Verification**: `grep "v0\|v1\|SAFE_RESTART_USE_TOKEN" docs/dev/specs/spec-20260425-094312.md` must return the phased-implementation text.

---

### 3.8 O8: Fix 5.9 Internal Contradiction on 5.2-C

**File to edit**: `docs/dev/specs/spec-20260425-094312.md`
**Section anchor**: `### 5.9 依赖关系（重要！）`

**Before**:
```
P0-NEW (5.2-C: /stop 鉴权)
   └── 防御性，可后置；但 5.2-E 里 safe-daemon-restart 要先用 /stop with token，所以推荐和 5.2-E 一起做
```
and:
```
**实施顺序**：5.2-A（治本）→ 5.2-D（行为约束 + hook bug）→ 5.2-B（避免误判）→ 5.2-E（SOP 工具）→ 5.2-C（/stop 鉴权）→ P0（peak）→ P1（watcher + archive 并行）→ P2
```

**After**:
```
P0-NEW (5.2-C: /stop 鉴权)
   └── **与 5.2-E 拆分实施**：5.2-E v0 先上线（用 systemctl stop，不需 token），5.2-C 上线后 5.2-E 升级为 v1（用 HTTP /stop + token）。两者不阻塞对方。

**实施顺序**：5.2-A（治本）→ 5.2-D（行为约束 + hook bug）→ 5.2-B（避免误判）→ 5.2-E-v0（SOP 工具，无 token）→ P0（peak）→ 5.2-C（/stop 鉴权）→ 5.2-E-v1（SOP 工具，有 token，upgrade）→ P1（watcher + archive 并行）→ P2
```

**Verification**: `grep "5.2-E-v0\|5.2-E-v1" docs/dev/specs/spec-20260425-094312.md` must return both instances.

---

### 3.9 O9: Three Sub-fixes (5.1.2 threshold + 5.1 rollback + regression ACs)

**File to edit**: `docs/dev/specs/spec-20260425-094312.md`

#### 3.9a: 5.1.2 mtime threshold

**Section anchor**: `### 5.1 P0：peak-merge 算法重做` — `2️⃣` block

**Before**:
```
再过滤"磁盘 .jsonl 还在 + .jsonl mtime 在合理时间窗口内（建议 < 2h 或 user-config）"
```

**After**:
```
再过滤"磁盘 .jsonl 还在 + .jsonl mtime 在合理时间窗口内"。**默认阈值：`MERGE_FRESHNESS_SECONDS=7200`（2 小时）**，写在脚本顶部常量块（与 `PEAK_PROTECT_SECONDS` 相邻）。用户可覆盖：`MERGE_FRESHNESS_SECONDS=<n> bash /root/bin/safe-daemon-restart.sh ...`。
```

**Also add** to Section 5.11 影响文件清单 `/root/bin/happy-session-recovery.sh` 改动范围列：`新增顶部常量 MERGE_FRESHNESS_SECONDS=7200`.

#### 3.9b: 5.1 Rollback Plan

**Section anchor**: `### 5.1 P0：peak-merge 算法重做` — at the end, before `### 5.2`

**Add new sub-block**:
```
**5.1 Rollback Plan**：
- dev 跑 5.1 修复时，在 Edit 之前用 Bash 复制备份：
  `cp /root/bin/happy-session-recovery.sh /root/bin/recovery-bak-peak-$(date +%Y%m%d-%H%M%S).sh`
  （hook 拦 `cp` + 路径？若被拦，改用 Read tool 把内容存到 `/root/bin/recovery-bak-peak-YYYYMMDD.sh.txt` 临时文件，human 手动 rename）
- 若新算法导致 restore 失败（log 出现 `ERROR` 或 session 减少），rollback：
  `cp /root/bin/recovery-bak-peak-<ts>.sh /root/bin/happy-session-recovery.sh`
  并立即报告 user
- **不**回滚 `PEAK_PROTECT_SECONDS`（14400 是正确值，与算法正确性无关）
```

#### 3.9c: Regression ACs for Already-Applied Patches

**Section anchor**: `### 5.12 验证策略（QA 必须执行）` — item 6 "回归" line

**Before**:
```
6. **回归**：现有 codex flavor / Source 4 / manual_dir 不能破坏
```

**After**:
```
6. **回归（已落地 patch，必须有具体 AC）**：
   - **codex flavor 自动检测**：`session_dirs.txt` 含 `019d` prefix UUID → `restore_online_sessions` spawn 时 log 出现 `flavor=codex`；不出现 `Skip <019d-uuid>: .jsonl not found`
   - **manual_dir bug fix**：`happy-session-recovery.sh restore --manual-dir /some/path` → `manual_dir` 路径在 auto-discovery 结果之前被应用（log 顺序可验证）
   - **Source 4 cwd 提取**：codex rollout 第 1 行含 `.payload.cwd` 字段时，`work_dir` 自动从该字段提取，不需 `--manual-dir` 补充；log 出现 `work_dir extracted from codex rollout: <path>`
   - **备份验证**：`/root/bin/recovery-bak-codex-20260424-2226.sh` 存在 → 对比新旧脚本，以上三项改动均在新版中保留
```

**Verification**: `grep -c "Source 4\|manual_dir\|codex flavor" docs/dev/specs/spec-20260425-094312.md` must be >= 3 in the 5.12 section.

---

## 4. Risk Assessment

| Change | Risk | Collision with other section? | Mitigation |
|--------|------|-------------------------------|------------|
| O1 path correction | Low — correcting factual error | None | Grep 5.11 to ensure both files listed |
| O2 D-2 success criteria rewrite | Medium — must not accidentally authorize subagent systemctl | Could collide with 5.2-E-2 FORBIDDEN list | 5.2-E-2 must remain "subagent may not call systemctl"; note the D-2 success criteria explicitly say hook-pass ≠ policy-allow |
| O3 5.5 rewrite | Medium — introduces is_codex_thread_id in new call site | Must be consistent with 5.7 (env path fix) | Both are in same function body; review together |
| O4 5.6 deferred | Low — removes code fix, adds deferred note | 5.11 影响文件清单 must be updated to remove 5.6 code change | Cross-check 5.11 after edit |
| O5 5.2-A scope expand | Low — adds doc-labeling AC | None | grep scope is new; does not change code changes |
| O6 new 5.13 section | Low — additive | None | Must reference every user-gated item from 5.2 to 5.4 |
| O7 5.2-E v0/v1 split | Medium — changes what safe-daemon-restart.sh must implement | 5.9 ordering must also be updated (O8) | Do O7 and O8 together |
| O8 5.9 rewrite | Low — clarifies ordering, adds v0/v1 labels | Consistent with O7 | Edit in same pass |
| O9a threshold | Low — single constant added | None | Grep to confirm MERGE_FRESHNESS_SECONDS appears in 5.11 |
| O9b rollback | Low — additive | Interacts with Section 8 note about backup naming | Use same backup prefix as Section 1 (`recovery-bak-codex-*`) |
| O9c regression ACs | Low — adds specificity to existing item | None | Must not contradict 5.5 codex behavior descriptions |

**Highest collision risk**: O2 + O6. The D-2 success criteria allow `systemctl restart happy-daemon-dev` to pass through the hook at the parser level. Section 5.13 must make absolutely clear that "hook allows" ≠ "subagent is permitted". If these are not both present and consistent, a future QA check can still flag a contradiction.

---

## 5. Out of Scope (Not Modified in This BA Spec)

The following items from the close report are NOT addressed in this redev fix:

1. **5.3 open-ended investigation convergence** (QA objection 6 in close-report): Spec leaves 5.3 as "investigate then fix." This is intentional — 5.3 requires live system investigation that cannot be pre-specified. Left as-is.

2. **5.2-D-2 + 5.2-E live hook enforcement for user TTY calls**: Whether user TTY should also go through `safe-daemon-restart.sh` is a design policy question, not a spec clarity issue. Not changed.

3. **`/root/bin/safe-daemon-restart.sh` full implementation spec**: This BA spec only changes the ordering and phasing notes in the existing spec. Full implementation detail of the script itself is unchanged (it remains in 5.2-E-1).

4. **5.4 autonomous feasibility**: 5.4 (archive) is user-gated due to prisma migration. Flagged in 5.13. The spec requirement itself is unchanged — user must approve before dev executes.

5. **Codex false claim on hook path** (`/root/happy/.claude/hooks/...`): Codex's finding O1 was factually wrong. The live hook IS at `/root/.claude/hooks/pretool-bash-safety.sh`. This BA spec corrects the spec to explicitly state this, rather than changing the target path.

---

## 6. Delivery Checklist for Dev

After applying all edits from Section 3, the spec must pass these grep checks:

```bash
# O1 verified
grep "settings.json 注册" docs/dev/specs/spec-20260425-094312.md
grep "claude.bak" docs/dev/specs/spec-20260425-094312.md

# O2 verified
grep "5.2-D-2 vs 5.2-E 关系" docs/dev/specs/spec-20260425-094312.md
grep "hook 允许通过.*subagent.*政策禁止" docs/dev/specs/spec-20260425-094312.md

# O3 verified
grep "上游过滤" docs/dev/specs/spec-20260425-094312.md
grep "is_codex_thread_id.*claude session" docs/dev/specs/spec-20260425-094312.md

# O4 verified
grep "DEFERRED" docs/dev/specs/spec-20260425-094312.md

# O5 verified
grep "DEPRECATED" docs/dev/specs/spec-20260425-094312.md  # in 5.2-A success criteria

# O6 verified
grep "5.13" docs/dev/specs/spec-20260425-094312.md
grep "user-gated" docs/dev/specs/spec-20260425-094312.md | wc -l  # expect >= 6 lines

# O7 verified
grep "v0\|v1\|SAFE_RESTART_USE_TOKEN" docs/dev/specs/spec-20260425-094312.md

# O8 verified
grep "5.2-E-v0\|5.2-E-v1" docs/dev/specs/spec-20260425-094312.md

# O9 verified
grep "MERGE_FRESHNESS_SECONDS" docs/dev/specs/spec-20260425-094312.md
grep "Rollback Plan" docs/dev/specs/spec-20260425-094312.md
grep "Source 4" docs/dev/specs/spec-20260425-094312.md
```
