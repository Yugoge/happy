# BA Specification: OOM Kill Behavior Characterization

**Request ID**: dev-20260408-oom-characterization
**Created**: 2026-04-08T17:20:00Z

## Goal

Characterize the exact timing pattern of session deaths on this server to reliably distinguish OOM/cgroup kills from manual archive operations and natural session exits.

## Key Finding: NO Cgroup OOM Kills Have Occurred

All four daemon cgroup `memory.events` counters show **zero** for `oom`, `oom_kill`, and `oom_group_kill`. No kernel-level OOM events appear in `dmesg` or `journalctl -k`. The cgroup limits are generous:

| Daemon | MemoryHigh | MemoryMax | Current Usage |
|--------|-----------|-----------|---------------|
| default | 16 GB | 20 GB | 8.2 GB |
| jade | 12 GB | 16 GB | 86 MB |
| qijie | 12 GB | 16 GB | 82 MB |

Sessions die for OTHER reasons, not cgroup OOM.

## Session Death Patterns Observed

### Pattern 1: Reboot Kill (ALL sessions die simultaneously)
- **Example**: 2026-04-08T06:12:44Z -- 13 sessions removed in the SAME SECOND
- **Cause**: Server rebooted at 06:09, daemons restarted at 06:11, watcher detected all sessions gone at 06:12
- **Signature**: ALL tracked sessions disappear in ONE watcher poll cycle, across ALL home dirs
- **Frequency**: Rare (last reboot was Apr 8; previous was Mar 26)

### Pattern 2: Cascade Kill (session dies, gets restored, dies again)
- **Example**: `ed24aacd` (multi-asset-portfolio) died and was restored 8 TIMES on Apr 8
- **Timing**: Remove at T, add at T+~75s (one watcher poll cycle), remove again at T+~150s
- **Signature**: Same UUID appears in alternating remove/add pairs with ~75s gap
- **Cause**: Session is unhealthy (crashes on resume), watcher keeps restoring it, it keeps dying
- **This is NOT OOM** -- it is a single session repeatedly failing

### Pattern 3: Natural Individual Death (1 session dies)
- **Frequency**: Most common (39 out of 54 episodes are single-session)
- **Timing**: Isolated, gap to next event is minutes to hours
- **Cause**: Claude process exits naturally (task complete, error, context limit)

### Pattern 4: Small Cluster Kill (2-3 sessions die together)
- **Frequency**: 13 episodes of size 2-3
- **Timing**: All within same second (0.0s span)
- **Cause**: Could be memory pressure causing kernel to kill heavy processes, OR multiple sessions hitting context limits simultaneously, OR daemon restart scoped to one home dir

### Pattern 5: Dev Batch Kill (6 sessions die together, all from same dir)
- **Example**: 2026-04-06T20:38:16Z -- 6 sessions ALL from `/dev/shm/dev-workspace/applio`
- **Cause**: Dev workspace cleanup or dev daemon restart, NOT system-wide OOM

## Timing Characteristics Summary

| Metric | Value |
|--------|-------|
| Sessions per process triplet | ~500 MB RSS (150 + 250 + 100 MB) |
| Watcher poll interval | ~60s (actual detection gap: 70-80s including processing) |
| Time between remove and re-add (restore) | ~75s (one poll cycle) |
| Reboot: time from boot to detection | ~3 minutes |
| Reboot: all sessions in single timestamp | YES (same second) |
| Natural death: typical count | 1 session |
| Cluster kill: typical count | 2-3 sessions |
| Max non-reboot cluster | 6 (but all from same dev workspace) |

## How to Distinguish Event Types

### Reboot vs Everything Else
- Reboot: count >= total tracked sessions, all in same second, spans ALL home dirs
- Check `last reboot` or `systemctl show --property=ActiveEnterTimestamp`

### Manual Archive vs Crash
- Manual archive: user deliberately removes sessions via UI, typically 1 at a time with ~3s human delay between each
- Crash: process exit detected by watcher, typically 1 session per poll, or 2-3 in same second if memory pressure

### Cascade (repeated restorer) vs True Multi-Kill
- Cascade: same UUID appears in remove/add/remove pattern with ~75s intervals
- True multi-kill: different UUIDs all removed in same second, none re-added between kills

## Critical Insight for Watcher Logic

The `nr` (number removed) value in a single watcher poll cycle:
- `nr=1`: Almost certainly natural death or manual archive
- `nr=2-3`: Could be coincidence, memory pressure, or manual archive batch
- `nr>=6`: Almost certainly system event (reboot, daemon restart, cgroup pressure)
- `nr>=total_sessions`: Server reboot

**There is NO proven cgroup OOM pattern on this server.** The cgroup limits have never been hit. Session deaths are from: reboots, natural exits, crash loops, and dev workspace cleanups.

## Recommendations

1. The watcher should track the REASON for session loss, not just the count
2. Cascade detection: if same UUID is removed+added+removed within 5 minutes, mark it as "crash loop" and stop restoring after N attempts
3. Reboot detection: compare against `boot_id` (already implemented in recovery script)
