# Audit: every-6-hours jobs scan restoration and overhead

Date: 2026-05-24T08:57:38Z  
Scope: read-only systemd/script investigation. No services restarted, no processes killed. This file is the only audit deliverable written.

## Verdict

**UNKNOWN** for the requested **every-6-hours jobs scan**.

I did **not** find a custom systemd timer/service that clearly implements an "every-6-hours jobs scan". The closest relevant Happy/MAP candidate is `daily-trade-scheduler.timer`, but it is **Mon-Fri 09:03 America/New_York**, not every 6 hours. Two OS-level every-6-hours-ish candidates exist (`ua-timer.timer`, `snapd.snap-repair.timer`), but both are unrelated to Happy/MAP job scanning and are currently skipped/inactive due unmet conditions.

`daily-trade-scheduler.timer` itself appears restored/enabled/active, but it has not fired under the current post-2026-05-23 20:23 boot/current timer state yet; next scheduled fire is 2026-05-25 13:03:00 UTC.

## Candidate inventory

Command:

```bash
systemctl list-timers --all --no-pager --no-legend | sed -e 's/[[:space:]]\+/ /g' | sort
systemctl list-unit-files --type=timer --all --no-pager | grep -Ei 'job|scan|daily|trade|scheduler|reconcile|happy|claude|swap|memory|safe|watch|cleanup|timer|6'
find /etc/systemd/system /usr/lib/systemd/system /lib/systemd/system -type f -name '*.timer' -print | sort | while read -r f; do grep -En '^(Description|OnCalendar|OnUnitActiveSec|OnBootSec|OnStartupSec|Unit|Persistent|AccuracySec)=' "$f"; done
```

Relevant observed candidates:

| Unit | Schedule | State | Relevance |
|---|---:|---|---|
| `daily-trade-scheduler.timer` | `Mon..Fri *-*-* 09:03:00 America/New_York` | enabled, active/waiting | Relevant daily trade scan, **not 6-hour** |
| `reconcile-incremental.timer` | every 10 min during NYSE market-hours window | enabled, active/waiting | Trading-related, **not jobs scan / not 6-hour** |
| `daily-trading.service` | no timer found | disabled, inactive | Trading daemon candidate only |
| `ua-timer.timer` | `OnUnitActiveSec=6h` | enabled but inactive/dead, skipped due missing Ubuntu Pro token | OS-level Ubuntu Pro repeated jobs, unrelated |
| `snapd.snap-repair.timer` | `05,11,17,23:00` with randomized delay | enabled but inactive/dead, skipped due conditions | OS-level snap repair, unrelated |

## Q1. What timer/service implements the 6-hour jobs scan?

**UNKNOWN.** No clear custom Happy/MAP "every-6-hours jobs scan" timer/service was found.

Closest relevant custom service:

```bash
systemctl cat daily-trade-scheduler.timer daily-trade-scheduler.service --no-pager
```

Evidence:

```ini
# /etc/systemd/system/daily-trade-scheduler.timer
[Unit]
Description=Daily Trade Scan Timer - Mon-Fri 09:03 America/New_York

[Timer]
OnCalendar=Mon..Fri *-*-* 09:03:00 America/New_York
Unit=daily-trade-scheduler.service
Persistent=false
AccuracySec=1min
```

This is a daily weekday scan, not an every-6-hours scan.

## Q2. Enabled/active, last run, next run

### `daily-trade-scheduler.timer` candidate

Commands:

```bash
systemctl is-enabled daily-trade-scheduler.timer
systemctl is-active daily-trade-scheduler.timer
systemctl show daily-trade-scheduler.timer daily-trade-scheduler.service --no-pager \
  -p LoadState -p ActiveState -p SubState -p UnitFileState -p FragmentPath \
  -p NextElapseUSecRealtime -p LastTriggerUSec -p Result
systemctl status daily-trade-scheduler.timer daily-trade-scheduler.service --no-pager -l
systemd-analyze calendar 'Mon..Fri *-*-* 09:03:00 America/New_York' --iterations=3
journalctl -u daily-trade-scheduler.timer -u daily-trade-scheduler.service --since '2026-05-23 15:30:00 UTC' --no-pager -o short-iso | tail -80
```

Evidence:

```text
daily-trade-scheduler.timer is-enabled: enabled
daily-trade-scheduler.timer is-active: active
daily-trade-scheduler.service is-enabled: disabled
daily-trade-scheduler.service is-active: inactive
```

```text
NextElapseUSecRealtime=Mon 2026-05-25 13:03:00 UTC
LastTriggerUSec=
ActiveState=active
SubState=waiting
UnitFileState=enabled
```

`LastTriggerUSec` is blank for the current timer instance, likely because the timer was stopped/restarted and the host rebooted after the last service run. Journal evidence shows the last actual service execution:

```text
2026-05-23T15:55:45+00:00 Starting daily-trade-scheduler.service
2026-05-23T15:57:10+00:00 SUCCESS: session created, exiting
2026-05-23T15:57:10+00:00 Finished daily-trade-scheduler.service
2026-05-23T15:57:10+00:00 daily-trade-scheduler.service: Consumed 41.339s CPU time.
2026-05-23T16:03:15+00:00 Stopped daily-trade-scheduler.timer
2026-05-23T17:38:34+00:00 Started daily-trade-scheduler.timer
2026-05-23T20:23:44+00:00 Started daily-trade-scheduler.timer
```

Next calendar occurrences:

```text
Next elapse: Mon 2026-05-25 13:03:00 UTC
Iteration #2: Tue 2026-05-26 13:03:00 UTC
Iteration #3: Wed 2026-05-27 13:03:00 UTC
```

### OS-level 6-hour candidates

Commands:

```bash
systemctl cat ua-timer.timer ua-timer.service snapd.snap-repair.timer snapd.snap-repair.service --no-pager
systemctl show ua-timer.timer ua-timer.service snapd.snap-repair.timer snapd.snap-repair.service --no-pager \
  -p ActiveState -p SubState -p UnitFileState -p NextElapseUSecRealtime -p LastTriggerUSec
journalctl -u ua-timer.timer -u ua-timer.service -u snapd.snap-repair.timer -u snapd.snap-repair.service --since '2026-05-20 00:00:00 UTC' --no-pager -o short-iso | tail -200
```

Evidence:

```ini
# ua-timer.timer
Description=Ubuntu Pro Timer for running repeated jobs
ConditionPathExists=/var/lib/ubuntu-advantage/private/machine-token.json
OnUnitActiveSec=6h
RandomizedDelaySec=1h
OnStartupSec=1min
```

```text
ua-timer.timer: ActiveState=inactive, SubState=dead, NextElapseUSecRealtime=, LastTriggerUSec=
ua-timer.timer was skipped because of an unmet condition check (ConditionPathExists=/var/lib/ubuntu-advantage/private/machine-token.json).
```

```ini
# snapd.snap-repair.timer
OnCalendar=*-*-* 5,11,17,23:00
RandomizedDelaySec=2h
```

```text
snapd.snap-repair.timer: ActiveState=inactive, SubState=dead, NextElapseUSecRealtime=, LastTriggerUSec=
snapd.snap-repair.timer was skipped because no trigger condition checks were met.
```

## Q3. What command/script does it execute?

For the relevant daily-trade candidate:

```ini
ExecStartPre=/bin/mkdir -p /var/log/daily-trade-scheduler
ExecStartPre=/bin/mkdir -p /var/tmp/daily-trade-scheduler
ExecStartPre=/bin/chmod 700 /var/tmp/daily-trade-scheduler
ExecStartPre=/root/bin/happy-readiness-probe.sh
ExecStart=/usr/bin/python3 /root/bin/daily-trade-scheduler.py
Environment="DAILY_TRADE_PROMPT=/daily-trade --auto --codex"
Environment=TMPDIR=/var/tmp/daily-trade-scheduler
```

The Python script defaults also show:

```text
/root/bin/daily-trade-scheduler.py:36 BASE_URL default http://localhost:8090
/root/bin/daily-trade-scheduler.py:37 PROJECT_PATH default /root/multi-asset-portfolio
/root/bin/daily-trade-scheduler.py:38 PROMPT default /daily-trade scan, overridden by systemd to /daily-trade --auto --codex
```

For OS-level unrelated 6-hour candidates:

```ini
ua-timer.service: ExecStart=/usr/bin/python3 /usr/lib/ubuntu-advantage/timer.py
snapd.snap-repair.service: ExecStart=/usr/lib/snapd/snap-repair run
```

## Q4. Resource limits / observed overhead

### Systemd limits for `daily-trade-scheduler.service`

Command:

```bash
systemctl show daily-trade-scheduler.service --no-pager \
  -p CPUAccounting -p MemoryAccounting -p TasksAccounting -p CPUQuotaPerSecUSec \
  -p MemoryMax -p MemoryHigh -p MemorySwapMax -p Nice -p IOSchedulingClass \
  -p TimeoutStartUSec -p TimeoutStopUSec -p Restart -p RestartSec -p KillMode \
  -p StartLimitBurst -p StartLimitIntervalUSec
```

Evidence:

```text
Restart=on-failure
TimeoutStartUSec=15min
TimeoutStopUSec=20s
CPUAccounting=yes
CPUQuotaPerSecUSec=infinity
MemoryAccounting=yes
MemoryHigh=infinity
MemoryMax=infinity
MemorySwapMax=infinity
TasksAccounting=yes
Nice=0
IOSchedulingClass=2
KillMode=control-group
StartLimitIntervalUSec=30min
StartLimitBurst=5
```

Interpretation: the wrapper is time-bounded, but **not CPU- or memory-capped** by systemd.

### Script-level bounds

Evidence from `/root/bin/daily-trade-scheduler.py`:

```text
BROWSER_RELAUNCH_RETRIES = 2
BROWSER_RELAUNCH_BACKOFF = 60
PRECHECK_HTTP_TIMEOUT_SEC = 8
DIR_TEXTAREA_POLL_BUDGET_SEC = 60
PLAYWRIGHT_LIFECYCLE_BUDGET_SEC = 90
```

The script uses a non-blocking lock and a watchdog around the full Playwright lifecycle. It also exits cleanly without dispatch when `/root/multi-asset-portfolio/data/trades/.safe_mode` exists.

### Observed runtime/CPU

Command:

```bash
journalctl -u daily-trade-scheduler.service --since '2026-05-20 00:00:00 UTC' --no-pager -o short-iso |
  awk '/Starting daily-trade-scheduler.service|Finished daily-trade-scheduler.service|Consumed/ {print}'
```

Evidence:

```text
2026-05-20T13:03:01 -> 2026-05-20T13:03:02: safe-mode exit, about 1s wall
2026-05-21T13:03:01 -> 2026-05-21T13:03:14: about 13s wall, 22.880s CPU
2026-05-22T11:46:30 -> 2026-05-22T11:47:44: about 74s wall, 22.876s CPU, included one 60s retry backoff after transient 502
2026-05-22T13:03:15 -> 2026-05-22T13:03:29: about 14s wall, 24.115s CPU
2026-05-22T13:22:29 -> 2026-05-22T13:23:43: about 74s wall, 23.754s CPU, included one 60s retry backoff after transient 502
2026-05-23T15:55:45 -> 2026-05-23T15:57:10: about 85s wall, 41.339s CPU, included one 60s retry backoff after transient 502
```

Current process check:

```bash
ps -eo pid,ppid,stat,lstart,etime,%cpu,%mem,rss,cmd | grep -E 'daily-trade-scheduler|/daily-trade|multi-asset-portfolio|trading/main.py|reconcile.py|chromium' | grep -v grep
```

Result: no matching live processes at audit time.

Interpretation: observed wrapper runs are short and finite, but memory peak evidence was not available after exit (`MemoryPeak=[not set]`). Also, the downstream `/daily-trade --auto --codex` Happy session can be much heavier than the scheduler wrapper; its overhead is controlled by the command-level concurrency governor below, not by this systemd unit.

## Q5. Feature-impacting changes detected

### `daily-trade-scheduler.timer`

Command:

```bash
diff -u /etc/systemd/system/daily-trade-scheduler.timer.bak-20260523-160315 /etc/systemd/system/daily-trade-scheduler.timer
diff -u /etc/systemd/system/daily-trade-scheduler.timer.bak-20260523-173833 /etc/systemd/system/daily-trade-scheduler.timer
```

Detected changes:

```diff
-Requires=daily-trade-scheduler.service
 Persistent=true
+Unit=daily-trade-scheduler.service
+Persistent=false
+AccuracySec=1min
```

Impact: `Persistent=false` means missed scheduled runs will not be caught up after downtime/reboot. This is feature-impacting for "restored" semantics if catch-up behavior is expected.

### `daily-trade-scheduler.service`

Command:

```bash
diff -u /etc/systemd/system/daily-trade-scheduler.service.bak-20260523-172607 /etc/systemd/system/daily-trade-scheduler.service
```

Detected change:

```diff
-Environment="DAILY_TRADE_PROMPT=/daily-trade --auto"
+Environment="DAILY_TRADE_PROMPT=/daily-trade --auto --codex"
```

Impact: scheduler-created sessions now request Codex adversarial consultation.

### `/root/multi-asset-portfolio/.claude/commands/daily-trade.md`

Command:

```bash
diff -u /root/multi-asset-portfolio/.claude/commands/daily-trade.md.bak-20260523-172341 /root/multi-asset-portfolio/.claude/commands/daily-trade.md
```

Detected change: a hard subagent concurrency governor was added.

Key evidence:

```text
If CODEX_REQUIRED=true: MAX_DAILY_TRADE_CONCURRENT_TASKS = 1.
Otherwise: MAX_DAILY_TRADE_CONCURRENT_TASKS = 2.
Hard upper bound across news, bull, bear, retry, and synthesizer Tasks combined.
Large universes are handled by more waves, not more simultaneous sessions.
```

Impact: lower memory/concurrency pressure but longer end-to-end `/daily-trade` latency.

## Final answer to audit question

- **6-hour jobs scan restored?** **UNKNOWN** — no matching custom every-6-hours job-scan timer/service found.
- **Daily trade scheduler restored?** **PASS for enabled/active timer**, but it is daily weekday, not 6-hour; current timer next fires 2026-05-25 13:03:00 UTC.
- **Low overhead?** **UNKNOWN/PARTIAL** — scheduler wrapper has bounded runtime and observed runs are finite (about 1s to 85s wall, 22.9s to 41.3s CPU on successful Playwright dispatches), but there is no systemd CPU/memory cap and no memory peak evidence after exit. Downstream `/daily-trade --auto --codex` load is mitigated by the newly added command-level concurrency governor (1 concurrent task with Codex, otherwise 2), not by systemd.
