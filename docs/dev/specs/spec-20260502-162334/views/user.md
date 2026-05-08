<!-- AUTO-GENERATED VIEW for user | source: docs/dev/specs/spec-20260502-162334.md | extracted: 2026-05-02T19:56:02Z -->

# user view of spec-20260502-162334

**Monolith**: docs/dev/specs/spec-20260502-162334.md
**Extraction**: content-block level (no section-level mapping)

---

## Role Mandate

> S4 is a **PAUSE-PENDING-USER** boundary: the dev subagent finishes S1+S5+S6+S-BUILD and S2+S3, then outputs the S4 REQUEST and STOPS. The /dev orchestrator marks the cycle as `awaiting-user`. S7 cannot start until the user reports back that the S4 SOP completed successfully.

---

# Spec: Codex 4-fix runtime closure — make declared fixes actually visible to user

## User Action — S4 Daemon Restart (PAUSE-PENDING-USER)

  2. Subagent outputs a REQUEST to the user with this exact text:
     ```
     REQUEST → user: please restart the dev daemon to load the rebuilt CLI dist.
       Pre-flight (optional but recommended):
         bash /root/bin/happy-session-recovery.sh save && bash /root/bin/happy-session-recovery.sh check
       Restart command (user-only, from a TTY):
         sudo systemctl restart happy-daemon-dev
       After restart, please reply with the new daemon.state.json startTime so the cycle can proceed to S7.
     ```
     Note: `/root/bin/safe-daemon-restart.sh` is referenced in some older docs but does NOT exist in this environment — do NOT use it. The actual SOP is the systemctl command above.

---

## User Action — S6 Attachment Scope Decision (closure criteria)

- **S6. Decide attachment file-type semantics** — User-owned decision (see Section 5 user-actions). Either (a) implement non-image attachments as a real first-class input item AND prove the model receives content (S7 evidence: model reply quotes the file content), or (b) scope the user-facing requirement to "images only" AND document that explicitly in Section 3 of this spec AND make the user-visible message UI surface the limitation (e.g. greyed-out non-image attach button or warning toast). Decision is "closed" only when: chosen path written into Section 3 + user-visible UI behavior implemented + (for path b) user has explicitly confirmed the down-scoping. Whichever path is chosen, image attachments must remain working (continue to flow through `localImage`).
