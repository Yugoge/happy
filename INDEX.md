# happy

*Last updated: 2026-04-19T15:01:09Z*
**Total entries**: 149
**Convention**: kebab

## Tree
```
happy/
├── docs/
│   ├── dev/
│   │   ├── `ba-spec-20260323-210000.md` - BA Specification: Sidebar Collapse/Expand UI Redesign
│   │   ├── `ba-spec-20260403-investigation.md` - BA Specification: Sidechain Display Bug Root Cause Analysis
│   │   ├── `ba-spec-20260405-120000.md` - BA Specification: Edit Tool Full View Missing Standard Detail Sections
│   │   ├── `ba-spec-20260408-120000.md` - BA Specification: Session Watcher Ignores Intentional Archive
│   │   ├── `ba-spec-20260408-161500.md` - BA Specification: find_peak_snapshot break-after-first-home is a no-op bug
│   │   ├── `ba-spec-20260408-180000.md` - BA Specification: Session Archive Cascade Root Cause Analysis (2026-04-08 Morning Incident)
│   │   ├── `ba-spec-20260408-bug62-v2.md` - BA Specification: Event-Driven Session Recovery Architecture
│   │   ├── `ba-spec-20260408-bug62.md` - BA Specification: Bug #62 Complete Fix -- Session Recovery Redesign
│   │   ├── `ba-spec-20260408-daemon-recovery.md` - BA Specification: Daemon-Owned Session Recovery Architecture
│   │   ├── `ba-spec-20260408-duplicate-session-investigation.md` - BA Specification: Duplicate Session Spawn Investigation
│   │   ├── `ba-spec-20260408-oom-characterization.md` - BA Specification: OOM Kill Behavior Characterization
│   │   ├── `ba-spec-20260408-restore-cascade.md` - BA Specification: Fix Restore Orphan-Kill Cascade
│   │   ├── `ba-spec-20260408-session-kill-investigation.md` - BA Specification: Session Kill Investigation (2026-04-08 09:05 UTC)
│   │   ├── `context-20260323-210000.json` - json config
│   │   ├── `context-20260403-investigation.json` - json config
│   │   ├── `context-20260405-120000.json` - json config
│   │   ├── `context-20260405-qijie.json` - json config
│   │   ├── `context-20260405-restore-fix.json` - json config
│   │   ├── `context-20260408-120000.json` - json config
│   │   ├── `context-20260408-161500.json` - json config
│   │   ├── `context-20260408-180000.json` - json config
│   │   ├── `context-20260408-bug62-v2.json` - json config
│   │   ├── `context-20260408-bug62.json` - json config
│   │   ├── `context-20260408-daemon-recovery.json` - json config
│   │   ├── `context-20260408-duplicate-session-investigation.json` - json config
│   │   ├── `context-20260408-oom-characterization.json` - json config
│   │   ├── `context-20260408-restore-cascade.json` - json config
│   │   ├── `context-20260408-session-kill-investigation.json` - json config
│   │   ├── `dev-report-20260403-investigation.json` - json config
│   │   ├── `dev-report-20260405-120000.json` - json config
│   │   ├── `dev-report-20260408-bash-fix.json` - json config
│   │   ├── `dev-report-20260408-bug62-v2.json` - json config
│   │   ├── `dev-report-20260408-combined.json` - json config
│   │   ├── `dev-report-20260408-watcher-fastdetect.json` - json config
│   │   ├── `dev-report-daemon-systemd.json` - json config
│   │   ├── `qa-pre-review-daemon-recovery.json` - json config
│   │   ├── `qa-report-20260405-120000.json` - json config
│   │   ├── `qa-report-20260408-bash-fix.json` - json config
│   │   ├── `qa-report-20260408-bug62-v2.json` - json config
│   │   ├── `qa-report-20260408-final.json` - json config
│   │   ├── `qa-report-20260408-round2.json` - json config
│   │   └── `qa-report-20260408-watcher-fastdetect.json` - json config
│   ├── plans/
│   │   ├── `cli-v3-messages-api.md` - CLI V3 Messages API Migration (happy-cli)
│   │   ├── `generic-acp-runner.md` - Generic ACP Runner
│   │   ├── `happy-agent.md` - happy-agent CLI Tool
│   │   ├── `metadata-driven-model-mode-selection.md` - Metadata-Driven Model and Mode Selection on Client
│   │   ├── `portable-binary.md` - Portable Single-Binary Distribution
│   │   ├── `reliable-http-messages-api.md` - Reliable HTTP Messages API (v3)
│   │   ├── `sandbox-runtime.md` - Add Anthropic Sandbox Runtime to CLI
│   │   └── `session-protocol-impl.md` - Session Protocol Implementation
│   ├── `api.md` - API
│   ├── `backend-architecture.md` - Backend Architecture
│   ├── `cli-architecture.md` - CLI Architecture
│   ├── `deployment.md` - Deployment
│   ├── `encryption.md` - Encryption and Data Encoding
│   ├── `happy-wire.md` - happy-wire
│   ├── `permission-resolution.md` - Permission Resolution (State-Based)
│   ├── `protocol.md` - Protocol
│   ├── `session-protocol-claude.md` - Claude Session Protocol (Local + Remote)
│   └── `session-protocol.md` - Session Protocol
├── packages/
│   ├── happy-agent/
│   │   ├── bin/
│   │   ├── src/
│   │   ├── `package.json` - json config
│   │   ├── `tsconfig.json` - json config
│   │   └── `vitest.config.ts` - ts file
│   ├── happy-app/
│   │   ├── deploy/
│   │   ├── docs/
│   │   ├── packages/
│   │   ├── patches/
│   │   ├── plugins/
│   │   ├── public/
│   │   ├── sources/
│   │   ├── src-tauri/
│   │   ├── `app.config.js` - js file
│   │   ├── `babel.config.js` - js file
│   │   ├── `CHANGELOG.md` - Changelog
│   │   ├── `CLAUDE.md` - CLAUDE.md
│   │   ├── `CONTRIBUTING.md` - Contributing to Happy
│   │   ├── `eas.json` - json config
│   │   ├── `expo-env.d.ts` - ts file
│   │   ├── `google-services.json` - json config
│   │   ├── `index.ts` - ts file
│   │   ├── `LICENSE` - unknown file
│   │   ├── `logo.png` - png file
│   │   ├── `metro.config.js` - js file
│   │   ├── `nativewind-env.d.ts` - ts file
│   │   ├── `package.json` - json config
│   │   ├── `PRIVACY.md` - Privacy Policy for Happy Coder
│   │   ├── `release-dev.sh` - Shell script
│   │   ├── `release-production.sh` - Shell script
│   │   ├── `release.cjs` - cjs file
│   │   ├── `Stores.md` - App Store & Google Play Store Information
│   │   ├── `TERMS.md` - Terms of Use
│   │   ├── `tsconfig.json` - json config
│   │   ├── `tsconfig.tsbuildinfo` - tsbuildinfo file
│   │   └── `vitest.config.ts` - ts file
│   ├── happy-cli/
│   │   ├── bin/
│   │   ├── demo-project/
│   │   ├── docs/
│   │   ├── scripts/
│   │   ├── src/
│   │   ├── tools/
│   │   ├── `CLAUDE.md` - Happy CLI Codebase Overview
│   │   ├── `CONTRIBUTING.md` - Contributing to Happy CLI
│   │   ├── `nohup.out` - out file
│   │   ├── `package.json` - json config
│   │   ├── `roadmap.md` - APi eeror?
│   │   ├── `tsconfig.json` - json config
│   │   └── `vitest.config.ts` - ts file
│   ├── happy-server/
│   │   ├── deploy/
│   │   ├── prisma/
│   │   ├── sources/
│   │   ├── `CLAUDE.md` - Handy Server - Development Guidelines
│   │   ├── `package.json` - json config
│   │   ├── `tsconfig.json` - json config
│   │   └── `vitest.config.ts` - ts file
│   └── happy-wire/
│       ├── src/
│       ├── `package.json` - json config
│       ├── `tsconfig.json` - json config
│       └── `vitest.config.ts` - ts file
├── patches/
│   └── `fix-pglite-prisma-bytes.cjs` - cjs file
├── scripts/
│   ├── `investigate-detail.mjs` - mjs file
│   ├── `investigate-sidechain.mjs` - mjs file
│   ├── `postinstall.cjs` - cjs file
│   └── `release.cjs` - cjs file
├── `bun.lock` - lock file
├── `CLAUDE.md` - CLAUDE.md
├── `Dockerfile` - unknown file
├── `Dockerfile.server` - server file
├── `Dockerfile.server-slim` - server-slim file
├── `Dockerfile.webapp` - webapp file
├── `expo-env.d.ts` - ts file
├── `happy-web-debug-1.png` - png file
├── `LICENCE` - unknown file
├── `logo.png` - png file
├── `package-lock.json` - json config
├── `package.json` - json config
└── `yarn.lock` - lock file
```

---
*Auto-generated by doc-sync hook.*