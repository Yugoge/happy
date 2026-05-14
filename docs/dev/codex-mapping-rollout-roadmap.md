# Codex Mapping Rollout Roadmap — fd-scan Deprecation Chain

**Created**: 2026-05-14
**Task ID**: 20260514-093200
**Predecessor cycles**:
  - 20260513-211054 (commit `38f6bac4`) — M1-M9 + S1 codex biological-child parity; Could-Have C2 (fd-scan deprecation roadmap) deferred
  - 20260514-093200 (this cycle) — M1' (mapping-health telemetry), M2', M3' landed; M4' = this doc
**Cross-links**:
  - `docs/dev/recovery-script-patches-20260513-211054.md` — Blocks 0-4 patch set for `/root/bin/*`
  - `docs/dev/ticket-20260513-211054.md` — prior cycle Could-Have C2 (deferred)
  - `docs/dev/ticket-20260514-093200.md` — this cycle's ticket (AC1 + AC5)
  - `packages/happy-cli/src/daemon/controlServer.ts` — M1' `mappingStats` exposure point
  - `packages/happy-cli/src/codex/codexMappingDaemon.ts` — M1' counter source + M3' cgroup upsert

---

## Purpose

`scan_codex_via_fd` (in `/root/bin/happy-session-recovery.sh`) is the legacy fallback path that discovers codex sessions by scanning `/proc/<pid>/fd/*` for open codex socket descriptors. It exists because the canonical mapping file (`$HAPPY_HOME_DIR/codex-mapping.json`, written by the daemon, M3 from prior cycle) is too new to be trusted as the sole source on production daemons that may not yet run the mapping-writer binary.

This document specifies the **preconditions that MUST be satisfied** before `scan_codex_via_fd` can be removed from the recovery script. Each step blocks the next; skipping a step risks silently losing recovered sessions.

## Telemetry distinction (critical — do not conflate)

This roadmap references two counters that look superficially similar but answer different questions:

| Counter | Source | Surface | Question it answers |
|---|---|---|---|
| `mappingStats.sweepRemovedCount` (and the 3 derived counts) | TypeScript daemon — see `codexMappingDaemon.ts MappingStats` TSDoc | `POST /list` response root (`mappingStats` field) | "Is the daemon's codex-mapping.json file itself healthy? Is the periodic/startup sweep removing dead-pid or stale-pending entries?" |
| bash-side fd-scan fallback firing counter | `/root/bin/happy-session-recovery.sh` — Block 3 of `recovery-script-patches-20260513-211054.md` | bash log file / cron-readable count file | "Has the recovery script's mapping-primary path ever failed, forcing a fallback to /proc fd-scan? If so, how often, since when?" |

**M1' is mapping-health telemetry only, NOT a replacement for the bash-side fd-scan fallback counter from Block 3.** Both must independently read zero before `scan_codex_via_fd` is removable.

## 5-step deprecation precondition chain

### Step 1 — Blocks 3 AND 4 land on `/root/bin/*`

Per ticket-20260514-093200 AC5 step 1, BOTH blocks must land before the roadmap proceeds:

- **Block 3** (in `recovery-script-patches-20260513-211054.md`): makes `scan_codex_via_mapping` the PRIMARY codex discovery path in `/root/bin/happy-session-recovery.sh` and adds the fd-scan-fallback firing counter (`SOURCE 3b` in the patch doc).
- **Block 4** (in `recovery-script-patches-20260513-211054.md`): applies the flavor-gate dispatch guard (M8) in `/root/bin/happy-restart.sh` so flavor-aware respawn is consistent across the recovery + restart entrypoints.

Both blocks are subagent-blocked by `pretool-block-production-files.sh`; user applies manually.

**Done when**:
- `grep -c scan_codex_via_mapping /root/bin/happy-session-recovery.sh` ≥1 AND the fd-scan firing counter increments to a file (or journal) on each fallback firing.
- The flavor-gate guard from Block 4 is present in `/root/bin/happy-restart.sh`.

### Step 2 — M1' `mappingStats` reports non-zero entry counts on the dev daemon

After the user-side dev daemon rebuild (manual, `我手动做`) and restart with the new binary, the daemon-side codex-mapping controller (M3 from prior cycle + M3' from this cycle) starts populating `codex-mapping.json`. The /list endpoint then surfaces non-zero `entryCount`, `boundCount`, and a stable or accumulating `sweepRemovedCount`.

**Done when**: `curl -s -XPOST http://127.0.0.1:<dev-daemon-port>/list | jq '.mappingStats'` returns `{entryCount: >=1, pendingCount: >=0, boundCount: >=1, sweepRemovedCount: ...}` after at least one codex session has bound.

### Step 3 — Confirm M3 + M3' + M6 mapping-writer + mapping-primary deployed on ALL daemon homes (BEFORE Step 4 observation window starts)

Deployment MUST be verified before the N-week zero-fallback observation begins; otherwise the observation window is meaningless (the bash counter cannot fire if the recovery script hasn't been patched yet, but that absence of firings tells us nothing about mapping reliability).

Per CLAUDE.md "Three Daemon Binary Architecture", each daemon home reads from a different source tree (codex round-3 F5 correction):

| Daemon | Source tree (running binary) | Verification command |
|---|---|---|
| `happy-daemon.service` (default) | `/root/happy/packages/happy-cli/dist/index.mjs` | `node -e 'console.log(JSON.parse(require("fs").readFileSync("/root/happy/packages/happy-cli/package.json")).version)'` |
| `happy-daemon-jade.service` | `/root/happy/packages/happy-cli/dist/index.mjs` (shared with default) | same as above |
| `happy-daemon-dev.service` | `/root/happy-dev/packages/happy-cli/dist/index.mjs` | `node -e 'console.log(JSON.parse(require("fs").readFileSync("/root/happy-dev/packages/happy-cli/package.json")).version)'` |

The reported version must come from a release containing the M3 (prior cycle 20260513-211054 commit `38f6bac4`) and M3' (this cycle) commits.

Recovery script: `grep -c scan_codex_via_mapping /root/bin/happy-session-recovery.sh` must be ≥1.

**Done when**: both checks (binary version + recovery script grep) pass for all three daemon homes.

### Step 4 — fd-scan-fallback bash counter reports 0 firings for N weeks across all 3 production daemon homes

ONLY START THIS OBSERVATION WINDOW AFTER STEP 3 IS GREEN.

For at least 4 consecutive weeks across `/root/.happy/` (default), `/root/.happy-jade/` (jade), and `/root/.happy-dev/` (dev) homes, the bash fd-scan firing counter from Step 1 must remain at zero. This proves the mapping-primary path is reliable in production. M1' `mappingStats.sweepRemovedCount` and `mappingStats.pendingCount` may be inspected during the window as auxiliary mapping-health signals (NOT as a substitute for the bash counter — see telemetry distinction above).

**Done when**: the bash counter file (or `journalctl -u happy-* | grep fd-scan-fallback`) for all three daemon homes shows zero increments across a 4-week observation window AND zero recovered-from-fd-scan sessions appear in `~/.happy*/session_dirs.txt` snapshots over the same window.

### Step 5 — Schedule `scan_codex_via_fd` removal cycle; replace with hard-error if mapping unavailable

With Steps 1-4 satisfied, schedule a new `/redev` cycle that removes the `scan_codex_via_fd` function from `/root/bin/happy-session-recovery.sh`. The replacement behavior must be: if `codex-mapping.json` is missing or empty AND there is no other recovered evidence, the recovery script LOGS a hard error and proceeds WITHOUT inventing codex session entries from fd scanning. This is acceptable because all three daemons by then have been writing the mapping for 4+ weeks; absence means the codex session genuinely does not exist in mapping memory and recovery would be guessing.

**Done when**: a follow-up cycle (separate ticket) ships the removal with explicit user authorization for the `/root/bin/*` edit.

---

## Risks and observations

- **R-1** — `sweepRemovedCount` resets on daemon restart (per-daemon-process accumulator). Step 3's 4-week window therefore depends on daemon uptime; if daemons restart frequently, prefer the bash-side counter (which is durable via the counter file) as the authoritative signal. Mitigation: pair both counters; only deprecate when bash counter reads zero across observation window regardless of daemon restart cadence.
- **R-2** — Mapping-primary path may have race conditions on rapid session creation. Codex round-2 #1 (BA-QA report 20260514-093200) flagged a pre-existing `runStartupSweep` race in `codexMappingDaemon.ts:120-126`. Out of scope this cycle; track in a future hardening pass.
- **R-3** — `mappingStats.pendingCount` should asymptotically approach zero in healthy operation (pending → bound transition completes within `PENDING_TTL_MS = 30s`). A persistently high `pendingCount` is itself a signal that the recovery script's mapping-primary path might miss sessions. Surface this as part of Step 2 done-criterion.

---

## Not in this roadmap

- **persistence.ts:writeDaemonState atomic refactor** — codex round-1 explicit DEFER (HIGH-criticality file); separate cycle with explicit user authorization required.
- **Periodic sweep wiring** — only `runStartupSweep` calls `sweepCodexMapping` today; a future cycle may add a periodic sweep on daemon heartbeat to make `sweepRemovedCount` more informative.
- **Process-title-based session discovery** — M2' (`process.title = happy-codex:<tid suffix>`) is operator observability via `ps`, NOT a programmatic discovery path. Not part of the fd-scan replacement.
- **cgroup-based PID re-binding** — M3' captures cgroup at upsert time for observability; it is NOT a substitute for mapping presence in the recovery flow.
