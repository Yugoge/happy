## Bug attribution
The actual loss was introduced by Yugoge’s revert/reset sequence — explicit revert commit `1731a6fcb448` (`Revert "Merge branch 'worktree-overnight-20260325-9b131828'"`) followed by resets of `main` back to `f6f129a1`; `fbaa5808e1e7` itself did **not** delete `HAPPY_SERVER_URL`.

## Forensic timeline
| UTC date | Ref / hash | Author | What happened | Evidence |
|---|---|---:|---|---|
| 2026-03-25 12:27 | `f6f129a1` | Yugoge | Merge-base commit; `Dockerfile.webapp` contains `ARG HAPPY_SERVER_URL` and `ENV EXPO_PUBLIC_HAPPY_SERVER_URL` | `git diff f6f129a1^ f6f129a1 -- Dockerfile.webapp` |
| 2026-03-26 06:25 | `fbaa5808` | Yugoge | Auto-save commit from prior overnight branch | Commit stats show 12 files changed, only 5 deletions total, none in `CLAUDE.md` or hooks |
| 2026-03-26 06:25 | `fbaa5808` | Yugoge | `Dockerfile.webapp` change was **add** `COPY patches ./patches`; it did **not** remove `HAPPY_SERVER_URL` | `git diff fbaa5808^ fbaa5808 -- Dockerfile.webapp` |
| 2026-03-26 12:19 | `57edfa49` | Yugoge | Merged `worktree-overnight-20260325-9b131828` into `main` | Reflog + merge commit |
| 2026-03-26 14:14 | `1731a6f` | Yugoge | Reverted that merge | Commit message: `Revert "Merge branch 'worktree-overnight-20260325-9b131828'"` |
| 2026-03-26 14:14 | `1731a6f` | Yugoge | Revert removed overnight artifacts and the duplicate `COPY patches ./patches`; still no `HAPPY_SERVER_URL` deletion | `git diff 1731a6f^ 1731a6f -- Dockerfile.webapp` |
| 2026-03-26 21:49 | reflog `main@{2026-03-26T21:49:41Z}` | Yugoge | `main` reset to `f6f129a1` | `git reflog --all` |
| 2026-03-27 01:05 | `8571dd3f` | Yugoge | Fork-side doc rebuild starts; `CLAUDE.md` +49 lines | `git show --stat 8571dd3f -- CLAUDE.md INDEX.md` |
| 2026-03-27 10:23 | `69755eb9` | Yugoge | More fork-side `CLAUDE.md` additions | `git show --stat 69755eb9 -- CLAUDE.md INDEX.md` |
| 2026-03-27 11:05 | `27cf62e6` | Yugoge | Fork-side “restore” commit updates `CLAUDE.md`, `INDEX.md`, `posttool-todo-sequence.py` | `git show --stat 27cf62e6` |
| 2026-03-27 11:05 | `27cf62e6` | Yugoge | Commit body blames `fbaa5808`, but diff evidence contradicts that | `fbaa5808` never touched `CLAUDE.md`, posttool hook, or `HAPPY_SERVER_URL` lines |
| 2026-03-27 21:56 | reflog `main@{2026-03-27T21:56:46Z}` | Yugoge | `main` reset again to `f6f129a1`, orphaning the fork-side restore chain from local main | `git reflog --all` |
| 2026-03-27 22:01 | `925f5960` | Yugoge | Local main begins new lineage by merging upstream `origin/main` onto `f6f129a1` | Merge commit parents: `f6f129a1` + `94a6bdc7` |
| 2026-03-28 00:10 | `1d5b4929` | Yugoge | Local main independently reintroduces the restore ideas into `CLAUDE.md` | Pickaxe shows first local re-add of `Web App Server URL Architecture` and “THREE localStorage entries” |
| 2026-03-28 19:38 | `e6b2de62` | Yugoge | Local main improves/corrects those docs for dev: `api-dev.life-ai.app`, worktree build instructions | Pickaxe shows first local `api-dev.life-ai.app` / dev `HAPPY_SERVER_URL` guidance |
| 2026-04-26 23:05 | `27733ff6` | Yugoge | Current local HEAD | Current `HEAD` |
## Content divergence audit
| File / topic | fork/main | local main | deployed/runtime copies | Verdict |
|---|---|---|---|---|
| `CLAUDE.md` | Has restore concepts, but still uses stale dev examples like `api.life-ai.app` for dev build/login in the restored sections | Has the same concepts **and** later corrections: current file contains `Web App Server URL Architecture` (line 649), `THREE localStorage entries` (line 631), dev build arg guidance with `api-dev.life-ai.app` (lines 83, 553, 656) | N/A | **Local is canonical**; fork’s version is older and partly wrong for dev |
| `CLAUDE.md` reintroduction history | via fork-only `27cf62e6` | independently reintroduced on local by `1d5b4929`, then corrected by `e6b2de62` | N/A | **Yes, local already reintroduced the lost content** |
| `.claude/hooks/posttool-todo-sequence.py` | Blob `aa9c6620`; keeps Rule 4 but drops Rule 5 immutability and rewrites the hook to a simpler version | Blob `8ecda874`; Rule 4 present (`cannot start before…`, lines 85–96) **and** Rule 5 immutability present (line 24 / error text at line 137) | `/root/happy/.claude/hooks/posttool-todo-sequence.py`, `/root/happy-dev/.claude/hooks/posttool-todo-sequence.py`, and `/root/happy-dev.bak/.claude/hooks/posttool-todo-sequence.py` are byte-identical to local main | **Local/deployed is canonical**; fork’s posttool version is not needed |
| Exact `~/.claude/hooks/posttool-todo-sequence.py` | Could not verify exact live path because `/root/.claude` is a broken symlink to `/dev/shm/dev-workspace/dot-claude` in this environment | — | Closest deployed copies above are all local-main-identical | **Practical answer:** deployed copies match local, not fork |
| `.claude/hooks/pretool-bash-safety.sh` | Same blob as local (`d67c7f86`) | Same blob as fork | same project copies present | **Identical on both sides**; `27cf62e6` commit message mentions it, but the commit did not actually change it |
| `INDEX.md` | Older generated inventory, 114 entries, dated 2026-03-27 | Much newer generated inventory, 842 entries, dated 2026-04-07 | N/A | **Keep local** |
| `Dockerfile.webapp` / suspected root cause | `HAPPY_SERVER_URL` present | `HAPPY_SERVER_URL` present | N/A | **No live divergence here**; the “fbaa deleted it” claim is unsupported |
| Fork-only artifacts since merge-base | 24 Playwright console logs, 9 root QA evidence files, 1 `.claude/worktrees/overnight-20260327-3bea7801`, plus `CLAUDE.md`, `INDEX.md`, posttool hook | Local does not need those artifacts | N/A | **Mostly noise / audit artifacts** |
## Recommended path
**Rank 1: B — push current local `HEAD` to a new branch on `fork`, leave `fork/main` untouched for now.**
Why:
1. Local already contains the only substantive fork-side ideas, and in a newer/corrected form.
2. Fork-only divergence is mostly artifacts (24 logs + 9 QA files + 1 worktree pointer).
3. A cherry-pick of `27cf62e6` is unnecessary and would partially regress docs/hook behavior.
4. D merge would import old logs/screenshots and create avoidable conflicts.
5. C force-push may be reasonable later, but it destroys the easiest audit handle immediately.
Concrete next-step commands the user can run from a TTY:
```bash
cd /dev/shm/dev-workspace/happy-dev
git fetch origin fork --prune
BRANCH=cycle6-fixes-20260427
git push fork HEAD:refs/heads/$BRANCH
printf '%s\n' \
  "Review vs fork/main: https://github.com/Yugoge/happy/compare/main...$BRANCH?expand=1" \
  "Optional upstream compare: https://github.com/slopus/happy/compare/main...Yugoge:$BRANCH?expand=1"
```
If the user insists on A or D anyway, the likely resolution rules are:
- `CLAUDE.md`: **keep local (`ours`)** for all dev-build, MMKV URL, `api-dev.life-ai.app`, and isolation sections.
- `INDEX.md`: **keep local (`ours`)**; fork copy is an older generated inventory.
- `.claude/hooks/posttool-todo-sequence.py`: even if Git auto-applies fork’s version cleanly, **keep local**, because local/deployed copies already include Rule 4 and also keep Rule 5 immutability.
## Risks of recommended path
1. `fork/main` stays stale, so branch sprawl remains for a bit.  
   Mitigation: use the compare URL above as the canonical review surface.
2. The pushed branch will reflect committed history only (`HEAD` at `27733ff6`), **not** the current dirty working tree with 824 uncommitted files.  
   Mitigation: only push if `HEAD` is the intended review point; otherwise snapshot the dirty state separately before any later publish step.
3. The review surface is large (298 local-only commits).  
   Mitigation: review by compare URL first, then decide whether to archive+replace `fork/main`.
4. Someone may later cherry-pick `27cf62e6` out of habit.  
   Mitigation: don’t; it is older than local on the substantive docs and older than deployed behavior on the posttool hook.
## Backup recommendation
If, after reviewing the new branch, the user decides `fork/main` itself should mirror local `HEAD`, use a **protected C**: archive current `fork/main`, then force-push local.
```bash
cd /dev/shm/dev-workspace/happy-dev
ARCHIVE=fork-main-archive-20260427
git push fork fork/main:refs/heads/$ARCHIVE
git push --force-with-lease fork HEAD:main
```
That preserves the 8 fork-only commits under an archive branch before replacing `fork/main`.
---
Bottom line: **local main is the canonical line; fork/main does not contain any substantive fix that local lacks today.**
hook: Stop
hook: Stop
hook: Stop
hook: Stop Failed
hook: Stop Completed
hook: Stop Completed
2026-04-27T00:17:41.571548Z ERROR codex_core::session: failed to record rollout items: thread 019dcc43-f710-7ce1-b366-850597105236 not found
tokens used
166,299
I did not write `/dev/shm/dev-workspace/happy-dev/docs/dev/codex-fork-divergence-research-20260427.md` because that would violate your “DO NOT modify any files” constraint. Below is the exact report content.
---
The actual loss was introduced by Yugoge’s revert/reset sequence — explicit revert commit `1731a6fcb448` (`Revert "Merge branch 'worktree-overnight-20260325-9b131828'"`) followed by resets of `main` back to `f6f129a1`; `fbaa5808e1e7` itself did **not** delete `HAPPY_SERVER_URL`.
| UTC date | Ref / hash | Author | What happened | Evidence |
|---|---|---:|---|---|
| 2026-03-25 12:27 | `f6f129a1` | Yugoge | Merge-base commit; `Dockerfile.webapp` contains `ARG HAPPY_SERVER_URL` and `ENV EXPO_PUBLIC_HAPPY_SERVER_URL` | `git diff f6f129a1^ f6f129a1 -- Dockerfile.webapp` |
| 2026-03-26 06:25 | `fbaa5808` | Yugoge | Auto-save commit from prior overnight branch | Commit stats show 12 files changed, only 5 deletions total, none in `CLAUDE.md` or hooks |
| 2026-03-26 06:25 | `fbaa5808` | Yugoge | `Dockerfile.webapp` change was **add** `COPY patches ./patches`; it did **not** remove `HAPPY_SERVER_URL` | `git diff fbaa5808^ fbaa5808 -- Dockerfile.webapp` |
| 2026-03-26 12:19 | `57edfa49` | Yugoge | Merged `worktree-overnight-20260325-9b131828` into `main` | Reflog + merge commit |
| 2026-03-26 14:14 | `1731a6f` | Yugoge | Reverted that merge | Commit message: `Revert "Merge branch 'worktree-overnight-20260325-9b131828'"` |
| 2026-03-26 14:14 | `1731a6f` | Yugoge | Revert removed overnight artifacts and the duplicate `COPY patches ./patches`; still no `HAPPY_SERVER_URL` deletion | `git diff 1731a6f^ 1731a6f -- Dockerfile.webapp` |
| 2026-03-26 21:49 | reflog `main@{2026-03-26T21:49:41Z}` | Yugoge | `main` reset to `f6f129a1` | `git reflog --all` |
| 2026-03-27 01:05 | `8571dd3f` | Yugoge | Fork-side doc rebuild starts; `CLAUDE.md` +49 lines | `git show --stat 8571dd3f -- CLAUDE.md INDEX.md` |
| 2026-03-27 10:23 | `69755eb9` | Yugoge | More fork-side `CLAUDE.md` additions | `git show --stat 69755eb9 -- CLAUDE.md INDEX.md` |
| 2026-03-27 11:05 | `27cf62e6` | Yugoge | Fork-side “restore” commit updates `CLAUDE.md`, `INDEX.md`, `posttool-todo-sequence.py` | `git show --stat 27cf62e6` |
| 2026-03-27 11:05 | `27cf62e6` | Yugoge | Commit body blames `fbaa5808`, but diff evidence contradicts that | `fbaa5808` never touched `CLAUDE.md`, posttool hook, or `HAPPY_SERVER_URL` lines |
| 2026-03-27 21:56 | reflog `main@{2026-03-27T21:56:46Z}` | Yugoge | `main` reset again to `f6f129a1`, orphaning the fork-side restore chain from local main | `git reflog --all` |
| 2026-03-27 22:01 | `925f5960` | Yugoge | Local main begins new lineage by merging upstream `origin/main` onto `f6f129a1` | Merge commit parents: `f6f129a1` + `94a6bdc7` |
| 2026-03-28 00:10 | `1d5b4929` | Yugoge | Local main independently reintroduces the restore ideas into `CLAUDE.md` | Pickaxe shows first local re-add of `Web App Server URL Architecture` and “THREE localStorage entries” |
| 2026-03-28 19:38 | `e6b2de62` | Yugoge | Local main improves/corrects those docs for dev: `api-dev.life-ai.app`, worktree build instructions | Pickaxe shows first local `api-dev.life-ai.app` / dev `HAPPY_SERVER_URL` guidance |
| 2026-04-26 23:05 | `27733ff6` | Yugoge | Current local HEAD | Current `HEAD` |
| File / topic | fork/main | local main | deployed/runtime copies | Verdict |
|---|---|---|---|---|
| `CLAUDE.md` | Has restore concepts, but still uses stale dev examples like `api.life-ai.app` for dev build/login in the restored sections | Has the same concepts **and** later corrections: current file contains `Web App Server URL Architecture` (line 649), `THREE localStorage entries` (line 631), dev build arg guidance with `api-dev.life-ai.app` (lines 83, 553, 656) | N/A | **Local is canonical**; fork’s version is older and partly wrong for dev |
| `CLAUDE.md` reintroduction history | via fork-only `27cf62e6` | independently reintroduced on local by `1d5b4929`, then corrected by `e6b2de62` | N/A | **Yes, local already reintroduced the lost content** |
| `.claude/hooks/posttool-todo-sequence.py` | Blob `aa9c6620`; keeps Rule 4 but drops Rule 5 immutability and rewrites the hook to a simpler version | Blob `8ecda874`; Rule 4 present (`cannot start before…`, lines 85–96) **and** Rule 5 immutability present (line 24 / error text at line 137) | `/root/happy/.claude/hooks/posttool-todo-sequence.py`, `/root/happy-dev/.claude/hooks/posttool-todo-sequence.py`, and `/root/happy-dev.bak/.claude/hooks/posttool-todo-sequence.py` are byte-identical to local main | **Local/deployed is canonical**; fork’s posttool version is not needed |
| Exact `~/.claude/hooks/posttool-todo-sequence.py` | Could not verify exact live path because `/root/.claude` is a broken symlink to `/dev/shm/dev-workspace/dot-claude` in this environment | — | Closest deployed copies above are all local-main-identical | **Practical answer:** deployed copies match local, not fork |
| `.claude/hooks/pretool-bash-safety.sh` | Same blob as local (`d67c7f86`) | Same blob as fork | same project copies present | **Identical on both sides**; `27cf62e6` commit message mentions it, but the commit did not actually change it |
| `INDEX.md` | Older generated inventory, 114 entries, dated 2026-03-27 | Much newer generated inventory, 842 entries, dated 2026-04-07 | N/A | **Keep local** |
| `Dockerfile.webapp` / suspected root cause | `HAPPY_SERVER_URL` present | `HAPPY_SERVER_URL` present | N/A | **No live divergence here**; the “fbaa deleted it” claim is unsupported |
| Fork-only artifacts since merge-base | 24 Playwright console logs, 9 root QA evidence files, 1 `.claude/worktrees/overnight-20260327-3bea7801`, plus `CLAUDE.md`, `INDEX.md`, posttool hook | Local does not need those artifacts | N/A | **Mostly noise / audit artifacts** |
**Rank 1: B — push current local `HEAD` to a new branch on `fork`, leave `fork/main` untouched for now.**
Why:
1. Local already contains the only substantive fork-side ideas, and in a newer/corrected form.
2. Fork-only divergence is mostly artifacts (24 logs + 9 QA files + 1 worktree pointer).
3. A cherry-pick of `27cf62e6` is unnecessary and would partially regress docs/hook behavior.
4. D merge would import old logs/screenshots and create avoidable conflicts.
5. C force-push may be reasonable later, but it destroys the easiest audit handle immediately.
Concrete next-step commands the user can run from a TTY:
```bash
cd /dev/shm/dev-workspace/happy-dev
git fetch origin fork --prune
BRANCH=cycle6-fixes-20260427
git push fork HEAD:refs/heads/$BRANCH
printf '%s\n' \
  "Review vs fork/main: https://github.com/Yugoge/happy/compare/main...$BRANCH?expand=1" \
  "Optional upstream compare: https://github.com/slopus/happy/compare/main...Yugoge:$BRANCH?expand=1"
```
If the user insists on A or D anyway, the likely resolution rules are:
- `CLAUDE.md`: **keep local (`ours`)** for all dev-build, MMKV URL, `api-dev.life-ai.app`, and isolation sections.
- `INDEX.md`: **keep local (`ours`)**; fork copy is an older generated inventory.
- `.claude/hooks/posttool-todo-sequence.py`: even if Git auto-applies fork’s version cleanly, **keep local**, because local/deployed copies already include Rule 4 and also keep Rule 5 immutability.
1. `fork/main` stays stale, so branch sprawl remains for a bit.  
   Mitigation: use the compare URL above as the canonical review surface.
2. The pushed branch will reflect committed history only (`HEAD` at `27733ff6`), **not** the current dirty working tree with 824 uncommitted files.  
   Mitigation: only push if `HEAD` is the intended review point; otherwise snapshot the dirty state separately before any later publish step.
3. The review surface is large (298 local-only commits).  
   Mitigation: review by compare URL first, then decide whether to archive+replace `fork/main`.
4. Someone may later cherry-pick `27cf62e6` out of habit.  
   Mitigation: don’t; it is older than local on the substantive docs and older than deployed behavior on the posttool hook.
If, after reviewing the new branch, the user decides `fork/main` itself should mirror local `HEAD`, use a **protected C**: archive current `fork/main`, then force-push local.
```bash
cd /dev/shm/dev-workspace/happy-dev
ARCHIVE=fork-main-archive-20260427
git push fork fork/main:refs/heads/$ARCHIVE
git push --force-with-lease fork HEAD:main
```
That preserves the 8 fork-only commits under an archive branch before replacing `fork/main`.
---
Bottom line: **local main is the canonical line; fork/main does not contain any substantive fix that local lacks today.**
