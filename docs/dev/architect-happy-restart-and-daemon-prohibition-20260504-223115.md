# Architect Report — happy-restart.sh per-stack support + permanent daemon-restart prohibition

**Agent**: architect (dev-20260504-223115)
**Date**: 2026-05-04
**Scope**: Structural / dependency / pattern observations only. No code, no file modifications outside this report.
**Concerns**:
- C1 — `/root/bin/happy-restart.sh` per-stack support (dev / default / jade / qijie / all)
- C3 — Layered, bypass-resistant prohibition on Claude restarting any happy-daemon-*

Companion sentinel registration: `/dev/shm/dev-workspace/happy-dev/.claude/dev-registry/dev-20260504-223115/architect.json`.

---

## CONCERN C1 — happy-restart.sh single-stack support

### Current shape (observed at `/root/bin/happy-restart.sh`, 142 lines)

The script is built around three implicit assumptions that all break when "dev" is added as a target:

1. **Target set is hardcoded global**. Daemons stopped (lines 22–26): `happy-daemon`, `happy-daemon-jade`, `happy-daemon-qijie`. Daemons started (lines 96–106): same three. `happy-daemon-dev` is intentionally excluded everywhere.
2. **Binary health gate (lines 51–88) is single-tree**. It greps `/usr/lib/node_modules/happy-coder/dist/*.mjs` for three tokens (`shouldHideParentToolCall` absence, `Task||Agent` presence, `sendExisting` presence). This is the production global CLI. If a dev restart is asked for, the dev binary is at `/dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/index.mjs` (not under `/usr/lib/node_modules/`) and the gate would either pass-by-accident (because the prod binary still looks fine) or block a legitimate dev restart for prod-binary contamination unrelated to dev.
3. **Docker step (lines 90–93) recreates `happy-server` + `happy-web` (production)** unconditionally. Dev's Docker counterparts are `happy-server-dev` (port 3005) and `happy-web-dev` (port 8097); neither is touched, but worse: a "dev-only restart" call would blow away production Docker as a side effect.

### Observed structural problems

| # | Problem | Symptom if unchanged when `--target dev` added |
|---|---------|------------------------------------------------|
| 1 | Hardcoded daemon list | dev-only invocation still stops/starts all three production daemons |
| 2 | Single binary check path | Gate validates the wrong binary for the chosen target; either false-pass or false-block |
| 3 | Unconditional Docker recreate | dev-only invocation still recreates production containers |
| 4 | Session-save target set is global | `happy-session-recovery.sh save` (line 18) saves all homes, but `--target dev` only needs `~/.happy-dev/` snapshots — bigger blast radius than required |
| 5 | Detached-process kill loop (lines 28–42) is global | greps `pgrep -P 1 -f "happy.*--started-by daemon"` matches dev AND prod children indiscriminately |
| 6 | PID-state verification block (lines 111–133) hardcoded to three homes | dev's `~/.happy-dev/daemon.state.json` is never validated |
| 7 | `HAPPY_SERVER_URL` default is production (line 8) | dev daemon must use `http://localhost:3005`; if env overlooked, dev daemon comes up pointed at prod server |
| 8 | No idempotency for partial failures | If only one stack's start fails, no rollback / retry semantics |
| 9 | No mutex / lockfile | Two concurrent invocations would race; production restart already takes ~10–15s |

### Structural recommendations (no code)

1. **Introduce a target dispatch layer**, not a flag-on-monolith. Each target (`dev`, `default`, `jade`, `qijie`, `all`) maps to a config record with five fields:
   - `systemd_unit` (e.g. `happy-daemon-dev.service`)
   - `home_dir` (e.g. `/root/.happy-dev`)
   - `binary_dist_glob` (e.g. `/dev/shm/dev-workspace/happy-dev/packages/happy-cli/dist/*.mjs` for dev; `/usr/lib/node_modules/happy-coder/dist/*.mjs` for prod targets)
   - `docker_services` (empty for dev daemon, `[happy-server-dev, happy-web-dev]` for dev when web also requested, `[happy-server, happy-web]` for prod-target invocations)
   - `server_url_default`
   The "do work" loop iterates target records; behaviour is data-driven, not branch-driven.

2. **Binary health gate must be parameterised by target**. Three tokens (`shouldHideParentToolCall` negative-check, `Task||Agent` positive, `sendExisting` positive) can stay as the rule-set, but the file paths come from the target's `binary_dist_glob`. For `--target dev`, gate against the worktree dist; the prod binary is irrelevant.

3. **Docker step must be conditional and target-scoped**. `--target dev` triggers neither `happy-server` nor `happy-web` recreate. `--target all` keeps current behaviour (prod daemons + prod Docker). A separate `--include-docker` toggle (off by default for dev) is the cleanest split — dev usually wants daemon-only restart because its Docker is rebuilt by `dev-overnight-build-deploy.sh`.

4. **Session save/recover must be per-target**. `happy-session-recovery.sh save` already exists and operates on whichever HAPPY_HOME_DIR it sees; the dispatcher should set HAPPY_HOME_DIR per target before invoking save/recover, or extend the save script with a `--home <dir>` argument. Either way, dev-target save touches only `~/.happy-dev/session_dirs.txt` and its history dir.

5. **Detached-process kill must be per-target**. Currently the loop (lines 30–37) iterates pidfiles but the inner `pgrep` is unconstrained. Per-target version: walk `pgrep -P 1 -f "happy.*--started-by daemon"` ONLY when daemon home matches the target's home (e.g. inspect each child's cwd or env to confirm `HAPPY_HOME_DIR` matches). Otherwise keep the global behaviour gated behind `--target all`.

6. **Mutex via `flock` on a per-target lockfile** (`/var/run/happy-restart-<target>.lock`). Different targets can run concurrently; same target serializes.

7. **Exit-code contract** — the script currently uses `set -euo pipefail` plus `|| true` patches (lines 18, 22, 24, 26). For per-target work, return a structured exit map: 0 = all targets ok; non-zero = bitmap of failed targets. Caller scripts can react.

8. **Logging path scope** — `LOG=/var/log/happy-restart.log` (line 10) shared across targets is fine for ops audit but should include `target=<value>` in every line.

### Pattern observations relevant to design

- The existing `safe-swap-drain.sh` and `auto-safe-swap-drain.sh` in `/root/bin/` use a similar dispatch-on-target idiom; the per-target restart can mirror their style.
- The `/root/bin/happy-session-recovery.sh` script is already explicitly multi-home aware (it monitors all three production homes via a watcher). A per-target invocation contract is consistent with how recovery already works.
- Project CLAUDE.md references a `safe-daemon-restart.sh` SOP that does NOT currently exist on disk (`ls /root/bin/safe-daemon-restart.sh` → no such file). If C1 is implemented, that SOP wrapper layer can be folded into per-target `happy-restart.sh` rather than living as a separate script — one less gate path for hooks to cover.

---

## CONCERN C3 — Permanent prohibition on Claude restarting any happy-daemon

### Authoritative ground truth: how the existing block works AND where it leaks

`/root/.claude/hooks/pretool-bash-safety.sh` is the single Bash gate. Relevant block at lines 427–435:

```
if echo "$COMMAND" | grep -qE 'systemctl\s+(stop|restart|disable|enable)\s+'; then
  if ! check_systemctl_targets_all_dev "$COMMAND" "$DEV_SYSTEMD"; then
    echo "BLOCKED: systemctl stop/restart/disable/enable is forbidden for production services" >&2
    ...
    exit 2
  fi
fi
```

`DEV_SYSTEMD="happy-daemon-dev"` (line 35). The helper `check_systemctl_targets_all_dev` (lines 81–105) splits `&&`/`||`/`;` and verifies every systemctl target argument is in the dev whitelist. **`happy-daemon-dev` is currently allow-listed, which is why a `sudo systemctl restart happy-daemon-dev` chained with debug echos went through — the orchestrator's chained form passed the splitter, every systemctl-bearing subcommand referenced ONLY `happy-daemon-dev`, and the helper returned 0.**

So the bypass that the user reported is not a hook-splitter bug; it is the explicit policy of the current hook: **`happy-daemon-dev` is whitelisted**. C3 is a policy change, not a regex hardening.

### Bypass surface inventory (exhaustive)

A daemon restart can be reached today through any of the following paths. The current hook covers some; others are silent gaps.

#### Bash-mediated paths (gated by `pretool-bash-safety.sh`)

| # | Path | Currently blocked? | Notes |
|---|------|-------------------|-------|
| B1 | `systemctl restart happy-daemon-dev` (single command) | ALLOWED — explicit whitelist | This is the hole the user wants closed. |
| B2 | `systemctl restart happy-daemon` / `-jade` / `-qijie` | BLOCKED (line 428) | Not in dev whitelist → exit 2. |
| B3 | `sudo systemctl restart …` | Same as B1/B2 | The sudo prefix doesn't change `check_systemctl_targets_all_dev`. The function strips `.service` suffix and checks the bare unit name; sudo is irrelevant. |
| B4 | `systemctl restart happy-daemon-dev && echo ok` (chained) | ALLOWED via splitter (each subcommand independently allow-listed) | Same hole as B1. |
| B5 | `bash -c "systemctl restart happy-daemon-dev"` | ALLOWED | Splitter still sees the inner command. |
| B6 | `eval "systemctl restart happy-daemon-dev"` | ALLOWED | Inner string contains the matching token. |
| B7 | `sh -c '…'` / `zsh -c '…'` | ALLOWED | Same. |
| B8 | `nohup systemctl restart happy-daemon-dev &` | ALLOWED | Background detach doesn't bypass token match — but doesn't block it either, since the token is whitelisted. |
| B9 | `systemd-run --unit foo systemctl restart happy-daemon-dev` | ALLOWED | systemd-run is not in the regex; the inner systemctl token is allow-listed. |
| B10 | `timeout 30 systemctl restart happy-daemon-dev` | ALLOWED | `timeout` is unhandled by the splitter; the systemctl token still matches. |
| B11 | `watch -n1 systemctl restart happy-daemon-dev` | ALLOWED | Same. |
| B12 | Heredoc: `bash <<'EOF'\nsystemctl restart happy-daemon-dev\nEOF` | ALLOWED | The full heredoc body is part of `$COMMAND`; splitter sees the line; whitelist matches. (Note: the consume_allowlist explicitly documents heredoc/backtick/process-sub as out-of-scope for `/allow` consumption, but the **block rules above** still match string content; current rule whitelists the unit.) |
| B13 | `kill -HUP <daemon-pid>` (graceful reload) | BLOCKED (lines 421–425, 567–573) | `kill -` and `kill <PID>` both blocked. |
| B14 | `pkill -f happy-daemon-dev` | BLOCKED (lines 414–418) | `pkill.*happy` blocked. |
| B15 | Daemon HTTP `POST /stop` via curl | NOT BLOCKED for `localhost:<httpPort>/stop` | Curl block (lines 525–540) only covers `/v1/sessions`, `/v1/machines`, `/spawn-session`, `/session-started`, `localhost:3000`, `127.0.0.1:3000`, `api.life-ai.app`. Daemon control HTTP (random port from `daemon.state.json`) is uncovered. |
| B16 | `nc localhost <httpPort>` raw TCP to daemon control | NOT BLOCKED | `nc` not in the rule set at all. |
| B17 | `bash /root/bin/happy-restart.sh …` | BLOCKED (line 345) | Absolute name match on `happy-restart`. |
| B18 | `/root/bin/happy-restart.sh` (no `bash` prefix) | BLOCKED | Same regex `happy-restart`. |
| B19 | `cp /root/bin/happy-restart.sh /tmp/foo.sh; bash /tmp/foo.sh` | BYPASSES name match (the `cp` form) BUT the inner `bash /tmp/foo.sh` would itself need to invoke `systemctl` — which is then re-gated. | Effective only against the name-match rule, not the systemctl rule. |
| B20 | `ln -s /root/bin/happy-restart.sh /tmp/foo && /tmp/foo` | Same as B19 | Symlink does not change argv[0] via execve, but `$COMMAND` text differs from `happy-restart`. The systemctl invocations inside still re-gate. |
| B21 | Writing a fresh shell script under `/tmp/*.sh` containing the daemon-restart sequence | Bash hook fires on the `bash /tmp/foo.sh` invocation; file content is opaque to the hook. INDIRECT BYPASS. | The Edit/Write rules don't currently block writes to `/tmp/`. |
| B22 | `dbus-send --system /org/freedesktop/systemd1 …` (dbus directly) | NOT BLOCKED | dbus-send is not in the regex. |
| B23 | `python3 -c "import subprocess; subprocess.run(['systemctl','restart','happy-daemon-dev'])"` | ALLOWED at the Bash level (string contains `systemctl restart happy-daemon-dev` — whitelist match). | Even if the unit weren't whitelisted, the regex `systemctl\s+(stop\|restart\|...)` should match this. |

#### Edit / Write paths (gated by `pretool-block-production-files.sh`)

| # | Path | Currently blocked? |
|---|------|-------------------|
| E1 | `Edit /etc/systemd/system/happy-daemon-dev.service` (change ExecStart, breaks daemon) | PARTIALLY — lines 66–80 of `pretool-block-production-files.sh` block writes that introduce `/usr/bin/happy` into ExecStart/ExecStop, but ANY OTHER edit to that unit file is allowed. Disabling, swapping the binary path to `/dev/null`, removing the service entirely — none of those are blocked. |
| E2 | `Edit /etc/systemd/system/happy-daemon.service` (production unit) | NOT BLOCKED — the only path-coverage in this hook is `/root/happy/`, `/root/.happy*/`, `/usr/lib/node_modules/happy*`, `/usr/bin/happy*`. `/etc/systemd/system/` is uncovered. |
| E3 | `Edit /etc/systemd/system/happy-daemon-dev.service` to remove ExecStop/Restart=on-failure | NOT BLOCKED |
| E4 | `Write /etc/systemd/system/happy-daemon-dev.service.d/override.conf` (drop-in override) | NOT BLOCKED — the path-prefix gate only matches the unit file itself, not its drop-in dir. |
| E5 | `Write /etc/systemd/system/happy-restart-shadow.service` (a NEW unit that wraps `systemctl restart happy-daemon-*`) | NOT BLOCKED |
| E6 | `Edit /root/bin/happy-restart.sh` itself | BLOCKED — `pretool-block-production-files.sh` does NOT cover `/root/bin/`, but the bash hook line 345 blocks BASH invocation. Edits TO the script are not blocked, only Bash invocations OF the script. |
| E7 | `Edit /root/.claude/hooks/pretool-bash-safety.sh` to remove the rule | PARTIAL — `.claude/hooks/**` writes are allow-listed in `settings.json` (line 237–238). Anyone with Edit access can rewrite the hook. |
| E8 | `Edit /root/bin/safe-swap-drain.sh` or other admin scripts to add a daemon-restart sidecall | NOT BLOCKED |
| E9 | `Write /tmp/anything.sh` containing systemctl invocations | NOT BLOCKED — the outer hook only fires when the file is INVOKED, not when it is written. By the time it runs, the systemctl rule re-gates — UNLESS the unit is `happy-daemon-dev`. |

#### Agent-tool / sub-agent dispatch paths (gated by `pretool-orchestrator-prompt-purity.py`)

| # | Path | Currently blocked? |
|---|------|-------------------|
| A1 | Orchestrator dispatches a subagent with prompt "restart happy-daemon-dev" | The purity hook scans for "shell-command tokens" (sed/awk/curl/.../systemctl included via `SHELL_COMMANDS` list at line 95). A prompt containing `systemctl restart …` would match `SHELL_COMMAND_PATTERNS` only if it also matches `\s+(?:-{1,2}[A-Za-z][\w-]*\|<<\s*['\"]?\w+['\"]?\|>>?\s*\S\|2>&?\d?\|\|)` — i.e. it's looking for systemctl with FLAGS or pipes. A bare "use systemctl to restart happy-daemon-dev" might miss. **Coverage is brittle.** |
| A2 | Orchestrator dispatches: "Please ensure happy-daemon-dev is fresh; do whatever is needed" | NOT BLOCKED — natural-language indirection is not in the purity hook's regex. |
| A3 | Subagent (already running) calls `systemctl restart happy-daemon-dev` itself | Same Bash gate as B1 — currently allow-listed. |
| A4 | Subagent invokes a script that internally restarts | Same as B17–B21 surface. |

### Defense-in-depth architecture (recommendation)

Treat this as a **four-layer defense** with one explicit, time-bounded user grant. Every layer must independently fail-closed; one layer's bypass cannot reach the daemon.

```
Layer 1: Bash command gate         — /root/.claude/hooks/pretool-bash-safety.sh
Layer 2: Edit/Write path gate      — /root/.claude/hooks/pretool-block-production-files.sh
                                     (extended to cover systemd unit files + drop-ins)
Layer 3: Agent prompt gate         — /root/.claude/hooks/pretool-orchestrator-prompt-purity.py
                                     (extended with a daemon-restart-prompt category)
Layer 4: Hook self-protection      — write-guard for hook files themselves
                                     (already partially exists in pretool-write-guard.sh)

Grant channel: explicit user-touched sentinel file + time-bounded TTL
```

#### Layer 1 — Bash gate (closing C3 entirely)

**Rule change**: remove `happy-daemon-dev` from `DEV_SYSTEMD` whitelist. With that one change, `check_systemctl_targets_all_dev` returns 1 for ALL happy-daemon-* units, the existing block fires, and B1/B3/B4/B5/B6/B7/B8/B9/B10/B11/B12/B23 all fail closed.

**New block rules** (cover the remaining holes):

1. `kill -HUP|-USR1|-USR2 …` near a `happy-daemon` token — already covered by the broad `kill -` rule (line 421).
2. `nc … <localhost-port>` AND `/stop` AND `daemon` co-occurrence — block raw TCP to daemon control.
3. `systemd-run`, `at`, `batch`, `crontab` — block these wrapper invocations entirely or block them when the body contains `happy-daemon`. systemd-run with a transient unit is a direct bypass of `systemctl` semantics.
4. `dbus-send`/`busctl` referencing `org.freedesktop.systemd1` AND a happy unit — block.
5. `bash <`(process substitution`)` and `bash -c '…'` containing `happy-daemon` AND `restart|stop|disable|enable` — block (defense in depth even when unit token also blocked).
6. **A new "wrapper-script-on-disk" rule**: if `bash /tmp/*.sh` or `bash /var/tmp/*.sh` is invoked, require a sentinel that the file was hashed and inspected. Realistic alternative: explicitly block `bash /tmp/*.sh` and `bash /var/tmp/*.sh` and `bash /dev/shm/*.sh` for the orchestrator AND subagents (the current hooks don't gate temp-script invocation, which is the durable bypass class).

**Compound-form coverage**: the existing splitter handles `&&`, `||`, `;`. It does NOT split on:
   - `|` (pipe — splitter consumes it as a single chain in some Python branches but the bash splitter on lines 44/57/84 only splits on `&&`/`||`/`;`)
   - command substitution `$(…)` and backticks
   - heredoc body
   - `<()` process substitution

Recommendation: extend the splitter to also break on `|`, then run the same `grep -qE` against each piece. For `$(…)` / heredoc / process-sub, document them as out-of-scope (full shell parser is the only correct fix; that is too heavy) but compensate by blocking the wrapper invocations themselves (e.g. `bash -c`, `eval`, `sh -c`, `nc`, `systemd-run`) when their body string contains `happy-daemon` and `(restart|stop|disable|enable|kill|hup)`.

#### Layer 2 — Edit/Write gate

Extend `pretool-block-production-files.sh` to additionally block:

- Any path under `/etc/systemd/system/happy-daemon-*.service` (current hook only blocks specific binary references inside `happy-daemon-dev.service`; replace with full-file lockdown — the user is the only legitimate editor)
- Any path under `/etc/systemd/system/happy-daemon-*.service.d/` (drop-in overrides)
- New unit files: any `*.service` under `/etc/systemd/system/` whose body contains `happy-daemon` or `systemctl restart happy-daemon` (this needs content scan; Edit hook receives `new_string` already — extend the `happy-daemon-dev.service` check pattern to all happy-daemon units)
- `/root/bin/happy-restart.sh`, `/root/bin/happy-session-recovery.sh`, `/root/bin/safe-swap-drain.sh`, `/root/bin/auto-safe-swap-drain.sh` — already protected against bash invocation but not against Edit/Write. Add path-prefix block to prevent the orchestrator from rewriting them to bypass.
- `/root/.claude/hooks/pretool-bash-safety.sh`, `pretool-block-production-files.sh`, `pretool-orchestrator-prompt-purity.py` — must be Write/Edit blocked from subagents (orchestrator allowed only with explicit user grant). The current `permissions.allow` in settings.json is `Edit(.claude/hooks/**)` — too permissive. Move to `permissions.ask` or to a dedicated hook-edit guard that requires a sentinel.

#### Layer 3 — Agent dispatch / prompt gate

Extend `pretool-orchestrator-prompt-purity.py` with a new category `daemon-restart-prescription`:
- Match if prompt contains any of `(restart|reload|stop|disable|kick|cycle|bounce)` AND `(happy-daemon|happy-cli daemon|systemctl)` AND not redacted to a USER_VERBATIM region.
- Match if prompt contains `bash /root/bin/happy-restart` OR `safe-daemon-restart` AND any imperative verb.
- Match if prompt instructs the subagent to "ensure daemon is fresh", "make the daemon pick up the new build", "restart the dev daemon" — natural-language paraphrases are the durable bypass class.

For the natural-language category, a regex-only approach will always be lossy. Suggested compromise:
- Hard regex hits → exit 2 (block).
- Soft hits (verb + "daemon" within N tokens) → exit 0 with WARN to stderr that goes into the audit log; user reviews next conversation turn.

Apply the SAME purity scan to **subagent-emitted Agent dispatches**. The current hook exempts subagents (`agent_id` truthy → return None at line 316). For C3, daemon-restart prompts must be blocked regardless of who the dispatcher is.

#### Layer 4 — Hook self-protection

The hook directory itself must be the harder-to-modify perimeter. Today:
- `permissions.allow` includes `Write(.claude/hooks/**)` and `Edit(.claude/hooks/**)`.
- The Bash hook doesn't block Edits to `~/.claude/hooks/*.sh` (only writes through Bash redirect).

Recommendation:
- Demote hook-file Edit/Write to `permissions.ask`.
- Add `pretool-block-production-files.sh` coverage for `/root/.claude/hooks/pretool-bash-safety.sh` etc., requiring an explicit sentinel before edits.
- Optional defence-in-depth: a `hooks/.integrity` file with sha256 of every hook script, validated by a `SessionStart` hook. Modifications without the user re-stamping `.integrity` cause a session-start error.

### Allow-channel UX — explicit user grant

Single-shot, time-bounded, sentinel-file based. The mechanism exists in spirit in `userprompt-consent-allowlist.sh` + `/tmp/claude-bash-allowlist-<sid>.json`; extend that pattern for daemon restart specifically.

#### Recommended channel

**A sentinel file** at `/tmp/claude-allow-daemon-restart-<target>.flag`. The file contains a JSON record:
```
{
  "target": "dev|default|jade|qijie|all",
  "expires_at": "2026-05-04T22:35:00Z",
  "granted_by": "user-tty",
  "session_id": "abc-123",
  "single_shot": true
}
```

#### Lifecycle invariants

1. **Created only by the user**, not by Claude. The Bash hook must block writes to `/tmp/claude-allow-daemon-restart-*.flag` from any tool source. The user creates it via a shell command run from a real TTY (outside Claude).
2. **TTL ≤ 60 seconds** — short enough that an idle Claude can't accumulate grants, long enough for a single restart. Hooks check `expires_at` on every consume.
3. **Single-shot** — consumed (unlinked) atomically by the bash hook on first match. Even within the TTL, second invocation of `systemctl restart happy-daemon-…` fails closed.
4. **Target-specific** — a grant for `dev` does NOT permit `default`. The hook compares the systemctl unit name to the flag's `target` field.
5. **Session-bound** — `session_id` must match the current session. Cross-session leakage is blocked. (Mirrors the existing `userprompt-consent-allowlist.sh` design — see lines 130–137 of `pretool-bash-safety.sh`.)
6. **Atomic consume under flock** — same pattern already used in `check_and_consume_allowlist` (lines 219–298): open with O_CREAT|O_RDWR, flock LOCK_EX|LOCK_NB with bounded retry, read-match-unlink while lock held. Reuse that scaffolding.
7. **Audit log entry** — every grant/consume/expire writes to `/var/log/claude-daemon-restart-grants.log` with timestamp, session, target, outcome.
8. **No env-var alternative** — env vars leak through subprocess inheritance; sentinel file is the only audit-able grant channel.
9. **No RPC alternative** — local HTTP RPC would itself be a new bypass surface. Filesystem sentinel is the simplest provable interlock.

#### Why single-shot beats time-bounded-multi-use

- Multi-use within TTL would let a misbehaving subagent fire two `systemctl restart` calls during the grant window. Single-shot caps damage at exactly one restart.
- "Multi-use within 60s" is hard to reason about for the user; "your one restart command" is cognitively simple.
- If the user needs two restarts (e.g. dev daemon AND web container), the simple answer is "touch the sentinel twice in succession" — but a cleaner answer is to make the per-target restart script idempotent enough that two grants are never needed.

#### Suggested user command (for documentation; not for Claude to run)

```
/root/bin/claude-allow-restart <target> [--ttl 60]
```

This script (user-only) writes the sentinel and prints the matching `systemctl restart …` for the user's audit trail. Claude's hooks consume the sentinel; Claude never writes it.

### Filesystem-watch for systemd unit edits — secondary alarm

The Edit gate (Layer 2) is the primary defense for unit-file modification. A complementary **fswatch** alarm on `/etc/systemd/system/happy-daemon-*.service*` can:
- Notice if the unit file changes via any path (Edit, Write, Bash, sudo)
- Append every change to an audit log
- Optionally emit a desktop notification if changed outside an active grant window

This is a detection layer, not a block layer. The block layer (Layer 2) must stand on its own.

### Subagent-bypass attempts and their counters

| Attempt | Counter |
|---------|---------|
| Edit a hook file to weaken it | Layer 4 (hook write-guard); + subagent has no Edit on `.claude/hooks/**` once permissions are demoted |
| `Write /tmp/foo.sh` containing the restart sequence; then `bash /tmp/foo.sh` | New Layer 1 rule: block `bash /tmp/*.sh` for orchestrator AND subagents |
| `nohup`, `disown`, `systemd-run`, `at`, `crontab` wrappers | New Layer 1 rule: block these as command-token prefixes whenever body contains daemon/restart vocabulary |
| `eval` / `bash -c` / `sh -c` with concatenated daemon command | Same Layer 1 rule applied recursively to inner command string |
| Reflection through Python: `subprocess.run([…])` | Layer 1 rule extended: `(python3?\|node)\s+-c\s+['"].*systemctl.*happy-daemon` |
| Spawn a long-running watcher that runs `systemctl restart` later | Layer 1 rule on `systemd-run`, `at`, `batch`, `cron` invocations; cron file edits already covered if cron files are in `/etc/cron.*/` and we add path coverage |
| Agent-tool dispatch saying "make the daemon fresh" | Layer 3 daemon-restart-prescription category (with the natural-language soft-hit caveat) |
| Editing `/etc/systemd/system/happy-daemon-dev.service.d/override.conf` to break the daemon, then waiting for systemd to fail it | Layer 2 path coverage extended to `*.service.d/` |
| Sending HTTP `/stop` to the local daemon control port | Layer 1 rule: block curl/wget/nc to localhost ports listed in `daemon.state.json`. Practically: block any HTTP body containing `/stop` to `localhost:` or `127.0.0.1:` regardless of port. |
| Calling `dbus-send --system org.freedesktop.systemd1 …` | Layer 1 rule: block `dbus-send`/`busctl` whenever args contain `systemd1` and a happy-daemon unit |

### Pattern-level observations (cross-cutting)

1. **Whitelist-by-name is fragile.** Today's bash hook uses an explicit `DEV_SYSTEMD="happy-daemon-dev"` whitelist. A name-whitelist makes "deny all daemon-restart" a one-line change (delete the whitelist entry) — that's the simple, low-risk fix.

2. **Splitter scope is the durable failure class.** `&&`/`||`/`;` are split, but `|`, `$( )`, heredoc, `<( )` are not. Every hook-bypass postmortem in this codebase eventually points back to splitter scope. The structural answer is to BLOCK wrappers that contain daemon vocabulary, not to perfect the splitter.

3. **Hook files are stored in a directory the orchestrator can write to.** This is the largest structural risk: any defense added to a hook can be removed by editing the hook. Until hook write permissions are demoted to `ask`, the rest of the layered defense is conditional. Layer 4 must land first; everything else after.

4. **Content-scan on Write/Edit is already present** for one specific case (`happy-daemon-dev.service` ExecStart binary check, lines 66–80 of `pretool-block-production-files.sh`). The same pattern can be generalised to any systemd unit file under `/etc/systemd/system/happy-daemon-*` — block ANY edit unless the user-grant sentinel is present.

5. **Existing `/allow` mechanism is well-engineered** (atomic flock consume, SIGALRM regex timeout, structured audit log at `~/.claude/logs/bash-consent.log`). Reuse it for the daemon-restart grant. Adding a NEW grant mechanism would multiply audit surfaces.

---

## Cross-concern observations

1. **C1's per-stack support requires C3 first.** If `happy-restart.sh` learns `--target dev`, the Bash hook still has the `happy-daemon-dev` whitelist; nothing prevents the orchestrator from invoking the new script with `--target all` (which restarts production). C3 closes that hole at the hook layer; C1 can safely ship after.

2. **The new per-target restart script is itself a bypass surface.** Once C1 lands, `bash /root/bin/happy-restart.sh --target dev` is a trivial alias for `systemctl restart happy-daemon-dev`. The existing line-345 block on `happy-restart` already covers this — but only when the script is invoked by name. Verify after C1 that the line-345 regex still matches the new invocation form (it does — substring match on `happy-restart`).

3. **Audit logs unify both concerns.** Both C1 and C3 should append to `/var/log/happy-restart.log` and `/var/log/claude-daemon-restart-grants.log` respectively. Cross-checking those two logs reveals the (grant, restart) pairs and any unmatched restart attempts.

4. **No emoji, no decoration in hook stderr.** All existing hooks emit clear stderr blocks (`BLOCKED: …`). New rules should follow the same shape: header line, command echo, REASON line, exit 2.

5. **Test surface for hooks is ad-hoc.** `/root/.claude/hooks/tests/` exists but has minimal coverage of the systemctl rules. Any C3 hook change should land alongside a test case for: (a) bare `systemctl restart happy-daemon-dev` blocked, (b) chained form blocked, (c) wrapper forms blocked, (d) sentinel-grant single-shot consumes correctly, (e) sentinel-grant TTL expiry works.

---

## Summary recommendations

### For C1 (per-stack happy-restart.sh)

1. Replace the hardcoded daemon list with a **target dispatch table**, keyed by `dev|default|jade|qijie|all`, with per-target `systemd_unit`, `home_dir`, `binary_dist_glob`, `docker_services`, `server_url_default`.
2. **Parameterise the binary health gate** by the target's dist glob; dev gates against worktree dist, prod targets gate against `/usr/lib/node_modules/happy-coder/dist/`.
3. **Conditional Docker step** — `--target dev` skips Docker entirely (or uses dev counterparts via separate flag).
4. **Per-target session save/recover** — pass HAPPY_HOME_DIR through `happy-session-recovery.sh`.
5. **Per-target lockfile** — concurrent invocations of different targets allowed; same target serializes.
6. **Per-target detached-process kill** — restrict the `pgrep` to children of the target's daemon home.

### For C3 (permanent daemon-restart prohibition)

1. **Remove `happy-daemon-dev` from `DEV_SYSTEMD` whitelist** in `pretool-bash-safety.sh`. Single-line policy change closes the reported bypass.
2. **Add wrapper-class block rules** (Bash hook): `systemd-run`, `at`, `batch`, `crontab`, `nohup`/`disown`/`watch`/`timeout` co-occurrence with daemon vocabulary, `nc`/`dbus-send`/`busctl` with daemon vocabulary, `bash /tmp/*.sh`/`bash /dev/shm/*.sh`/`bash /var/tmp/*.sh`, `eval`/`bash -c`/`sh -c` with embedded daemon-restart strings, `python3 -c "subprocess.run(...)"` with daemon-restart strings.
3. **Extend Edit/Write gate** to cover all `/etc/systemd/system/happy-daemon-*.service` paths and their `.service.d/` drop-in dirs; cover `/root/bin/happy-restart.sh`, `/root/bin/happy-session-recovery.sh`, `/root/bin/safe-swap-drain.sh`, `/root/bin/auto-safe-swap-drain.sh` against Write/Edit; cover `.claude/hooks/*` against Edit/Write (demote to `permissions.ask`).
4. **Extend Agent prompt purity gate** with a new `daemon-restart-prescription` category covering imperative restart verbs adjacent to daemon vocabulary, AND apply the same scan to subagent-emitted Agent dispatches (don't exempt by `agent_id`).
5. **Single-shot, target-specific, TTL≤60s sentinel-file grant** at `/tmp/claude-allow-daemon-restart-<target>.flag`. Reuse the existing flock+SIGALRM atomic-consume scaffolding from `check_and_consume_allowlist`. User creates the sentinel from a real TTY; Claude never writes it (Bash hook blocks writes to that path glob from any tool).
6. **Filesystem-watch alarm** on systemd unit files as detection layer; not a substitute for Layer 2.
7. **Hook integrity layer** — sha256 manifest of hooks, validated at `SessionStart`; modifications without re-stamp emit a session warning. Lower priority than 1–6 but desirable.

### Sequencing

C3 first (closes the policy bypass; small surface change). C1 second (relies on C3 to ensure the new `--target` flag can't be abused). Hook integrity layer third (defense in depth; not blocking).

---

**End of report.**
