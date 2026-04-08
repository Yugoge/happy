# BA Specification: Fix Restore Orphan-Kill Cascade

**Request ID**: dev-20260408-restore-cascade
**Created**: 2026-04-08T10:00:00Z

## Goal

Identify and document why the `restore_online_sessions` orphan-kill cascade never happened before but started manifesting recently, providing the exact commit and code change that introduced the behavior.

## Context

The session recovery script (`/root/bin/happy-session-recovery.sh`) has a watcher that triggers `restore_online_sessions` whenever sessions "disappear" (the `watch_sessions` function detects session count drops). The restore function kills ALL running sessions for a home as "orphans" before re-spawning them. This creates a cascade: one session dies naturally -> watcher detects drop -> triggers restore -> restore kills ALL remaining sessions -> watcher detects more drops -> triggers another restore.

The user reports this cascade NEVER happened before. This investigation found the exact commit that changed the behavior.

## Root Cause Analysis

### The Introducing Commit

**Commit**: `78154c0` (2026-03-21 06:46:03 UTC)
**Message**: "Update: Comprehensive changes via push script"

This commit made TWO critical changes to `restore_online_sessions()`:

1. **ADDED**: An orphan-kill block that kills ALL running sessions for a home before re-spawning
2. **REMOVED**: The per-UUID "already running" skip check that previously protected live sessions

### BEFORE (commit `719f7d6`, 2026-03-17)

```bash
# Running UUIDs for this specific home
local running_for_home
running_for_home=$(echo "$running_raw" | filter_sessions_for_home "$home" | cut -d: -f1)

while IFS=: read -r uuid work_dir; do
    [ -z "$uuid" ] && continue

    # CHECK: if already running, SKIP (don't touch it)
    if [ -n "$running_for_home" ] && echo "$running_for_home" | grep -q "$uuid"; then
        total_already=$((total_already + 1))
        continue
    fi
    # ... spawn only missing sessions ...
```

**Behavior**: Restore ONLY spawned sessions that were NOT already running. Running sessions were left completely untouched. If a session died naturally and the watcher triggered restore, restore would only try to re-spawn the dead session. Other sessions continued uninterrupted.

### AFTER (commit `78154c0`, 2026-03-21)

```bash
# Kill orphaned session processes for this home before respawning.
# After daemon restart, old processes are alive but not registered with the new daemon.
# We must kill them so daemon_spawn_session creates fresh ones under the new daemon.
local running_for_home
running_for_home=$(echo "$running_raw" | filter_sessions_for_home "$home" | cut -d: -f1)
if [ -n "$running_for_home" ]; then
    while IFS= read -r orphan_uuid; do
        [ -z "$orphan_uuid" ] && continue
        local orphan_pids
        orphan_pids=$(pgrep -f -- "--resume $orphan_uuid" 2>/dev/null)
        if [ -n "$orphan_pids" ]; then
            echo "$orphan_pids" | xargs kill 2>/dev/null
            log "Killed orphaned process for $orphan_uuid (home=$home)"
        fi
    done <<< "$running_for_home"
    sleep 2
fi

while IFS=: read -r uuid work_dir; do
    [ -z "$uuid" ] && continue
    # NOTE: No "already running" check -- the per-UUID skip was REMOVED
    # ... spawn ALL sessions from snapshot ...
```

**Behavior**: Restore KILLS every running session for the home, then re-spawns ALL sessions from the snapshot. This was designed for daemon restart scenarios (where old processes are truly orphaned), but the same function is called by the watcher on ANY session disappearance.

### The Cascade Chain

1. Session A dies naturally (Claude exits, crash, etc.)
2. Watcher detects count drop (`nr > 0`)
3. Watcher calls `restore_online_sessions &` (lines 642-644)
4. Restore finds sessions B, C, D still running
5. Restore KILLS B, C, D as "orphans" (they are NOT orphans -- they are healthy)
6. Restore re-spawns A, B, C, D from snapshot
7. Meanwhile, watcher's next poll detects B, C, D disappeared (killed in step 5)
8. Watcher triggers ANOTHER `restore_online_sessions &`
9. Cycle repeats

### Why It Never Happened Before

The old code (pre-`78154c0`) had the `grep -q "$uuid"` check that SKIPPED running sessions. The watcher's auto-restore trigger existed since the very first version (`b0bada6`, 2026-02-04), but it was harmless because restore never killed anything -- it only spawned missing sessions.

### Why the Change Was Made

The commit comment says: "After daemon restart, old processes are alive but not registered with the new daemon." This is a legitimate concern for daemon restarts. However, the orphan-kill was added to a function that is ALSO called by the watcher on normal session disappearance, where running sessions are NOT orphans.

## Requirements (MoSCoW)

### Must Have
- Restore must NOT kill sessions when triggered by the watcher (natural session death)
- Restore must still be able to kill orphans when triggered after a daemon restart
- The fix must distinguish between "watcher-triggered restore" and "daemon-restart-triggered restore"

### Should Have
- Re-add the per-UUID "already running" skip for watcher-triggered restores
- Log clearly which mode restore is operating in

### Could Have
- Add a `--mode watcher|restart` parameter to restore_online_sessions
- Separate the orphan-kill into a distinct function only called during daemon restart

### Won't Have (Non-Goals)
- Rewriting the watcher's change detection logic
- Changing the auto-restore trigger threshold

## Edge Cases & Risks

- If orphan-kill is completely removed, daemon restarts leave stale processes consuming resources
- If the fix only checks a flag, callers must remember to set it correctly
- Race condition: watcher and daemon-post-start could both call restore simultaneously

## Acceptance Criteria

### AC1: Natural session death does not cascade
- GIVEN sessions A, B, C are running under a daemon
- WHEN session A dies naturally (Claude exit)
- THEN the watcher triggers restore, sessions B and C are NOT killed, only session A is re-spawned

### AC2: Daemon restart still cleans orphans
- GIVEN sessions A, B, C were running under the old daemon
- WHEN daemon restarts and ExecStartPost triggers restore
- THEN old processes are killed and fresh ones are spawned under the new daemon

### AC3: No cascade loop
- GIVEN the watcher triggers restore after detecting session loss
- WHEN restore runs
- THEN the watcher's next poll does NOT detect additional session losses caused by the restore itself

## Technical Hints

- Affected file: `/root/bin/happy-session-recovery.sh`
- Introducing commit: `78154c0` (2026-03-21)
- The fix should differentiate between watcher-triggered and daemon-restart-triggered calls
- The watcher calls `restore_online_sessions &` at line 644 (current version)
- ExecStartPost / `daemon-post-start.sh` also calls restore
- The `restart_daemon` function (line ~1042) also calls restore
- Consider adding a parameter like `--skip-orphan-kill` for watcher-triggered calls
