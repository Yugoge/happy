# happy-dev

*Last updated: 2026-03-29T11:41:58Z*
**Total entries**: 268
**Convention**: kebab

## Tree
```
happy-dev/
├── docs/
│   ├── competition/
│   │   ├── claude/
│   │   ├── codex/
│   │   ├── opencode/
│   │   ├── `AGENTS.md` - Competition Research
│   │   └── `comparison-matrix.md` - Competitor Protocol Matrix
│   ├── dev/
│   │   ├── `ba-spec-20260323-210000.md` - BA Specification: Sidebar Collapse/Expand UI Redesign
│   │   └── `context-20260323-210000.json` - json config
│   ├── experimental/
│   │   ├── `agents-engineer.md` - Engineer Agent
│   │   ├── `agents-manager.md` - Manager Agent
│   │   ├── `agents.md` - Agents (Experimental)
│   │   ├── `product.md` - Manual Product Validation
│   │   └── `roadmap.md` - Roadmap
│   ├── plans/
│   │   ├── `agent-testing-layers.md` - Agent Testing Layers
│   │   ├── `cli-v3-messages-api.md` - CLI V3 Messages API Migration (happy-cli)
│   │   ├── `codex-app-server-migration.md` - Codex: app-server integration
│   │   ├── `elevenlabs-voice-usage-gating.md` - ElevenLabs Voice Usage Gating
│   │   ├── `experimental-chat-file-links.md` - Experimental Chat File Links
│   │   ├── `expo-sdk-55-upgrade.md` - Expo SDK 55 Upgrade
│   │   ├── `generic-acp-runner.md` - Generic ACP Runner
│   │   ├── `happy-agent.md` - happy-agent CLI Tool
│   │   ├── `metadata-driven-model-mode-selection.md` - Metadata-Driven Model and Mode Selection on Client
│   │   ├── `pnpm-migration [draft].md` - pnpm Migration [Draft]
│   │   ├── `portable-binary.md` - Portable Single-Binary Distribution
│   │   ├── `provider-envelope-redesign.md` - Provider Envelope Redesign
│   │   ├── `reliable-http-messages-api.md` - Reliable HTTP Messages API (v3)
│   │   ├── `remove-profiles-wizard-cli-detection.md` - Plan: Remove Profiles & Wizard, Move CLI Detection to Daemon
│   │   ├── `sandbox-runtime.md` - Add Anthropic Sandbox Runtime to CLI
│   │   ├── `session-protocol-impl.md` - Session Protocol Implementation
│   │   ├── `session-protocol-unification-v2-draft.md` - Session Protocol Unification v2 — Draft
│   │   └── `session-protocol-v2.md` - Session Protocol v2 Design
│   ├── research/
│   │   ├── `agent-teams-claude-code-stuck-non-interactive.png` - png file
│   │   ├── `agent-teams-claude-code.md` - Claude Code Agent Teams — Internal Architecture
│   │   └── `unsupervised-development-guidelines-and-skills.md` - Unsupervised Development Guidance and Skills Ecosystem
│   ├── `api.md` - API
│   ├── `backend-architecture.md` - Backend Architecture
│   ├── `cli-architecture.md` - CLI Architecture
│   ├── `deployment.md` - Deployment
│   ├── `dev-environments.md` - Dev Environments
│   ├── `encryption.md` - Encryption and Data Encoding
│   ├── `happy-wire.md` - happy-wire
│   ├── `permission-resolution.md` - Permission Resolution (State-Based)
│   ├── `protocol.md` - Protocol
│   ├── `release-process.md` - Release Process
│   ├── `session-protocol-claude.md` - Claude Session Protocol (Local + Remote)
│   ├── `session-protocol.md` - Session Protocol
│   └── `voice-architecture.md` - Voice Architecture
├── environments/
│   ├── lab-rat-todo-project/
│   │   ├── `agents.md` - Lab Rat Todo Project — Agent Instructions
│   │   ├── `app.js` - js file
│   │   ├── `CLAUDE.md` - No description
│   │   ├── `exercise-flow.md` - Agent Exercise Flow
│   │   ├── `index.html` - html file
│   │   └── `styles.css` - css file
│   ├── snapshots/
│   └── `environments.ts` - ts file
├── packages/
│   ├── happy-agent/
│   │   ├── bin/
│   │   ├── src/
│   │   ├── `package.json` - json config
│   │   ├── `tsconfig.json` - json config
│   │   ├── `vitest.config.ts` - ts file
│   │   └── `vitest.integration.config.ts` - ts file
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
│   ├── happy-app-logs/
│   │   ├── src/
│   │   ├── `package.json` - json config
│   │   └── `tsconfig.json` - json config
│   ├── happy-cli/
│   │   ├── bin/
│   │   ├── demo-project/
│   │   ├── docs/
│   │   ├── experiments/
│   │   ├── scripts/
│   │   ├── src/
│   │   ├── tools/
│   │   ├── `agents.md` - Happy CLI Agent Tests
│   │   ├── `CLAUDE.md` - Happy CLI Codebase Overview
│   │   ├── `CONTRIBUTING.md` - Contributing to Happy CLI
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
├── screenshots/
│   ├── `01-landing-connected-no-sessions.png` - png file
│   ├── `02-session-history-unknown.png` - png file
│   ├── `03-sessions-list-full.png` - png file
│   ├── `04-session-deleted.png` - png file
│   ├── `05-localhost-connected.png` - png file
│   ├── `06-applio-redirect-blocked.png` - png file
│   ├── `07-settings-page.png` - png file
│   ├── `08-session-history-unknown-titles.png` - png file
│   ├── `09-session-view-no-messages.png` - png file
│   ├── `10-session-deleted-state.png` - png file
│   └── `11-applio-redirect-mobile.png` - png file
├── scripts/
│   ├── `postinstall.cjs` - cjs file
│   └── `release.cjs` - cjs file
├── `01-connected-no-sessions.png` - png file
├── `02-settings-page.png` - png file
├── `03-session-appeared.png` - png file
├── `04-session-messages-loaded.png` - png file
├── `05-session-full-view.png` - png file
├── `06-session-top.png` - png file
├── `07-taskview-visible.png` - png file
├── `08-taskview-expanded.png` - png file
├── `09-table-area.png` - png file
├── `10-taskview-detail-duplicate-title.png` - png file
├── `11-table-scroll-indicator.png` - png file
├── `12-table-view.png` - png file
├── `13-table-scroll-test.png` - png file
├── `14-table-in-view.png` - png file
├── `15-navigation-instability.png` - png file
├── `16-input-bar-attachments.png` - png file
├── `17-mermaid-message-typed.png` - png file
├── `18-mermaid-rendered.png` - png file
├── `bun.lock` - lock file
├── `CLAUDE.md` - CLAUDE.md
├── `desktop-appearance-1440.png` - png file
├── `desktop-code-block-1440.png` - png file
├── `desktop-codeblock-area.png` - png file
├── `desktop-home-1440.png` - png file
├── `desktop-session-1440.png` - png file
├── `desktop-session-top-1440.png` - png file
├── `desktop-settings-1440.png` - png file
├── `desktop-table-area.png` - png file
├── `desktop-table-view-1440.png` - png file
├── `desktop-taskview-desktop.png` - png file
├── `desktop-taskview-detail.png` - png file
├── `dev-connected-no-active.png` - png file
├── `Dockerfile` - unknown file
├── `Dockerfile.server` - server file
├── `Dockerfile.server-slim` - server-slim file
├── `Dockerfile.webapp` - webapp file
├── `expo-env.d.ts` - ts file
├── `LICENCE` - unknown file
├── `logo.png` - png file
├── `mobile-home-375.png` - png file
├── `mobile-mermaid-area.png` - png file
├── `mobile-mermaid-full.png` - png file
├── `mobile-raw-markdown-table.png` - png file
├── `mobile-session-375.png` - png file
├── `mobile-session-bottom.png` - png file
├── `mobile-settings-375.png` - png file
├── `mobile-table-context.png` - png file
├── `mobile-taskview-375.png` - png file
├── `mobile-taskview-900.png` - png file
├── `mobile-taskview-current.png` - png file
├── `mobile-taskview-final.png` - png file
├── `mobile-taskview-found.png` - png file
├── `mobile-taskview-rocket.png` - png file
├── `mobile-taskview-scroll.png` - png file
├── `package-lock.json` - json config
├── `package.json` - json config
├── `pm-desktop-authenticated.png` - png file
├── `pm-landing-authenticated.png` - png file
├── `pm-landing.png` - png file
├── `pm-mobile-view.png` - png file
├── `pm-prod-landing.png` - png file
├── `po-01-initial-load.png` - png file
├── `po-01-landing-connected.png` - png file
├── `po-01-landing-connecting.png` - png file
├── `po-01-landing.png` - png file
├── `po-02-account-settings.png` - png file
├── `po-02-session-view-empty.png` - png file
├── `po-02-sessions-loaded.png` - png file
├── `po-03-appearance.png` - png file
├── `po-03-redirected.png` - png file
├── `po-03-terminals-list.png` - png file
├── `po-04-sessions-list.png` - png file
├── `po-04-sitemap.png` - png file
├── `po-05-dev-no-sessions.png` - png file
├── `po-05-settings-localhost.png` - png file
├── `po-06-appearance-localhost.png` - png file
├── `po-06-empty-snapshot.png` - png file
├── `po-07-settings.png` - png file
├── `po-07-usage.png` - png file
├── `po-08-features.png` - png file
├── `po-08-inbox.png` - png file
├── `po-09-session-deleted.png` - png file
├── `po-09-unmatched-route.png` - png file
├── `po-10-applio-redirect.png` - png file
├── `po-10-session-appeared.png` - png file
├── `po-11-session-view.png` - png file
├── `po-12-session-desktop.png` - png file
├── `po-12-settings-mobile.png` - png file
├── `po-13-artifacts.png` - png file
├── `po-14-new-session.png` - png file
├── `po-15-inbox.png` - png file
├── `po-final-state.png` - png file
├── `qa-bug64-conversation-view.png` - png file
├── `qa-bug64-detail-page-no-duplication.png` - png file
├── `qa-bug64-tool-calls-divider.png` - png file
├── `qa-dev-app-state.png` - png file
├── `qa-latex-inline-closeup.png` - png file
├── `qa-latex-inline-rendering.png` - png file
├── `qa-session-latex-view.png` - png file
├── `qa-session-overview.png` - png file
├── `qa-task-detail-view.png` - png file
├── `step-01-landing-page.png` - png file
├── `step-02-sessions-list.png` - png file
├── `step-03-session-deleted.png` - png file
├── `step1-initial-load.png` - png file
├── `step10-session-view2.png` - png file
├── `step11-session-bottom.png` - png file
├── `step12-taskview-no-divider.png` - png file
├── `step2-session-view.png` - png file
├── `step3-session-top.png` - png file
├── `step4-session-middle.png` - png file
├── `step5-dev-redirect-401.png` - png file
├── `step6-reconnected.png` - png file
├── `step7-taskview-expanded.png` - png file
├── `step8-taskview-full.png` - png file
├── `step9-settings.png` - png file
└── `yarn.lock` - lock file
```

---
*Auto-generated by doc-sync hook.*