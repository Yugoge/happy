# Dev Orchestrator Notes — 20260523-235421

Requirement: Fix Happy recovery/session tracking debt: restored sessions must be daemon-tracked or explicitly adopted; live watcher must not resurrect manually stopped/archived sessions; restore-in-progress must not trigger false loss; emergency OOM protection should kill relevant runaway sessions instead of server-wide hang; exclude coarse whole happy-daemon memory limits.

Specialist assessment:
- ui-specialist: SKIP — no UI or visual behavior change.
- architect: RELEVANT — cross-script/daemon/recovery architecture and OOM behavior.
- product-owner: RELEVANT — manual stop/archive semantics and recovery intent.
- user: RELEVANT — end-to-end reboot/recovery/manual-stop behavior.

Known evidence anchors:
- Recovery-spawned sessions currently mostly have PPID=1, only three are daemon children.
- daemon snapshot is derived from pidToTrackedSession in dist index-WGnVoqay.mjs.
- recovery script currently uses systemd-run/direct spawn path and stable-low-count auto-restore.
- current restore transient units show MemoryHigh/Max/SwapMax infinity; user excludes coarse whole-daemon memory limits.
