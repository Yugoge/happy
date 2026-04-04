# Forensic Incident Report: Production Sessions Killed 2026-04-04

**Report generated**: 2026-04-04 ~13:15 UTC
**Scope**: Default daemon sessions killed; jade daemon sessions failed to restore

---

## Timeline of Events (all times UTC)

### Phase 1: Global Binary Poisoned (07:14:46)

**FACT**: At `2026-04-04 07:14:46` UTC, the global npm symlink `/usr/lib/node_modules/happy` was changed.
- Source: `stat /usr/lib/node_modules/happy` shows `Birth: 2026-04-04 07:14:46.727798286 +0000`
- Source: `stat /usr/bin/happy` shows `Birth: 2026-04-04 07:14:46.729798303 +0000`

**FACT**: The symlink now points to an overnight worktree:
```
/usr/lib/node_modules/happy -> ../../../dev/shm/dev-workspace/happy-dev/.claude/worktrees/overnight-20260403-d6f1eea4/packages/happy-cli
```
- Source: `ls -la /usr/lib/node_modules/happy`

**FACT**: The binary reports version `1.1.3` (worktree version). The production daemon (PID 2020314) was started with version `0.14.0-1`.
- Source: `/usr/bin/happy --version` outputs `happy version: 1.1.3`
- Source: `/root/.happy-jade/daemon.state.json` shows `"startedWithCliVersion": "0.14.0-1"`

**FACT**: The overnight session `d6f1eea4` (running in this workspace) performed the `npm install -g` from the worktree path. The session's own JSONL log at `2026-04-04T12:54:50Z` contains the session's own root cause analysis admitting: "npm install -g packages/happy-cli ... /usr/lib/node_modules/happy became a symlink to the worktree".
- Source: `grep "npm install -g" /root/.claude/projects/-dev-shm-dev-workspace-happy-dev/d6f1eea4-7769-4384-bd28-deae1ba26177.jsonl`

**FACT**: The worktree build has `sendExisting` count of 3 in one dist file and 0 in the other (same as the now-global binary):
```
index-BEFOpLzs.mjs: 0 occurrences
index-LvSIZVJE.mjs: 3 occurrences
```
- Source: `grep -c "sendExisting"` on both worktree dist files

**MEANS**: An overnight dev session ran `npm install -g` from a worktree, replacing the production global binary with a worktree symlink. This created a version mismatch (1.1.3 vs 0.14.0-1) that the daemon auto-upgrade mechanism would detect.

### Phase 2: Default Daemon Was Operating Normally Until 13:03 (07:14 - 13:03)

**FACT**: Despite the binary change at 07:14, the default daemon (PID 2020314, started Apr 03 13:11:53) continued running without interruption until 13:03. The daemon log shows it was tracking 5 sessions at 13:02:29.
- Source: `/root/.happy/logs/2026-04-03-13-11-56-pid-2020314-daemon.log` line `[13:02:29.843] [CONTROL SERVER] Listing 5 sessions`

**FACT**: The daemon auto-upgrade is NOT triggered by a periodic heartbeat. It is triggered when a NEW happy-cli process starts and checks the daemon version via `[DAEMON CONTROL] Checking if daemon is running same version`.
- Source: `/root/.happy/logs/2026-04-04-13-03-17-pid-3974953-daemon.log` line `[13:03:17.602] [DAEMON CONTROL] Checking if daemon is running same version`

**MEANS**: The 07:14 npm install alone did not kill the daemon. The daemon only dies when a new CLI process detects the version mismatch and forces a restart. This explains the ~6 hour gap.

### Phase 3: Trigger Event -- New CLI Process Starts (13:03:16)

**FACT**: At `13:03:16.518`, PID 3974917 started as a new happy-cli process from `/dev/shm/dev-workspace/happy-dev`. It ran `/usr/lib/node_modules/happy/dist/index.mjs --version`.
- Source: `/root/.happy/logs/2026-04-04-13-03-16-pid-3974917.log` shows `processArgv: ["/usr/bin/node", "/usr/lib/node_modules/happy/dist/index.mjs", "--version"]`

**FACT**: This process detected a version mismatch: `Current CLI version: 1.1.3, Daemon started with version: 0.14.0-1`.
- Source: same log file, line `[13:03:16.548] [DAEMON CONTROL] Current CLI version: 1.1.3, Daemon started with version: 0.14.0-1`

**FACT**: This process spawned PID 3974953 to run `daemon start-sync`, which is the auto-upgrade flow.
- Source: `/root/.happy/logs/2026-04-04-13-03-16-pid-3974917.log` line `[13:03:16.549] [SPAWN HAPPY CLI] Spawning: happy daemon start-sync in /dev/shm/dev-workspace/happy-dev`

**MEANS**: A new CLI invocation (this appears to be this very forensic session or a concurrent one starting up) triggered the version mismatch detection, which initiated the auto-upgrade cascade.

### Phase 4: Default Daemon Killed (13:03:17)

**FACT**: At `13:03:17.604`, PID 3974953 (the auto-upgrade process) detected the mismatch and issued a stop command to the running daemon PID 2020314.
- Source: `/root/.happy/logs/2026-04-04-13-03-17-pid-3974953-daemon.log`:
  ```
  [13:03:17.604] [DAEMON CONTROL] Current CLI version: 1.1.3, Daemon started with version: 0.14.0-1
  [13:03:17.604] [DAEMON RUN] Daemon version mismatch detected, restarting daemon with current CLI version
  [13:03:17.605] Stopping daemon with PID 2020314
  [13:03:17.827] Daemon stopped gracefully via HTTP
  ```

**FACT**: The old daemon (PID 2020314) received the stop request and shut down cleanly. Its last log entries:
```
[13:03:17.618] [CONTROL SERVER] Stop daemon request received
[13:03:17.670] [CONTROL SERVER] Triggering daemon shutdown
[13:03:17.793] [DAEMON RUN] Process exiting with code: 0
```
- Source: `/root/.happy/logs/2026-04-03-13-11-56-pid-2020314-daemon.log`

**FACT**: Systemd confirms the deactivation at `Apr 04 13:03:19`:
```
happy-daemon.service: Deactivated successfully.
happy-daemon.service: Consumed 2h 58min 45.117s CPU time, 8.7G memory peak
```
- Source: `journalctl -u happy-daemon`

**MEANS**: The default daemon (PID 2020314) that was running 5 production sessions was killed by the auto-upgrade mechanism. All 5 session child processes died when their parent daemon stopped.

### Phase 5: Replacement Daemon Immediately Killed (13:03:17-13:03:19)

**FACT**: PID 3974953 started a new daemon at `13:03:17.969` and it came online with port 43497 at `13:03:18.012`.
- Source: daemon log shows `[CONTROL SERVER] Started on port 43497` and `Daemon started successfully`

**FACT**: Within 1 second, at `13:03:18.870`, the new daemon received ANOTHER stop request and shut down:
```
[13:03:18.870] [CONTROL SERVER] Stop daemon request received
[13:03:19.053] [DAEMON RUN] Process exiting with code: 0
```
- Source: `/root/.happy/logs/2026-04-04-13-03-17-pid-3974953-daemon.log`

**FACT**: The second stop was issued by PID 3975016, which ran `daemon stop` at `13:03:18.854`:
```
Starting happy CLI with args: [..., "daemon", "stop"]
Stopping daemon with PID 3974953
Daemon stopped gracefully via HTTP
```
- Source: `/root/.happy/logs/2026-04-04-13-03-18-pid-3975016.log`

**FACT**: This PID 3975016 ran at `13:03:18.835`, which corresponds to the systemd `ExecStop=/usr/bin/happy daemon stop` command.
- Source: Timing matches the systemd deactivation event at 13:03:19

**MEANS**: The systemd service detected its main PID (2020314) had exited, so it ran ExecStop, which killed the replacement daemon (PID 3974953) that had just started. The replacement daemon lived for approximately 1 second. The systemd service then entered `inactive (dead)` state.

### Phase 6: Session Recovery Detects Mass Death (13:03:37-13:03:57)

**FACT**: The session watcher detected all 14 tracked sessions disappeared at `13:03:40`:
```
[2026-04-04 13:03:40] Peak merge: peak=14 current=0 merged=14 (0 new sessions added)
[2026-04-04 13:03:41] Change detected: 0 sessions (+0 -14)
[2026-04-04 13:03:42] Sessions disappeared (14 removed), triggering auto-restore...
```
- Source: `journalctl -u happy-session-watcher`

**FACT**: Recovery skipped the default daemon because it was not running:
```
[2026-04-04 13:03:46] Skip /root/.happy: daemon not running
```
- Source: same journal

**FACT**: Recovery attempted to restore 2 jade sessions via the jade daemon:
```
[2026-04-04 13:03:46] Restoring 2 sessions for /root/.happy-jade
[2026-04-04 13:03:47] Spawned via /root/.happy-jade: PID=3975893 claudeId=24ac74b3
[2026-04-04 13:03:52] Spawned via /root/.happy-jade: PID=3975960 claudeId=610b36ac
```
- Source: same journal

**FACT**: Both jade session spawns failed immediately. Systemd scopes deactivated within 0 seconds:
```
Started happy-session-24ac74b3-766271.scope
happy-session-24ac74b3-766271.scope: Deactivated successfully.
Started happy-session-610b36ac-766271.scope
happy-session-610b36ac-766271.scope: Deactivated successfully.
```
- Source: same journal

**FACT**: Recovery also skipped the dev daemon: `Skip /root/.happy-dev: daemon not running`
- Source: same journal

**FACT**: Final recovery tally: `Recovery: total=2 running=0 restored=2 skipped=0 failed=0`
- Source: same journal. Note: recovery reports "restored=2" but the processes died immediately.

**MEANS**: Of 14 tracked sessions, 0 were successfully restored. The default daemon was dead (not restarted by systemd because ExecStop ran cleanly -- "Deactivated successfully" means systemd considers this a clean stop, not a failure, so `Restart=on-failure` does NOT trigger). The jade daemon's spawned sessions crashed immediately (the binary they use is the poisoned worktree binary via `/usr/bin/happy`). The dev daemon was dead since 12:26:14.

### Phase 7: Default Daemon Manually Restarted (13:10:53)

**FACT**: A new default daemon (PID 3983349) started at `13:10:54` with version `1.1.3`. It detects the version mismatch again but since there's no old daemon running, it starts fresh:
```
[13:10:54.136] [DAEMON CONTROL] Checking if daemon is running same version
[13:10:54.136] [DAEMON RUN] Daemon version mismatch detected, restarting daemon with current CLI version
```
- Source: `/root/.happy/logs/2026-04-04-13-10-53-pid-3983349-daemon.log`

**FACT**: This daemon has 0 sessions: `[13:10:56.952] [CONTROL SERVER] Listing 0 sessions`
- Source: same log

**MEANS**: The default daemon is back online but empty. No sessions were auto-restored because the session recovery already ran (and failed) at 13:03:42.

---

## Current State (13:15 UTC)

| Component | Status | Evidence |
|-----------|--------|----------|
| Default daemon | Running, 0 production sessions | PID 3983349, started 13:10:54, log shows "Listing 0 sessions" |
| Jade daemon | Running, 0 sessions | PID 2020944 (old, since Apr 3), jade log shows "Listing 0 sessions" since at least 12:48 |
| Dev daemon | Dead since 12:26:14 | systemd shows `inactive (dead)` |
| Production DB active sessions | 0 | `SELECT count(*) FROM "Session" WHERE active=true` returns 0 rows |
| Global binary | Poisoned -- points to overnight worktree | `/usr/lib/node_modules/happy -> worktree path` |
| Session recovery data | 14 sessions saved in snapshots | `/root/.happy/session_backup_history/2026-04-04-13-03.json` has all 14 |

### Sessions That Were Lost

From the 13:03 snapshot (14 total):

| Session | Home Dir | Working Dir | Type |
|---------|----------|-------------|------|
| 0b602a56 | (default) | /dev/shm/dev-workspace/applio | Default daemon |
| 11df4f77 | (default) | /root | Default daemon |
| 353c80f2 | (default) | /root/application-assistant | Default daemon |
| 817e8407 | (default) | /root/knowledge-system | Default daemon |
| 9162590b | (default) | /root/knowledge-system | Default daemon |
| 9bef2d5a | (default) | /root/application-assistant | Default daemon |
| a1e9b8d2 | (default) | /root/knowledge-system | Default daemon |
| d47a0726 | (default) | /root/application-assistant | Default daemon |
| d6f1eea4 | (default) | /dev/shm/dev-workspace/happy-dev | Default daemon (this session) |
| 24ac74b3 | /root/.happy-jade | /root | Jade daemon |
| 610b36ac | /root/.happy-jade | /root | Jade daemon |
| 2c7092f6 | /root/.happy-dev | /root | Dev daemon |
| 701f6880 | /root/.happy-dev | /root | Dev daemon |
| a735fe6d | /root/.happy-dev | /root | Dev daemon |

---

## Root Cause Chain

```
1. Overnight session d6f1eea4 ran `npm install -g` from worktree at 07:14:46
   -> /usr/lib/node_modules/happy symlinked to worktree (version 1.1.3)
   -> /usr/bin/happy now runs worktree code

2. At 13:03:16, a new CLI process started (PID 3974917, `--version` check)
   -> Detected version mismatch: 1.1.3 (binary) vs 0.14.0-1 (running daemon)
   -> Triggered auto-upgrade: spawned PID 3974953 to restart daemon

3. PID 3974953 stopped old daemon PID 2020314 via HTTP at 13:03:17
   -> Old daemon exited cleanly (code 0)
   -> All 5 default-daemon child session processes died

4. PID 3974953 started new daemon, but systemd ExecStop killed it at 13:03:18
   -> systemd saw main PID exit, ran ExecStop on the replacement
   -> Replacement daemon lived ~1 second

5. systemd marked service as "inactive (dead)" with clean exit
   -> Restart=on-failure did NOT trigger (clean stop, not failure)
   -> Default daemon stayed dead

6. Session watcher detected 14 sessions gone at 13:03:40
   -> Auto-restore skipped default daemon (dead)
   -> Auto-restore spawned 2 jade sessions, both crashed immediately
   -> Dev daemon was already dead
   -> Net result: 0 of 14 sessions restored

7. Jade session spawns crashed because they used /usr/bin/happy
   -> Which points to worktree binary
   -> Scope deactivated within 0 seconds of starting
```

---

## Critical Observations

1. **The auto-upgrade mechanism is the kill mechanism**: When version mismatch is detected, it stops the running daemon and starts a new one. But the new one gets killed by systemd's ExecStop for the old service, creating a death loop where no daemon survives.

2. **Restart=on-failure does not help**: Because ExecStop runs and exits cleanly, systemd considers this a clean deactivation, not a failure. The daemon service stays dead.

3. **Jade daemon (PID 2020944) was NOT killed**: It was started on Apr 3 and runs `/root/happy/packages/happy-cli/dist/index.mjs` (the production binary, not the global symlink). Its daemon process survived. However, it has 0 sessions because all jade sessions were child processes of the default daemon or had already ended.

4. **The jade session recovery spawns failed because `/usr/bin/happy` is poisoned**: The recovery script uses `/usr/bin/happy` (the global binary) to spawn sessions, which now points to the worktree. The spawned processes exit immediately (scope lifetime < 1 second).

---

## Immediate Actions Required

1. **Restore global binary**: `cd /root/happy/packages/happy-cli && npm install -g .`
2. **Restart default daemon**: `systemctl start happy-daemon`
3. **Restore sessions from snapshot**: Use `/root/.happy/session_backup_history/2026-04-04-13-03.json` which has all 14 sessions
4. **Verify sendExisting**: After restoring the binary, confirm `grep -c "sendExisting"` returns >0 in the production dist files
