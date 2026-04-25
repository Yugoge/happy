# BA Spec: spec-20260425-094312 Re-Layering Design

**Created**: 2026-04-25
**Source spec**: `/dev/shm/dev-workspace/happy-dev/docs/dev/specs/spec-20260425-094312.md`
**Goal**: split spec content into 3 layers (A=global CLAUDE.md, B=project CLAUDE.md, C=this spec) so that project-specific names (`happy-daemon-*`, `safe-daemon-restart.sh`, cgroup, dev-overnight) never appear in the cross-project global file.

---

## 1. Layering errors in current spec (line-cited)

Spec rows that say "write into skill / skill prompt / skill 顶部" — these conflate cross-project skill files with project rules:

| Spec line | Content | Problem |
|---|---|---|
| L168-169 | "5.2-D 必须做（subagent 行为约束 …）否则就算 5.2-A 改了 skill 文件，下个 subagent 仍可能找漏洞绕过" | Skill files are global; rule is project-specific |
| L176-187 | "5.2-D-1 写进所有 dev-overnight / dev / spec / qa skill prompt 模板", "强制规则（必须出现在 skill 顶部 FORBIDDEN 段）" | Putting project rules in shared skill prompts |
| L188 | "dev-overnight skill 顶部 FORBIDDEN 段加一条 'If a daemon restart is required, output a REQUEST to user — do not execute'" | Same |
| L240 | "CLAUDE.md '🚨 Production Catastrophe Lessons' 段加第 14 条" — currently says global CLAUDE.md, but listed text mentions only generic verbs (good); only the framing line needs neutralizing |
| L277-284 | "5.2-E-2 subagent 必须用这个工具 …", "skill prompt 顶部 FORBIDDEN 段加: 禁止 systemctl restart happy-daemon-*, 禁止 HTTP POST /stop, 禁止 kill happy-cli pid, 唯一允许的重启入口是 /root/bin/safe-daemon-restart.sh" | All four bullets cite project-specific names; cannot live in shared skill |
| L502-503 | 5.11 影响文件清单 — 列出 `commands/dev-overnight.md`, `agents/qa.md` etc. as edit targets | Same files as above |
| L510 | "~/.claude/CLAUDE.md 全局 … 加第 14 条" | OK destination, but body must be neutralized |
| L536-537, L541-542 | 5.13 表格 user-gated 理由频繁说 "改 dot-claude prompt 库", "skill 文件" | These rationales must change to "改 CLAUDE.md / 项目 hook" |
| L588 | Section 8 注 10: "subagent 遇 hook 拦截…严禁修改 hook 文件" | Already generic; can stay in spec or move to A |

**Summary**: every "write into skill" instruction (5.2-D-1, 5.2-E-2, 5.11, 5.13) is a layering violation.

---

## 2. Layer A — content moving to global `/root/.claude/CLAUDE.md`

### 2.1 New section: "Subagent hook-bypass forbidden" — insert AFTER `## 🚫 Safety Enforcement` (i.e. at L123)

Source: spec L177-184 (5.2-D-1 강제규칙) + L240 (item 14) + L588 (Section 8 注 10).

Neutralized text (no project names):

```markdown
## 🛡️ Subagent Hook Discipline

**NON-NEGOTIABLE.** Applies to every subagent in every project.

When a hook (PreToolUse / PostToolUse / Stop) rejects a command, the subagent MUST:

1. **PAUSE** immediately and report the rejected command + hook output to the user.
2. **NOT** rewrite the command into another shell wrapper (`nohup`, `systemd-run`, `disown`, `setsid`, `at`, `cron`, …) to dodge the same rule.
3. **NOT** write the rejected command body into a file (e.g. `/tmp/*.sh`, `/var/tmp/*.sh`, any file outside the working tree) and execute that file.
4. **NOT** read hook source code looking for parsing gaps — reconnaissance counts as a bypass attempt.
5. **NOT** modify, rename, or move any file under `~/.claude/hooks/` or `~/.claude.bak/hooks/`.
6. If the task genuinely requires the rejected operation, output a **REQUEST** message to the user describing exactly what needs to run and why; the user decides.

**Why this rule exists**: a subagent that "finds a way around" a hook negates the hook's purpose and can corrupt long-running processes or production state. Whether the hook itself is correct is a separate question — if the hook is buggy, the subagent's correct response is still PAUSE + report.
```

### 2.2 Add item 14 to "🚨 Production Catastrophe Lessons" — insert AFTER L28 (item 13)

Source: spec L239-240, neutralized.

```markdown
### 14. Subagent rejected by a hook MUST PAUSE + report — never bypass
Writing the blocked command into a script file, wrapping it in `nohup`/`systemd-run`/`setsid`, or editing the hook itself is a security violation, even if the rejection looks like a parsing bug.
```

### 2.3 New "Long-running daemon verification protocol" — append AFTER L165 (Testing Strategy section)

Source: spec implicit from 5.2-A/E, fully neutralized:

```markdown
## 🌙 Long-Running Process Verification

When a code change targets a long-running daemon-style process (one whose source tree is hot-loaded by a separately-running OS process or service), a subagent MUST NOT cause that process to restart in order to verify the change. Acceptable verification paths:

1. **Sandboxed instance**: launch a parallel copy of the daemon binary against a throwaway state directory and verify there.
2. **Static verification**: read the post-build artifact and confirm the change is present (sufficient when behaviour is structurally obvious).
3. **PAUSE-PENDING-USER**: if neither (1) nor (2) is feasible, output a REQUEST naming the restart command and stop; the user triggers it.

Restarting a long-running daemon from inside a session that itself depends on that daemon will kill the session before it can report results.
```

(All three sub-rules are domain-agnostic; project-specific tools live in Layer B.)

---

## 3. Layer B — content moving to project `/dev/shm/dev-workspace/happy-dev/CLAUDE.md`

Insertion point: a new section **`## Dev-Overnight Verification Protocol`** immediately after `### Dev-Overnight Worktree Build & Deploy (MANDATORY for QA)` (after L584).

Content (from spec 5.2-A, 5.2-D-1 project-specific bullets, 5.2-E-1..6, 5.9 ordering, Section 8 attention notes):

```markdown
## Dev-Overnight Verification Protocol

This section makes the global "Long-Running Process Verification" rule concrete for happy-dev. Three classes of cycle, each with its own verification path:

### Cycle classes

| Class | Targets | Restart needed? | Verification path |
|---|---|---|---|
| **A: happy-app (web)** | `packages/happy-app/**` | No — Expo HMR or `docker compose up -d happy-web-dev` | Playwright on `http://localhost:8097` |
| **B: happy-server** | `packages/happy-server/**` | Yes — `docker compose up -d happy-server-dev` (container restart, daemons unaffected) | `curl http://localhost:3005/health` then UI |
| **C: happy-cli daemon** | `packages/happy-cli/src/daemon/**`, `packages/happy-cli/src/api/apiMachine.ts`, anything loaded by the live daemon process | **YES — and MUST be PAUSE-PENDING-USER or sandbox-only for subagents** | see below |

### Cycle C — daemon code changes

A subagent that changes daemon code MUST pick exactly one of:

1. **Sandbox daemon mode** (preferred for autonomous cycles):
   ```bash
   SANDBOX_HOME=$(mktemp -d /tmp/happy-sandbox-XXXX)
   cp /root/.happy-dev/access.key $SANDBOX_HOME/   # if testing with dev account
   HAPPY_HOME_DIR=$SANDBOX_HOME \
   HAPPY_SERVER_URL=http://localhost:3005 \
   IS_SANDBOX=1 \
     node /dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/index.mjs daemon start
   ```
   Verify the change against the sandbox daemon. The live `happy-daemon-dev.service` is untouched.

2. **PAUSE-PENDING-USER**: output a REQUEST naming the SOP command (`/root/bin/safe-daemon-restart.sh dev --reason "<text>"`) and stop. User runs it.

**Forbidden** for subagents (in any cycle): direct `systemctl restart happy-daemon-*`, daemon HTTP `POST /stop`, `kill` against `happy-cli` PIDs, writing the restart command into a `/tmp/*.sh` to bypass the bash-safety hook.

### safe-daemon-restart SOP (user-only entry point)

`/root/bin/safe-daemon-restart.sh <dev|default|jade> [--reason <text>] [--no-confirm] [--prod-acknowledged]` is the only sanctioned daemon restart path. It runs pre-flight save → confirmation gate → graceful stop → start → post-flight recover + audit log. Subagents must never invoke it directly; they output a REQUEST and let the user run it from a TTY.

### Hook bypass — project-specific consequences

The global "Subagent Hook Discipline" rule applies. In happy-dev specifically, the bash-safety hook blocks: `npm install -g`, `/usr/bin/happy`, `systemctl restart` against non-dev units, `kill` with bare PIDs, writes to `/usr/lib/node_modules/happy*`, and exact-name matches on `happy-session-recovery.sh`. If a hook rejects an operation here, the correct action is REQUEST to user — never wrap in `nohup`/`systemd-run`/`/tmp/*.sh`.
```

(Triple daemon table at L278-285 already documents `happy-daemon-{default,jade,dev}` mapping; no change needed.)

---

## 4. Layer C — spec slim-down

Edits to `spec-20260425-094312.md`:

1. **L176-188 (5.2-D-1)**: replace body so it no longer references skill files. New body:
   - "Global rule already lives in `/root/.claude/CLAUDE.md` § 'Subagent Hook Discipline'."
   - "Project rule already lives in `/dev/shm/dev-workspace/happy-dev/CLAUDE.md` § 'Dev-Overnight Verification Protocol'."
   - Success criteria → "grep both CLAUDE.md files for the required sections; both must contain the listed bullets."
2. **L277-284 (5.2-E-2)**: same pattern — delete "skill prompt 顶部 FORBIDDEN 段加 …" bullets; replace with "verify project CLAUDE.md contains forbidden-actions list."
3. **L502-503 (5.11)**: drop the two rows that target `commands/*.md` and `agents/*.md`; add two rows: `~/.claude/CLAUDE.md` (Layer A inserts) and `/dev/shm/dev-workspace/happy-dev/CLAUDE.md` (Layer B insert).
4. **L536-537, L541-542 (5.13)**: change "user-gated 理由" wording from "dot-claude prompt 库 / skill 文件" to "global CLAUDE.md / project CLAUDE.md (root-owned)".
5. **L510 (5.11 row for `~/.claude/CLAUDE.md`)**: keep, but expand to "add items 14 + 'Subagent Hook Discipline' section + 'Long-Running Process Verification' section" per Layer A.
6. **L114-119 (DEPRECATED-tag step under 5.2-A)**: keep — these target `docs/dev/*.md` artifacts, not skill files; not a layering violation.

The spec retains Sections 5.1, 5.2-A (only the doc-tagging part), 5.2-B, 5.2-C, 5.2-D-2, 5.2-D-3 (incident doc), 5.2-E-1 (script body), 5.2-E-3..6 (policy details), 5.3-5.8. Net removed: ~15 lines about skill-file editing.

---

## 5. Risks / conflicts with existing CLAUDE.md content

- **Global CLAUDE.md `## 🚫 Safety Enforcement`** (L89-122) already enumerates hook categories — new "Subagent Hook Discipline" section sits after it without overlap (one describes what hooks enforce, the other describes how subagents must react).
- **Global item 11** ("Subagent prompts must explicitly list FORBIDDEN") — item 14 complements (FORBIDDEN list ≠ bypass discipline). No collision.
- **Project CLAUDE.md `### Dev-Overnight Safety Boundaries`** (L539-543) and `## ABSOLUTE PROHIBITIONS FOR ALL SUBAGENTS` (L672+) already mention production-access and UI-only-session-creation rules. New Verification Protocol section explicitly covers a different axis (cycle-class verification + daemon restart authority); cross-reference but don't restate.
- **Hook enforcement summary** (project L650-656) does not mention `happy-session-recovery.sh` — current hook does block exact filename. Layer B description above truthfully notes this; no contradiction with existing table since the table is a summary, not exhaustive.

---

## 6. Grey zones (cannot cleanly split A/B/C)

1. **5.2-D-2 hook arg-parsing fix** at `/root/.claude/hooks/pretool-bash-safety.sh`. The hook itself is global (lives in `~/.claude/hooks/`), but it bakes in project-specific service names (`happy-daemon-dev` whitelist). Recommendation: keep the FIX in the spec (Layer C, user-gated) since it is a one-time bug fix, not a documentation rule. The DOCS about what hooks enforce should remain in global CLAUDE.md (already there at L89-122 as paraphrased categories — no project names).

2. **5.2-E-1 `safe-daemon-restart.sh` script body**. The script is project-specific (path, daemon names, recovery script paths). Spec body for the script (Layer C) is correct. The *policy* that "subagents must REQUEST + user runs the SOP" splits cleanly: generic rule → Layer A; specific tool path → Layer B.

3. **Item 14 of "Production Catastrophe Lessons"**. Section title in global CLAUDE.md says "(2026-04-04)" — historical incident. Adding a 2026-04-25 lesson under that header is semantically odd but the section is already a mixed list. Acceptable: add item 14 as written; if the user prefers, retitle the section to "🚨 Production Catastrophe Lessons" without a date.

4. **`packages/happy-cli/src/daemon/run.ts` log fix (5.2-B)** is pure code change in worktree — clean Layer C, no doc layering issue.

5. **DEPRECATED tagging of `docs/dev/*.md` artifacts (5.2-A)** — these are project-specific historical artifacts, not shared skills. Leave in Layer C as-is.

---

## 7. Implementation order

1. Edit global CLAUDE.md (Layer A): item 14 + Subagent Hook Discipline section + Long-Running Process Verification section. **User-gated** (root-owned file).
2. Edit project CLAUDE.md (Layer B): Dev-Overnight Verification Protocol section. **User-gated** (under `/dev/shm/dev-workspace/happy-dev`, owned by current user but content affects all overnight cycles — recommend user review).
3. Edit spec (Layer C): replace 5.2-D-1 / 5.2-E-2 bodies, update 5.11 + 5.13 tables. **Autonomous-safe** (worktree path, doc-only).

No file is touched in this BA design — investigation only.
