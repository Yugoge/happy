# DEPLOYMENT.md — happy dev → prod patch promotion runbook

Operator-facing runbook for `scripts/deploy.sh` and `scripts/rollback.sh`. If you
came here because a deploy went sideways, jump to **§ Recovery**.

> **Audience**: Yugoge (operator). All commands run as `root` from a TTY.
> Agent (Claude Code) cannot run any of these — they're hook-blocked.

---

## TL;DR

```bash
# Deploy a validated dev SHA into prod
cd /root/happy
bash scripts/deploy.sh <dev-SHA> <topic-slug>

# If it broke, roll back to the snapshot tag the deploy created
cd /root/happy
bash scripts/rollback.sh <pre-deploy-tag-from-deploy-output>
```

Both scripts gate, validate, and abort early on the slightest doubt. They
never push until daemons are verified healthy. They always create a rollback
target before touching anything.

---

## One-time setup (do once per fresh `/root/happy` clone)

### 1. Verify the fork remote is named `fork`

`deploy.sh` insists the remote is named `fork`. Confirm:

```bash
cd /root/happy
git remote -v | grep '^fork\b' || echo "MISSING — add it"
# Should print: fork  git@github.com:Yugoge/happy.git (fetch)/(push)
```

If missing:

```bash
git remote add fork git@github.com:Yugoge/happy.git
git fetch fork
```

### 2. Verify recovery script is executable

```bash
[ -x /root/bin/happy-session-recovery.sh ] && echo OK || echo MISSING
```

If missing, deploy will abort early. Restore from `~/bin/` backup or talk to
whoever maintains `/root/bin/`.

### 3. Verify the `safe-daemon-restart.sh` SOP exists (optional)

`rollback.sh` prefers `/root/bin/safe-daemon-restart.sh` for daemon-restart
hints; falls back to `/root/bin/happy-restart.sh` if missing. Both work.

```bash
[ -x /root/bin/safe-daemon-restart.sh ] && echo "preferred SOP available" \
  || echo "will fall back to happy-restart.sh"
```

### 4. Verify log file is writable

```bash
sudo touch /var/log/happy-deploy.log /var/log/happy-rollback.log
sudo chmod 644 /var/log/happy-deploy.log /var/log/happy-rollback.log
```

---

## Standard deploy procedure

### Step 0 — pick the dev SHA to deploy

You're promoting a commit from `fork/<dev-branch>` into `/root/happy` main.
Find the SHA on GitHub, or:

```bash
cd /dev/shm/dev-workspace/happy-dev
git log --oneline fork/main -20
```

Copy a 7+ character prefix or full SHA.

### Step 1 — pick a topic slug

Short kebab-case identifier (4–30 chars, `[a-z0-9-]+`). Examples:
`codex-watcher-fix`, `latex-render-fix`, `redis-pool-bump`.

This becomes part of the deploy tag: `stable/<date>-<HHMMSS>-<sha>-<topic>`.

### Step 2 — start a screen / tmux session

The deploy runs an interactive `confirm` prompt before the global install. If
your SSH disconnects mid-deploy, you lose the session and end up in a partial
state. Always run inside `screen` or `tmux`.

```bash
screen -S deploy-$(date +%H%M)
```

### Step 3 — invoke the deploy

```bash
cd /root/happy
bash scripts/deploy.sh <dev-SHA> <topic-slug>
```

Watch the log. The script will:

1. Validate cwd is `/root/happy` (codex #5 — 2026-04-04 incident gate)
2. Validate working tree is clean (codex #9)
3. Validate `dev-SHA` resolves and is reachable
4. Tag pre-deploy snapshot: `stable/<date>-<HHMMSS>-<SHA>-pre-deploy`
5. Merge `--no-ff --no-commit`, then **explicitly checkout PRE_HEAD on
   protected paths** (CLAUDE.md, INDEX.md, .claude/, docs/dev/, docs/spec/)
6. Commit the merge
7. Detect same-version no-op deploy → abort if package.json version unchanged
   (codex #3)
8. Run `yarn install --frozen-lockfile && yarn workspaces run test` test gate
9. **Pause for `confirm "Proceed with global install?"`** ← you press `y`
10. `npm install -g .`
11. Sleep 90s for daemon auto-upgrade heartbeat
12. Verify all 3 prod daemons (`/root/.happy`, `/root/.happy-jade`,
    `/root/.happy-qijie`) loaded the new version
13. **Only after daemons are healthy**, tag deploy + push main + 2 tags atomic
    to fork (codex #8 push-before-validate fix)

### Step 4 — verify in the app

```bash
# UI verification (operator does manually):
# 1. Open https://life-ai.app on phone or browser
# 2. Send a test message in an existing session
# 3. Confirm the response renders correctly
```

**Done.** You have a deploy tag (`stable/<date>-<HHMMSS>-<SHA>-<topic>`) and a
pre-deploy tag (`stable/<...>-pre-deploy`) on fork as your rollback target.

---

## Standard rollback procedure

You realize the deploy is broken (UI regression, crash loop, …). Roll back.

### Step 1 — find the pre-deploy tag

The tag was printed at the top of the deploy log. Or:

```bash
cd /root/happy
git tag -l 'stable/*-pre-deploy' | tail -5
```

Pick the most recent one (the deploy you want to undo).

### Step 2 — start screen, run rollback

```bash
screen -S rollback-$(date +%H%M)

cd /root/happy
bash scripts/rollback.sh stable/2026-04-30-123456-abc1234-pre-deploy
```

The script:

1. Validates cwd
2. Validates working tree is clean
3. Validates the tag is annotated, exists locally, reachable from main
4. Calls `/root/bin/happy-session-recovery.sh save` for pre-rollback snapshot
5. Detects same-version no-op (already at this version) → abort
6. Tags safety snapshot: `stable/<date>-<HHMMSS>-<SHA>-pre-rollback`
7. `git reset --hard <tag>` + verifies HEAD matches expected SHA
8. **Rebuilds happy-cli** (`yarn install --frozen-lockfile && yarn workspace
   happy-cli build`) — without this, `npm install -g` ships un-rolled-back
   compiled `dist/`
9. `npm install -g .`
10. Sleep 90s
11. Verifies all 3 daemons loaded the rollback target version
12. Prints fork-divergence advisory (`git rev-list --count
    HEAD..fork/main`) with two forward paths if you want to push

### Step 3 — decide forward strategy

`rollback.sh` does **not** push. It tells you the current state and asks you
to pick:

- **(a) Single-commit failed deploy**: `git push fork
  --force-with-lease=main:<bad-commit-SHA>` — only force-push if you're sure
  no one else committed since.
- **(b) Multi-commit / collaborator territory**: tag-based forward roll —
  cherry-pick fix on top instead of force-push.

If you're unsure, **don't push**. The local rollback is enough — daemons are
already on the rolled-back version. Push after you've cooled down and decided.

---

## Failure mode reference

### `ABORT: cwd is not /root/happy`

You're not in `/root/happy`. The script refuses to deploy from anywhere else.
This is the 2026-04-04 incident gate.

```bash
cd /root/happy && bash scripts/deploy.sh ...
```

### `ABORT: working tree not clean`

Stash, commit, or discard your local changes first.

```bash
git status
git stash    # or git commit -m "wip" / git restore .
```

### `ABORT: dev-SHA does not resolve / not reachable from fork/main`

The SHA you typed isn't on fork. Either you fat-fingered it or the dev branch
hasn't been pushed yet. Run `git fetch fork && git log fork/main -10` to see
recent SHAs.

### `ABORT: same version` (deploy)

The dev SHA's `package.json` version is identical to current prod. Either:
- That's correct (no version bump needed) → bump `packages/happy-cli/package.json`
  in the dev branch and re-run deploy
- Or you picked the wrong SHA

### `ABORT: test gate failed`

`yarn workspaces run test` failed against the merged tree. Don't continue.
The merge has already been made locally; your prod tree is in a transitional
state. The script auto-rolls-back to PRE_HEAD on test failure.

### `ABORT: daemon X did not pick up new version`

Global install succeeded but a daemon didn't auto-upgrade within 90s. This is
serious — your prod tree is at the new version but at least one daemon is
still running old code. Possible causes:

- The daemon's heartbeat is stuck (check `journalctl -u happy-daemon-jade -n 50`)
- The daemon process died and didn't respawn (check `systemctl status happy-daemon-jade`)
- Manual `safe-daemon-restart.sh` needed: `bash /root/bin/safe-daemon-restart.sh
  jade --reason "post-deploy auto-upgrade timeout"`

The deploy log will tell you which daemon failed and which version it's still on.

### `ABORT: push failed (after daemons healthy)`

Local state is good (all daemons on new version), but pushing to fork failed
(network, auth, conflict, …). Your local prod is correct — the push is
recoverable later. Just retry:

```bash
cd /root/happy
git push --atomic fork main \
  refs/tags/stable/<deploy-tag> \
  refs/tags/stable/<pre-deploy-tag>
```

---

## Tag conventions

| Tag pattern | Purpose | Created by |
|-------------|---------|------------|
| `stable/YYYY-MM-DD-HHMMSS-<sha>-pre-deploy` | rollback target before this deploy | deploy.sh step 4 |
| `stable/YYYY-MM-DD-HHMMSS-<sha>-<topic>` | deploy point (= what you deployed) | deploy.sh step 13 |
| `stable/YYYY-MM-DD-HHMMSS-<sha>-pre-rollback` | safety snapshot before rolling back | rollback.sh step 6 |
| `stable/YYYY-MM-DD-<topic>` (legacy) | three pre-existing baselines | manual `git tag -a` |

The three legacy baselines are:
- `stable/2026-03-23-F1-F2` — F1 LaTeX/Mermaid + F2 image upload
- `stable/2026-03-25-mobile-table-fix` — table font + mobile overflow
- `stable/2026-04-09-prod-baseline` — current prod HEAD as of 2026-04-09

---

## What deploy.sh + rollback.sh do NOT cover

These are explicitly out of scope. If your deploy involves any of these,
you need separate procedures:

- **Database migrations** — schema changes don't roll back with `git reset
  --hard`. Coordinate forward-only migrations or write down-migrations
  separately.
- **`/root/bin/*.sh` script changes** — these aren't in the repo. Edit + test
  + commit them separately.
- **Docker image rebuilds** — `happy-server` and `happy-web` containers are
  managed via `/root/deploy/docker-compose.yml`, not via this workflow.
- **Encryption key rotation** — touches `access.key` files, daemon home dirs,
  user credentials. Different problem.
- **`safe-daemon-restart.sh` itself** — operator-only territory; agents
  cannot modify `/root/bin/`.
- **Session loss during global install** — `npm install -g` overwrites
  `/usr/lib/node_modules/happy-coder` while daemons are running, which kills
  their session children via cgroup. Recovery is best-effort via
  `--resume <UUID>`. Real fix is **atomic-symlink architecture** — see
  `docs/dev/adr-atomic-symlink-deploy.md`.

---

## Recovery from edge cases

### "I ran deploy from `/root/happy-dev` instead of `/root/happy`"

The cwd realpath gate prevents this from starting at all. If somehow it ran
anyway (you bypassed the script), check:

```bash
cd /root/happy
git status
git log -3
```

If `/root/happy` is unmodified, you're fine. The dev workspace is just an
extra clone — it can't push to fork's main without your auth.

### "Pre-deploy tag was created but global install never started"

Either you pressed `n` at the confirm prompt, or the test gate failed. Check:

```bash
cd /root/happy
git status                  # should be clean (script auto-rolled back)
git tag -l 'stable/*' | tail -3  # pre-deploy tag may still exist
git log -1                  # should be at PRE_HEAD again
```

Delete the stray pre-deploy tag if you don't want the noise:

```bash
git tag -d stable/<...>-pre-deploy
# don't push --delete unless tag was already pushed (it shouldn't have been)
```

### "Multiple daemons restarted simultaneously and some sessions are lost"

This is the architectural reality. After deploy completes:

```bash
# Check what's running
bash /root/bin/happy-session-recovery.sh check

# Restore what's recoverable
bash /root/bin/happy-session-recovery.sh restore
```

Sessions whose `.jsonl` history is intact will resume. Sessions where
recovery script has no record (e.g., the codex registration gap) will not.
Long-term fix: atomic-symlink ADR.

### "I rolled back, but fork/main is still on the bad commit"

`rollback.sh` deliberately doesn't push. You decide whether to:

- **Force-push the rollback** (if you're the only contributor):
  ```bash
  cd /root/happy
  git push --force-with-lease=main:<bad-commit-sha> fork main
  ```
- **Cherry-pick a forward fix** (safer, no history rewrite):
  ```bash
  # Make a fix commit on top of current /root/happy main
  git commit -am "hotfix: revert effects of <topic>"
  git push fork main
  ```

`rollback.sh` prints the divergence count and both options at the end. Use
those numbers to inform the choice.

---

## Operational logs

| Log | Path |
|-----|------|
| deploy events | `/var/log/happy-deploy.log` |
| rollback events | `/var/log/happy-rollback.log` |
| daemon logs | `journalctl -u happy-daemon{,-jade,-qijie} -n 200` |
| session recovery | `~/.happy*/session_history.jsonl` |

---

## Verifying the harness works

```bash
cd /root/happy   # or wherever scripts/ lives
bash tests/run-all.sh
# Expect: 24 PASS / 0 FAIL in ~30s
```

24 named scenarios (S01–S17) cover the codex critical findings, deploy + rollback
happy paths, and all major abort branches. Sandboxed — does not touch real
systemd, npm, GitHub, or `/root`.
