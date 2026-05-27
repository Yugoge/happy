# BA Specification: Happy Recovery Incident Debt Cleanup

**Request ID**: happy-recovery-debt-20260524  
**Created**: 2026-05-24T09:00:07Z

## Goal
Finish the Happy recovery incident debt cleanup by repairing confirmed operational-script debts first, while keeping `happy-session-recovery.sh` an external operations tool and forbidding Happy source-code changes unless the user explicitly approves them.

## Setup / Environment
- **applicability**: N/A
- **reason**: non-UI -- CLI; cycle does not produce (1) rendered UI changes, (2) browser interaction, (3) Playwright invocation, or (4) screenshot evidence

## Evidence
- **Observed**: User requires: “finish the Happy recovery incident debt cleanup without changing Happy source code unless explicitly approved”; keep recovery external; separate confirmed vs unverified debts.
- **Measured**:
  - Active recovery still external-spawns via `systemd-run`/direct `node` and returns success on child PID only: `/root/bin/happy-session-recovery.sh:1101-1147`.
  - No active tombstone, disaster-mode, `/spawn-session`, `daemon_tracked`, or `external_restored` strings in `/root/bin/happy-session-recovery.sh` (`grep` returned zero matches).
  - Runtime read-only probe: 26 session rows were in daemon `/list`, but many session processes have `PPID=1` and `/list.startedBy="happy directly - likely by user from terminal"`; this confirms apparent daemon visibility without daemon-child ownership.
  - Stable fast-detect and restore-in-progress protections exist: `/root/bin/happy-session-recovery.sh:708-720`, `753-770`.
  - Runtime count drops preserve old `session_dirs.txt`: `/root/bin/happy-session-recovery.sh:506-509`; restore falls back to peak JSON when `session_dirs.txt` is empty: `/root/bin/happy-session-recovery.sh:1294-1305`.
  - Daemon units have no whole-daemon `MemoryMax/MemoryHigh`: `/etc/systemd/system/happy-daemon.service:34-41`, `happy-daemon-dev.service:35-42`; guard targets session units/process groups: `/root/bin/happy-memory-emergency-guard.sh:263-323`, `365-379`.
  - OOM guard logs capture a selected `python -` process with PGID/PID and memory totals, but not enough job/session attribution: `/var/log/happy-memory-emergency-guard.log:33-36`.
- **Expected**: external-tool-only cleanup; no source edits; no daemon-level memory cap; peak/old snapshots must not resurrect manual removals; active/live actions require explicit operator authorization.
- **Gap**: current recovery success/reporting and desired-state rules can still treat externally spawned or stale sessions as durable; OOM evidence is not yet attribution-complete; several adjacent automation changes are unverified.

## Prior Attempts
- Attempt 1 (`docs/dev/ticket-20260523-235421.md`, `dev-report-20260523-235421.json`): fixed stable-loss/restore-lock/OOM guard pieces, but QA failed daemon-owned restore and tombstone producers (`qa-report-20260523-235421.json`). Category: incomplete deeper lifecycle debt.
- Attempt 2 (`dev-report-iter2-20260523-235421.json`): modified `packages/happy-cli` source for daemon `/spawn-session` and tombstones. Current user binding makes that wrong scope unless approved. Category: wrong_scope.
- Attempt 3 (`dev-report-iter3-20260523-235421.json`): added source-aware fail-closed checks around daemon support. Current binding still rejects source-dependent architecture. Category: over-engineered/wrong_scope.
- Current git diff for `packages/happy-cli/**` is empty; do not create a new source diff to “fix” this without approval.

## Ordered Issue List
1. **CONFIRMED — Scope guard**: Future dev must not edit `packages/happy-*`, `/root/happy`, `/root/happy-dev`, or daemon source. If a source change appears necessary, stop with `needs_user_approval`.
2. **CONFIRMED — Recovery spawn truthfulness**: external `systemd-run` restore may remain, but success/durable counts must require daemon `/list` + requested resume/thread mapping proof; otherwise report `external_unverified`, not restored.
3. **CONFIRMED — Desired-state safety**: disable runtime peak resurrection except explicit operator disaster mode; stale `session_dirs.txt` must not resurrect manually removed sessions indefinitely.
4. **CONFIRMED — Preserve good guards**: keep restore-in-progress suppression, stable-low-count abort, daemon-derived `HOME`, and Codex `CODEX_HOME` stripping.
5. **CONFIRMED — OOM evidence**: before any active guard action, capture enough forensic data to name the culprit session/job/process tree, not just `cmd="python -"`.
6. **CONFIRMED — No daemon MemoryMax**: keep daemon units free of `MemoryMax/MemoryHigh/MemorySwapMax`; prefer per-session transient limits, spawn pacing, and emergency guard targeting.
7. **UNVERIFIED — Feature-impact audit**: audit `daily-trade-scheduler`, `auto-safe-swap-drain`, and `happy-daemon-post-start` for behavior changes before modifying them.
8. **UNVERIFIED — Six-hour jobs scan**: no literal six-hour Happy unit was found in current grep/systemd timer output. Dev must first locate expected artifact/behavior; do not invent a new timer without evidence.
9. **CONFIRMED — Claude Code consultation**: attempted real `claude --print` consultation failed with `Not logged in · Please run /login`; record fallback self-review, do not claim success.

## Acceptance Criteria
- **AC1** GIVEN current external recovery restore WHEN a session is spawned THEN the report distinguishes `process_spawned`, `daemon_list_verified`, and `durable_restore_count`; durable count increments only on `/list` + resume/thread proof.
- **AC2** GIVEN runtime count drops or stable low counts WHEN watcher evaluates them THEN it does not auto-restore from peak and does not overwrite/retain state in a way that resurrects manual removals without explicit disaster/operator intent.
- **AC3** GIVEN a restore lock exists WHEN watcher sees process-list changes THEN fast-detect remains suppressed.
- **AC4** GIVEN restored Claude/Codex sessions WHEN spawned externally THEN `HOME=/root` (or daemon home) is explicit and Codex does not inherit stale `CODEX_HOME`.
- **AC5** GIVEN memory pressure WHEN guard acts THEN logs include selected PID/PGID, cgroup, cwd, parent chain, Happy session/thread id if available, top memory totals, and reason; daemon units still have no coarse memory caps.
- **AC6** GIVEN daily-trade/swap-drain/post-start/six-hour concerns WHEN dev starts each iteration THEN it first produces read-only audit evidence and changes only the single named issue.

## Files
- **In scope for future external-tool dev**: `/root/bin/happy-session-recovery.sh`, `/root/bin/happy-memory-emergency-guard.sh`, `/root/bin/happy-daemon-post-start.sh`, `/root/bin/auto-safe-swap-drain.sh`, related docs in `docs/dev/**`.
- **Audit-only unless explicitly approved**: `/etc/systemd/system/*.service`, `/etc/systemd/system/*.timer`.
- **Forbidden without explicit approval**: `packages/happy-*`, `/root/happy/**`, `/root/happy-dev/**`, daemon restarts/stops/kills/restores, production web/API access.

## Ambiguities / Assumptions
- “Six-hour jobs scan” lacks a concrete unit/script name. Assumption: dev performs locator/audit only; absence is reported, not implemented from scratch.
- No ambiguity blocks an external-tool-only first pass.
