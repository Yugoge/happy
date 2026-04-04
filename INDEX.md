# happy-dev

*Last updated: 2026-04-04T07:30:10Z*
**Total entries**: 559
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
│   │   ├── overnight/
│   │   ├── `ba-spec-20260323-210000.md` - BA Specification: Sidebar Collapse/Expand UI Redesign
│   │   ├── `context-20260323-210000.json` - json config
│   │   ├── `dev-report-tools2-filter-fix.json` - json config
│   │   └── `qa-site-isolation-verification.json` - json config
│   ├── e2e/
│   │   ├── `console-initial.log` - log file
│   │   ├── `p12-console-after-toolclick.log` - log file
│   │   ├── `p12-console-messages.log` - log file
│   │   ├── `p5-session-overview.png` - png file
│   │   ├── `p5-tool-call-expanded.png` - png file
│   │   ├── `p5-tool-single-header.png` - png file
│   │   ├── `p7-tables-with-scroll.png` - png file
│   │   ├── `session-full-content.png` - png file
│   │   ├── `session-view.png` - png file
│   │   ├── `wrap-envelopes-clicked.png` - png file
│   │   ├── `wrap-envelopes-multiple.png` - png file
│   │   ├── `wrap-envelopes-scrolled.png` - png file
│   │   ├── `wrap-envelopes-visible.png` - png file
│   │   └── `wrap-envelopes.png` - png file
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
│   ├── `pretool-block-production.sh` - Hook: PreToolUse (mcp__playwright__browser_navigate, mcp__playwright__browser_run_code, WebFetch)
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
├── `arch-session-latex-test.png` - png file
├── `bug-hunt-01-initial-load.png` - png file
├── `bug-hunt-02-session-view.png` - png file
├── `bug-hunt-03-input-focused.png` - png file
├── `bug-hunt-04-session2-top.png` - png file
├── `bug-hunt-05-session2-scrolled-top.png` - png file
├── `bug-hunt-06-tool-call-expanded.png` - png file
├── `bug-hunt-07-tables.png` - png file
├── `bug-hunt-08-qa-report-tables.png` - png file
├── `bug-hunt-09-scrolled-bottom.png` - png file
├── `bug-hunt-10-tables-area.png` - png file
├── `bug-hunt-11-systemd-table.png` - png file
├── `bug-hunt-12-table-view.png` - png file
├── `bug-hunt-13-resources-table.png` - png file
├── `bug-hunt-14-main-no-session.png` - png file
├── `bug-hunt-15-settings.png` - png file
├── `bug-hunt-16-inbox.png` - png file
├── `bug-hunt-17-new-session.png` - png file
├── `bug-hunt-18-mobile-view.png` - png file
├── `bug-hunt-19-mobile-session.png` - png file
├── `bug-hunt-20-mobile-toolbar.png` - png file
├── `bug-hunt-21-desktop-session2.png` - png file
├── `bug-hunt-22-investigate-label.png` - png file
├── `bug-hunt-23-404-route.png` - png file
├── `bug-hunt-24-fake-session.png` - png file
├── `bug-hunt-25-session-header.png` - png file
├── `bug-hunt-26-appearance.png` - png file
├── `bug-hunt-27-changelog.png` - png file
├── `bun.lock` - lock file
├── `CLAUDE.md` - CLAUDE.md
├── `cycle2-landing.png` - png file
├── `cycle2-session-open.png` - png file
├── `cycle2-session2.png` - png file
├── `cycle2-sidebar-collapse.png` - png file
├── `cycle2-sidebar-restored.png` - png file
├── `cycle3-initial-load.png` - png file
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
├── `pipeline6-sessions-before.png` - png file
├── `pm-01-landing.png` - png file
├── `pm-02-session-view.png` - png file
├── `pm-03-tool-detail.png` - png file
├── `pm-04-session2.png` - png file
├── `pm-05-inbox.png` - png file
├── `pm-06-settings.png` - png file
├── `pm-07-mobile-list.png` - png file
├── `pm-08-mobile-session.png` - png file
├── `pm-09-mobile-toolbar.png` - png file
├── `pm-10-desktop-tables.png` - png file
├── `pm-11-input-toolbar.png` - png file
├── `pm-after-send-2.png` - png file
├── `pm-after-send.png` - png file
├── `pm-desktop-authenticated.png` - png file
├── `pm-desktop-session.png` - png file
├── `pm-desktop-terminals.png` - png file
├── `pm-files-page.png` - png file
├── `pm-landing-authenticated.png` - png file
├── `pm-landing-connecting.png` - png file
├── `pm-landing-empty.png` - png file
├── `pm-landing.png` - png file
├── `pm-mobile-view.png` - png file
├── `pm-new-session-page.png` - png file
├── `pm-prod-landing.png` - png file
├── `pm-session-response.png` - png file
├── `pm-session-view.png` - png file
├── `pm-session2.png` - png file
├── `pm-settings-mobile.png` - png file
├── `pm-settings.png` - png file
├── `pm-tool-views.png` - png file
├── `po-01-initial-load.png` - png file
├── `po-01-landing-connected.png` - png file
├── `po-01-landing-connecting.png` - png file
├── `po-01-landing-session.png` - png file
├── `po-01-landing.png` - png file
├── `po-02-account-settings.png` - png file
├── `po-02-session-view-empty.png` - png file
├── `po-02-session-with-tools.png` - png file
├── `po-02-sessions-loaded.png` - png file
├── `po-03-appearance.png` - png file
├── `po-03-redirected.png` - png file
├── `po-03-session1-toolcalls.png` - png file
├── `po-03-terminals-list.png` - png file
├── `po-04-sessions-list.png` - png file
├── `po-04-sitemap.png` - png file
├── `po-04-tool-detail.png` - png file
├── `po-05-dev-no-sessions.png` - png file
├── `po-05-session2-toolbar.png` - png file
├── `po-05-settings-localhost.png` - png file
├── `po-06-appearance-localhost.png` - png file
├── `po-06-empty-snapshot.png` - png file
├── `po-06-session2-scrolled-top.png` - png file
├── `po-07-settings.png` - png file
├── `po-07-usage.png` - png file
├── `po-08-features.png` - png file
├── `po-08-inbox.png` - png file
├── `po-08-mobile-session.png` - png file
├── `po-09-inbox.png` - png file
├── `po-09-session-deleted.png` - png file
├── `po-09-unmatched-route.png` - png file
├── `po-10-applio-redirect.png` - png file
├── `po-10-desktop-sessions-list.png` - png file
├── `po-10-session-appeared.png` - png file
├── `po-11-session-view.png` - png file
├── `po-12-session-desktop.png` - png file
├── `po-12-settings-mobile.png` - png file
├── `po-13-artifacts.png` - png file
├── `po-14-new-session.png` - png file
├── `po-15-inbox.png` - png file
├── `po-404-changelog.png` - png file
├── `po-appearance.png` - png file
├── `po-bug62-title-header.png` - png file
├── `po-changelog.png` - png file
├── `po-cycle2-chip-click-result.png` - png file
├── `po-cycle2-chip-navigation-bug.png` - png file
├── `po-cycle2-chip-sent-message.png` - png file
├── `po-cycle2-landing-desktop.png` - png file
├── `po-cycle2-landing.png` - png file
├── `po-cycle2-new-session.png` - png file
├── `po-cycle2-old-tool-detail.png` - png file
├── `po-cycle2-session1.png` - png file
├── `po-cycle2-session2-bottom.png` - png file
├── `po-cycle2-session2-bug62.png` - png file
├── `po-cycle2-session2-response.png` - png file
├── `po-cycle2-settings.png` - png file
├── `po-cycle2-tool-detail-view.png` - png file
├── `po-cycle2-tools2-full.png` - png file
├── `po-cycle2-tools2-other-empty.png` - png file
├── `po-cycle2-tools2-top.png` - png file
├── `po-cycle2-unmatched-route.png` - png file
├── `po-desktop-terminals.png` - png file
├── `po-features.png` - png file
├── `po-final-state.png` - png file
├── `po-inbox.png` - png file
├── `po-new-session-desktop.png` - png file
├── `po-new-session-page.png` - png file
├── `po-new-session.png` - png file
├── `po-session-desktop-full.png` - png file
├── `po-session-desktop-view.png` - png file
├── `po-session-desktop.png` - png file
├── `po-session-fullpage.png` - png file
├── `po-session-info.png` - png file
├── `po-session-messages.png` - png file
├── `po-session-reload.png` - png file
├── `po-session-view.png` - png file
├── `po-settings-full.png` - png file
├── `po-settings-redirect.png` - png file
├── `po-step0-landing.png` - png file
├── `po-usage.png` - png file
├── `qa-after-reload.png` - png file
├── `qa-before-enter.png` - png file
├── `qa-bug64-conversation-view.png` - png file
├── `qa-bug64-detail-page-no-duplication.png` - png file
├── `qa-bug64-tool-calls-divider.png` - png file
├── `qa-code-block-area.png` - png file
├── `qa-cycle2-p0-sidebar.png` - png file
├── `qa-cycle2-p3-tools2.png` - png file
├── `qa-cycle2-p6-other-tools-filtered.png` - png file
├── `qa-cycle2-p6-other-tools.png` - png file
├── `qa-dev-app-state.png` - png file
├── `qa-latex-inline-closeup.png` - png file
├── `qa-latex-inline-rendering.png` - png file
├── `qa-p10-1280.png` - png file
├── `qa-p10-root-session.png` - png file
├── `qa-p10-send-button-empty.png` - png file
├── `qa-p10-session-view.png` - png file
├── `qa-p12-after-collapse.png` - png file
├── `qa-p12-after-expand.png` - png file
├── `qa-p12-before-collapse.png` - png file
├── `qa-p2-machine-card.png` - png file
├── `qa-p5-toolcalls.png` - png file
├── `qa-p5-toolview-divider.png` - png file
├── `qa-p5-toolview-scroll1.png` - png file
├── `qa-p9-files-loaded.png` - png file
├── `qa-pipeline-baseline.png` - png file
├── `qa-pipeline1-toolbar.png` - png file
├── `qa-pipeline3-collapsed.png` - png file
├── `qa-pipeline3-enter-sent.png` - png file
├── `qa-pipeline3-new-session.png` - png file
├── `qa-root-session.png` - png file
├── `qa-session-latex-view.png` - png file
├── `qa-session-overview.png` - png file
├── `qa-sidebar-snapshot.md` - No description
├── `qa-task-detail-view.png` - png file
├── `screenshot-01-initial-state.png` - png file
├── `screenshot-02-loading.png` - png file
├── `screenshot-03-new-session-form.png` - png file
├── `screenshot-04-localhost8097.png` - png file
├── `screenshot-05-new-form-direct.png` - png file
├── `screenshot-06-before-redirect.png` - png file
├── `screenshot-07-stable-happy-app.png` - png file
├── `screenshot-08-new-session-form.png` - png file
├── `screenshot-09-production-sessions.png` - png file
├── `screenshot-10-session-open.png` - png file
├── `screenshot-11-message-typed.png` - png file
├── `screenshot-12-message-sent.png` - png file
├── `screenshot-13-task-detail-view.png` - png file
├── `screenshot-14-mobile-session.png` - png file
├── `screenshot-15-mobile-home-tabs.png` - png file
├── `screenshot-16-new-session-form-mobile.png` - png file
├── `screenshot-17-empty-send-test.png` - png file
├── `step-01-landing-page.png` - png file
├── `step-02-sessions-list.png` - png file
├── `step-03-session-deleted.png` - png file
├── `step0-connected-sidebar.png` - png file
├── `step1-home-authenticated.png` - png file
├── `step1-initial-load.png` - png file
├── `step1-session-view.png` - png file
├── `step10-session-view2.png` - png file
├── `step10-settings-features.png` - png file
├── `step10-tools2-demo.png` - png file
├── `step11-home-final.png` - png file
├── `step11-session-bottom.png` - png file
├── `step11-tools2-scrolled.png` - png file
├── `step12-taskview-no-divider.png` - png file
├── `step12-tools2-more.png` - png file
├── `step13-other-tools.png` - png file
├── `step2-new-session-form.png` - png file
├── `step2-session-view.png` - png file
├── `step2-settings-page.png` - png file
├── `step3-files-not-git.png` - png file
├── `step3-session-top.png` - png file
├── `step3-settings.png` - png file
├── `step4-inbox.png` - png file
├── `step4-session-middle.png` - png file
├── `step4-session1-desktop.png` - png file
├── `step5-dev-redirect-401.png` - png file
├── `step5-messages-demo.png` - png file
├── `step5-settings-appearance.png` - png file
├── `step6-messages-demo-bottom.png` - png file
├── `step6-new-session.png` - png file
├── `step6-reconnected.png` - png file
├── `step7-demo-tool-calls.png` - png file
├── `step7-mobile-home.png` - png file
├── `step7-taskview-expanded.png` - png file
├── `step8-settings-full.png` - png file
├── `step8-taskview-full.png` - png file
├── `step8-tools-demo-top.png` - png file
├── `step9-settings-account.png` - png file
├── `step9-settings.png` - png file
├── `step9-tools-demo-examples.png` - png file
├── `tools2-initial.png` - png file
├── `tools2-permission-states.png` - png file
├── `tools2-status-icons.png` - png file
├── `user-01-initial-state.png` - png file
├── `user-01-landing-mobile.png` - png file
├── `user-02-session-view-mobile.png` - png file
├── `user-02-session-view.png` - png file
├── `user-03-message-typed.png` - png file
├── `user-03-session-top.png` - png file
├── `user-04-message-sent-clauding.png` - png file
├── `user-04-session-scrolled-top.png` - png file
├── `user-05-session-mobile-after-send.png` - png file
├── `user-05-session-with-toolcalls.png` - png file
├── `user-06-terminals-mobile-back.png` - png file
├── `user-06-tool-detail-view.png` - png file
├── `user-07-new-session-redirect.png` - png file
├── `user-07-session-back-toolcalls.png` - png file
├── `user-08-input-toolbar-closeup.png` - png file
├── `user-08-mobile-375-layout-check.png` - png file
├── `user-09-session-info-page.png` - png file
├── `user-09-toolbar-crop.png` - png file
├── `user-10-session2.png` - png file
├── `user-10-usage-page.png` - png file
├── `user-11-service-message.png` - png file
├── `user-11-settings-appearance.png` - png file
├── `user-12-desktop-after-wait.png` - png file
├── `user-12-message-typed.png` - png file
├── `user-13-session2-service-message.png` - png file
├── `user-13-start-new-session-goes-to-changelog.png` - png file
├── `user-14-new-session-composer.png` - png file
├── `user-14-settings-page.png` - png file
├── `user-15-message-unsent-in-input.png` - png file
├── `user-15-new-session-composer-typed.png` - png file
├── `user-16-inbox.png` - png file
├── `user-16-new-session-created.png` - png file
├── `user-17-message-roundtrip-verified.png` - png file
├── `user-17-new-session-active.png` - png file
├── `user-18-inbox-empty.png` - png file
├── `user-18-message-sent-received.png` - png file
├── `user-19-mobile-session.png` - png file
├── `user-19-settings-main.png` - png file
├── `user-20-mobile-settings.png` - png file
├── `user-20-settings-account.png` - png file
├── `user-21-mermaid-latex-typed.png` - png file
├── `user-21-quick-action-response.png` - png file
├── `user-22-404-page.png` - png file
├── `user-22-mermaid-latex-response.png` - png file
├── `user-23-mermaid-top.png` - png file
├── `user-23-sitemap.png` - png file
├── `user-24-settings-features.png` - png file
├── `user-24-tables-area.png` - png file
├── `user-25-404-page.png` - png file
├── `user-25-terminals-two-sessions.png` - png file
├── `user-26-double-submit-test.png` - png file
├── `user-26-main-list-mobile.png` - png file
├── `user-27-long-text-input.png` - png file
├── `user-27-voice-permission-dialog.png` - png file
├── `user-28-new-session-info.png` - png file
├── `user-29-settings-voice.png` - png file
├── `user-c3-01-initial-connected.png` - png file
├── `user-c3-02-tools2-desktop.png` - png file
├── `user-c3-03-tools2-all-filter.png` - png file
├── `user-c3-04-tools2-read-filter.png` - png file
├── `user-c3-05-tools2-read-filter-result.png` - png file
├── `user-c3-06-tools2-edit-filter.png` - png file
├── `user-c3-07-tools2-bash-filter.png` - png file
├── `user-c3-08-tools2-other-filter.png` - png file
├── `user-c3-09-tools2-permission-filter.png` - png file
├── `user-c3-10-tools2-permission-states.png` - png file
├── `user-c3-11-tools2-status-icons-view.png` - png file
├── `user-c3-11-tools2-status-icons.png` - png file
├── `user-c3-12-tools2-all-expanded.png` - png file
├── `user-c3-13-read-card-expanded-view.png` - png file
├── `user-c3-13-read-card-expanded.png` - png file
├── `user-c3-14-bash-cards-scroll.png` - png file
├── `user-c3-14-bash-cards-scrolled.png` - png file
├── `user-c3-15-current-state.png` - png file
├── `user-c3-17-session-view-bottom.png` - png file
├── `user-c3-18-session-scrolled-top.png` - png file
├── `user-c3-18-session-top.png` - png file
├── `user-c3-19-session1-messages.png` - png file
├── `user-c3-19-session1-open.png` - png file
├── `user-c3-20-session2-open.png` - png file
├── `user-c3-20-session2-view.png` - png file
├── `user-c3-21-session-scroll-top.png` - png file
├── `user-c3-22-ctrl-b-result.png` - png file
├── `user-c3-22-ctrl-b-test.png` - png file
├── `user-c3-25-back-to-sessions.png` - png file
├── `user-c3-27-session-with-toolcalls.png` - png file
├── `user-c3-28-bash-card-toggle-result.png` - png file
├── `user-c3-28-bash-card-toggle.png` - png file
├── `user-c3-29-session-loading.png` - png file
├── `user-c3-30-tools2-mobile.png` - png file
├── `user-c3-31-mobile-sessions.png` - png file
├── `user-c3-32-desktop-sessions.png` - png file
├── `user-c3-33-settings-page.png` - png file
└── `yarn.lock` - lock file
```

---
*Auto-generated by doc-sync hook.*