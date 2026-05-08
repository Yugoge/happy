<!-- AUTO-GENERATED VIEW for dev | source: docs/dev/specs/spec-20260502-162334.md | extracted: 2026-05-02T19:56:02Z -->

# dev view of spec-20260502-162334

**Monolith**: docs/dev/specs/spec-20260502-162334.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> ## Section 2: What Was Attempted

> <!-- WHO WRITES: Dev (after each implementation attempt) -->

> ## Section 3: What Was Changed

> <!-- WHO WRITES: Dev (after each implementation) -->

---

# Spec: Codex 4-fix runtime closure — make declared fixes actually visible to user

## Section 2: What Was Attempted

<!-- WHO WRITES: Dev (after each implementation attempt) -->
<!-- WHAT: Per-cycle record of what approach was tried, what the rationale was, and why it failed (if it failed). -->
<!-- This prevents the next cycle's Dev from repeating the same approach. -->

### Cycle 1

_Not yet populated._

---

## Section 3: What Was Changed

<!-- WHO WRITES: Dev (after each implementation) -->
<!-- WHAT: Exact file changes with line numbers and old->new values. -->
<!-- FORMAT: - **file.tsx:42** -- `property: oldValue` -> `property: newValue` -->

### Cycle 1

_Not yet populated._

---

## Implementation Contract — Steps Dev Executes (S1, S5, S6, S-BUILD, S2, S3) and Stops at (S4)

- **S1. Open raw event protocol gate** — `packages/happy-cli/src/codex/codexAppServerClient.ts:802` must change from `experimentalRawEvents: false` to `experimentalRawEvents: true`. The flag is part of `NewConversationParams` (see `codexAppServerTypes.ts:19-32`) and is sent on the **`thread/start`** RPC (NOT `turn/start`). Runtime verification: after S-BUILD, after S4, log/inspect the `thread/start` request payload from `/root/.happy-dev/logs/` for the next Codex thread and confirm the flag is present and `true`.

- **S5. Expand MCP elicitation handler** — Capture the actual Playwright MCP elicitation payload shape on a live Codex session (logs at `/root/.happy-dev/logs/`). Update `codexAppServerClient.ts` and `runCodex.ts` so that handler accepts every Playwright MCP elicitation form, not only `_meta.codex_approval_kind === 'mcp_tool_call'`. Add tests for the additional shapes. The single live success criterion: Codex calls Playwright MCP and the call goes through without `user rejected` / `Unknown server request` log entries.

- **S6. Decide attachment file-type semantics** — User-owned decision (see Section 5 user-actions). Either (a) implement non-image attachments as a real first-class input item AND prove the model receives content (S7 evidence: model reply quotes the file content), or (b) scope the user-facing requirement to "images only" AND document that explicitly in Section 3 of this spec AND make the user-visible message UI surface the limitation (e.g. greyed-out non-image attach button or warning toast). Decision is "closed" only when: chosen path written into Section 3 + user-visible UI behavior implemented + (for path b) user has explicitly confirmed the down-scoping. Whichever path is chosen, image attachments must remain working (continue to flow through `localImage`).

- **S-BUILD. Build CLI dist after S1+S5+S6 source changes** — Per CLAUDE.md "Three Daemon Binary Architecture", dev daemon runs `/dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/index.mjs`. S1/S5/S6 modify `packages/happy-cli/src/codex/*.ts`; without rebuilding, S4 daemon restart will load STALE dist code and the changes will not take effect. Run: `cd /dev/shm/dev-workspace/happy-dev/packages/happy-cli && yarn build`. Verification: (a) `dist/runCodex-*.mjs` mtime is later than `src/codex/codexAppServerClient.ts` mtime; (b) `grep -c 'experimentalRawEvents: true' dist/runCodex-*.mjs` returns ≥1; (c) `grep -c 'experimentalRawEvents: false' dist/runCodex-*.mjs` returns 0. **Forbidden in this step**: `npm install -g` (per Hard Prohibitions), any touch of `/usr/bin/happy*`, any touch of `/usr/lib/node_modules/happy*`. Only the local worktree dist matters — `happy-daemon-dev.service` is wired to it via `/usr/bin/happy-dev` symlink.

- **S2. Fix scope policy whitelist** — `packages/happy-app/sources/utils/codexToolRendering.ts:26-28` must change from `return hasSpecializedView;` to a whitelist that admits both specialized renderers AND Codex-sourced tools (so Codex generic/unknown/resource result still render inline). Update / add tests so Grep/Glob/WebSearch/ToolSearch are still proven hidden, while Codex unknown/resource tools are proven shown. Reconcile with `codex-render-fixtures-data.ts` expected strings.

- **S3. Rebuild dev web image from current worktree** — Depends on S2 (and any other app-source changes). Use the documented dev-overnight build command (see CLAUDE.md "Dev-Overnight Worktree Build & Deploy"): `bash scripts/dev-overnight-build-deploy.sh /dev/shm/dev-workspace/happy-dev frontend`. The command builds `happy-app:dev` with `HAPPY_SERVER_URL=https://api-dev.life-ai.app` and restarts only `happy-web-dev`. Image `created` timestamp must be later than every relevant app source mtime; `curl -s http://localhost:8097/ | head -1` must return HTML; production targets (`life-ai.app`, `localhost:8090`, `api.life-ai.app`) must NOT be touched.

- **S4. Restart dev daemon (REQUEST → user, PAUSE-PENDING-USER)** — Subagents are FORBIDDEN to restart any daemon. Even `systemctl restart happy-daemon-dev` is a user-only action in this cycle (the bash-safety hook permits it for the user from a TTY but spec policy keeps subagents at REQUEST). Steps:
  1. Subagent verifies S-BUILD completed (dist contains `experimentalRawEvents: true`) and S3 completed (`happy-web-dev` image newer than app sources) — if either fails, do NOT issue the S4 REQUEST yet.
  3. Subagent then STOPS. Cycle status = `awaiting-user`. /dev orchestrator MUST treat S7 as not-yet-startable until the user replies.
  4. After the user replies with the new startTime, post-restart verification: (a) `cat /root/.happy-dev/daemon.state.json` shows fresh `startTime`; (b) any new Codex child process spawned by the new daemon uses `/dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/index.mjs` (verify by inspecting `daemonLogPath`); (c) live dev sessions can still be created via the UI.

---

## Hard Prohibitions — Dev-Critical Forbidden Operations

- **2026-04-04 production catastrophe (`docs/incidents-2026-04-04.md`)**: A subagent ran `npm install -g` from a worktree, replaced `/usr/bin/happy`, triggered auto-upgrade across all daemons, and destroyed every production session. Hooks now block `npm install -g`, `/usr/bin/happy`, edits to `/usr/lib/node_modules/happy*`, and `kill <pid>`. Subagents in this cycle MUST respect those hooks and MUST NOT use shell wrappers, `nohup`, `systemd-run`, or `/tmp/*.sh` to bypass them.

- **Production paths**: `/root/happy/`, `/root/.happy/`, `/root/.happy-jade/`, `happy-server`, production web image `happy-app:message-fixes`, `/usr/bin/happy*`, `/usr/lib/node_modules/happy*`.
- **Daemon binaries other than dev**: do NOT restart `happy-daemon.service` or `happy-daemon-jade.service`. Only `happy-daemon-dev.service` is in scope, and even that is REQUEST → user (S4), not a subagent action.
- **Hook configuration**: `~/.claude/hooks/*`, `~/.codex/hooks.json`, `.claude/settings.json` (anywhere). Same rule for `pretool-bash-safety.sh`, `pretool-orchestrator-gate.py`, `pretool-block-production.sh`, `pretool-block-production-files.sh`, `pretool-orchestrator-prompt-purity.py`, and any `pretool-*` / `posttool-*` / `stop-*` script. The hooks failed once (Codex audit re-created `stop-workflow-enforce.py`); do NOT touch them in this cycle.
- **Database / Docker daemon / Cloudflare tunnel / systemd unit files**: out of scope.
- **CLI global install path**: NEVER `npm install -g`, NEVER edit `/usr/bin/happy*`, NEVER call `/usr/bin/happy` (auto-upgrade trigger). Dev daemon already runs `/usr/bin/happy-dev` which symlinks into the worktree; no global install is needed for any S1–S7 step.
