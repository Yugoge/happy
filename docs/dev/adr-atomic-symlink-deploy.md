# ADR: Atomic-symlink deploys for happy-cli

> **Status**: Proposed (2026-04-30)
> **Decider**: Yugoge (operator)
> **Implementation lead**: TBD
> **Companion**: `scripts/DEPLOYMENT.md`, `scripts/deploy.sh`, `scripts/rollback.sh`
> **Estimated effort**: ~3 day-equivalents (Phase 1 + Phase 2 below)

---

## Context

### The current pain point

Today's deploy flow (`scripts/deploy.sh` step 10):

```
npm install -g .     # from /root/happy
```

This overwrites `/usr/lib/node_modules/happy-coder/` **in place**. While files
are partially written, the 3 prod daemons (`happy-daemon`, `happy-daemon-jade`,
`happy-daemon-qijie`) are still running old code. Within 60s of install
completion, each daemon's heartbeat compares on-disk `package.json.version`
against the version compiled into its in-memory `dist/`, detects mismatch,
and self-respawns via `auto-upgrade`.

**Self-respawn = cgroup-kill of all session children.** The sessions are
expected to recover via `--resume <UUID>`, but:

1. **In-flight generation is lost**. If Claude was mid-output when the cgroup
   killed it, the partial response is gone. The session resumes but the
   user sees a truncated reply or has to retry.
2. **Sessions outside `session_dirs.txt` cannot recover at all.** This is
   the codex registration gap — `codex/runCodex.ts:710-713` and
   `codex/resumeExistingThread.ts:35-38` only call `session.updateMetadata`,
   not `notifyDaemonSessionStarted`. As of 2026-04-30, 5 codex sessions on
   the dev daemon are unregistered and would not survive a deploy.
3. **All 3 daemons restart simultaneously.** Thundering-herd recovery on a
   single 16-vCPU server: every session tries to re-establish WebSocket,
   re-read `.jsonl` history, replay state in parallel. The session-watcher
   service (`happy-session-watcher.service`) is also reading `session_dirs.txt`
   during this window — race risk.
4. **Partial-write window**. If `npm install -g` is interrupted (network
   blip, `^C`), the global install is left half-written. A daemon
   heartbeat that fires during this window may crash trying to load a
   syntactically-incomplete module.

### Why .gitattributes / merge=ours doesn't fix this

The current deploy.sh hardens the **git side** (protected paths, version
sanity, push deferral). The session-loss problem lives one layer below in
the **install + restart side**. No git-level change can fix it.

### Why the existing recovery system isn't enough

`/root/bin/happy-session-recovery.sh` is best-effort:

- Snapshots `session_dirs.txt` periodically (15min interval)
- On `restore`, tries to spawn each known session via `--resume <UUID>`
- Sessions outside the manifest are invisible to it (codex gap)
- In-flight generation state is never persisted; only message history is

A deploy that loses 0 sessions is currently **architecturally impossible**.

---

## Decision

Adopt a two-phase migration:

### Phase 1 — Atomic install path (eliminates partial-write window)

Install each new version into a **versioned directory**, then atomically swap
a symlink. No more in-place overwrite of `/usr/lib/node_modules/happy-coder`.

```
/opt/happy/
├── current   →  v0.14.3   (symlink, atomically swapped)
├── v0.14.0/             (kept for rollback)
├── v0.14.1/
├── v0.14.2/
└── v0.14.3/             (newly installed)
```

`/usr/bin/happy` is a symlink (or thin wrapper) pointing to
`/opt/happy/current/packages/happy-cli/dist/cli.mjs`.

systemd units launch with:

```
ExecStart=/usr/bin/node /opt/happy/current/packages/happy-cli/dist/index.mjs daemon start
```

**Deploy**:

1. Build new version into `/opt/happy/v<version>/` (untouched dir)
2. `ln -sfn /opt/happy/v<version> /opt/happy/current` (atomic symlink swap)
3. Existing daemons keep running old version (their open file descriptors
   pin the old binary)
4. Trigger daemon graceful restart (Phase 2)

**What this solves**:
- ✅ Partial-write window — install is to a new dir, never visible until swap
- ✅ Rollback is instant — `ln -sfn` to old version dir
- ✅ Old binary stays available on disk for forensic inspection
- ✅ No more cgroup-kill **caused by file overwrite mid-write**

**What this does NOT solve**:
- ❌ Daemons still need to restart to pick up new code (cgroup-kill still
  happens, just deterministically rather than mid-write)
- ❌ In-flight Claude generation state still lost on restart
- ❌ Codex registration gap — orthogonal problem

### Phase 2 — Graceful daemon handoff (eliminates cgroup-kill)

Replace heartbeat-driven `auto-upgrade self-respawn` with a **two-daemon
handoff** protocol:

1. New daemon spawns from `/opt/happy/current/...` after symlink swap
2. New daemon binds to a different ephemeral port (it's already designed for
   this — `daemon.state.json` stores `httpPort`)
3. New daemon pings old daemon's HTTP control endpoint with a
   `prepare-handoff` request
4. Old daemon: stops accepting new RPC calls, finishes draining in-flight
   message-send queues, exports session-state to `~/.happy*/handoff.json`
5. Old daemon writes "handoff-ready" + sends `SIGUSR1` to new daemon
6. New daemon reads `handoff.json`, takes over WebSocket connections,
   inherits session-process PIDs (via the existing daemon-attach pattern)
7. Old daemon exits cleanly (NOT cgroup-kill — sends SIGTERM to its own
   process, child PIDs are already adopted by the new daemon's process group)

**What this solves**:
- ✅ Sessions transition without cgroup-kill — Claude SDK processes keep running
- ✅ In-flight generation state is preserved through the swap
- ✅ Server-side reconnect is clean (single brief WebSocket reopen, not full
  session restart)

**Why this is hard**:
- POSIX process group inheritance across un-related daemon processes is
  non-trivial. Need to use `setpgid` carefully or accept a brief reparent
  window.
- Each daemon currently owns its sessions in-memory (RPC handler maps,
  WebSocket auth tokens, encryption-key cache). The handoff serializes
  this state to disk and rehydrates — bug-prone.
- The Claude SDK child processes are already designed to outlive their
  parent (they reconnect via `--resume` if the daemon dies and respawns).
  We extend this so they don't need to reconnect at all when the new
  daemon takes over.

### Phase 3 (deferred, optional) — Sessions independent of daemon

Make session processes connect directly to happy-server via their own
WebSocket, bypassing the daemon for message routing. Daemon becomes purely
an orchestrator (spawn/respawn) and a heartbeat reporter, not a router.

**Why deferred**: large refactor across `apiSession.ts`, `apiMachine.ts`,
`run.ts`. Probably 5+ day-equivalents. Phase 1 + Phase 2 already gets
~95% of session continuity; Phase 3 chases the last 5%.

---

## Consequences

### Positive

- **Deploys become near-instant** for the file-swap step (`ln -sfn` is a
  single inode update). The slow part shifts to test-gate + verification.
- **Rollback is trivial**: re-point the symlink. No `git reset --hard`,
  no `npm install -g`, no second build.
- **Forensic recovery**: previous N versions stay on disk for inspection.
- **Disk usage rises**: ~50–100MB per version. Garbage collect to last 5.
- **Session continuity dramatically improved** (Phase 2): in-flight state
  preserved through restart.

### Negative

- **systemd unit changes required** — one-time edit of
  `happy-daemon.service`, `happy-daemon-jade.service`,
  `happy-daemon-qijie.service`, `happy-daemon-dev.service` to point at
  `/opt/happy/current/...` instead of `/usr/lib/node_modules/happy-coder/...`.
  Hook-blocked from agent — operator-only.
- **One-time migration is risky**: cutover from current `npm install -g`
  layout to versioned `/opt/happy/` layout is a single non-atomic event.
  Schedule during low-traffic window with all 3 daemon snapshots saved.
- **Disk garbage collection**: needs cron or a `prune-old-versions.sh`
  helper to keep `/opt/happy/` from filling.
- **Phase 2 is genuinely complex** — daemon handoff is the kind of thing
  that's "simple in theory, brittle in practice". Allocate test budget
  for it.
- **Tooling drift**: `npm install -g happy-coder@latest` (the current
  ad-hoc upgrade path) breaks. Replace with `bash scripts/install-version.sh
  <version>`.

---

## Implementation plan

### Phase 0 — Pre-work (orchestrator-runnable)

- [x] `scripts/deploy.sh` + `scripts/rollback.sh` written, codex-reviewed,
      tested (24 scenarios)
- [x] `scripts/DEPLOYMENT.md` operator runbook
- [x] This ADR
- [ ] Decide whether to do Phase 1 alone or commit to Phase 1+2

### Phase 1 — Atomic install path (~1 day)

User-executable steps marked **(operator)**:

1. **(operator)** Choose `/opt/happy/` (or `/var/lib/happy/`) as version root
2. Write `scripts/install-version.sh`:
   ```bash
   #!/bin/bash
   # Install current /root/happy as a new versioned dir
   set -euo pipefail
   VERSION=$(cd /root/happy/packages/happy-cli && jq -r .version package.json)
   TARGET="/opt/happy/v${VERSION}"
   [ -e "$TARGET" ] && { echo "version already installed"; exit 1; }
   mkdir -p "$TARGET"
   tar -C /root/happy -cf - --exclude=.git --exclude=node_modules . | tar -C "$TARGET" -xf -
   ( cd "$TARGET" && yarn install --frozen-lockfile && yarn workspace happy-cli build )
   echo "installed to $TARGET"
   ```
3. Modify `scripts/deploy.sh`:
   - Replace `npm install -g .` (line ~300) with `bash scripts/install-version.sh`
   - Add `ln -sfn /opt/happy/v<NEW> /opt/happy/current`
4. Modify `scripts/rollback.sh`:
   - Replace `npm install -g .` with `ln -sfn /opt/happy/v<TARGET> /opt/happy/current`
   - Skip the `yarn install + build` step (already done at install-time)
5. **(operator)** One-time migration:
   - Snapshot all 3 daemons: `bash /root/bin/happy-session-recovery.sh save`
   - Run `bash scripts/install-version.sh` for current prod version
   - Edit systemd units to point at `/opt/happy/current/...`
   - `systemctl daemon-reload && bash /root/bin/safe-daemon-restart.sh ...`
6. Update `tests/scenarios/` to cover atomic-swap path (new S18–S21)
7. Update `scripts/DEPLOYMENT.md` step references
8. Verify with full `tests/run-all.sh`

### Phase 2 — Graceful daemon handoff (~2 days)

1. Design handoff protocol (write a sub-ADR `adr-daemon-handoff-protocol.md`)
2. Add `prepare-handoff` RPC to `daemon/controlServer.ts`
3. Add `accept-handoff` mode to `daemon/run.ts` startup path
4. Implement state serialization (`writeHandoffSnapshot`,
   `readHandoffSnapshot`) covering:
   - Session WebSocket auth tokens
   - Active session-process PIDs + cgroup paths
   - In-flight RPC request map
   - Encryption-key cache
5. Test with sandbox daemon (HAPPY_HOME_DIR=/tmp/sandbox-XXXX)
6. Add scenario tests `S22–S30` for handoff
7. **(operator)** Production rollout — schedule during low-traffic window

### Phase 3 (deferred) — Sessions independent of daemon

Defer until Phase 2 stabilizes for ≥1 month in production.

---

## Risks and mitigations

| Risk | Likelihood | Severity | Mitigation |
|------|------------|----------|------------|
| systemd unit migration breaks daemon startup | Medium | High | Pre-stage units with `Wants=` fallback to old path; rehearse in sandbox first |
| Disk fills with old `/opt/happy/v*/` | High | Low | `prune-old-versions.sh` cron, keep last 5 |
| Phase 2 handoff has edge case (e.g. session WebSocket times out mid-handoff) | High | Medium | Conservative timeouts; old daemon retains ability to abort handoff and keep running |
| Handoff state file gets corrupted | Low | High | Verify with checksum + version field; fall back to cgroup-restart on parse failure |
| `/opt/happy/current` symlink target becomes stale | Low | Medium | Daemon startup verifies symlink target exists; aborts otherwise |
| Operator runs `npm install -g happy-coder@latest` (the old upgrade path) by habit | Medium | High | Block via `pretool-bash-safety.sh` after migration; print loud error in CLI |

---

## Decision points still open

1. **Version root location**: `/opt/happy/`, `/var/lib/happy/`, or
   `/usr/local/happy/`? — recommend `/opt/happy/` (FHS-compliant for
   add-on software).
2. **Version retention count**: 5 versions? 10? — recommend 5.
3. **Garbage collection trigger**: cron, post-install hook, or manual? —
   recommend post-install hook (deterministic).
4. **Phase 2 implementation order**: handoff first, or finish Phase 1
   completely + production-soak before starting Phase 2? — strongly
   recommend the latter. Phase 1 alone reclaims most of the safety budget.
5. **Codex registration gap fix**: should it land before Phase 1 (so
   handoff can correctly enumerate codex sessions) or in parallel? —
   recommend before Phase 1, since the user identified this as a
   watcher-side fix and only the operator can edit `/root/bin/`.

---

## Alternatives considered

### Alt 1: Hot-reload modules without restart

Use Node.js cluster + `process.send` to swap module code in-process. Rejected:
Node module cache is not designed for live replacement. Memory leaks and
module-state inconsistency are nearly certain.

### Alt 2: Process-level checkpoint/restore (CRIU)

Use Linux CRIU to snapshot daemon process and restore against new binary.
Rejected: CRIU support for Node + WebSocket connections is unreliable;
adds OS-level complexity.

### Alt 3: Accept the loss, improve recovery only

Keep current install + restart, focus solely on improving
`happy-session-recovery.sh` (codex gap, faster restart, better cgroup
adoption). Rejected: doesn't help in-flight generation. The 2026-03-29
incident showed that "recovery is best-effort" sets a permanent floor on
session loss.

### Alt 4: Stop using `npm install -g` entirely; deploy via Docker

Containerize happy-cli daemon. Rejected: large rework, breaks the
"daemon spawns Claude SDK as a child cgroup" model that's load-bearing
for current session lifecycle.

---

## Required user actions to start Phase 1

These are the steps the operator (Yugoge) must run because they're
hook-blocked or system-level:

1. Decide on version root path (`/opt/happy/` recommended)
2. Push 3 stable tags to fork: `git -C /root/happy push fork --tags`
3. Push happier-stable backup repo (one-time)
4. After agent writes `scripts/install-version.sh` and updates `deploy.sh`:
   a. Snapshot daemons
   b. One-time install of current prod version into `/opt/happy/v<current>/`
   c. Edit systemd units (4 files in `/etc/systemd/system/`)
   d. `systemctl daemon-reload` + restart daemons via SOP
   e. Verify all 4 daemons came up cleanly
5. Codex-review this ADR (recommended) — adversarial review of Phase 2
   handoff protocol especially.

The agent (Claude Code in this session) cannot do any of items 2, 3, 4 —
they're all hook-blocked or root-level.

---

## References

- `scripts/deploy.sh` (current implementation, 387 lines)
- `scripts/rollback.sh` (current implementation, 568 lines)
- `scripts/DEPLOYMENT.md` (operator runbook)
- `tests/run-all.sh` (24 scenarios)
- `docs/dev/completion-20260429-192017.md` (test harness completion report)
- `packages/happy-cli/src/daemon/run.ts` (auto-upgrade implementation,
  ~line 200–300)
- `packages/happy-cli/src/daemon/controlServer.ts` (RPC handlers, where
  `prepare-handoff` would land)
- `/root/docs/REBOOT-RECOVERY-POSTMORTEM.md` (prior cold-boot recovery work,
  context for handoff design)
- `/root/docs/ALWAYS-ONLINE-PLAN.md` (Plan A — claude-keep-alive partial
  implementation; commit `38226fc9`)
