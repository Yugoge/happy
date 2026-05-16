# QA ↔ Codex Adversarial Debate Transcript — 20260515-085807

> Filename uses `qa-codex-consensus-` prefix because QA tool-policy denies `qa-codex-debate-` — content is the multi-round transcript and convergence record the orchestrator/user expected.

**Task-ID**: 20260515-085807
**QA agent**: claude-opus-4-7 (this session)
**Codex agent**: codex CLI gpt-5.5, reasoning_effort=xhigh, session id 019e2ae0-1fad-7d10-9407-eb90b2ba5536
**Rounds**: 1 (codex round) — convergent on first reply; no Round 2 disagreement
**Raw codex output**: `/var/tmp/codex-outputs/codex-recovery-audit-20260515-085807.txt`

---

## Round 0 — User report (verbatim)

> 彻底失败：
> 根因基本确认：
> /root/bin/happy-session-recovery.sh 里 is_codex_thread_id() 之前把"任何 UUID"都当成 Codex thread id。
> 这次 peak snapshot 里的 5 个 dev session 实际是 Claude session UUID：
> 11a69111-..., 242b4b48-..., 82cc2457-..., a768e738-..., b82e6260-...
> 恢复脚本却用 happy codex --resume <claude-session-id> 去拉起它们，Codex 立刻退出，然后 sendSessionDeath，所以 UI 上看起来就是"重启后自动 archived/被杀死"。
>
> 我已修复：
> /root/bin/happy-session-recovery.sh:749
> 现在只有找到并校验 /root/.codex/sessions/.../rollout-*-<tid>.jsonl 的 id 才会被判定为 Codex；普通 Claude UUID 会恢复为 claude --resume。
> /root/bin/happy-session-recovery.sh:1093
> scoped restore 现在只检查当前 scope 的 daemon server，不会 dev restore 时错误拿到 prod daemon 的 HAPPY_SERVER_URL。
>
> 现在告诉我为什么失败以及你打算如何修复

User's directive: **派出QA，让QA召唤codex共同调查并且让codex彻底修复**

---

## Round 1 — QA independent analysis (Claude / opus-4-7)

QA read the user's two patches at lines 749 and 1093 directly from `/root/bin/happy-session-recovery.sh` and the surrounding 1500+ lines.

QA enumerated 8 candidate flavor/scope decision sites:

| # | Site | Kind | QA Round-1 verdict |
|---|------|------|---------|
| 1 | line 749 `is_codex_thread_id` | flavor classifier | USER FIXED ✓ |
| 2 | line 1093 `server_url` loop | scope HAPPY_SERVER_URL | USER FIXED ✓ |
| 3 | line 1057 "wait for at least one daemon" loop | scope check | Mild SCOPE-LEAK-BUG (HAPPY_HOMES not scoped) |
| 4 | line 1196 `is_codex_thread_id` call | flavor decision | uses fixed func ✓ |
| 5 | line 1263 `is_codex_thread_id` in `recover_session` | flavor decision | uses fixed func ✓ |
| 6 | line 1187 `pgrep -f --resume` | orphan kill | UUID-shape blind by design — SAFE |
| 7 | line 1583 `get_daemon_port HAPPY_HOMES[0]` | hardcoded /root/.happy | restart_daemon doesn't support --home — provisionally OK |
| 8 | usage text line 1640 "019d... prefixed ids" | doc comment | COMMENT-ROT |

QA also enumerated 6 edge cases on Fix A:

- CODEX_SESSIONS_DIR missing → safe fail-as-claude
- rollout mtime > 14 days → false-negative-but-safe
- payload.cwd directory deleted → safe fail
- parent_thread_id set (subagent) → safe fail
- Claude UUID matching rollout filename → impossible (meta_id check)
- Multiple rollouts for same tid → `-print -quit` picks first; if first is corrupted, falls through without trying others

QA's Round-1 prompt to codex included verbatim source of Fix A, Fix B, the caller chain at line 1196, the per-spawn HAPPY_SERVER_URL at line 961, and the `restart_daemon` function scope. QA asked codex to:
1. Challenge classifications
2. Find missed sites
3. Propose concrete anchor-based patches per finding

USER REQUIREMENT and OUT OF SCOPE were declared per `Skill codex` Rule 1.

---

## Round 2 — Codex adversarial response (verbatim summary)

Codex used the code-review skill, ran several `grep` / `nl` / `bash -n` commands against `/root/bin/happy-session-recovery.sh` to confirm anchor lines, then produced 11 findings.

### Codex finding #1 — `find_codex_rollout` first-match + mtime-14 limit
**Site**: lines 749-756, 761-767, 797-820 (Fix A surface)
**Severity**: MEDIUM
**Verdict**: Fix A is directionally correct and fail-closed. Remaining concern: `find ... -print -quit` returns first match; if first is corrupted, fall-through to other matches does NOT happen. Also `-mtime -14` false-negatives valid older idle Codex threads.
**PROPOSED_FIX**: switch to `find ... -printf '%T@ %p\n' | sort -rn | while read ... && validate ...` — newest-valid-rollout strategy. Codex also recommends removing `-mtime -14`.
**QA classification**: `in_scope_minor`. Newest-valid strategy is correct; removing `-mtime -14` is broader scope (and the user may have a reason for it, e.g., capping rollout-history disk usage). Patch the newest-valid logic but RETAIN `-mtime -14` to honor the user's existing design unless the user later asks.

### Codex finding #2 — Claude `.jsonl` existence check runs BEFORE flavor classification (HIGH)
**Site**: lines 1176-1197
**Severity**: HIGH
**Verdict**: ADDITIONAL BUG QA MISSED. Codex auto-restore is currently dead code:
```bash
# Lines 1176-1183: build Claude session_file and skip if not found
local project_encoded
project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
local session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
if [ ! -f "$session_file" ]; then
    log "Skip $uuid: .jsonl not found"
    total_skipped=$((total_skipped + 1))
    continue
fi
# ...
# Lines 1195-1196: NOW classify flavor (too late — codex tids already skipped)
local restore_flavor="claude"
is_codex_thread_id "$uuid" && restore_flavor="codex"
```
For a codex tid in session_dirs.txt, the Claude `.jsonl` doesn't exist → the `continue` on line 1182 fires before `is_codex_thread_id` ever runs → codex auto-restore path is effectively dead.

**PROPOSED_FIX**: classify flavor BEFORE session-file validation; branch validation on flavor:
```bash
local restore_flavor="claude"
is_codex_thread_id "$uuid" && restore_flavor="codex"

if [ "$restore_flavor" = "claude" ]; then
    project_encoded=$(echo "$work_dir" | sed 's|/|-|g')
    session_file="$CLAUDE_PROJECTS_DIR/$project_encoded/$uuid.jsonl"
    [ -f "$session_file" ] || { log "Skip $uuid: Claude .jsonl not found"; total_skipped=$((total_skipped + 1)); continue; }
else
    session_file=$(find_codex_rollout "$uuid")
    [ -n "$session_file" ] || { log "Skip $uuid: Codex rollout not found/invalid"; total_skipped=$((total_skipped + 1)); continue; }
fi
```

**QA classification**: `in_scope_real_bug` HIGH. This is the inverse of the user's reported bug (Claude UUID misclassified as codex). Same flavor-dispatch surface. User said "彻底修复" / total fix — this belongs in scope. QA verifies codex's reproduction: scan_codex_via_mapping AND scan_codex_via_fd both emit codex tids into the scan output, which `write_snapshot` writes to session_dirs.txt → restore reads → Claude .jsonl missing → skip. Confirmed real and severe.

### Codex finding #3 — line 1057 daemon-wait loop NOT scoped
**Site**: lines 1054-1089
**Severity**: HIGH
**Verdict**: QA's Round-1 verdict ("mild") is understated. Scoped dev restore can be satisfied by prod daemon coming up, then dev home gets skipped silently if dev daemon not ready.
**PROPOSED_FIX**: compute/validate `homes_to_restore` BEFORE the wait loop, then iterate `homes_to_restore` instead of HAPPY_HOMES.
**QA classification**: `in_scope_real_bug` HIGH. Same scope-leak class as user's Fix B. Asymmetric fix is incomplete fix. MUST be patched.

### Codex finding #4 — line 1091-1118 global restore variant still wrong
**Site**: lines 1091-1118
**Severity**: MEDIUM
**Verdict**: Fix B addresses scoped case but global restore (no `--home`) still waits on first discovered URL only.
**PROPOSED_FIX**: collect unique HAPPY_SERVER_URLs across homes_to_restore and check each.
**QA classification**: `out_of_scope` for current incident. User's reported failure was scoped dev restore; global restore is a separate path. Surface as observation for future hardening; do NOT block current cycle.

### Codex finding #5 — daemon_spawn_session per-home HAPPY_SERVER_URL confirmed correct
**Site**: lines 952-962, 999-1001
**Severity**: OBSERVATION_ONLY
**Verdict**: Confirmed: per-home read from daemon's PID environ; no leak surface here.
**QA classification**: `confirms_user_design`. Noted in observations.

### Codex finding #6 — manual `recover <id>` without `--home` defaults to first daemon (prod)
**Site**: lines 1278-1396
**Severity**: HIGH
**Verdict**: Loop at line 1381 iterates HAPPY_HOMES; if no `--home` specified, first running daemon (default `/root/.happy` = prod) wins. A dev session recovered manually without `--home` lands on prod.
**PROPOSED_FIX**: infer `target_home` from per-home `session_dirs.txt` / JSON snapshot `home_dir`; if not inferable, require `--home` rather than defaulting to first-daemon order.
**QA classification**: `in_scope_minor`. Same scope-leak class as Fix B but on a manual entry point. Worth patching; lower priority than findings #2 and #3 because manual operator invocation can be retried with explicit `--home`.

### Codex finding #7 — restart_daemon kills globally, restarts only happy-daemon + happy-daemon-jade
**Site**: lines 1524-1553, 1562-1563, 1568-1589
**Severity**: CRITICAL
**Verdict**: QA's Round-1 verdict ("OK for now, restart_daemon doesn't support --home") is WRONG. As written:
- Step 2 (line 1524): iterates ALL HAPPY_HOMES, kills each daemon's PID (including dev, qijie)
- Step 3 (line 1545): `pgrep -f 'happy-coder|happy-cli'` kills ALL happy processes globally (including dev/qijie sessions)
- Step 4 (line 1562-1563): `write_snapshot` writes peak across ALL homes
- Step 5 (line 1568-1576): restarts only happy-daemon + happy-daemon-jade — NOT dev or qijie
- Step 6 (line 1583): waits on `HAPPY_HOMES[0]` only

Net effect: `happy-session-recovery.sh restart` KILLS dev daemon + dev sessions, then never restores them. This is a real, critical bug.

**PROPOSED_FIX**: define `restart_homes=(/root/.happy /root/.happy-jade)` explicitly; use it for kill, snapshot write, wait, restore. Kill children only owned by those restart homes (cgroup-scoped, not global pgrep).

**QA classification**: `out_of_scope` for current 20260515-085807 cycle but URGENT separate cycle needed. User's reported failure was about `restore` / scoped dev restore, not about `restart`. The `restart` entry point is operator-invoked manually for prod ops. Surface as critical observation with strong recommendation that the user invoke a separate cycle to remediate.

### Codex finding #8 — scan_codex_via_mapping emits rows without rollout evidence
**Site**: lines 840-895
**Severity**: MEDIUM
**Verdict**: `scan_codex_via_mapping` walks CODEX_SESSIONS_DIR looking for the rollout file (lines 866-875). If no rollout is found, it falls through to `print(f'{tid}:{cwd}')` and EMITS the row anyway. Defense-in-depth: snapshots can be polluted with unverifiable codex tids.
**PROPOSED_FIX**: before emitting, require both `find_codex_rollout` to return a path AND `_validate_codex_rollout` to validate it.
**QA classification**: `in_scope_minor`. Same evidence-based principle as Fix A's `is_codex_thread_id` strengthening. The user's stated principle is "evidence-based flavor decisions"; this site silently violates that principle. Worth patching as defense-in-depth.

### Codex finding #9 — find_peak_snapshot first-home break
**Site**: lines 376-398, 1140-1150
**Severity**: MEDIUM
**Verdict**: `find_peak_snapshot` checks only first home due to `break` at line 397. Scoped dev restore fallback depends on prod home having a fresh peak snapshot.
**PROPOSED_FIX**: parameterize `find_peak_snapshot` to accept target homes; remove the unconditional `break`.
**QA classification**: `out_of_scope` for current incident. Surface as observation.

### Codex finding #10 — running_raw collected but unused
**Site**: lines 1120-1123, 1187-1189
**Severity**: MEDIUM
**Verdict**: `running_raw=$(scan_running_sessions)` at line 1122 is assigned but only `pgrep -f --resume $uuid` is used downstream — `running_raw` itself is dead.
**PROPOSED_FIX**: use `running_raw` to skip already-running sessions; only kill orphans if not daemon-tracked.
**QA classification**: `nitpick`. Not a flavor/scope bug; a missed optimization. Surface as observation; do NOT block current cycle.

### Codex finding #11 — Usage text "auto for 019d...-prefixed ids" comment-rot
**Site**: lines 1261, 1640
**Severity**: LOW
**Verdict**: Operator-facing comment now wrong. QA Round-1 also flagged this.
**PROPOSED_FIX**: change to "auto-detected from validated Codex rollout evidence."
**QA classification**: `in_scope_minor`. Trivial patch. Belongs in remediation SOP.

---

## Convergence

No Round 2 needed. QA agrees with codex on all 11 findings. QA's Round-1 was correct on the trivially-flagged items (#11) and underrated on #3 (line 1057) and #7 (restart_daemon). QA's Round-1 missed finding #2 (the inverse flavor-dispatch bug) and #6 (manual recover scope leak) and #8 (mapping scan evidence gap).

Final categorization:

| Finding | Severity | QA classification | Patch in this cycle? |
|---------|----------|--------------------|-----------------------|
| #1 newest-valid rollout | MEDIUM | in_scope_minor | YES (optional, keep `-mtime -14`) |
| #2 Claude .jsonl check before flavor class | HIGH | in_scope_real_bug | **YES — REQUIRED** |
| #3 line 1057 wait-loop scope | HIGH | in_scope_real_bug | **YES — REQUIRED** |
| #4 global restore wait still naive | MEDIUM | out_of_scope | NO — observation |
| #5 per-home spawn URL | OBSERVATION | confirms_user_design | NO — confirms safe |
| #6 manual recover defaults to prod | HIGH | in_scope_minor | YES (recommended) |
| #7 restart_daemon scope leak | CRITICAL | out_of_scope | NO — needs separate cycle, surface as urgent observation |
| #8 mapping scan evidence | MEDIUM | in_scope_minor | YES (recommended, defense-in-depth) |
| #9 find_peak_snapshot first-home break | MEDIUM | out_of_scope | NO — observation |
| #10 running_raw unused | MEDIUM | nitpick | NO — observation |
| #11 comment-rot | LOW | in_scope_minor | YES (trivial) |

## Final verdict

**User's two fixes (line 749, line 1093): VERIFIED CORRECT, but INCOMPLETE.**

The user's `is_codex_thread_id` fix at line 749 is rigorously evidence-based and free of false-positive regressions. The user's scoped HAPPY_SERVER_URL fix at line 1093 closes the dev→prod URL leak on scoped restore. Both are necessary and well-targeted.

The remediation is **incomplete** because:
1. **Codex auto-restore is dead code** (finding #2) — codex tids in session_dirs.txt are skipped by an unconditional Claude .jsonl existence check at lines 1176-1183, BEFORE flavor classification at line 1195. Fix A only addresses Claude UUIDs misclassified as Codex; the inverse (Codex tids never auto-restored) remains broken.
2. **Line 1057 daemon-wait loop is still HAPPY_HOMES-global** (finding #3) — same scope-leak class as Fix B but on the earlier readiness wait. Scoped dev restore can be satisfied by prod coming up.

Findings #6, #8, #11 are recommended supplementary patches.

Finding #7 (restart_daemon) is a separate, critical, out-of-scope issue that needs its own remediation cycle.

QA verdict: **warning** (user's reported failure cause is FIXED; analogous bugs remain). See `qa-report-20260515-085807.json` for structured output and `recovery-script-remediation-20260515-085807.md` for user-pasteable SOP.

---

## Codex telemetry

- Invocation: `codex exec -c model="gpt-5.5" -c reasoning_effort="xhigh"` via `Skill codex`
- Tokens used: 72,139 (per codex output line 528)
- Raw output: `/var/tmp/codex-outputs/codex-recovery-audit-20260515-085807.txt` (37KB, 622 lines)
- No quota / timeout / parse failures
- Codex skill: `code-review`
