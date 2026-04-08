# BA Specification: Session Kill Investigation (2026-04-08 09:05 UTC)

**Request ID**: dev-20260408-investigation
**Created**: 2026-04-08T09:30:00Z

## Goal

Determine what killed sessions in the last hour causing the session watcher to trigger auto-restore at 09:05:26 UTC on 2026-04-08, and whether the cascading restore behavior is the real problem.

## Root Cause Analysis: Timeline of Events with Evidence

### Finding: NOT OOM. NOT cgroup. NOT daemon restart. Sessions died naturally (Claude process exit), and the restore logic amplified a single death into a full cascade.

---

### Evidence: No OOM / No cgroup / No kernel kills

- `dmesg -T | grep -i 'oom|killed|out of memory'` -- **empty**. Zero OOM events.
- `journalctl -k | grep 'oom|kill|memory'` -- **empty**. Zero kernel kill events.
- `journalctl | grep 'cgroup|memory|killed'` -- **only baton-host relay noise**, zero memory/cgroup events.
- System memory at time of investigation: 15Gi used / 30Gi total, 18Gi swap free. **No memory pressure.**
- `happy-daemon.service` MemoryHigh=16GB, MemoryMax=20GB. MemoryCurrent=2.1GB, MemoryPeak=2.9GB. **Well within limits.**

### The ACTUAL sequence of events

#### Cascade 1: 07:40 UTC

| Time (UTC) | Event | Evidence |
|------------|-------|----------|
| 07:39:26 | Daemon detects PID 202461 (session `25a67373`) **no longer exists** | Daemon log: `Removing stale session with PID 202461 (process no longer exists)` |
| 07:40:09 | session_history records remove of `25a67373` | `session_history.jsonl` |
| 07:40:10 | Watcher detects 14->13 sessions (-1), triggers auto-restore | Recovery log: `Sessions disappeared (1 removed), triggering auto-restore...` |
| 07:40:24-27 | Restore **kills 7 "orphan" processes** for `/root/.happy` (09b4ed09, 1140deaf, 76f187c1, 817e8407, 8e46a63b, d47a0726, ed24aacd) | Recovery log: `Killed orphaned process for ...` |
| 07:40:26 | Daemon detects 4 more PIDs gone: 202272, 202401, 202608, 202643 | Daemon log: `Removing stale session with PID ... (process no longer exists)` |
| 07:40:29-41:13 | Restore re-spawns all 9 default + 3 jade + 1 dev sessions | Recovery log |
| 07:41:27 | During restore, session `ed24aacd` dies again (newly spawned) | `session_history.jsonl` |
| 07:41:28 | Watcher detects another disappearance, but "Restore already running" | Recovery log |

#### Cascade 2: 09:05 UTC (the reported incident)

| Time (UTC) | Event | Evidence |
|------------|-------|----------|
| 09:03:00 | Session `1140deaf` (PID 289607) still alive, daemon reports webhook | Daemon log: session webhook for PID 289607 |
| 09:05:17 | Session `2f575c9e` (PID 355927) reports webhook | Daemon log |
| **09:05:26** | **Daemon detects PID 289607 (session `1140deaf`) no longer exists** | Daemon log: `Removing stale session with PID 289607 (process no longer exists)` |
| 09:05:24 | session_history records remove of `1140deaf` | `session_history.jsonl` |
| 09:05:26 | Watcher detects 15->14 sessions (-1), triggers auto-restore | Recovery log |
| 09:05:40-42 | Restore **kills 6 "orphan" processes** for `/root/.happy` | Recovery log |
| 09:06:41 | session_history records removal of d47a0726, ed24aacd (killed by restore) | `session_history.jsonl` |
| 09:06:44 | Watcher detects ANOTHER 2 sessions disappeared | Recovery log: `Sessions disappeared (2 removed)` |
| 09:06:44 | "Restore already running (pid 4895), skipping" -- prevents second cascade | Recovery log |
| 09:05:45-07:13 | Restore re-spawns all 10 default + 3 jade + 1 dev = 14 sessions | Recovery log |
| 09:09:10 | session `2f575c9e` dies again | session_history |
| 09:09:11 | **THIRD** auto-restore triggered, kills everyone again, re-spawns 13 | Recovery log |

#### Cascade 3: 09:09 UTC (aftershock)

Same pattern. Session `2f575c9e` dies, watcher triggers, restore kills all orphans, re-spawns everything.

---

## Root Cause (Upstream)

**The immediate trigger**: A single Claude process (PID 289607, session `1140deaf`) exited naturally. The daemon detected the stale PID at 09:05:26. This is normal -- Claude processes exit when they finish a task, hit context limits, or encounter SDK errors.

**The amplification problem (the REAL bug)**: The restore logic treats ALL running session processes as "orphans" and kills them before re-spawning. When 1 session dies:
1. Watcher detects -1 session, triggers `restore_online_sessions`
2. Restore calls `scan_running_sessions` to find running processes
3. For each home, it kills ALL running processes matching `--resume <uuid>` in that home
4. Then re-spawns ALL sessions from `session_dirs.txt`
5. This means 1 death causes ~13 healthy sessions to be killed and re-spawned
6. Some re-spawned sessions die during startup (resource contention from 13 simultaneous spawns)
7. Watcher detects MORE deaths, triggering ANOTHER restore (though "already running" prevents infinite loop)

**Why the orphan kill exists**: The comment says "After daemon restart, old processes are alive but not registered with the new daemon." But this logic runs even when the daemon was NOT restarted -- it runs on every single-session death.

## Requirements (MoSCoW)

### Must Have
- Session watcher must NOT kill healthy running sessions when restoring a single dead session
- Restore should only re-spawn the specific sessions that are actually missing, not nuke everything

### Should Have
- Distinguish between "daemon restarted" (orphan kill needed) and "single session died" (only re-spawn that one)
- Rate-limit restore triggers to avoid cascading restores within a short window

### Could Have
- Configurable threshold: only trigger restore if N+ sessions die within M seconds (ignore single deaths)

### Won't Have (Non-Goals)
- Preventing Claude processes from exiting naturally (that is expected behavior)
- Changing the session watcher's detection mechanism (process scanning is correct)

## Edge Cases & Risks

- If restore is changed to only spawn missing sessions, orphan processes from a daemon restart would persist
- Need to detect whether daemon restarted (PID changed) vs. single session death to choose the right strategy

## Acceptance Criteria

### AC1: Single session death does not cascade
- GIVEN 14 running sessions
- WHEN 1 Claude process exits naturally
- THEN only that 1 session is re-spawned; the other 13 are untouched

### AC2: Daemon restart still cleans orphans
- GIVEN daemon was restarted (different PID in daemon.state.json)
- WHEN restore runs
- THEN orphan processes from old daemon ARE killed and re-spawned

## Technical Hints

- Affected file: `/root/bin/happy-session-recovery.sh` lines 889-907 (orphan kill logic)
- The `scan_running_sessions` function already knows which PIDs are daemon-tracked vs orphaned
- Key insight: `running_for_home` at line 893 finds ALL running sessions, not just orphans
- Fix direction: compare `running_for_home` against `saved` (sessions to restore) -- only kill processes for sessions that ARE in the saved list and need re-spawning
