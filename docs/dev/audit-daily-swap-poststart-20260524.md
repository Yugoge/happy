# Audit: daily-trade / swap-drain / happy-daemon-post-start

Date: 2026-05-24 (UTC)
Scope: read-only inspection of requested unit files/scripts plus related `systemctl` / `journalctl` metadata. No unit reload/start/stop/restart/kill and no service payload execution was performed by this audit.

## Overall verdict

**FAIL** — installed automation is mostly active, but the debt is not closable yet because:

1. `auto-safe-swap-drain.service` contains an invalid systemd key, logged as ignored: `ConditionPathIsExecutable=`.
2. The swap-drain timer is active, but the latest run skipped because swap usage was above the unattended threshold: `39767160 KiB > 8388608 KiB`; the log says manual safe-swap-drain is required.
3. `happy-daemon-post-start.sh` is wired into daemon `ExecStartPost`, but restore outcome was not proven in the allowed evidence set; only unit wiring and daemon starts were confirmed.
4. `daily-trade-scheduler.timer` is enabled, but `Persistent=false` means it will not catch up missed weekday runs after boot. Confirm this is intended before closing.

## Status matrix

| Area | Status | Evidence |
|---|---:|---|
| `daily-trade-scheduler.timer` enabled/active | **PASS** | `UnitFileState=enabled`, `ActiveState=active`, `SubState=waiting`; timer snapshot at `2026-05-24T08:56:45+00:00` showed next fire `Mon 2026-05-25 13:03:00 UTC`. |
| `daily-trade-scheduler.service` enabled/active | **PASS** | Service is loaded but intentionally inactive/disabled: `UnitFileState=disabled`, `ActiveState=inactive`, `SubState=dead`; triggered by timer. |
| daily-trade last/next run known | **PASS** | Timer `LAST` was `-` in current boot; next was `2026-05-25 13:03 UTC`. Journal showed latest actual service completion `2026-05-23T15:57:10+00:00` and latest normal weekday 09:03 ET-style fire `2026-05-22T13:03:15` -> success at `13:03:29`. |
| `auto-safe-swap-drain.timer` enabled/active | **PASS** | `UnitFileState=enabled`, `ActiveState=active`, `SubState=waiting`; post-fire snapshot: last `2026-05-24 08:56:33 UTC`, next `2026-05-24 09:01:33 UTC`. |
| `auto-safe-swap-drain.service` current execution status | **FAIL** | Service is `static` and latest run exited success, but journal says it skipped: `swap usage too high for unattended drain (39767160 KiB > 8388608 KiB); manual safe-swap-drain required`. |
| `happy-daemon-post-start.sh` auto-run wiring | **PASS** | `happy-daemon.service`, `happy-daemon-jade.service`, and `happy-daemon-dev.service` are enabled/active and each has `ExecStartPost=/root/bin/happy-daemon-post-start.sh`. |
| post-start restore feature proven | **UNKNOWN** | Script schedules `sleep 20 && /root/bin/happy-session-recovery.sh restore`, but this audit did not inspect `/var/log/happy-daemon-post-start.log` / recovery logs or restart daemons. |
| resource overhead likely small | **PASS with caveats** | Swap timer skip path showed `CPU: 8ms`; daily-trade journal showed ~23-41s CPU per actual Playwright run. No hard memory/CPU quotas exist. |

## What they execute and boot behavior

### Daily trade

Files:
- `/etc/systemd/system/daily-trade-scheduler.service`
- `/etc/systemd/system/daily-trade-scheduler.timer`

Execution:
- Timer: `OnCalendar=Mon..Fri *-*-* 09:03:00 America/New_York`
- Service preflight: creates `/var/log/daily-trade-scheduler`, creates/chmods `/var/tmp/daily-trade-scheduler`, then runs `/root/bin/happy-readiness-probe.sh`.
- Service payload: `/usr/bin/python3 /root/bin/daily-trade-scheduler.py`
- Environment includes `DAILY_TRADE_PROMPT=/daily-trade --auto --codex` and `TMPDIR=/var/tmp/daily-trade-scheduler`.

Boot behavior:
- The timer is enabled under `timers.target`, so it starts on boot and waits for the next matching weekday 09:03 America/New_York fire.
- `Persistent=false`, so missed runs are not backfilled after boot.
- The service itself is disabled and does not run directly at boot except when triggered manually or by the timer.

Feature impact visible from journal:
- The automation creates a Happy web session and types `/daily-trade --auto --codex`.
- Journal evidence showed production-facing targets during previous runs (`http://localhost:8090/...`, `https://api.life-ai.app/...`). This may be intentional production automation, but it should be explicitly documented/owned.

### Auto safe swap drain

Files:
- `/etc/systemd/system/auto-safe-swap-drain.service`
- `/etc/systemd/system/auto-safe-swap-drain.timer`
- `/root/bin/auto-safe-swap-drain.sh`

Execution:
- Timer: `OnBootSec=10min`, `OnUnitActiveSec=5min`, `AccuracySec=1min`, `Persistent=false`.
- Service payload: `/root/bin/auto-safe-swap-drain.sh` as root.
- Script uses a nonblocking flock at `/var/run/auto-safe-swap-drain.lock`.
- Script skips unless all safety checks pass: swap used > 0, swap used <= 8 GiB, `MemAvailable >= 8 GiB`, integer load1 < 6, memory PSI avg10 < 1.00.
- If allowed, it runs `/root/bin/safe-swap-drain.sh --no-drop-caches --margin-gib 6 --timeout-sec 240`.

Boot behavior:
- Timer is enabled under `timers.target`; it first runs 10 minutes after boot, then about every 5 minutes after the service unit becomes active.
- It does not backfill missed runs because `Persistent=false`.

Current feature status:
- Active timer is firing.
- Latest observed run did not drain; it skipped because swap usage was too high for unattended mode and requested manual intervention.

### happy-daemon post-start

File:
- `/root/bin/happy-daemon-post-start.sh`

Execution:
- Not a standalone timer/service in the requested scope.
- Wired as `ExecStartPost` on all three daemon units observed:
  - `happy-daemon.service` (`HAPPY_HOME_DIR` default `/root/.happy`)
  - `happy-daemon-jade.service` (`HAPPY_HOME_DIR=/root/.happy-jade`)
  - `happy-daemon-dev.service` (`HAPPY_HOME_DIR=/root/.happy-dev`)
- Script waits up to 15 seconds for `${HAPPY_HOME}/daemon.state.json`, validates the PID belongs to a matching `happy-cli/dist/index.mjs daemon start-sync` process for that home, writes `${HAPPY_HOME}/daemon.pid`, then backgrounds `sleep 20 && /root/bin/happy-session-recovery.sh restore`.

Boot behavior:
- All three daemon units are enabled under `multi-user.target` and active, so the post-start script runs at boot and on daemon service starts/restarts.
- Current boot evidence: daemon units entered active state around `2026-05-23 20:23:53 UTC`.

## Resource protections / limits

### Daily trade

Present:
- `TimeoutStartSec=900`
- `TimeoutStopSec=20`
- `KillMode=control-group`
- `Restart=on-failure`, `RestartSec=120`
- `StartLimitBurst=5`, `StartLimitIntervalSec=1800`
- `RestartPreventExitStatus=2 5 6 7 8 9 10`
- `TMPDIR=/var/tmp/daily-trade-scheduler` to keep Chromium temp/profile/shared-memory I/O off `/tmp` tmpfs.

Missing/weak:
- Runs as root.
- No hard `MemoryMax`, `MemoryHigh`, or CPU quota (`MemoryMax=infinity`, CPU quota infinity).
- No sandboxing hardening (`ProtectSystem=no`, `ProtectHome=no`, `PrivateTmp=no`, `NoNewPrivileges=no`).

Overhead judgment: small when idle because it only runs on schedule; moderate during Playwright runs. Recent actual runs consumed about 23-41 seconds CPU according to journal.

### Auto swap drain

Present:
- `Nice=19`
- `IOSchedulingClass=idle`
- `TimeoutStartSec=300`
- flock prevents overlapping runs.
- Script safety gates on swap amount, available memory, load, and memory PSI.
- Timer path uses `--no-drop-caches`, `--margin-gib 6`, and `--timeout-sec 240`.

Missing/weak:
- Invalid systemd condition key: `ConditionPathIsExecutable=` is ignored by systemd. The script still checks `[[ -x "$SAFE_SCRIPT" ]]`, but the unit-level condition is not working.
- No hard `MemoryMax` or CPU quota.

Overhead judgment: likely small in normal skip path; `systemctl status` showed an 8ms CPU run at `2026-05-24 08:51:33 UTC`. Actual drain path can run up to 240 seconds and perform swap/memory operations, but with idle I/O priority and safety gates.

### happy-daemon post-start

Present:
- Validates PID before writing daemon pid file.
- Uses a 15-second bounded validation loop.
- Delays restore by 20 seconds to let daemons publish state.

Missing/weak:
- Background restore is not separately supervised as its own systemd unit in the observed wiring.
- No dedicated resource limits for the post-start script/restore path beyond the daemon unit context.
- Restore success/failure is not visible in the inspected systemd metadata.

Overhead judgment: the PID validation script itself is tiny. The background global restore may be more impactful depending on session count, but this audit did not inspect recovery internals or logs.

## Visible changes vs easy backups/history

Only local backup files in `/etc/systemd/system` and `/root/bin` were compared; no deeper history was available in the requested scope.

### Daily trade service/timer

- Current service matches `/etc/systemd/system/daily-trade-scheduler.service.bak-20260523-172341`.
- Versus `.bak-20260523-172607`, the prompt changed from `/daily-trade --auto` to `/daily-trade --auto --codex`.
- Timer changed from older backups by:
  - removing `Requires=daily-trade-scheduler.service`,
  - adding `Unit=daily-trade-scheduler.service`,
  - changing `Persistent=true` to `Persistent=false`,
  - adding `AccuracySec=1min`.

### Auto swap drain

- Service changed by adding `ConditionPathIsExecutable=/root/bin/safe-swap-drain.sh` and `TimeoutStartSec=300`; the condition key is currently invalid/ignored.
- Timer changed from `OnBootSec=5min` / `OnUnitActiveSec=1min` / `Persistent=true` to `OnBootSec=10min` / `OnUnitActiveSec=5min` / `Persistent=false`.
- Script changed to stricter unattended criteria: load threshold 8 -> 6, minimum available memory 8 GiB, memory PSI max 1.00, max unattended swap 8 GiB, safe margin 6 GiB, timeout 240s, and `--no-drop-caches`.

### happy-daemon post-start

- Versus `/root/bin/happy-daemon-post-start.sh.bak-20260523-184252`, restore changed from scoped `restore --home '${HAPPY_HOME}'` after 8 seconds to one global `restore` after 20 seconds.
- Versus emergency backup from 2026-05-22, the current script added PID validation against process cmdline and `HAPPY_HOME_DIR`, bounded retry loop, and log preservation.

## Required fixes before closing

1. Replace `ConditionPathIsExecutable=/root/bin/safe-swap-drain.sh` with a valid systemd condition such as `ConditionFileIsExecutable=/root/bin/safe-swap-drain.sh`, or intentionally remove the unit-level condition and document reliance on the script-level executable check.
2. Resolve the current swap-drain non-action state: either perform the manual safe swap drain through the approved operator path, add an alert/runbook for `swap usage too high for unattended drain`, or change policy if unattended high-swap handling is intended.
3. Confirm expected timer semantics for both timers, especially `Persistent=false`; if missed daily trade or swap-drain runs should be caught up after boot, this is currently wrong.
4. Provide evidence that `happy-daemon-post-start.sh` actually restores all intended homes after boot/restart without a restore storm. The current audit only confirms wiring, not end-to-end restore success.
5. Decide whether the absence of hard memory/CPU limits is acceptable. If not, add explicit resource caps for the Playwright daily-trade path and/or swap-drain path.
6. Explicitly document/approve that daily-trade automation targets production web/API (`localhost:8090` / `api.life-ai.app`) if that is intended.

## Evidence commands used

Read-only commands only:
- `sed`, `stat`, and `ls` on the requested unit/script files.
- `systemctl show`, `systemctl status`, `systemctl list-unit-files`, and `systemctl list-timers --all`.
- `journalctl -u ... --no-pager` for requested/related units.
- `find` and `diff -u` for easy local backup comparison.
