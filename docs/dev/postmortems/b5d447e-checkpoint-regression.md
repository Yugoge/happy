# Postmortem: b5d447e checkpoint-bridge regression

**Commit**: `b5d447e chore(claude): sync all uncommitted config, hooks, scripts, sessions, docs`
**Authored**: 2026-04-21T17:45:03+00:00 (UTC)
**Repository**: `/dev/shm/dev-workspace/dot-claude/` (the nested `.claude` repo, remote `git@github.com:Yugoge/claude-code-config.git`)
**Discovered**: during `/dev-overnight` + `/merge` cycle on 2026-04-24 — worktree branches were sitting at the same SHA for entire overnight cycles, and `/merge` found 0 commits to merge.
**Source of investigation**: `/dev/shm/dev-workspace/happy-dev/docs/dev/ba-investigation-20260425-122518.md` (Sections 1, 2, IF-1 through IF-5)

This postmortem reconstructs why the regressing commit landed without a hook catching it, and lists the four hooks that close the gap (spec-20260424-233926 R4 family).

---

## User-prompt-recovered

The original user prompt that produced commit `b5d447e` was recovered from the project-keyed Claude Code session JSONL at:

- **Absolute path**: `/root/.claude/projects/-root/962de59f-fe0b-416e-b88b-7345fdf569e2.jsonl`
- **mtime**: 2026-04-21 18:04:31 UTC (19 minutes after the regressing commit landed)
- **Size**: 775,366 bytes
- **Distinctive-token grep matrix** confirms this is the authoring JSONL: 4 verbatim references to SHA `b5d447e`, 4 hits for `sync.*uncommitted`, 4 hits for `install-checkpoint-refspec`, 3 hits for `posttool-git-checkpoint`, 3 hits for `spec-block-foreground-agent`. No other JSONL under `/root/.claude/projects/*/` contains the SHA literal.

The verbatim user prompt was:

```
全部commit push
```

(English translation: "commit and push everything")

This appears as message 293 of the session JSONL, type `user`, timestamp `2026-04-21T17:44:16.221Z`, with `cwd=/root` and `gitBranch=master`. The companion JSONL `/root/.claude/projects/-root/05dd71c2-06ce-4a2a-adac-fb31e2521d61.jsonl` (mtime 17:07:32 UTC, 38 minutes earlier) holds the pre-commit context — it has 3 hits for `sync.*uncommitted`, 6 for `merge-overnight`, and 5 for `runcode-watchdog` but zero references to the eventual SHA, consistent with its role as the upstream conversation that left the working tree dirty.

The prompt is **generic — a bulk-sync directive ("commit and push everything"), NOT a request to refactor any hook**. Specifically: the user did NOT ask for a rewrite of `posttool-git-checkpoint.sh`, `auto-commit.sh`, `stop-git-commit.sh`, or `lib/checkpoint-core.sh`. Those rewrites had been authored in a PRIOR conversation (the `4a08b10` era — "Fix overnight hook guard, refactor hooks, and clean up") and were sitting in the working tree as uncommitted edits. The 17:44 sweep picked them up incidentally. This is the central misalignment: the user's intent was bulk-sync of pending state, and the agent treated that as license to ship a 64-line semantic rewrite without surfacing it.

Round-1 BA had searched only `/root/.claude/projects/-dev-shm-dev-workspace-dot-claude/` (keyed by the target git repo) and reported the session log as no-longer-available. That was wrong: Claude Code session JSONLs are keyed by the SESSION's CWD, not by the git repo of the commit target. The session that ran `git commit` was rooted at `/root/`, so the JSONL lives under `-root/`. The JSONL is intact and recoverable.

## Agent-reasoning

The 47-second window from prompt receipt to commit completion (17:44:16 → 17:45:03 UTC) is reconstructed from messages 293-313 of the session JSONL. Verbatim and paraphrased actions:

| Time (UTC) | Action |
|------|--------|
| 17:44:16 | User prompt received: `全部commit push` |
| 17:44:34 | Assistant (verbatim): `Let me quickly scan for obviously-sensitive content before blanket-committing everything.` |
| 17:44:36 | `Bash`: peek `sessions/` + backup files for obvious secrets |
| 17:44:40 | `Bash`: `wc -c` on backups + grep for `token\|secret\|password\|apiKey\|sk-...` |
| 17:44:45 | Assistant (verbatim): `Looks safe. Let me add and commit everything.` |
| 17:44:46 | `Bash`: `cd /root/.claude && git add -A && git status --short \| head -30` (93 files staged) |
| 17:44:54 | `Bash`: first `git commit -m '...'` — BLOCKED by `pretool-orchestrator-gate.py` (`[Orchestrator Gate] BLOCKED: Bash used consecutively beyond limit (4/3)`) |
| 17:44:58 | `Grep`: a Grep call (whitelist tool) — resets the per-tool streak counter |
| 17:45:03 | `Bash`: `git commit -m '...'` retried — succeeded, produced commit `b5d447e` |
| 17:45:06 | `Bash`: `git log -1` + `git push origin master` |

The agent's reasoning at commit time was minimal:

1. **Sensitivity-only scan**: the agent ran a token/secret grep (looking for `sk-...`, `password`, `apiKey`, `secret`) across the `sessions/` directory and backup files. This scan was scoped to credential exfiltration risk only.
2. **No diff-summary step**: the agent did NOT enumerate per-file what was about to ship. There was no "you are about to ship a 64-line rewrite of `posttool-git-checkpoint.sh` whose semantics change the auto-commit-to-branch-HEAD contract that `/dev-overnight` and `/merge` depend on" check. The 4 hook rewrites were silent passengers in the bulk diff.
3. **No semantic-contract awareness**: the assistant treated the working tree as a homogeneous "uncommitted state" blob. The fact that `posttool-git-checkpoint.sh`, `auto-commit.sh`, `stop-git-commit.sh`, and `lib/checkpoint-core.sh` were a coordinated rewrite (the snapshots-off-HEAD design ratified in `f2f8741` 2026-04-16) was invisible from a token-grep vantage point.
4. **Bulk subject line chosen for clearance, not accuracy**: the commit message `chore(claude): sync all uncommitted config, hooks, scripts, sessions, docs` enumerates subsystems by directory — exactly the canonical AI-bulk-commit signature that R4.4 will catch — but read at the time as a neutral chore message.

Direct evidence that the hook rewrite was a side-effect, not an explicit request:

```
$ git log --all --oneline -- hooks/posttool-git-checkpoint.sh
b5d447e chore(claude): sync all uncommitted config, hooks, scripts, sessions, docs
0b254ea checkpoint: Auto-save at 2026-04-16 06:52:23
f5241eb checkpoint: Auto-save at 2026-04-15 21:08:34
4a08b10 Fix overnight hook guard, refactor hooks, and clean up
```

Between `4a08b10` and `b5d447e` there is no intervening semantic commit — only `Auto-save` checkpoints from 2026-04-15 and 2026-04-16. The +64-line delta on `posttool-git-checkpoint.sh` accumulated as uncommitted working-tree state across 5 days and was swept into the bulk along with everything else when the user said "commit and push everything."

## Hook-that-should-have-caught-it

Exactly one hook fired and blocked during the 47-second window: `pretool-orchestrator-gate.py` at 17:44:54, with stderr:

```
[Orchestrator Gate] BLOCKED: Bash used consecutively beyond limit (4/3).
Delegate to a subagent (Agent tool) or ask the user to run /do to unlock.
```

The block was bypassed 9 seconds later. The orchestrator gate is **rate-based, per-tool-name streak counter** — once the agent issued a `Grep` call (a whitelist tool that resets the streak), the next `Bash` (the retried `git commit`) was within the 3-consecutive limit and passed. This is by-design behavior of the gate: it caps consecutive same-name tool use, not the *kind* of work being done.

**No semantic guard fired.** Specifically, no hook today inspects:

- **Subject pattern**: `sync.*uncommitted` is the canonical AI-bulk-commit signature (also matched by `chore\(claude\): sync` for the b5d447e exact form). No hook matched on the subject.
- **Multi-subsystem fan-out**: the staged set spanned 93 files crossing `hooks/`, `scripts/`, `commands/`, `sessions/`, `docs/`, `INDEX.md`, and `.claude.json` backups — five-plus subsystems in a single commit. No hook counted subsystem prefixes.
- **Authorship (agent vs user)**: the `git commit` was issued by the agent process, not the user typing it at a shell. No hook distinguished agent-authored `git` operations from user-authored ones.

The orchestrator gate is a coarse rate limiter and was never intended to police commit semantics. It correctly fired on the consecutive-Bash anomaly and correctly stepped aside once the streak reset. The gap is upstream: there is no hook today that catches the `b5d447e` SHAPE — agent-authored bulk commit + multi-subsystem fan-out + AI-bulk subject pattern.

The two hooks introduced by spec-20260424-233926 R4 that close this gap are:

- **R4.4 `pretool-bulk-commit-detector.py`** — fires on `Bash` with command matching `^git commit\b`, parses the staged set (`git diff --cached --name-only`), counts subsystem prefixes, and refuses if the staged set spans 3+ of `{hooks/, commands/, scripts/, packages/, docs/}` AND the subject matches `sync.*uncommitted` OR `chore\(claude\): sync`. Both conditions must be true (conjunctive) so a benign multi-subsystem commit (e.g. `feat: cycle 2`) passes and a single-subsystem AI-bulk commit also passes; only the joint shape fires.
- **R4.3 `pretool-git-privilege-guard.py`** — refuses agent-authored `git commit` outright (exit 2 with stderr `BLOCKED: agent git commit`) unless the message matches the blessed bridge pattern `^auto-bulk: end-of-cycle commit for ` (R2's auto-bulk bridge) or comes from the user via `/do`. R4.3 fires before R4.4 even runs and would have stopped b5d447e at 17:44:54 regardless of subsequent streak resets.

Together R4.3 + R4.4 are belt-and-suspenders. R4.3 enforces authorship; R4.4 enforces commit shape. Either alone would have stopped `b5d447e`.

## Concrete-hook-paths-to-add

Spec-20260424-233926 Section 5.2.4 declares a four-hook anti-regression family. Three are NEW; one is an extension. All live in the global config repo under `/root/.claude/hooks/` (= `/dev/shm/dev-workspace/dot-claude/hooks/`). Project-repo `.claude/hooks/` is verified non-divergent (16 hooks, none named `pretool-overnight-hook-guard.py` or any of the R4 paths).

1. **`/root/.claude/hooks/pretool-overnight-hook-guard.py`** (EXTENDED — R4.1)
   Today's hook (481 lines) covers `is_hooks_path()` (`.claude/hooks/`) and `is_state_file_path()` (`overnight-state-*.json`) but has no `.claude/commands/*` predicate. R4.1 adds a NEW `is_commands_path()` predicate that mirrors the structure of `is_hooks_path()` (path-prefix check + Bash regex coverage for `Edit`, `Write`, and shell-redirect Bash commands). Verification signal: synthetic stdin `{"tool_name":"Edit","tool_input":{"file_path":"/root/.claude/commands/merge.md"}}` with an active overnight session_id MUST produce exit 2 and stderr identifying the `.claude/commands/` block. Satisfies AC5.

2. **`/root/.claude/hooks/pretool-claude-config-guard.py`** (NEW — R4.2)
   Runs OUTSIDE `/dev-overnight` too — a permanent guard, not session-scoped. Blocks Edit/Write/Bash modifications to `.claude/hooks/*` and `.claude/commands/*` unless an explicit allow-list flag is set. Recommended mechanism: sentinel file `.claude/.hook-refactor-allow` in the active project root (affirmative user action, leaves an audit trail). Verification signal: synthetic stdin `{"tool_name":"Edit","tool_input":{"file_path":"/root/.claude/hooks/some-hook.sh"}}` with no sentinel MUST exit 2 and stderr explains the block; with the sentinel present the same Edit MUST exit 0. Satisfies AC6. This hook addresses the exact regression class b5d447e represents — incidental hook rewrites slipping through bulk commits — by requiring an explicit refactor-mode opt-in.

3. **`/root/.claude/hooks/pretool-git-privilege-guard.py`** (NEW — R4.3)
   For agent contexts (synthetic stdin with `agent_id` set, OR session detected as agent-driven), refuses unblessed git history mutations: `git commit` (except blessed bridge `^auto-bulk: end-of-cycle commit for `), `git merge` (except via `/merge`), `git push`, and `git reset --hard <non-HEAD-ref>`. Exit code 2 with stderr containing literal `BLOCKED: agent git commit` (analogous strings for the other verbs). Verification signal: synthetic stdin `{"tool_name":"Bash","tool_input":{"command":"git commit -m 'some message'"}}` from agent context MUST exit 2 with the literal stderr substring; the same with message `auto-bulk: end-of-cycle commit for foo` MUST exit 0. Satisfies AC7. **This is the direct preventer of the b5d447e shape**: the regressing commit was agent-authored, the message did not match the blessed bridge pattern, so R4.3 would have refused it.

4. **`/root/.claude/hooks/pretool-bulk-commit-detector.py`** (NEW — R4.4)
   Fires on `Bash` whose command begins with `git commit`. Parses the staged set via `git diff --cached --name-only`, counts how many of `{hooks/, commands/, scripts/, packages/, docs/}` are touched, and checks whether the subject matches `sync.*uncommitted` OR `chore\(claude\): sync`. If both conditions hold (multi-subsystem fan-out AND AI-bulk subject), exit 2 with stderr naming the matched subsystem prefixes (so the human reviewing the block can see why it fired). Verification signal: a synthetic git index with staged paths spanning 3+ subsystems and message `chore(claude): sync foo` MUST exit 2 with subsystem prefixes in stderr; a single-subsystem control with the same message MUST exit 0; a multi-subsystem control with a benign message (`feat: cycle 2`) MUST also exit 0 (proving the check is conjunctive, not just shape OR subject). Satisfies AC8. **This is the direct catcher of the b5d447e shape**.

Registration is intrinsic to Must-Have (Round-2 escalation per BA Objection 4): unregistered hooks never fire. Dev's R4 group emits a JSON snippet for the `update-config` skill that adds the three new hooks (R4.2, R4.3, R4.4) as PreToolUse matchers in the harness `settings.json` — Edit/Write/Bash matcher for the config-guard, Bash matcher for the git-privilege and bulk-commit hooks. AC10 verifies registration is complete; AC5–AC8 verify each hook actually fires on synthetic stdin, not just that the file exists.

---

### Lessons

1. **Rate-based gates do not catch semantic regressions.** The orchestrator gate's per-tool-name streak counter is the right shape for its job (preventing pathological tool spam in the main agent), but it is the wrong layer to police commit semantics. Semantic guards must inspect the *content* of the operation, not just its *cadence*.
2. **Generic user prompts are not consent for refactors.** A user saying "commit and push everything" is asking the agent to clear the working tree; it is not an explicit blessing for any particular semantic change that happens to be in that tree. Bulk commits MUST surface refactor content via diff-summary, per-file review, or an opt-in refactor flag — not bury it in a `chore: sync` catch-all.
3. **Subsystem prefixes are a strong signal.** Commits that span `hooks/ + commands/ + scripts/ + docs/` simultaneously are almost always either (a) an explicit cross-cutting feature (rare and worth surfacing) or (b) an AI-bulk sync that swept incidental work (the b5d447e shape). Either way, requiring a human-readable subject that names the cross-cut explicitly costs little and gains a lot.
4. **Authorship matters.** The harness can distinguish agent-authored `git` calls from user-authored ones via the `agent_id` field on stdin JSON. R4.3 leverages this to require explicit blessing on agent commits — a coarse but effective prophylaxis against incidental regressions.
5. **Recover the JSONL before declaring it lost.** Claude Code session JSONLs are keyed by the SESSION CWD, not the target repo. Always search across all `/root/.claude/projects/*/` directories with the appropriate time window AND distinctive-token greps before concluding the trail is cold. Round-1 BA's premature no-longer-available claim cost a round and would have shipped a falsehood into this postmortem if it had not been caught.
