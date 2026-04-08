# BA Specification: Duplicate Session Spawn Investigation

**Request ID**: dev-20260408-duplicate-session
**Created**: 2026-04-08

## Goal

Determine whether the same Claude session (same UUID) can be spawned twice simultaneously, causing conflicts, and whether the kill step in `restore_online_sessions()` is necessary.

## Analysis Summary

**YES, duplicates are possible. The kill step IS necessary.**

There are NO deduplication mechanisms at any layer that would prevent two processes from operating on the same Claude session UUID simultaneously. The kill step in `restore_online_sessions()` (lines 889-905 of `happy-session-recovery.sh`) is a critical safety mechanism.

## Evidence by Layer

### Layer 1: Daemon `/spawn-session` endpoint -- NO dedup

**File**: `packages/happy-cli/src/daemon/controlServer.ts:109-171`

The `/spawn-session` endpoint accepts `directory` and optional `sessionId`, passes them directly to `spawnSession()`. No check is performed against `pidToTrackedSession` to see if a session with the same Claude UUID is already running.

**File**: `packages/happy-cli/src/daemon/run.ts:232-613`

The `spawnSession()` function:
- Checks if the directory exists (line 239)
- Spawns a new process (line 518)
- Tracks by PID in `pidToTrackedSession` (line 556)
- Waits for webhook (line 575)

At no point does it check if any existing tracked session has the same Claude session UUID. The tracking map is keyed by PID, not by session UUID. Two processes with different PIDs but the same `--resume UUID` would both be tracked independently.

### Layer 2: Recovery script `daemon_spawn_session()` -- NO dedup

**File**: `happy-session-recovery.sh:688-752`

The `daemon_spawn_session()` function spawns directly via `systemd-run` or `nohup node`, passing `--resume $session_id`. It does not query the daemon's `/list` endpoint to check if the UUID is already running before spawning.

### Layer 3: Claude SDK `--resume` -- NO file locking

**File**: `packages/happy-cli/src/claude/sdk/query.ts:300`

The `--resume` flag is simply passed as a CLI argument to the Claude Code binary. The SDK spawns Claude as a child process. There is no file locking on the `.jsonl` session file.

When `--resume UUID` is used:
1. Claude reads the existing `.jsonl` file to load history
2. Creates a NEW `.jsonl` file with a new session UUID (as documented in `packages/happy-cli/CLAUDE.md` "Session Forking" section)
3. The new file contains complete history from the old file with rewritten session IDs

This means two `--resume UUID-A` invocations would:
- Both read the same original `.jsonl` file
- Each create its own new `.jsonl` file with a different new UUID
- Both succeed independently -- no crash, no lock error

### Layer 4: Happy Server session creation -- DIFFERENT tags, no collision

**File**: `packages/happy-cli/src/claude/runClaude.ts:82-83`

```typescript
const sessionTag = options.recoverSessionId || randomUUID();
```

For recovery (`--recover-session`), the tag is the happy session ID, so tag idempotency returns the existing session. But for `--resume` (which goes through `daemon_spawn_session`), each spawned process uses `randomUUID()` as the tag (line 82), creating a SEPARATE happy-server session.

**File**: `packages/happy-server/sources/app/api/routes/sessionRoutes.ts:235-239`

The server uses `@@unique([accountId, tag])` (prisma schema line 112). Since each spawned process generates a random UUID tag, two processes resuming the same Claude UUID would create two independent happy-server sessions.

### Layer 5: WebSocket connections -- both connect independently

Each happy-cli process creates its own `sessionSyncClient` with its own WebSocket connection to the server. Two processes with different happy-server session IDs would both connect and both stream messages independently. The server would broadcast updates to the app for both sessions, causing confusion.

## Specific Scenario Analysis

### Scenario A: Orphan still alive + restore spawns duplicate

1. Old process for UUID-A is still alive (orphan from previous daemon)
2. `restore_online_sessions()` spawns `--resume UUID-A`
3. OLD process: continues running with its existing Claude process, connected to happy-server session X
4. NEW process: Claude forks UUID-A into UUID-B, creates happy-server session Y
5. **Result**: Two sessions visible in the app, both referencing the same conversation history. User sees duplicate. Both processes write to happy-server independently. Messages from either show up in different sessions.

### Scenario B: Old process already dead (safe case)

Only one process exists. No conflict.

### Scenario C: Daemon `/spawn-session` dedup

The daemon has NO dedup logic for session UUIDs. It tracks sessions by PID only. Two `/spawn-session` calls with the same directory but different Claude UUIDs would both succeed. Two calls that result in the same Claude UUID being resumed would also both succeed.

## Why the Kill Step is Necessary

The kill block at lines 889-905 of `happy-session-recovery.sh`:

```bash
# Kill orphaned session processes for this home before respawning.
# After daemon restart, old processes are alive but not registered with the new daemon.
# We must kill them so daemon_spawn_session creates fresh ones under the new daemon.
```

This is necessary for TWO reasons:

1. **Prevents duplicate sessions**: Without killing orphans, both old and new processes would run simultaneously for the same Claude conversation, causing duplicate sessions in the app.

2. **Ensures daemon tracking**: The new daemon instance has an empty `pidToTrackedSession` map. Old processes are not registered with the new daemon. They would never report via webhook (the daemon's HTTP port changed), so the new daemon cannot manage them. Killing and respawning ensures all sessions are tracked by the current daemon.

## Requirements (MoSCoW)

### Must Have
- Keep the kill step in `restore_online_sessions()` -- it is necessary

### Should Have
- Consider adding UUID-based dedup to `spawnSession()` in `run.ts` as defense-in-depth
- Consider adding a `/list` check in `daemon_spawn_session()` before spawning

### Could Have
- File locking on `.jsonl` files (would require Claude SDK changes, unlikely feasible)

### Won't Have (Non-Goals)
- Removing the kill step from recovery
- Changing Claude SDK behavior

## Acceptance Criteria

### AC1: Kill step preserved
- GIVEN the recovery script needs to restore sessions after daemon restart
- WHEN orphan processes exist from the previous daemon instance
- THEN they must be killed before spawning replacements

### AC2: Defense-in-depth (optional improvement)
- GIVEN a `spawnSession()` call with a `--resume UUID`
- WHEN a tracked session already has that UUID in its metadata
- THEN `spawnSession()` should return the existing session instead of spawning a duplicate
