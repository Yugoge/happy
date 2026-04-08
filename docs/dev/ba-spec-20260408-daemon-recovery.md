# BA Specification: Daemon-Owned Session Recovery Architecture

**Request ID**: dev-20260408-daemon-recovery
**Created**: 2026-04-08T14:00:00Z

## Goal

Move all session recovery responsibility into the happy daemon TypeScript codebase, eliminate the bash session watcher and ExecStartPre/ExecStartPost scripts, and make daemon self-manage its systemd service files. The result is clean, unambiguous ownership: the daemon is the single authority on session lifecycle.

## Context

Currently session recovery is split across 5 components with tangled ownership:
1. `happy-session-recovery.sh` (1336-line bash script) -- polls, snapshots, restores
2. `happy-session-watcher.service` -- systemd unit running the bash watcher
3. `ExecStartPre` in each daemon service -- calls bash script to save state before restart
4. `happy-daemon-post-start.sh` -- ExecStartPost that writes PID file and schedules restore
5. Daemon's `onChildExited` -- already handles crash respawn with exponential backoff

This split has caused multiple production incidents (Bug #61: cross-daemon cascade from global restore, flock race conditions in Bug #60). The daemon already tracks sessions in memory via `pidToTrackedSession` and has crash respawn logic. The missing piece is persistence: writing session state to disk and reading it back on startup.

## Requirements (MoSCoW)

### Must Have
- **Snapshot persistence**: Daemon writes `session_snapshot.json` to `$HAPPY_HOME/` on every session add, remove, crash, and shutdown
- **Startup recovery**: Daemon reads snapshot on startup, spawns sessions with `--resume` for each entry
- **Periodic safety writes**: Every 60s (piggybacking on existing heartbeat), write snapshot to handle SIGKILL/OOM scenarios
- **Shutdown snapshot**: Write final snapshot in `cleanupAndShutdown()` before lock release
- **systemd service generation**: `happy daemon install` generates and installs a Linux systemd service file (extend existing macOS-only install to support Linux)
- **systemd service removal**: `happy daemon uninstall` removes the service file
- **Clean service files**: Generated service files have NO ExecStartPre, NO ExecStartPost -- daemon handles everything internally
- **Per-daemon scoping**: Each daemon only manages sessions for its own `HAPPY_HOME_DIR`

### Should Have
- **Orphan process cleanup on startup**: Before restoring sessions, check for and kill orphaned happy-coder processes from previous daemon (already partially exists via `findRunawayHappyProcesses`)
- **Staggered restore**: 5-second delay between session spawns during restore (matches existing proven timing)
- **Snapshot validation**: Verify .jsonl file exists before attempting restore of each session
- **Restore progress logging**: Log each session restore attempt and result for debugging
- **PID file generation**: Daemon writes its own PID file to `$HAPPY_HOME/daemon.pid` (currently done by `happy-daemon-post-start.sh` via Python)

### Could Have
- **Snapshot history**: Keep last N snapshots in `session_backup_history/` for forensic debugging
- **Migration command**: `happy daemon migrate` reads existing `session_dirs.txt` into new snapshot format
- **`happy daemon install --all`**: Install all 4 daemon services at once
- **Service file diffing**: Before overwriting, show diff of existing vs new service file

### Won't Have (Non-Goals)
- **Cross-daemon coordination**: Each daemon is fully independent; no shared state
- **Remote restore triggers**: Mobile app cannot trigger restore; it happens automatically on daemon startup
- **Session file repair**: If .jsonl is corrupted or missing, session is skipped (not repaired)
- **Watcher functionality**: No polling loop; snapshot writes are event-driven + periodic safety net
- **Backward compatibility with bash watcher**: Clean break; `happy-session-recovery.sh` kept only as read-only diagnostic tool

## Edge Cases & Risks

- **SIGKILL / OOM kill**: Daemon gets no cleanup chance. Periodic 60s safety write ensures at most 60s of state loss. Acceptable tradeoff vs. external watcher complexity.
- **Server reboot**: systemd starts daemon, daemon reads last snapshot (from periodic write), restores. Boot_id check unnecessary -- daemon simply reads its own snapshot file.
- **Corrupted snapshot file**: Log warning, skip restore, start fresh. Do NOT crash.
- **First run (no snapshot)**: `session_snapshot.json` doesn't exist, skip restore gracefully.
- **Session .jsonl deleted**: Validate file exists before `--resume`; skip with warning if missing.
- **4 daemons starting concurrently after reboot**: Each reads its own `$HAPPY_HOME/session_snapshot.json`. No shared state, no conflicts.
- **Snapshot written mid-session-spawn**: Use atomic write (write to temp file, rename) to prevent partial reads.
- **Dev daemon uses different binary path**: Service file template must support `ExecStart` pointing to either `/usr/bin/happy` or custom path (e.g., `/usr/bin/happy-dev`).
- **Detached sessions (started outside daemon)**: These are tracked via webhook (`onHappySessionWebhook`). On daemon restart, they won't be in the snapshot because they died with the old daemon or are orphans. Orphan cleanup handles this.

## Acceptance Criteria

### AC1: Snapshot written on session lifecycle events
- GIVEN daemon is running with 3 active sessions
- WHEN a new session is spawned (4th session added)
- THEN `$HAPPY_HOME/session_snapshot.json` is updated within 1 second to contain 4 session entries

### AC2: Snapshot written on daemon shutdown
- GIVEN daemon is running with N active sessions
- WHEN daemon receives SIGTERM
- THEN `$HAPPY_HOME/session_snapshot.json` is written with all N sessions BEFORE process exits

### AC3: Sessions restored on daemon startup
- GIVEN `$HAPPY_HOME/session_snapshot.json` contains 5 sessions with valid .jsonl files
- WHEN daemon starts
- THEN all 5 sessions are spawned with `--resume` and their Claude session UUIDs, with 5s delay between spawns

### AC4: Corrupted snapshot handled gracefully
- GIVEN `$HAPPY_HOME/session_snapshot.json` contains invalid JSON
- WHEN daemon starts
- THEN daemon logs a warning and starts normally with zero sessions

### AC5: Periodic safety write
- GIVEN daemon is running
- WHEN 60 seconds elapse (heartbeat interval)
- THEN snapshot file is updated (even if no session changes occurred)

### AC6: systemd service install on Linux
- GIVEN `happy daemon install` is run with `HAPPY_HOME_DIR=/root/.happy-jade`
- WHEN the command completes
- THEN `/etc/systemd/system/happy-daemon-jade.service` exists with correct Environment, ExecStart, no ExecStartPre/ExecStartPost

### AC7: systemd service uninstall
- GIVEN `happy-daemon-jade.service` is installed
- WHEN `happy daemon uninstall` is run
- THEN the service file is removed and `systemctl daemon-reload` is called

### AC8: No external dependencies for recovery
- GIVEN daemon is the only recovery mechanism
- WHEN `happy-session-watcher.service` is disabled/removed
- THEN session recovery still works perfectly on daemon restart

## Technical Hints

- **Snapshot file path**: `configuration.happyHomeDir + '/session_snapshot.json'` -- add to `configuration.ts`
- **Atomic writes**: Use `writeFileSync(tmpPath, data)` then `renameSync(tmpPath, finalPath)` -- already a pattern in persistence.ts
- **Startup recovery insertion point**: After `apiMachine.connect()` (line ~795 in run.ts), before heartbeat loop setup
- **Shutdown snapshot insertion point**: In `cleanupAndShutdown()`, before `apiMachine.shutdown()` (line ~907)
- **Heartbeat piggyback**: In the `setInterval` at line ~804, add snapshot write alongside heartbeat
- **Session data for snapshot**: From `pidToTrackedSession` values, extract `claudeSessionId`, `workingDirectory`, `happySessionId`
- **Restore uses existing `spawnSession()`**: With `resumeSessionId` parameter already supported
- **Service file template**: Embed as template literal in new file `src/daemon/linux/install.ts` (parallel to `mac/install.ts`)
- **Install/uninstall routing**: Update `src/daemon/install.ts` to dispatch on `process.platform === 'linux'`
- **PID file**: Write in `startDaemon()` after `writeDaemonState()`, before heartbeat loop
- **Existing patterns**: `spawnSession()` already accepts `resumeSessionId` option (line 523 in run.ts)
- **Affected files**:
  - `packages/happy-cli/src/daemon/run.ts` -- core changes (snapshot read/write, startup restore, shutdown write)
  - `packages/happy-cli/src/daemon/types.ts` -- add `SessionSnapshot` interface
  - `packages/happy-cli/src/daemon/install.ts` -- add Linux support
  - `packages/happy-cli/src/daemon/uninstall.ts` -- add Linux support
  - `packages/happy-cli/src/daemon/linux/install.ts` -- new file, systemd service template
  - `packages/happy-cli/src/daemon/linux/uninstall.ts` -- new file
  - `packages/happy-cli/src/configuration.ts` -- add `sessionSnapshotFile` path
  - `packages/happy-cli/src/persistence.ts` -- add `readSessionSnapshot()` / `writeSessionSnapshot()` (optional, could be in run.ts)
