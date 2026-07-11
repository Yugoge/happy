# happy-dev

*Last updated: 2026-05-14T19:57:49Z*
**Total entries**: 1731
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
│   │   ├── evidence/
│   │   ├── overnight/
│   │   ├── postmortems/
│   │   ├── qa-artifacts/
│   │   ├── qa-partial-20260425-131502/
│   │   ├── specs/
│   │   ├── specs.pre-merge-backup/
│   │   ├── visual-evidence-20260426/
│   │   ├── `adr-atomic-symlink-deploy.md` - ADR: Atomic-symlink deploys for happy-cli
│   │   ├── `agent-failure-audit-20260507.md` - Agent Failure Audit — 2026-05-07
│   │   ├── `apply-sop-c1-redev-20260505-001500.md` - Apply SOP — C1 Redev (`/root/bin/happy-restart.sh` per-stack refactor)
│   │   ├── `architect-codex-recovery-gap-20260428-215017.json` - json config
│   │   ├── `architect-d5-subagent-lifecycle-merge-20260508-130403.json` - json config
│   │   ├── `architect-happy-restart-and-daemon-prohibition-20260504-223115.md` - Architect Report — happy-restart.sh per-stack support + permanent daemon-restart prohibition
│   │   ├── `architect-report-20260513-211054.json` - json config
│   │   ├── `architect-virtual-repo-testing-20260429-192017.json` - json config
│   │   ├── `ba-children-analysis.md` - BA Analysis: Agent/Task Sidechain Children Pipeline
│   │   ├── `ba-investigation-20260425-122518.md` - BA Re-Investigation Artifact — Cycle 2 Round 2
│   │   ├── `ba-issue3-deep-20260407.md` - Deep Analysis: Issue 3 -- Subagent Sidebar Missing Messages
│   │   ├── `ba-qa-report-20260424-143000-0.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-1.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-10.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-11.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-12.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-13.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-2.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-3.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-4.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-5.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-6.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-7.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-8.json` - json config
│   │   ├── `ba-qa-report-20260424-143000-9.json` - json config
│   │   ├── `ba-qa-report-20260424-202503.json` - json config
│   │   ├── `ba-qa-report-20260425-000300-0-iter2.json` - json config
│   │   ├── `ba-qa-report-20260425-000300-0.json` - json config
│   │   ├── `ba-qa-report-20260425-000300-1-iter2.json` - json config
│   │   ├── `ba-qa-report-20260425-000300-1.json` - json config
│   │   ├── `ba-qa-report-20260425-000300-2.json` - json config
│   │   ├── `ba-qa-report-20260425-000300-9.json` - json config
│   │   ├── `ba-qa-report-20260425-030000-0.json` - json config
│   │   ├── `ba-qa-report-20260425-104643.json` - json config
│   │   ├── `ba-qa-report-20260425-122518-iter1.json` - json config
│   │   ├── `ba-qa-report-20260425-122518.json` - json config
│   │   ├── `ba-qa-report-20260425-131502.json` - json config
│   │   ├── `ba-qa-report-20260425-143500-redev.json` - json config
│   │   ├── `ba-qa-report-20260425-201355-5-16.json` - json config
│   │   ├── `ba-qa-report-20260425-201355-5-17.json` - json config
│   │   ├── `ba-qa-report-20260425-201355-5-19.json` - json config
│   │   ├── `ba-qa-report-20260425-201355-5-2.json` - json config
│   │   ├── `ba-qa-report-20260425-201355-5-3.json` - json config
│   │   ├── `ba-qa-report-20260425-201355-5-4-5.json` - json config
│   │   ├── `ba-qa-report-20260425-211000-redev2.json` - json config
│   │   ├── `ba-qa-report-20260425-221000-redev3-iter1.json` - json config
│   │   ├── `ba-qa-report-20260425-221000-redev3.json` - json config
│   │   ├── `ba-qa-report-20260426-085000-ac12.json` - json config
│   │   ├── `ba-qa-report-20260426-095000-wid.json` - json config
│   │   ├── `ba-qa-report-20260427-001500-saga.json` - json config
│   │   ├── `ba-qa-report-20260427-230227-p01-rerun.json` - json config
│   │   ├── `ba-qa-report-20260427-230227-p02.json` - json config
│   │   ├── `ba-qa-report-20260428-063343-codex-rendering-rerun.json` - json config
│   │   ├── `ba-qa-report-20260428-063343-codex-rendering.json` - json config
│   │   ├── `ba-qa-report-20260428-112122-codex-claude-transcript-parity-r2.json` - json config
│   │   ├── `ba-qa-report-20260428-112122-codex-claude-transcript-parity-r3.json` - json config
│   │   ├── `ba-qa-report-20260428-112122-codex-claude-transcript-parity.json` - json config
│   │   ├── `ba-qa-report-20260428-215017.json` - json config
│   │   ├── `ba-qa-report-20260429-120613.json` - json config
│   │   ├── `ba-qa-report-20260429-192017.json` - json config
│   │   ├── `ba-qa-report-20260502-162334.json` - json config
│   │   ├── `ba-qa-report-20260506-124632.json` - json config
│   │   ├── `ba-qa-report-20260507-055611.json` - json config
│   │   ├── `ba-qa-report-20260507-060647.json` - json config
│   │   ├── `ba-qa-report-20260507-103129.json` - json config
│   │   ├── `ba-qa-report-20260507-103856.json` - json config
│   │   ├── `ba-qa-report-20260507-142748-iter2.json` - json config
│   │   ├── `ba-qa-report-20260507-142748.json` - json config
│   │   ├── `ba-qa-report-20260507-142952.json` - json config
│   │   ├── `ba-qa-report-20260507-191304.json` - json config
│   │   ├── `ba-qa-report-20260507-191743.json` - json config
│   │   ├── `ba-qa-report-20260508-130403.json` - json config
│   │   ├── `ba-qa-report-20260508-134003.json` - json config
│   │   ├── `ba-qa-report-20260508-154926.json` - json config
│   │   ├── `ba-qa-report-20260508-211214.json` - json config
│   │   ├── `ba-qa-report-20260508-211705.json` - json config
│   │   ├── `ba-qa-report-20260509-115500.json` - json config
│   │   ├── `ba-qa-report-20260509-152243.json` - json config
│   │   ├── `ba-qa-report-20260509-225006.json` - json config
│   │   ├── `ba-qa-report-20260510-090535.json` - json config
│   │   ├── `ba-qa-report-20260510-134234.json` - json config
│   │   ├── `ba-qa-report-20260510-191410.json` - json config
│   │   ├── `ba-qa-report-20260513-211054.json` - json config
│   │   ├── `ba-qa-report-20260514-093200.json` - json config
│   │   ├── `ba-qa-report-20260514-143000.json` - json config
│   │   ├── `ba-qa-report-c1-20260504-223115.json` - json config
│   │   ├── `ba-qa-report-c1-redev-20260505-001500.json` - json config
│   │   ├── `ba-qa-report-c2-20260504-223115.json` - json config
│   │   ├── `ba-qa-report-c3-20260504-223115-iter2.json` - json config
│   │   ├── `ba-qa-report-c3-20260504-223115.json` - json config
│   │   ├── `ba-qa-response-20260428-112122-codex-claude-transcript-parity.json` - json config
│   │   ├── `ba-report-20260502-162334.json` - json config
│   │   ├── `ba-spec-20260323-210000.md` - BA Specification: Sidebar Collapse/Expand UI Redesign
│   │   ├── `ba-spec-20260403-210447-0.md` - BA Specification: Restore LaTeX Rendering in MarkdownView
│   │   ├── `ba-spec-20260403-210447-1.md` - BA Specification: Re-wire File Attachment UI in AgentInput
│   │   ├── `ba-spec-20260403-210447-10.md` - BA Specification: Send Button Voice Mode on Web -- Disable Mic Trigger
│   │   ├── `ba-spec-20260403-210447-11.md` - BA Specification: Enable Gzip Compression in Nginx for Web App
│   │   ├── `ba-spec-20260403-210447-12.md` - BA Specification: Remove Debug console.log from ToolView.tsx
│   │   ├── `ba-spec-20260403-210447-2.md` - BA Specification: Add wrapped event rendering to AgentEventBlock
│   │   ├── `ba-spec-20260403-210447-3.md` - BA Specification: Enter Key Does Not Send Message in Web Input
│   │   ├── `ba-spec-20260403-210447-4.md` - BA Specification: Code Block Download Button
│   │   ├── `ba-spec-20260403-210447-5.md` - BA Specification: Fix TaskView Title Duplication in ToolView
│   │   ├── `ba-spec-20260403-210447-6.md` - BA Specification: Bug #62 -- Session Title Not Updating in Sidebar/Header After MCP change_title
│   │   ├── `ba-spec-20260403-210447-7.md` - BA Specification: Fix Hidden Horizontal Scroll Indicators on Web
│   │   ├── `ba-spec-20260403-210447-8.md` - BA Specification: Fix Session Navigation on Web
│   │   ├── `ba-spec-20260403-210447-9.md` - BA Specification: Mermaid Timeline Diagram Chinese Character / Empty Event Rendering Fix
│   │   ├── `ba-spec-20260404-080000.md` - BA Specification: Permanently Fix Title Change (Bug #62)
│   │   ├── `ba-spec-20260404-110000.md` - BA Specification: Fix MCP change_title Tool Failure
│   │   ├── `ba-spec-20260404-120000.md` - BA Specification: Fix MCP Title Change - Stateless Transport Reuse Error
│   │   ├── `ba-spec-20260405-130000.md` - BA Specification: Fix File/Image Upload in happy-dev
│   │   ├── `ba-spec-20260405-mcp-title.md` - BA Specification: MCP change_title Survives Daemon/Session Restarts
│   │   ├── `ba-spec-20260406-1930.md` - BA Specification: Fix 5 Remaining UI Issues (Edit File View, AskUserQuestion Persistence, Subagent Sidebar, Bash/Detail Confirmation)
│   │   ├── `ba-spec-20260406-agent-edit-detail.md` - BA Specification: Agent Inline/Full View Split + Edit Detail Cleanup
│   │   ├── `ba-spec-20260406-data-gaps.md` - BA Specification: Sidebar Data Display Gaps
│   │   ├── `ba-spec-20260406-sidebar-bugs.md` - BA Specification: 5 Sidebar Bugs
│   │   ├── `ba-spec-20260406-sidebar-content.md` - BA Specification: Right Sidebar Content Renderers
│   │   ├── `ba-spec-20260406-sidebar-layout.md` - BA Specification: Right Sidebar Infrastructure (3-Panel Layout)
│   │   ├── `ba-spec-20260406-sidebar-polish.md` - BA Specification: Sidebar Polish - Requirements 2-5
│   │   ├── `ba-spec-20260406-sidebar-routing.md` - BA Specification: Tool Click Routing -- Dual Click Targets for Sidebar
│   │   ├── `ba-spec-20260406-tool-detail.md` - BA Specification: Unified Tool Detail View Layout
│   │   ├── `ba-spec-20260407-0830.md` - BA Specification: AskUserQuestion Answer Persistence + Subagent Sidebar Data Flow
│   │   ├── `ba-spec-20260407-sidebar-detail-coexist.md` - BA Specification: Right Sidebar Must Coexist with Tool Detail Page
│   │   ├── `ba-spec-20260408-0010.md` - BA Specification: BashView Scrollbar and Corner Radius Fix
│   │   ├── `ba-spec-20260408-0700.md` - BA Specification: Fix BashView Inline Preview CSS Bugs
│   │   ├── `ba-spec-20260408-150000.md` - BA Specification: Revert Broken SidebarBashView Horizontal Scroll
│   │   ├── `ba-spec-20260408-170000.md` - BA Specification: Fix BashView Scrollbar + Bottom Border-Radius Conflict
│   │   ├── `ba-spec-20260409-120000.md` - BA Specification: Subagent Sidechain Envelope Visibility
│   │   ├── `ba-spec-20260409-130000.md` - BA Specification: Sidechain Messages Not Rendering in Sidebar/Detail View
│   │   ├── `ba-spec-20260409-160000.md` - BA Specification: Forward Subagent Sidechain Messages from JSONL to Server
│   │   ├── `ba-spec-20260410-0750.md` - BA Specification: Sidechain Messages Not in Main JSONL -- Scanner Reads Wrong Location
│   │   ├── `ba-spec-20260410-children.md` - BA Specification: Agent/Task Tool Detail View Missing Children
│   │   ├── `ba-spec-20260424-143000-0.md` - BA Specification: Markdown Primitives — Missing Block and Span Rendering (§5.17)
│   │   ├── `ba-spec-20260424-143000-1.md` - BA Specification: Inline LaTeX $...$ not rendered (§5.16)
│   │   ├── `ba-spec-20260424-143000-10.md` - BA Specification: §5.9 Stop-Hook Feedback Suppression
│   │   ├── `ba-spec-20260424-143000-11.md` - BA Specification: Top Bar — Header Max-Width and Right-Sidebar Reserved Width Not Responsive (§5.4 + §5.5)
│   │   ├── `ba-spec-20260424-143000-12.md` - BA Specification: §5.5 — Top-Bar Non-Adaptive Layout (Second Case / Verification Scenario)
│   │   ├── `ba-spec-20260424-143000-13.md` - BA Specification: Attachment Tray — Layout Inconsistency + Silent Upload Failure (§5.12)
│   │   ├── `ba-spec-20260424-143000-2.md` - BA Specification: CronList Inline Card Simplification (§5.18)
│   │   ├── `ba-spec-20260424-143000-3.md` - BA Specification: §5.6 — Unify CodexBashView with BashView/CommandView Primitives
│   │   ├── `ba-spec-20260424-143000-4.md` - BA Specification: §5.3 Bash Popup — Command Text Overflows Popup Width
│   │   ├── `ba-spec-20260424-143000-5.md` - BA Specification: Per-session model persistence + model indicator in status bar (§5.1)
│   │   ├── `ba-spec-20260424-143000-6.md` - BA Specification: 1M-Context Claude Models — Context-Usage Display Fix
│   │   ├── `ba-spec-20260424-143000-7.md` - BA Specification: §5.8 Markdown Table Horizontal Scroll — Port from Happy Prod
│   │   ├── `ba-spec-20260424-143000-8.md` - BA Specification: Detail Panel — Long File Path Overflows Header
│   │   ├── `ba-spec-20260424-143000-9.md` - BA Specification: Codex Tool-Call Popup — Description vs Command Separation (§5.7)
│   │   ├── `ba-spec-20260424-202503.md` - BA Specification: Close CLOSE:NO Blockers — Cycle 1 Remediation
│   │   ├── `ba-spec-20260425-000300-0.md` - BA Specification: §5.15 Phase B — Codex Tool Renderers (2 actionable: apply_patch + mcp__happy__change_title alias)
│   │   ├── `ba-spec-20260425-000300-1.md` - BA Specification: §5.15 Phase C — Codex Subagent Delegation Tool Renderers (Rev 2)
│   │   ├── `ba-spec-20260425-000300-2.md` - BA Specification: §5.15 Phase D — Codex Tool-suggest / Parallel Renderers
│   │   ├── `ba-spec-20260425-000300-9.md` - BA Specification: §5.4 Cleanup — Remove dead `headerMaxWidth` export and `getMaxWidth()` helper
│   │   ├── `ba-spec-20260425-030000-0.md` - BA Specification: Codex Protocol Extension (Path A) — Activate 14 Dormant Renderers
│   │   ├── `ba-spec-20260425-104643.md` - BA Specification: Restructure spec-20260424-233926.md to close 7 maturity gaps
│   │   ├── `ba-spec-20260425-122518.md` - BA Specification: Cycle 2 — Implement engineering for spec-20260424-233926 (R1–R5)
│   │   ├── `ba-spec-20260425-131502.md` - BA Specification: Verification Pass — Claude Code items in spec-20260424-084848
│   │   ├── `ba-spec-20260425-143500-redev.md` - BA Specification: Gap E + Gap C fix (/redev cycle)
│   │   ├── `ba-spec-20260425-201355-5-16.md` - BA Specification: Spec Item 5.16 — LaTeX rendering re-verification + mixed-line `$$…$$` collision
│   │   ├── `ba-spec-20260425-201355-5-17.md` - BA Specification: §5.17 — H2 Typography + List Rendering Leak
│   │   ├── `ba-spec-20260425-201355-5-18.md` - BA Specification: 5.18 — CronList inline card must show input line (bash-card style)
│   │   ├── `ba-spec-20260425-201355-5-2.md` - BA Specification: §5.2 Context% Display Broken — Architecture Bug (Cycle 6 Re-attempt)
│   │   ├── `ba-spec-20260425-201355-5-3.md` - BA Specification: §5.3 Right detail panel — Bash command overflow (cycle-2 retry)
│   │   ├── `ba-spec-20260425-201355-5-4-5.md` - BA Specification: Top-bar 800px hardcoded cap + inverted-toggle symptom (§5.4 + §5.5 bundle)
│   │   ├── `ba-spec-20260425-201355-5-8.md` - BA Specification: 5.8 — Message-card wrapper width mismatches actual content width on mobile
│   │   ├── `ba-spec-20260425-211000-redev2.md` - BA Specification: claude-config-guard regex false-positive + anti-fabrication discipline
│   │   ├── `ba-spec-20260425-221000-redev3.md` - BA Specification: M6 — `pretool-quality-gate.py` no-net-worsening exemption
│   │   ├── `ba-spec-20260425-bgtask.md` - BA Specification: Background-Task Notification Not Refreshing in Real-Time
│   │   ├── `ba-spec-20260425-redev-final.md` - BA Specification: spec-20260425-094312 彻底修复 (final pass)
│   │   ├── `ba-spec-20260425-redev-fix.md` - BA Spec: spec-20260425-094312 Redev Fix (9 Objections)
│   │   ├── `ba-spec-20260425-redev-layering.md` - BA Spec: spec-20260425-094312 Re-Layering Design
│   │   ├── `ba-spec-20260426-085000-ac12.md` - BA Specification: AC12 Script-Level Dry-Run Verification of /merge
│   │   ├── `ba-spec-20260426-095000-wid.md` - BA Specification: 20260426-095000-wid — Workflow Integrity Dimension Remediation
│   │   ├── `ba-spec-20260427-001500-saga.md` - BA Specification: 20260427-001500-saga — Saga closure (final)
│   │   ├── `ba-spec-20260427-230227-p04.md` - BA Specification: §5.16/§5.17/§5.18 Evidence Conflict Closure
│   │   ├── `ba-spec-20260428-063343-codex-rendering.md` - BA Specification: Codex Rendering Completion
│   │   ├── `ba-spec-20260428-112122-codex-claude-transcript-parity.md` - BA Specification: Codex/Claude Transcript Rendering Parity — R3 QA Amendment
│   │   ├── `ba-spec-20260428-215017.md` - BA Specification: Fix codex session registration gap so codex sessions survive dev-daemon restart
│   │   ├── `ba-spec-20260429-120613.md` - BA Specification: rollback.sh — symmetric companion to deploy.sh
│   │   ├── `ba-spec-20260429-192017.md` - BA Specification: Virtual-Repo End-to-End Test Harness for deploy.sh + rollback.sh
│   │   ├── `ba-spec-20260507-142952.md` - BA Specification: Hook-Layer Fix — cp-state Direct-Write Block, Stop Hook Backstop, Resolver Fail-Closed
│   │   ├── `ba-spec-20260507-191743.md` - BA Specification: cp-state Bash-Write Bypass Closure (4 Codex Forms + High-Risk Adjacent)
│   │   ├── `blocked-20260428-063343-codex-rendering.md` - Blocked Development Report — 20260428-063343-codex-rendering
│   │   ├── `build-verification-20260409.json` - json config
│   │   ├── `cleanliness-inspector-report-20260504-223115.json` - json config
│   │   ├── `cleanliness-inspector-report-20260507-055611.json` - json config
│   │   ├── `cleanliness-inspector-report-20260507-103856.json` - json config
│   │   ├── `cleanliness-inspector-report-20260507-142748.json` - json config
│   │   ├── `cleanliness-inspector-report-20260507-142952.json` - json config
│   │   ├── `cleanliness-inspector-report-20260507-191304.json` - json config
│   │   ├── `cleanliness-inspector-report-20260507-191743.json` - json config
│   │   ├── `cleanliness-inspector-report-20260508-130403.json` - json config
│   │   ├── `cleanliness-inspector-report-20260508-134003.json` - json config
│   │   ├── `cleanliness-inspector-report-20260508-154926.json` - json config
│   │   ├── `cleanliness-inspector-report-20260508-211214.json` - json config
│   │   ├── `cleanliness-inspector-report-20260508-211705.json` - json config
│   │   ├── `cleanliness-inspector-report-20260509-115500.json` - json config
│   │   ├── `cleanliness-inspector-report-20260509-152243.json` - json config
│   │   ├── `cleanliness-inspector-report-20260509-225006.json` - json config
│   │   ├── `cleanliness-inspector-report-20260510-090535.json` - json config
│   │   ├── `cleanliness-inspector-report-20260510-115954.json` - json config
│   │   ├── `cleanliness-inspector-report-20260510-134234.json` - json config
│   │   ├── `cleanliness-inspector-report-20260510-191410.json` - json config
│   │   ├── `cleanliness-inspector-report-20260513-211054.json` - json config
│   │   ├── `cleanliness-inspector-report-20260514-093200.json` - json config
│   │   ├── `cleanliness-inspector-report-20260514-143000.json` - json config
│   │   ├── `cleanliness-inspector-report-spec-20260506-203844.json` - json config
│   │   ├── `close-report-20260424-175800.md` - Close Report — Overnight Delivery 2026-04-24
│   │   ├── `close-report-20260425-001000.md` - Close-Report (Spec Maturity Review): spec-20260424-233926
│   │   ├── `close-report-20260425-102054.md` - Close Debate Report
│   │   ├── `close-report-20260425-105500.md` - Close Debate Report
│   │   ├── `close-report-20260425-110000.md` - Close Debate Report
│   │   ├── `close-report-20260425-110500.md` - /close debate report — spec maturity re-check after /redev cycle
│   │   ├── `close-report-20260425-111000.md` - Close Debate Report (Re-check after /redev)
│   │   ├── `close-report-20260425-134121.md` - Close Debate Report (QA-only, no codex)
│   │   ├── `close-report-20260425-205822.md` - Close Debate Report
│   │   ├── `close-report-20260425-220425.md` - Close Debate Report
│   │   ├── `close-report-20260425-234439.md` - Close Debate Report
│   │   ├── `close-report-20260426-080520.md` - /close report — spec-20260424-233926, fifth invocation
│   │   ├── `close-report-20260426-084528.md` - /close report — sixth invocation (saga spec-20260424-233926)
│   │   ├── `close-report-20260426-085000-ac12.md` - Close Debate Report
│   │   ├── `close-report-20260426-095000-wid.md` - Close Debate Report — /redev5 (diagnostic via codex)
│   │   ├── `close-report-20260427-001500-saga.md` - Close Debate Report
│   │   ├── `close-report-20260429-192017.md` - Close Debate Report
│   │   ├── `close-report-20260504-223115.md` - Close Debate Report
│   │   ├── `close-report-20260507-055611.md` - Close Debate Report
│   │   ├── `close-report-20260507-103856.md` - Close Debate Report
│   │   ├── `close-report-20260507-142748.md` - Close Debate Report
│   │   ├── `close-report-20260507-142952.md` - /close Debate Report — task-id 20260507-142952
│   │   ├── `close-report-20260507-191304.md` - Close Report — task-id 20260507-191304 (cycle 5)
│   │   ├── `close-report-20260507-191743.md` - Close Report — task-id 20260507-191743
│   │   ├── `close-report-20260508-130403.md` - Close Report — cycle 6 (spec-20260506-203844, D.5 subagent lifecycle merge)
│   │   ├── `close-report-20260508-134003.md` - Close Report — Cycle 5 (task-id 20260508-134003)
│   │   ├── `close-report-20260508-154926.md` - Close Report — cycle 7 (spec-20260506-203844, D.5 final_summary production data path fix)
│   │   ├── `close-report-20260508-211214.md` - Close Report — task-id 20260508-211214 (cycle 8 of spec-20260506-203844)
│   │   ├── `close-report-20260508-211705.md` - Close Report — Cycle 6 (task-id 20260508-211705)
│   │   ├── `close-report-20260509-115500.md` - Close Debate Report
│   │   ├── `close-report-20260509-152243.md` - Close Report — task-id 20260509-152243
│   │   ├── `close-report-20260509-225006.md` - Close Report — task-id 20260509-225006
│   │   ├── `close-report-20260510-090535.md` - Close-Debate Report — 20260510-090535
│   │   ├── `close-report-20260510-115954.md` - Close Debate Report
│   │   ├── `close-report-20260510-134234.md` - Close-Debate Report — 20260510-134234
│   │   ├── `close-report-20260510-191410.md` - Close Debate Report
│   │   ├── `close-report-20260513-211054.md` - Close Report — Codex Symmetric Tracking (Biological-Child Parity)
│   │   ├── `close-report-20260514-093200.md` - Close Debate Transcript — task-id 20260514-093200
│   │   ├── `close-report-20260514-143000.json` - json config
│   │   ├── `close-report-20260514-143000.md` - Close Debate Report
│   │   ├── `close-report-spec-20260506-203844.md` - Close Debate Report
│   │   ├── `codex-fork-divergence-research-20260427.md` - No description
│   │   ├── `codex-mapping-rollout-roadmap.md` - Codex Mapping Rollout Roadmap — fd-scan Deprecation Chain
│   │   ├── `codex-research-20260425-bgtask-reconnect.md` - No description
│   │   ├── `completion-20260424-202503.md` - Development Completion Report — Close-Remediation
│   │   ├── `completion-20260425-104643.md` - Development Completion Report — Spec Maturity Remediation
│   │   ├── `completion-20260425-122518.md` - Development Completion Report
│   │   ├── `completion-20260425-131502.md` - /dev Completion Report — Comprehensive Claude Code Verification Pass
│   │   ├── `completion-20260425-143500-redev.md` - /redev Completion Report — Gap E + Gap C
│   │   ├── `completion-20260425-201355.md` - /dev Completion Report — Cycle 6
│   │   ├── `completion-20260425-211000-redev2.md` - /redev2 Completion Report — Mystery 4 + Trap 11
│   │   ├── `completion-20260425-221000-redev3.md` - /redev3 Completion Report — Mystery 6 + 5-function refactor
│   │   ├── `completion-20260426-085000-ac12.md` - /redev4 Completion Report 20260426-085000-ac12 — AC12 /merge-half empirically verified
│   │   ├── `completion-20260427-001500-saga.md` - Saga Closure Attestation — 20260427-001500-saga
│   │   ├── `completion-20260428-112122-codex-claude-transcript-parity.md` - Development Completion Report — 20260428-112122-codex-claude-transcript-parity
│   │   ├── `completion-20260428-215017.md` - Development Completion Report — 20260428-215017
│   │   ├── `completion-20260429-120613.md` - Development Completion Report — 20260429-120613
│   │   ├── `completion-20260429-192017.md` - Development Completion Report — 20260429-192017
│   │   ├── `completion-20260502-162334.md` - Development Completion Report — 20260502-162334
│   │   ├── `completion-20260504-223115.md` - Development Completion Report — 20260504-223115
│   │   ├── `completion-20260506-124632.md` - Development Completion Report — 20260506-124632
│   │   ├── `completion-20260507-055611.md` - Development Completion Report — 20260507-055611
│   │   ├── `completion-20260507-103856.md` - Development Completion Report — 20260507-103856
│   │   ├── `completion-20260507-142748.md` - Development Completion Report — 20260507-142748
│   │   ├── `completion-20260507-142952.md` - Completion Report — task-id 20260507-142952
│   │   ├── `completion-20260507-191304.md` - Development Completion Report — 20260507-191304
│   │   ├── `completion-20260507-191743.md` - Completion Report — task-id 20260507-191743
│   │   ├── `completion-20260508-130403.md` - Development Completion Report — 20260508-130403
│   │   ├── `completion-20260508-134003.md` - Completion Report — task-id 20260508-134003
│   │   ├── `completion-20260508-154926.md` - Development Completion Report — 20260508-154926
│   │   ├── `completion-20260508-211214.md` - Development Completion Report — 20260508-211214
│   │   ├── `completion-20260508-211705.md` - Completion Report — task-id 20260508-211705
│   │   ├── `completion-20260509-115500.md` - Development Completion Report — 20260509-115500
│   │   ├── `completion-20260509-152243.md` - Completion Report — task-id 20260509-152243
│   │   ├── `completion-20260509-225006.md` - Completion Report — task-id 20260509-225006
│   │   ├── `completion-20260510-090535.md` - Completion Report — task-id 20260510-090535
│   │   ├── `completion-20260510-134234.md` - Completion Report — task-id 20260510-134234
│   │   ├── `completion-20260510-191410.md` - Development Completion Report — 20260510-191410
│   │   ├── `completion-20260513-211054.md` - Completion Report — Codex Symmetric Tracking (Biological Child Parity)
│   │   ├── `completion-20260514-093200.md` - Completion Report — /redev Follow-up (Codex Parity Telemetry + Process.Title + Cgroup)
│   │   ├── `completion-20260514-143000.md` - Completion Report — Codex Recovery Script Patches (Blocks 2+3+4 Final SOP)
│   │   ├── `completion-redev-c1-20260505-001500.md` - /redev Completion Report — redev-c1-20260505-001500
│   │   ├── `context-20260323-210000.json` - json config
│   │   ├── `context-20260403-210447-0.json` - json config
│   │   ├── `context-20260403-210447-1.json` - json config
│   │   ├── `context-20260403-210447-10.json` - json config
│   │   ├── `context-20260403-210447-11.json` - json config
│   │   ├── `context-20260403-210447-12.json` - json config
│   │   ├── `context-20260403-210447-2.json` - json config
│   │   ├── `context-20260403-210447-3.json` - json config
│   │   ├── `context-20260403-210447-4.json` - json config
│   │   ├── `context-20260403-210447-5.json` - json config
│   │   ├── `context-20260403-210447-6.json` - json config
│   │   ├── `context-20260403-210447-7.json` - json config
│   │   ├── `context-20260403-210447-8.json` - json config
│   │   ├── `context-20260403-210447-9.json` - json config
│   │   ├── `context-20260404-080000.json` - json config
│   │   ├── `context-20260404-110000.json` - json config
│   │   ├── `context-20260404-120000.json` - json config
│   │   ├── `context-20260405-130000.json` - json config
│   │   ├── `context-20260405-mcp-title.json` - json config
│   │   ├── `context-20260406-1930.json` - json config
│   │   ├── `context-20260406-agent-edit-detail.json` - json config
│   │   ├── `context-20260406-data-gaps.json` - json config
│   │   ├── `context-20260406-sidebar-bugs.json` - json config
│   │   ├── `context-20260406-sidebar-content.json` - json config
│   │   ├── `context-20260406-sidebar-layout.json` - json config
│   │   ├── `context-20260406-sidebar-polish.json` - json config
│   │   ├── `context-20260406-sidebar-routing.json` - json config
│   │   ├── `context-20260406-tool-detail.json` - json config
│   │   ├── `context-20260407-0830.json` - json config
│   │   ├── `context-20260407-sidebar-detail-coexist.json` - json config
│   │   ├── `context-20260408-0010.json` - json config
│   │   ├── `context-20260408-0700.json` - json config
│   │   ├── `context-20260408-150000.json` - json config
│   │   ├── `context-20260408-170000.json` - json config
│   │   ├── `context-20260409-120000.json` - json config
│   │   ├── `context-20260409-130000.json` - json config
│   │   ├── `context-20260409-160000.json` - json config
│   │   ├── `context-20260410-0750.json` - json config
│   │   ├── `context-20260410-children.json` - json config
│   │   ├── `context-20260424-143000-0.json` - json config
│   │   ├── `context-20260424-143000-1.json` - json config
│   │   ├── `context-20260424-143000-10.json` - json config
│   │   ├── `context-20260424-143000-11.json` - json config
│   │   ├── `context-20260424-143000-12.json` - json config
│   │   ├── `context-20260424-143000-13.json` - json config
│   │   ├── `context-20260424-143000-2.json` - json config
│   │   ├── `context-20260424-143000-3.json` - json config
│   │   ├── `context-20260424-143000-4.json` - json config
│   │   ├── `context-20260424-143000-5.json` - json config
│   │   ├── `context-20260424-143000-6.json` - json config
│   │   ├── `context-20260424-143000-7.json` - json config
│   │   ├── `context-20260424-143000-8.json` - json config
│   │   ├── `context-20260424-143000-9.json` - json config
│   │   ├── `context-20260424-202503.json` - json config
│   │   ├── `context-20260425-000300-0.json` - json config
│   │   ├── `context-20260425-000300-1.json` - json config
│   │   ├── `context-20260425-000300-2.json` - json config
│   │   ├── `context-20260425-000300-9.json` - json config
│   │   ├── `context-20260425-030000-0.json` - json config
│   │   ├── `context-20260425-104643.json` - json config
│   │   ├── `context-20260425-122518.json` - json config
│   │   ├── `context-20260425-131502.json` - json config
│   │   ├── `context-20260425-143500-redev.json` - json config
│   │   ├── `context-20260425-201355-5-16.json` - json config
│   │   ├── `context-20260425-201355-5-17.json` - json config
│   │   ├── `context-20260425-201355-5-18.json` - json config
│   │   ├── `context-20260425-201355-5-2.json` - json config
│   │   ├── `context-20260425-201355-5-3.json` - json config
│   │   ├── `context-20260425-201355-5-4-5.json` - json config
│   │   ├── `context-20260425-201355-5-8.json` - json config
│   │   ├── `context-20260425-211000-redev2.json` - json config
│   │   ├── `context-20260425-221000-redev3.json` - json config
│   │   ├── `context-20260425-bgtask.json` - json config
│   │   ├── `context-20260426-085000-ac12.json` - json config
│   │   ├── `context-20260426-095000-wid.json` - json config
│   │   ├── `context-20260427-001500-saga.json` - json config
│   │   ├── `context-20260427-230227-p04.json` - json config
│   │   ├── `context-20260428-063343-codex-rendering.json` - json config
│   │   ├── `context-20260428-112122-codex-claude-transcript-parity.json` - json config
│   │   ├── `context-20260428-215017.json` - json config
│   │   ├── `context-20260429-120613.json` - json config
│   │   ├── `context-20260429-192017.json` - json config
│   │   ├── `context-20260506-124632.json` - json config
│   │   ├── `context-20260507-055611.json` - json config
│   │   ├── `context-20260507-060647.json` - json config
│   │   ├── `context-20260507-103129.json` - json config
│   │   ├── `context-20260507-103856.json` - json config
│   │   ├── `context-20260507-142748.json` - json config
│   │   ├── `context-20260507-142952.json` - json config
│   │   ├── `context-20260507-191304.json` - json config
│   │   ├── `context-20260507-191743.json` - json config
│   │   ├── `context-20260508-130403.json` - json config
│   │   ├── `context-20260508-134003.json` - json config
│   │   ├── `context-20260508-154926.json` - json config
│   │   ├── `context-20260508-211214.json` - json config
│   │   ├── `context-20260508-211705.json` - json config
│   │   ├── `context-20260509-115500.json` - json config
│   │   ├── `context-20260509-152243.json` - json config
│   │   ├── `context-20260509-225006.json` - json config
│   │   ├── `context-20260510-090535.json` - json config
│   │   ├── `context-20260510-134234.json` - json config
│   │   ├── `context-20260510-191410.json` - json config
│   │   ├── `context-20260513-211054.json` - json config
│   │   ├── `context-20260514-093200.json` - json config
│   │   ├── `context-20260514-143000.json` - json config
│   │   ├── `context-c1-20260504-223115.json` - json config
│   │   ├── `context-c1-redev-20260505-001500.json` - json config
│   │   ├── `context-c2-20260504-223115.json` - json config
│   │   ├── `context-c3-20260504-223115.json` - json config
│   │   ├── `deploy-report-20260425-201355.json` - json config
│   │   ├── `dev-instrument-20260425-201355-5-19-7.1.md` - Pipeline 7.1 — Phase-1 Instrumentation Plan + Block Report
│   │   ├── `dev-report-20260403-210447-0.json` - json config
│   │   ├── `dev-report-20260403-210447-1.json` - json config
│   │   ├── `dev-report-20260403-210447-10.json` - json config
│   │   ├── `dev-report-20260403-210447-11.json` - json config
│   │   ├── `dev-report-20260403-210447-12.json` - json config
│   │   ├── `dev-report-20260403-210447-2.json` - json config
│   │   ├── `dev-report-20260403-210447-3.json` - json config
│   │   ├── `dev-report-20260403-210447-4.json` - json config
│   │   ├── `dev-report-20260403-210447-5.json` - json config
│   │   ├── `dev-report-20260403-210447-6.json` - json config
│   │   ├── `dev-report-20260403-210447-7.json` - json config
│   │   ├── `dev-report-20260403-210447-8.json` - json config
│   │   ├── `dev-report-20260403-210447-9.json` - json config
│   │   ├── `dev-report-20260403-210447.json` - json config
│   │   ├── `dev-report-20260404-080000.json` - json config
│   │   ├── `dev-report-20260404-110000.json` - json config
│   │   ├── `dev-report-20260404-120000.json` - json config
│   │   ├── `dev-report-20260405-130000.json` - json config
│   │   ├── `dev-report-20260405-mcp-title.json` - json config
│   │   ├── `dev-report-20260406-1930.json` - json config
│   │   ├── `dev-report-20260406-sidebar-bugs.json` - json config
│   │   ├── `dev-report-20260406-sidebar-layout.json` - json config
│   │   ├── `dev-report-20260406-sidebar-polish.json` - json config
│   │   ├── `dev-report-20260406-tool-detail.json` - json config
│   │   ├── `dev-report-20260407-0930.json` - json config
│   │   ├── `dev-report-20260407-sidebar-detail-coexist.json` - json config
│   │   ├── `dev-report-20260408-0700.json` - json config
│   │   ├── `dev-report-20260408-170000.json` - json config
│   │   ├── `dev-report-20260409-120000.json` - json config
│   │   ├── `dev-report-20260409-130000.json` - json config
│   │   ├── `dev-report-20260409-160000.json` - json config
│   │   ├── `dev-report-20260424-143000-0.json` - json config
│   │   ├── `dev-report-20260424-143000-1.json` - json config
│   │   ├── `dev-report-20260424-143000-10.json` - json config
│   │   ├── `dev-report-20260424-143000-11.json` - json config
│   │   ├── `dev-report-20260424-143000-13.json` - json config
│   │   ├── `dev-report-20260424-143000-2.json` - json config
│   │   ├── `dev-report-20260424-143000-3.json` - json config
│   │   ├── `dev-report-20260424-143000-4.json` - json config
│   │   ├── `dev-report-20260424-143000-5.json` - json config
│   │   ├── `dev-report-20260424-143000-6.json` - json config
│   │   ├── `dev-report-20260424-143000-7.json` - json config
│   │   ├── `dev-report-20260424-143000-8.json` - json config
│   │   ├── `dev-report-20260424-143000-9.json` - json config
│   │   ├── `dev-report-20260424-143000.json` - json config
│   │   ├── `dev-report-20260424-170900-extra.json` - json config
│   │   ├── `dev-report-20260424-170900.json` - json config
│   │   ├── `dev-report-20260424-172000-extra2.json` - json config
│   │   ├── `dev-report-20260424-172000.json` - json config
│   │   ├── `dev-report-20260424-202503.json` - json config
│   │   ├── `dev-report-20260425-000300-0.json` - json config
│   │   ├── `dev-report-20260425-000300-1.json` - json config
│   │   ├── `dev-report-20260425-000300-2.json` - json config
│   │   ├── `dev-report-20260425-000300-9.json` - json config
│   │   ├── `dev-report-20260425-000300.json` - json config
│   │   ├── `dev-report-20260425-030000-0.json` - json config
│   │   ├── `dev-report-20260425-030000.json` - json config
│   │   ├── `dev-report-20260425-104643.json` - json config
│   │   ├── `dev-report-20260425-122518-G1.json` - json config
│   │   ├── `dev-report-20260425-122518-G2-iter1.json` - json config
│   │   ├── `dev-report-20260425-122518-G2.json` - json config
│   │   ├── `dev-report-20260425-122518-G3.json` - json config
│   │   ├── `dev-report-20260425-122518-G4.json` - json config
│   │   ├── `dev-report-20260425-122518-G5.json` - json config
│   │   ├── `dev-report-20260425-122518.json` - json config
│   │   ├── `dev-report-20260425-131502.json` - json config
│   │   ├── `dev-report-20260425-143500-redev.json` - json config
│   │   ├── `dev-report-20260425-143500.json` - json config
│   │   ├── `dev-report-20260425-201355-5-16.json` - json config
│   │   ├── `dev-report-20260425-201355-5-17.json` - json config
│   │   ├── `dev-report-20260425-201355-5-18-retry.json` - json config
│   │   ├── `dev-report-20260425-201355-5-18.json` - json config
│   │   ├── `dev-report-20260425-201355-5-19-7.1-retry.json` - json config
│   │   ├── `dev-report-20260425-201355-5-19-7.1.json` - json config
│   │   ├── `dev-report-20260425-201355-5-19-7.2.json` - json config
│   │   ├── `dev-report-20260425-201355-5-19-7.3-retry.json` - json config
│   │   ├── `dev-report-20260425-201355-5-19-7.3.json` - json config
│   │   ├── `dev-report-20260425-201355-5-2-retry.json` - json config
│   │   ├── `dev-report-20260425-201355-5-2.json` - json config
│   │   ├── `dev-report-20260425-201355-5-3.json` - json config
│   │   ├── `dev-report-20260425-201355-5-4-5.json` - json config
│   │   ├── `dev-report-20260425-201355-5-8.json` - json config
│   │   ├── `dev-report-20260425-201355.json` - json config
│   │   ├── `dev-report-20260425-211000-redev2.json` - json config
│   │   ├── `dev-report-20260425-211000.json` - json config
│   │   ├── `dev-report-20260425-221000-redev3-iter1.json` - json config
│   │   ├── `dev-report-20260425-221000-redev3.json` - json config
│   │   ├── `dev-report-20260425-221000.json` - json config
│   │   ├── `dev-report-20260426-085000-ac12.json` - json config
│   │   ├── `dev-report-20260426-085000.json` - json config
│   │   ├── `dev-report-20260426-095000-wid-iter1.json` - json config
│   │   ├── `dev-report-20260426-095000-wid.json` - json config
│   │   ├── `dev-report-20260426-095000.json` - json config
│   │   ├── `dev-report-20260427-001500-saga.json` - json config
│   │   ├── `dev-report-20260427-001500.json` - json config
│   │   ├── `dev-report-20260428-063343-codex-rendering-iter1.json` - json config
│   │   ├── `dev-report-20260428-063343-codex-rendering-iter2.json` - json config
│   │   ├── `dev-report-20260428-063343-codex-rendering-iter3.json` - json config
│   │   ├── `dev-report-20260428-063343-codex-rendering-iter4.json` - json config
│   │   ├── `dev-report-20260428-063343-codex-rendering.json` - json config
│   │   ├── `dev-report-20260428-063343.json` - json config
│   │   ├── `dev-report-20260428-112122-codex-claude-transcript-parity.json` - json config
│   │   ├── `dev-report-20260428-112122.json` - json config
│   │   ├── `dev-report-20260428-215017.json` - json config
│   │   ├── `dev-report-20260429-120613.json` - json config
│   │   ├── `dev-report-20260429-192017.json` - json config
│   │   ├── `dev-report-20260502-162334.json` - json config
│   │   ├── `dev-report-20260504-223115.json` - json config
│   │   ├── `dev-report-20260506-124632.json` - json config
│   │   ├── `dev-report-20260507-055611.json` - json config
│   │   ├── `dev-report-20260507-060647.json` - json config
│   │   ├── `dev-report-20260507-103856.json` - json config
│   │   ├── `dev-report-20260507-142748.json` - json config
│   │   ├── `dev-report-20260507-142952.json` - json config
│   │   ├── `dev-report-20260507-191304.json` - json config
│   │   ├── `dev-report-20260507-191743.json` - json config
│   │   ├── `dev-report-20260508-130403.json` - json config
│   │   ├── `dev-report-20260508-134003.json` - json config
│   │   ├── `dev-report-20260508-154926.json` - json config
│   │   ├── `dev-report-20260508-211214.json` - json config
│   │   ├── `dev-report-20260508-211705.json` - json config
│   │   ├── `dev-report-20260509-115500.json` - json config
│   │   ├── `dev-report-20260509-152243.json` - json config
│   │   ├── `dev-report-20260509-225006.json` - json config
│   │   ├── `dev-report-20260510-090535.json` - json config
│   │   ├── `dev-report-20260510-115954.json` - json config
│   │   ├── `dev-report-20260510-134234.json` - json config
│   │   ├── `dev-report-20260510-191410.json` - json config
│   │   ├── `dev-report-20260513-211054.json` - json config
│   │   ├── `dev-report-20260514-093200.json` - json config
│   │   ├── `dev-report-20260514-143000.json` - json config
│   │   ├── `dev-report-c1-20260504-223115.json` - json config
│   │   ├── `dev-report-c1-redev-20260505-001500.json` - json config
│   │   ├── `dev-report-c3-20260504-223115.json` - json config
│   │   ├── `dev-report-tools2-filter-fix.json` - json config
│   │   ├── `e2e-verification-rendering.json` - json config
│   │   ├── `e2e-verification-title.json` - json config
│   │   ├── `e2e-verification-ui.json` - json config
│   │   ├── `hook-block-handoff-20260425-201355.md` - Hook-Block Handoff — DEV_SESSION_ID dev-20260425-201355
│   │   ├── `incident-forensic-20260404.md` - Forensic Incident Report: Production Sessions Killed 2026-04-04
│   │   ├── `isolation-audit-20260404.md` - Production/Dev Isolation Audit
│   │   ├── `observations-ledger.md` - Observations Ledger
│   │   ├── `overnight-log-20260424.md` - Overnight Log — 2026-04-24
│   │   ├── `overnight-log-21d24e89-e5f4-41f4-90f9-7ec3b025fc44.md` - No description
│   │   ├── `overnight-log-d6f1eea4.md` - Overnight Development Log — d6f1eea4
│   │   ├── `overnight-summary-20260424.md` - Overnight Development Summary — 2026-04-24
│   │   ├── `overnight-summary-21d24e89-e5f4-41f4-90f9-7ec3b025fc44.md` - Overnight Development Summary — Session 21d24e89
│   │   ├── `overnight-summary-d6f1eea4.md` - Overnight Development Summary
│   │   ├── `prompt-inspector-report-20260504-223115.json` - json config
│   │   ├── `prompt-inspector-report-20260507-055611.json` - json config
│   │   ├── `prompt-inspector-report-20260507-103856.json` - json config
│   │   ├── `prompt-inspector-report-20260507-142748.json` - json config
│   │   ├── `prompt-inspector-report-20260507-142952.json` - json config
│   │   ├── `prompt-inspector-report-20260507-191304.json` - json config
│   │   ├── `prompt-inspector-report-20260507-191743.json` - json config
│   │   ├── `prompt-inspector-report-20260508-130403.json` - json config
│   │   ├── `prompt-inspector-report-20260508-134003.json` - json config
│   │   ├── `prompt-inspector-report-20260508-154926.json` - json config
│   │   ├── `prompt-inspector-report-20260508-211214.json` - json config
│   │   ├── `prompt-inspector-report-20260508-211705.json` - json config
│   │   ├── `prompt-inspector-report-20260509-115500.json` - json config
│   │   ├── `prompt-inspector-report-20260509-152243.json` - json config
│   │   ├── `prompt-inspector-report-20260509-225006.json` - json config
│   │   ├── `prompt-inspector-report-20260510-090535.json` - json config
│   │   ├── `prompt-inspector-report-20260510-115954.json` - json config
│   │   ├── `prompt-inspector-report-20260510-134234.json` - json config
│   │   ├── `prompt-inspector-report-20260510-191410.json` - json config
│   │   ├── `prompt-inspector-report-20260513-211054.json` - json config
│   │   ├── `prompt-inspector-report-20260514-093200.json` - json config
│   │   ├── `prompt-inspector-report-20260514-143000.json` - json config
│   │   ├── `prompt-inspector-report-spec-20260506-203844.json` - json config
│   │   ├── `proposal-c1-happy-restart-refactor-20260504-223115.sh.md` - Proposal: Refactored /root/bin/happy-restart.sh (C1 dispatch-table architecture)
│   │   ├── `qa-audit-20260407.json` - json config
│   │   ├── `qa-audit-20260425-131502.md` - QA 审计报告 — Cycle 5 Verification (dev-20260425-131502)
│   │   ├── `qa-build-deploy-20260407.json` - json config
│   │   ├── `qa-codex-consensus-20260502-162334.txt` - txt file
│   │   ├── `qa-codex-consensus-20260507-142952.txt` - txt file
│   │   ├── `qa-codex-schema-audit-20260509-115500.json` - json config
│   │   ├── `qa-hooks-bash-safety.json` - json config
│   │   ├── `qa-hooks-prod-files.json` - json config
│   │   ├── `qa-hooks-project.json` - json config
│   │   ├── `qa-input-20260429-192017-ac4-mutated-deploy.sh` - AC4 mutation harness: temporarily modify the rewritten deploy.sh to disable
│   │   ├── `qa-input-20260429-192017-redebate-codex-prompt.txt` - txt file
│   │   ├── `qa-input-20260429-192017-redebate-mutation-test.sh` - QA re-debate mutation harness for M-REWRITE.5 verification.
│   │   ├── `qa-input-codex-prompt-20260428-215017.txt` - txt file
│   │   ├── `qa-issue3-browser-debug-20260407.json` - json config
│   │   ├── `qa-output-20260429-192017-codex.txt` - txt file
│   │   ├── `qa-output-codex-cycle5-20260507-191304.txt` - txt file
│   │   ├── `qa-report-20260403-210447-0.json` - json config
│   │   ├── `qa-report-20260403-210447-1.json` - json config
│   │   ├── `qa-report-20260403-210447-10.json` - json config
│   │   ├── `qa-report-20260403-210447-11.json` - json config
│   │   ├── `qa-report-20260403-210447-12.json` - json config
│   │   ├── `qa-report-20260403-210447-2.json` - json config
│   │   ├── `qa-report-20260403-210447-3.json` - json config
│   │   ├── `qa-report-20260403-210447-4.json` - json config
│   │   ├── `qa-report-20260403-210447-5.json` - json config
│   │   ├── `qa-report-20260403-210447-6.json` - json config
│   │   ├── `qa-report-20260403-210447-7.json` - json config
│   │   ├── `qa-report-20260403-210447-8.json` - json config
│   │   ├── `qa-report-20260403-210447-9.json` - json config
│   │   ├── `qa-report-20260404-080000.json` - json config
│   │   ├── `qa-report-20260404-110000.json` - json config
│   │   ├── `qa-report-20260404-120000-v2.json` - json config
│   │   ├── `qa-report-20260404-120000.json` - json config
│   │   ├── `qa-report-20260405-130000.json` - json config
│   │   ├── `qa-report-20260405-mcp-title.json` - json config
│   │   ├── `qa-report-20260406-1930.json` - json config
│   │   ├── `qa-report-20260406-agent-edit-detail.json` - json config
│   │   ├── `qa-report-20260406-sidebar-bugs.json` - json config
│   │   ├── `qa-report-20260406-sidebar-polish.json` - json config
│   │   ├── `qa-report-20260406-sidebar.json` - json config
│   │   ├── `qa-report-20260406-tool-detail.json` - json config
│   │   ├── `qa-report-20260407-0930.json` - json config
│   │   ├── `qa-report-20260408-0010.json` - json config
│   │   ├── `qa-report-20260408-0700.json` - json config
│   │   ├── `qa-report-20260408-170000.json` - json config
│   │   ├── `qa-report-20260409-120000.json` - json config
│   │   ├── `qa-report-20260409-130000.json` - json config
│   │   ├── `qa-report-20260409-160000.json` - json config
│   │   ├── `qa-report-20260424-143000-0.json` - json config
│   │   ├── `qa-report-20260424-143000-1.json` - json config
│   │   ├── `qa-report-20260424-143000-10.json` - json config
│   │   ├── `qa-report-20260424-143000-11.json` - json config
│   │   ├── `qa-report-20260424-143000-12.json` - json config
│   │   ├── `qa-report-20260424-143000-13.json` - json config
│   │   ├── `qa-report-20260424-143000-2.json` - json config
│   │   ├── `qa-report-20260424-143000-3.json` - json config
│   │   ├── `qa-report-20260424-143000-4.json` - json config
│   │   ├── `qa-report-20260424-143000-5.json` - json config
│   │   ├── `qa-report-20260424-143000-6.json` - json config
│   │   ├── `qa-report-20260424-143000-7.json` - json config
│   │   ├── `qa-report-20260424-143000-8.json` - json config
│   │   ├── `qa-report-20260424-143000-9.json` - json config
│   │   ├── `qa-report-20260424-174000-extras.json` - json config
│   │   ├── `qa-report-20260424-202503-extras.json` - json config
│   │   ├── `qa-report-20260424-202503.json` - json config
│   │   ├── `qa-report-20260425-000300-0.json` - json config
│   │   ├── `qa-report-20260425-000300-1.json` - json config
│   │   ├── `qa-report-20260425-000300-2.json` - json config
│   │   ├── `qa-report-20260425-000300-9.json` - json config
│   │   ├── `qa-report-20260425-030000-0-pm2.json` - json config
│   │   ├── `qa-report-20260425-030000-0.json` - json config
│   │   ├── `qa-report-20260425-104643.json` - json config
│   │   ├── `qa-report-20260425-122518-iter1.json` - json config
│   │   ├── `qa-report-20260425-122518.json` - json config
│   │   ├── `qa-report-20260425-143500-redev.json` - json config
│   │   ├── `qa-report-20260425-201355-5-16.json` - json config
│   │   ├── `qa-report-20260425-201355-5-17.json` - json config
│   │   ├── `qa-report-20260425-201355-5-18.json` - json config
│   │   ├── `qa-report-20260425-201355-5-19.json` - json config
│   │   ├── `qa-report-20260425-201355-5-2.json` - json config
│   │   ├── `qa-report-20260425-201355-5-3.json` - json config
│   │   ├── `qa-report-20260425-201355-5-4-5.json` - json config
│   │   ├── `qa-report-20260425-201355-5-8.json` - json config
│   │   ├── `qa-report-20260425-201355-fresh-session-retest.json` - json config
│   │   ├── `qa-report-20260425-211000-redev2.json` - json config
│   │   ├── `qa-report-20260425-221000-redev3-iter1.json` - json config
│   │   ├── `qa-report-20260425-221000-redev3.json` - json config
│   │   ├── `qa-report-20260426-085000-ac12.json` - json config
│   │   ├── `qa-report-20260427-001500-saga.json` - json config
│   │   ├── `qa-report-20260427-230227-p05.json` - json config
│   │   ├── `qa-report-20260428-063343-codex-rendering-iter1-live-rerun.json` - json config
│   │   ├── `qa-report-20260428-063343-codex-rendering-iter1.json` - json config
│   │   ├── `qa-report-20260428-063343-codex-rendering-iter2-live-rerun.json` - json config
│   │   ├── `qa-report-20260428-063343-codex-rendering-iter2.json` - json config
│   │   ├── `qa-report-20260428-063343-codex-rendering.json` - json config
│   │   ├── `qa-report-20260428-112122-codex-claude-transcript-parity-r2.json` - json config
│   │   ├── `qa-report-20260428-112122-codex-claude-transcript-parity.json` - json config
│   │   ├── `qa-report-20260428-215017.json` - json config
│   │   ├── `qa-report-20260429-120613.json` - json config
│   │   ├── `qa-report-20260429-192017.json` - json config
│   │   ├── `qa-report-20260502-162334.json` - json config
│   │   ├── `qa-report-20260506-124632.json` - json config
│   │   ├── `qa-report-20260507-055611.json` - json config
│   │   ├── `qa-report-20260507-103856.json` - json config
│   │   ├── `qa-report-20260507-142748.json` - json config
│   │   ├── `qa-report-20260507-142952.json` - json config
│   │   ├── `qa-report-20260507-191304.json` - json config
│   │   ├── `qa-report-20260507-191743.json` - json config
│   │   ├── `qa-report-20260508-130403.json` - json config
│   │   ├── `qa-report-20260508-134003.json` - json config
│   │   ├── `qa-report-20260508-154926.json` - json config
│   │   ├── `qa-report-20260508-211214.json` - json config
│   │   ├── `qa-report-20260508-211705.json` - json config
│   │   ├── `qa-report-20260509-115500.json` - json config
│   │   ├── `qa-report-20260509-152243.json` - json config
│   │   ├── `qa-report-20260509-225006.json` - json config
│   │   ├── `qa-report-20260510-090535.json` - json config
│   │   ├── `qa-report-20260510-134234.json` - json config
│   │   ├── `qa-report-20260510-191410.json` - json config
│   │   ├── `qa-report-20260513-211054.json` - json config
│   │   ├── `qa-report-20260514-093200.json` - json config
│   │   ├── `qa-report-20260514-143000.json` - json config
│   │   ├── `qa-report-c1-20260504-223115.json` - json config
│   │   ├── `qa-report-c1-redev-20260505-001500.json` - json config
│   │   ├── `qa-report-c3-20260504-223115.json` - json config
│   │   ├── `qa-report-visual-evidence-20260426.md` - QA Visual Evidence Report — spec-20260424-084848 Cycle 6 (2026-04-26 22:18Z)
│   │   ├── `qa-review-20260407-0830.json` - json config
│   │   ├── `qa-site-isolation-verification.json` - json config
│   │   ├── `qa-validation-20260410.json` - json config
│   │   ├── `recovery-script-patches-20260513-211054.md` - Recovery & Restart Script Patches — Task 20260513-211054
│   │   ├── `recovery-script-patches-final-20260514-143000.md` - Recovery Script Patches — Final SOP for Blocks 2+3+4
│   │   ├── `sim-test-and-cleanup-20260425-122518.json` - json config
│   │   ├── `style-inspector-report-20260504-223115.json` - json config
│   │   ├── `style-inspector-report-20260507-055611.json` - json config
│   │   ├── `style-inspector-report-20260507-103856.json` - json config
│   │   ├── `style-inspector-report-20260507-142748.json` - json config
│   │   ├── `style-inspector-report-20260507-142952.json` - json config
│   │   ├── `style-inspector-report-20260507-191304.json` - json config
│   │   ├── `style-inspector-report-20260507-191743.json` - json config
│   │   ├── `style-inspector-report-20260508-130403.json` - json config
│   │   ├── `style-inspector-report-20260508-134003.json` - json config
│   │   ├── `style-inspector-report-20260508-154926.json` - json config
│   │   ├── `style-inspector-report-20260508-211214.json` - json config
│   │   ├── `style-inspector-report-20260508-211705.json` - json config
│   │   ├── `style-inspector-report-20260509-115500.json` - json config
│   │   ├── `style-inspector-report-20260509-152243.json` - json config
│   │   ├── `style-inspector-report-20260509-225006.json` - json config
│   │   ├── `style-inspector-report-20260510-090535.json` - json config
│   │   ├── `style-inspector-report-20260510-115954.json` - json config
│   │   ├── `style-inspector-report-20260510-134234.json` - json config
│   │   ├── `style-inspector-report-20260510-191410.json` - json config
│   │   ├── `style-inspector-report-20260513-211054.json` - json config
│   │   ├── `style-inspector-report-20260514-093200.json` - json config
│   │   ├── `style-inspector-report-20260514-143000.json` - json config
│   │   ├── `style-inspector-report-spec-20260506-203844.json` - json config
│   │   ├── `ticket-20260506-124632.md` - Ticket 20260506-124632: Inline rendering for image-like tool outputs
│   │   ├── `ticket-20260507-055611.md` - BA Specification: P0 Inline Markdown Parser/Data-Flow Regression Slice (QA-Corrected)
│   │   ├── `ticket-20260507-060647.md` - BA Specification: Happy Tool Rendering Matrix Fix (QA Revision)
│   │   ├── `ticket-20260507-103856.md` - BA Specification: Close-report cycle-3 fix — `web.open` fixture row + per-row §5.3.B image-preview screenshots
│   │   ├── `ticket-20260507-142748.md` - BA Specification: Spec spec-20260506-203844 — Phase A remaining sub-items (C.2, B.7, F.4, G.4, E.2-doc, I.2-doc)
│   │   ├── `ticket-20260507-191304.md` - BA Specification: Remove cycle-4 DOM probe script + cleanup stale permission entry
│   │   ├── `ticket-20260508-130403.md` - BA Specification: D.5 Subagent Lifecycle Card Merge (cycle 6 of spec-20260506-203844)
│   │   ├── `ticket-20260508-154926.md` - BA Specification: D.5 final_summary production data path (3-layer fix)
│   │   ├── `ticket-20260508-211214.md` - BA Specification: Cycle 8 — spawn-begin lifecycle entry gate fix (Path A+) + fixture realism
│   │   ├── `ticket-20260509-115500.md` - BA Specification: Restore DropdownMenu API in SessionActionsNativeMenu.android.tsx (typecheck fix)
│   │   ├── `ticket-20260510-191410.md` - BA Specification: Add §5.X-inflation prohibition + --codex mode to /spec
│   │   ├── `ticket-20260513-211054.md` - BA Specification: Codex Symmetric Tracking — First-Class Biological Child Parity with Claude
│   │   ├── `ticket-20260514-093200.md` - BA Specification: /redev round-1 — land risk-filtered prior-cycle deferrals (M1' M2' M3' M4')
│   │   ├── `ticket-20260514-143000.md` - BA Specification: Codex-Mapping Recovery — Block 2+3+4 Closure (Subagent Slice)
│   │   ├── `ticket-c1-20260504-223115.md` - BA Specification: happy-restart.sh per-stack target dispatch (CONCERN C1)
│   │   ├── `ticket-c1-redev-20260505-001500.md` - BA Specification: C1 Redev — Apply-Step Contract for happy-restart.sh refactor
│   │   ├── `ticket-c2-20260504-223115.md` - BA Specification: Recover Codex Session 019dd077 (CONCERN C2)
│   │   └── `ticket-c3-20260504-223115.md` - BA Specification: C3 — Permanent prohibition on Claude restarting any happy-daemon
│   ├── e2e/
│   │   ├── `console-initial.log` - log file
│   │   ├── `download-desktop-codeblock-buttons.png` - png file
│   │   ├── `download-desktop-codeblock-visible.png` - png file
│   │   ├── `download-desktop-download-button.png` - png file
│   │   ├── `download-desktop-hover-buttons.png` - png file
│   │   ├── `download-mobile-buttons-revealed.png` - png file
│   │   ├── `download-mobile-buttons-visible.png` - png file
│   │   ├── `download-mobile-codeblock-buttons.png` - png file
│   │   ├── `download-mobile-codeblock.png` - png file
│   │   ├── `mcp-title-desktop-response.png` - png file
│   │   ├── `mcp-title-desktop-sidebar.png` - png file
│   │   ├── `mcp-title-mobile-response.png` - png file
│   │   ├── `mic-desktop-empty.png` - png file
│   │   ├── `mic-desktop-with-text.png` - png file
│   │   ├── `mic-mobile-empty.png` - png file
│   │   ├── `mic-mobile-with-text.png` - png file
│   │   ├── `mobile-01-sessions-list.png` - png file
│   │   ├── `mobile-02-session-top.png` - png file
│   │   ├── `mobile-03-latex.png` - png file
│   │   ├── `mobile-04-latex-closeup.png` - png file
│   │   ├── `mobile-05-wrap-envelopes.png` - png file
│   │   ├── `mobile-06-wrap-closeup.png` - png file
│   │   ├── `mobile-07-wrap-expanded.png` - png file
│   │   ├── `mobile-08-taskview.png` - png file
│   │   ├── `mobile-09-taskview-closeup.png` - png file
│   │   ├── `mobile-10-table.png` - png file
│   │   ├── `mobile-11-table-closeup.png` - png file
│   │   ├── `mobile-12-mermaid-fallback.png` - png file
│   │   ├── `mobile-13-input-area.png` - png file
│   │   ├── `mobile-14-qa-report.png` - png file
│   │   ├── `mobile-15-report-tables.png` - png file
│   │   ├── `mobile-16-resources-table.png` - png file
│   │   ├── `mobile-17-option-buttons.png` - png file
│   │   ├── `mobile-18-mermaid-flowchart.png` - png file
│   │   ├── `mobile-19-mermaid-flowchart-closeup.png` - png file
│   │   ├── `mobile-20-fullpage.png` - png file
│   │   ├── `mobile-21-back-to-list.png` - png file
│   │   ├── `p12-console-after-toolclick.log` - log file
│   │   ├── `p12-console-messages.log` - log file
│   │   ├── `p5-initial-load.png` - png file
│   │   ├── `p5-scrolled-top.png` - png file
│   │   ├── `p5-session-opened.png` - png file
│   │   ├── `p5-session-overview.png` - png file
│   │   ├── `p5-taskview-block.png` - png file
│   │   ├── `p5-taskview-closeup.png` - png file
│   │   ├── `p5-taskview-top.png` - png file
│   │   ├── `p5-taskview-verified.png` - png file
│   │   ├── `p5-tool-call-expanded.png` - png file
│   │   ├── `p5-tool-single-header.png` - png file
│   │   ├── `p7-scroll-table-closeup.png` - png file
│   │   ├── `p7-scroll-table-final.png` - png file
│   │   ├── `p7-scroll-table-overview.png` - png file
│   │   ├── `p7-scroll-table-scrolled.png` - png file
│   │   ├── `p7-tables-with-scroll.png` - png file
│   │   ├── `p9-mermaid-full-page.png` - png file
│   │   ├── `p9-mermaid-timeline-chinese-fallback.png` - png file
│   │   ├── `p9-mermaid-timeline-viewport.png` - png file
│   │   ├── `p9-mermaid-user-message-fallback.png` - png file
│   │   ├── `session-full-content.png` - png file
│   │   ├── `session-view.png` - png file
│   │   ├── `title-final-desktop-home.png` - png file
│   │   ├── `title-final-desktop-session.png` - png file
│   │   ├── `title-final-desktop-tools.png` - png file
│   │   ├── `title-final-mobile-session.png` - png file
│   │   ├── `title-final-mobile-tools.png` - png file
│   │   ├── `title-final-mobile-tools2.png` - png file
│   │   ├── `title-final-mobile-tools3.png` - png file
│   │   ├── `title-final2-desktop-initial.png` - png file
│   │   ├── `title-final2-desktop-titlechange.png` - png file
│   │   ├── `title-final2-mobile-titlechange.png` - png file
│   │   ├── `title-fix-desktop-session.png` - png file
│   │   ├── `title-fix-mobile-session.png` - png file
│   │   ├── `title-mcp-after-desktop.png` - png file
│   │   ├── `title-mcp-after-mobile.png` - png file
│   │   ├── `title-mcp-before-desktop.png` - png file
│   │   ├── `toolcall-bash-all-collapsed-desktop.png` - png file
│   │   ├── `toolcall-bash-area-desktop.png` - png file
│   │   ├── `toolcall-bash-blocks-desktop.png` - png file
│   │   ├── `toolcall-bash-blocks2-desktop.png` - png file
│   │   ├── `toolcall-bash-collapsed-desktop.png` - png file
│   │   ├── `toolcall-bash-expanded-desktop.png` - png file
│   │   ├── `toolcall-desktop-bash-area.png` - png file
│   │   ├── `toolcall-desktop-bash-area2.png` - png file
│   │   ├── `toolcall-desktop-bash-cards.png` - png file
│   │   ├── `toolcall-desktop-bash-collapsed.png` - png file
│   │   ├── `toolcall-desktop-bash-docker.png` - png file
│   │   ├── `toolcall-desktop-bash-expanded.png` - png file
│   │   ├── `toolcall-desktop-bottom.png` - png file
│   │   ├── `toolcall-desktop-grep-collapsed.png` - png file
│   │   ├── `toolcall-desktop-grep-expanded.png` - png file
│   │   ├── `toolcall-desktop-mid1.png` - png file
│   │   ├── `toolcall-desktop-overview.png` - png file
│   │   ├── `toolcall-desktop-read-collapsed.png` - png file
│   │   ├── `toolcall-desktop-read-expanded-full.png` - png file
│   │   ├── `toolcall-desktop-read-expanded.png` - png file
│   │   ├── `toolcall-desktop-read-view.png` - png file
│   │   ├── `toolcall-desktop-scrolltop0.png` - png file
│   │   ├── `toolcall-desktop-session-top.png` - png file
│   │   ├── `toolcall-mobile-bash-cards.png` - png file
│   │   ├── `toolcall-mobile-bash-docker.png` - png file
│   │   ├── `toolcall-mobile-bash-docker2.png` - png file
│   │   ├── `toolcall-mobile-bash-expanded-header.png` - png file
│   │   ├── `toolcall-mobile-bash-expanded.png` - png file
│   │   ├── `toolcall-mobile-bash.png` - png file
│   │   ├── `toolcall-mobile-read.png` - png file
│   │   ├── `toolcall-mobile-top.png` - png file
│   │   ├── `toolcall-overview-desktop.png` - png file
│   │   ├── `toolcall-session-top-desktop.png` - png file
│   │   ├── `toolcall-todowrite-expanded-desktop.png` - png file
│   │   ├── `toolcall2-01-write-collapsed-desktop.png` - png file
│   │   ├── `toolcall2-01-write-expanded-desktop.png` - png file
│   │   ├── `toolcall2-02-edit-desktop.png` - png file
│   │   ├── `toolcall2-03-glob-desktop.png` - png file
│   │   ├── `toolcall2-04-agent-desktop.png` - png file
│   │   ├── `toolcall2-05-websearch-desktop.png` - png file
│   │   ├── `toolcall2-06-webfetch-desktop.png` - png file
│   │   ├── `toolcall2-06-webfetch-permission-desktop.png` - png file
│   │   ├── `toolcall2-07-mcp-desktop.png` - png file
│   │   ├── `toolcall2-08-mobile-top.png` - png file
│   │   ├── `toolcall2-09-mobile-websearch.png` - png file
│   │   ├── `toolcall2-10-mobile-edit-write.png` - png file
│   │   ├── `toolcall2-11-mobile-write.png` - png file
│   │   ├── `toolcall2-12-mobile-glob.png` - png file
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
│   ├── data/
│   │   └── envs/
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
│   ├── `build-cli-production.sh` - Build and globally install production happy-cli from /root/happy only.
│   ├── `deploy-services.sh` - happy-dev service deployment helper. Keeps the existing promotion deploy.sh separate.
│   ├── `deploy.sh` - deploy.sh — Foolproof dev → prod patch promotion for happy monorepo
│   ├── `DEPLOYMENT.md` - DEPLOYMENT.md — happy dev → prod patch promotion runbook
│   ├── `derive-content-public-key.js` - js file
│   ├── `dev-overnight-build-deploy.sh` - Build and deploy happy-dev frontend/backend directly from a worktree context.
│   ├── `generate-access-key-material.sh` - Derive content publicKey and mint a privacy-kit token for access.key material.
│   ├── `playwright-login-dev.js` - js file
│   ├── `postinstall.cjs` - cjs file
│   ├── `pretool-block-production.sh` - Hook: PreToolUse (mcp__playwright__browser_navigate, mcp__playwright__browser_run_code, WebFetch)
│   ├── `release.cjs` - cjs file
│   ├── `rollback.sh` - rollback.sh — Symmetric companion to deploy.sh
│   └── `verify-cli-build.sh` - Verify installed happy-coder binary after a CLI build.
├── tests/
│   ├── bin/
│   │   ├── `npm` - unknown file
│   │   ├── `recovery-stub.sh` - tests/bin/recovery-stub.sh — M-RECOVERY
│   │   └── `yarn` - unknown file
│   ├── lib/
│   │   ├── `assert.sh` - tests/lib/assert.sh — M-ASSERT
│   │   ├── `daemon-mock.sh` - tests/lib/daemon-mock.sh — M-DAEMONMOCK
│   │   ├── `git-helpers.sh` - tests/lib/git-helpers.sh — M-GIT
│   │   ├── `path-scan.sh` - tests/lib/path-scan.sh — M-PATHSCAN
│   │   ├── `rewrite.sh` - tests/lib/rewrite.sh — M-REWRITE
│   │   ├── `sandbox.sh` - tests/lib/sandbox.sh — M-SANDBOX
│   │   └── `static-audit.sh` - tests/lib/static-audit.sh — defines audit_no_executable() helper used by S17
│   ├── scenarios/
│   │   ├── `S01-deploy-happy-path.sh` - S01: deploy-happy-path-clean-version-bump
│   │   ├── `S02-deploy-aborts-same-version.sh` - S02: deploy-aborts-same-version-codex-3
│   │   ├── `S03-deploy-restores-protected-paths.sh` - S03: deploy-restores-protected-paths-codex-1-2
│   │   ├── `S03b-deploy-aborts-unreachable-dev-sha.sh` - S03b: deploy-aborts-unreachable-dev-sha-codex-10  (Pass 2 #2)
│   │   ├── `S04-deploy-aborts-wrong-cwd.sh` - S04: deploy-aborts-wrong-cwd-codex-5  (the 2026-04-04 incident)
│   │   ├── `S05-deploy-aborts-dirty-tree.sh` - S05: deploy-aborts-dirty-tree-codex-9
│   │   ├── `S06-deploy-aborts-on-test-gate-failure.sh` - S06: deploy-aborts-on-test-gate-failure-codex-14
│   │   ├── `S06b-deploy-aborts-on-frozen-lockfile-install-failure.sh` - S06b: deploy-aborts-on-frozen-lockfile-install-failure  (Pass 2 #1)
│   │   ├── `S07-deploy-aborts-on-install-failure-and-restores.sh` - S07: deploy-aborts-on-install-failure-and-restores-codex-14-install-side
│   │   ├── `S08-deploy-no-tag-leak.sh` - S08: deploy-no-tag-leak-codex-11
│   │   ├── `S09-deploy-push-fails-local-still-good.sh` - S09: deploy-push-fails-local-still-good-codex-8
│   │   ├── `S10-rollback-happy-path.sh` - S10: rollback-happy-path
│   │   ├── `S11-rollback-aborts-same-version.sh` - S11: rollback-aborts-same-version-codex-3-symmetric
│   │   ├── `S11b-rollback-bad-argv-exits-2.sh` - S11b: rollback-bad-argv-exits-2  (Pass 2 #6)
│   │   ├── `S12-rollback-aborts-partial-daemon-migration.sh` - S12: rollback-aborts-partial-daemon-migration-M14-P3
│   │   ├── `S12b-rollback-stale-daemon-emits-safe-daemon-restart-hint.sh` - S12b: rollback-stale-daemon-emits-safe-daemon-restart-hint  (Pass 2 #5)
│   │   ├── `S13-rollback-safety-tag-collision-suffix.sh` - S13: rollback-safety-tag-collision-suffix-S2-codex-15
│   │   ├── `S14-rollback-aborts-on-recovery-snapshot-fail.sh` - S14: rollback-aborts-on-recovery-snapshot-fail-M6
│   │   ├── `S14b-rollback-aborts-on-install-failure-P2.sh` - S14b: rollback-aborts-on-install-failure-P2  (Pass 2 #7)
│   │   ├── `S15-rollback-aborts-on-active-merge.sh` - S15: rollback-aborts-on-active-merge-M3b
│   │   ├── `S15b-rollback-aborts-on-unreachable-tag.sh` - S15b: rollback-aborts-on-unreachable-tag  (Pass 2 #4 / M4)
│   │   ├── `S15c-rollback-aborts-on-sensitive-untracked.sh` - S15c: rollback-aborts-on-sensitive-untracked  (Pass 2 #4 / M5 strict)
│   │   ├── `S16-rollback-fork-divergence-and-missing-fork-main.sh` - S16: rollback-fork-divergence-and-missing-fork-main  (Pass 2 #10)
│   │   └── `S17-static-audit-no-network-no-shell-state.sh` - S17: static-audit-no-network-no-shell-state  (Pass 2 #12, iter1+2+3)
│   └── `run-all.sh` - tests/run-all.sh — M-RUNNER
├── `01-connected-no-sessions.png` - png file
├── `01-happy-dev-session-overview.png` - png file
├── `02-bottom-of-happy-dev-session.png` - png file
├── `02-settings-page.png` - png file
├── `03-mobile-390px-tool-cards.png` - png file
├── `03-session-appeared.png` - png file
├── `04-session-messages-loaded.png` - png file
├── `05-session-full-view.png` - png file
├── `06-session-top.png` - png file
├── `07-taskview-visible.png` - png file
├── `08-taskview-expanded.png` - png file
├── `09-table-area.png` - png file
├── `10-taskview-detail-duplicate-title.png` - png file
├── `11-table-scroll-indicator.png` - png file
├── `12-1280-rightsidebar-closed.png` - png file
├── `12-table-view.png` - png file
├── `13-mobile-390x844.png` - png file
├── `13-table-scroll-test.png` - png file
├── `14-table-in-view.png` - png file
├── `15-navigation-instability.png` - png file
├── `16-input-bar-attachments.png` - png file
├── `17-mermaid-message-typed.png` - png file
├── `18-mermaid-rendered.png` - png file
├── `5.3-bash-popup-current.png` - png file
├── `_test_notebook.ipynb` - ipynb file
├── `_tool_test.txt` - txt file
├── `agent-sidebar-test.png` - png file
├── `applio-session-claude-code-tools.png` - png file
├── `applio-session-deleted.png` - png file
├── `arch-session-latex-test.png` - png file
├── `ba-5-16-desktop-latex.png` - png file
├── `bashview-82pct.png` - png file
├── `bashview-94pct.png` - png file
├── `bashview-cards.png` - png file
├── `bashview-complete-card.png` - png file
├── `bashview-deploy.png` - png file
├── `bashview-mid-scroll.png` - png file
├── `bashview-mobile.png` - png file
├── `bashview-new-desktop.png` - png file
├── `bashview-new-inline.png` - png file
├── `bashview-new-v2.png` - png file
├── `bashview-rebuild.png` - png file
├── `bg-task-bug-current-session.png` - png file
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
├── `CLAUDE.md.bak-layering-20260425-1329` - bak-layering-20260425-1329 file
├── `codex-render-desktop-session.png` - png file
├── `composer-initial.png` - png file
├── `cron-cycle5-current.png` - png file
├── `cycle2-landing.png` - png file
├── `cycle2-session-open.png` - png file
├── `cycle2-session2.png` - png file
├── `cycle2-sidebar-collapse.png` - png file
├── `cycle2-sidebar-restored.png` - png file
├── `cycle3-initial-load.png` - png file
├── `demo-dev-life-ai-2.png` - png file
├── `demo-dev-life-ai.png` - png file
├── `desktop-appearance-1440.png` - png file
├── `desktop-code-block-1440.png` - png file
├── `desktop-codeblock-area.png` - png file
├── `desktop-home-1440.png` - png file
├── `desktop-landing.png` - png file
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
├── `find-agent-25pct.png` - png file
├── `find-agent-60pct.png` - png file
├── `find-agent-82pct.png` - png file
├── `find-agent-93pct.png` - png file
├── `find-agent-97pct.png` - png file
├── `find-agent-985.png` - png file
├── `find-agent-tool.png` - png file
├── `happy-dev-session.png` - png file
├── `happydev-session-desktop-1440px.png` - png file
├── `happydev-session-mobile-390px.png` - png file
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
├── `p11-desktop-1440-sidebar-closed.png` - png file
├── `p11-desktop-1440-sidebar-opened.png` - png file
├── `p11-final-1440-closed.png` - png file
├── `p11-narrow-1024.png` - png file
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
├── `pm-happy-app-session-view.png` - png file
├── `pm-landing-2026-04-24.png` - png file
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
├── `po-00-current-stop-hook-visible.png` - png file
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
├── `po-current-snapshot.md` - No description
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
├── `po-reset-screenshot.png` - png file
├── `po-reset2.md` - No description
├── `po-reset3.md` - No description
├── `po-reset4.md` - No description
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
├── `qa-20260425-201355-5-17-desktop-rendered-headers-lists.png` - png file
├── `qa-20260425-201355-5-17-desktop-rendered.png` - png file
├── `qa-20260426-085500-mobile-overview.png` - png file
├── `qa-5-16-desktop-AC2-AC3-existing-block-and-inline.png` - png file
├── `qa-5-16-desktop-baseline-existing-latex.png` - png file
├── `qa-5-16-mobile-AC2-AC3-existing-block-and-inline-v2.png` - png file
├── `qa-5-16-mobile-AC2-AC3-existing-block-and-inline.png` - png file
├── `qa-5-16-mobile-AC2-AC3-final.png` - png file
├── `qa-5-18-desktop-cronlist-2-rows.png` - png file
├── `qa-5-18-desktop-cronlist-card.png` - png file
├── `qa-5-18-desktop-cronlist-final.png` - png file
├── `qa-5-18-desktop-cronlist-visible.png` - png file
├── `qa-5-18-mobile-cronlist-2-rows.png` - png file
├── `qa-5-3-after-click-1.png` - png file
├── `qa-5-3-bashview-inline-regression.png` - png file
├── `qa-5-3-current-state.png` - png file
├── `qa-5-3-desktop-cycle2-popup.png` - png file
├── `qa-5-3-desktop-loaded.png` - png file
├── `qa-5-3-desktop-state.png` - png file
├── `qa-5-3-mobile-after-close.png` - png file
├── `qa-5-3-mobile-cycle2-popup.png` - png file
├── `qa-5-3-state-debug.png` - png file
├── `qa-5-4-5-1280-pre-toggle.png` - png file
├── `qa-5-4-5-1920-final.png` - png file
├── `qa-5-4-5-1920-sidebar-OPEN-maxwidth-1110.png` - png file
├── `qa-5-4-5-desktop-1280-sidebar-closed.png` - png file
├── `qa-5-4-5-desktop-1920-sidebar-closed.png` - png file
├── `qa-5-4-5-mobile-390.png` - png file
├── `qa-5.2-desktop-final.png` - png file
├── `qa-5.2-desktop-inactive-default.png` - png file
├── `qa-5.2-mobile-final.png` - png file
├── `qa-516-desktop-1280.png` - png file
├── `qa-516-desktop.png` - png file
├── `qa-516-mobile-390.png` - png file
├── `qa-518-inline.png` - png file
├── `qa-ac17-mcp-fixtures-desktop.png` - png file
├── `qa-ac17-mcp-fixtures-mobile.png` - png file
├── `qa-after-click-desktop.png` - png file
├── `qa-after-reload.png` - png file
├── `qa-agent-card-click-desktop.png` - png file
├── `qa-agent-detail-desktop.png` - png file
├── `qa-agent-detail-mobile.png` - png file
├── `qa-agent-detail-scrolled.png` - png file
├── `qa-agent-detail-subtools-section.png` - png file
├── `qa-agent-detail-subtools.png` - png file
├── `qa-agent-sidebar-opened.png` - png file
├── `qa-agent-sidebar-scrolled.png` - png file
├── `qa-agent-sidebar-test.png` - png file
├── `qa-agent-sidebar-toolcalls.png` - png file
├── `qa-agent-sidebar-tools.png` - png file
├── `qa-back-to-session.md` - No description
├── `qa-baseline-session-view.png` - png file
├── `qa-bashview-desktop-bash-blocks.png` - png file
├── `qa-bashview-desktop-closeup.png` - png file
├── `qa-bashview-desktop-overview.png` - png file
├── `qa-bashview-inline-1.png` - png file
├── `qa-bashview-inline-short.png` - png file
├── `qa-bashview-inline-short2.png` - png file
├── `qa-bashview-mobile-65lines.png` - png file
├── `qa-bashview-mobile-closeup.png` - png file
├── `qa-bashview-mobile-long.png` - png file
├── `qa-bashview-mobile-short.png` - png file
├── `qa-bashview-session-overview.png` - png file
├── `qa-bashview-sidebar-bash.png` - png file
├── `qa-before-enter.png` - png file
├── `qa-blk2-cronlist-desktop-sidebar.png` - png file
├── `qa-blk2-cronlist-desktop.png` - png file
├── `qa-blk2-cronlist-mobile.png` - png file
├── `qa-blk2-table-desktop.png` - png file
├── `qa-blk2-table-mobile.png` - png file
├── `qa-bug64-conversation-view.png` - png file
├── `qa-bug64-detail-page-no-duplication.png` - png file
├── `qa-bug64-tool-calls-divider.png` - png file
├── `qa-code-block-area.png` - png file
├── `qa-cycle2-desktop-baseline-1440x900.png` - png file
├── `qa-cycle2-desktop-claude-session-regression.png` - png file
├── `qa-cycle2-desktop-home.png` - png file
├── `qa-cycle2-desktop-markdown-tables-1440x900.png` - png file
├── `qa-cycle2-desktop-orchestra-session.png` - png file
├── `qa-cycle2-desktop-session-renderers-1440x900.png` - png file
├── `qa-cycle2-desktop-session.png` - png file
├── `qa-cycle2-mobile-home.png` - png file
├── `qa-cycle2-mobile-markdown-tables-390x844.png` - png file
├── `qa-cycle2-mobile-session-renderers-390x844.png` - png file
├── `qa-cycle2-mobile-session.png` - png file
├── `qa-cycle2-p0-sidebar.png` - png file
├── `qa-cycle2-p3-tools2.png` - png file
├── `qa-cycle2-p6-other-tools-filtered.png` - png file
├── `qa-cycle2-p6-other-tools.png` - png file
├── `qa-desktop-1440-confirmed.png` - png file
├── `qa-desktop-1440-final.png` - png file
├── `qa-desktop-1440x900-overview.png` - png file
├── `qa-desktop-bash-truncation.png` - png file
├── `qa-desktop-bashview-hover-scrollbar.png` - png file
├── `qa-desktop-bashview-scrollbar.png` - png file
├── `qa-desktop-bashview-sidebar.png` - png file
├── `qa-desktop-edit-sidebar.png` - png file
├── `qa-desktop-overview.png` - png file
├── `qa-desktop-session-overview.png` - png file
├── `qa-desktop-session-view.png` - png file
├── `qa-desktop-sidechain-agent-card.png` - png file
├── `qa-dev-agent-subtools.png` - png file
├── `qa-dev-app-state.png` - png file
├── `qa-find-agent-tools.png` - png file
├── `qa-fresh-desktop-1.png` - png file
├── `qa-fresh-desktop-context-pct.png` - png file
├── `qa-fresh-desktop-sonnet.png` - png file
├── `qa-fresh-mobile-1.png` - png file
├── `qa-fresh-mobile-context-pct.png` - png file
├── `qa-image-render-mobile-attempt.png` - png file
├── `qa-initial-session-view.png` - png file
├── `qa-inline-todo-overview.png` - png file
├── `qa-issue3-sidebar-ba-agent.png` - png file
├── `qa-latex-inline-closeup.png` - png file
├── `qa-latex-inline-rendering.png` - png file
├── `qa-mid-scroll.md` - No description
├── `qa-mobile-390x844-overview.png` - png file
├── `qa-mobile-agent-detail.png` - png file
├── `qa-mobile-bash-card-clipped.png` - png file
├── `qa-mobile-bashview.png` - png file
├── `qa-mobile-conversation-bottom.png` - png file
├── `qa-mobile-markdown-demo.png` - png file
├── `qa-mobile-session-view.jpeg` - jpeg file
├── `qa-mobile-sidechain-agent-card.png` - png file
├── `qa-mobile-viewport.png` - png file
├── `qa-new-session.png` - png file
├── `qa-p0-desktop-baseline.png` - png file
├── `qa-p0-desktop-session-applio.png` - png file
├── `qa-p0-mobile-changelog.png` - png file
├── `qa-p0-mobile-session-applio.png` - png file
├── `qa-p10-1280.png` - png file
├── `qa-p10-root-session.png` - png file
├── `qa-p10-send-button-empty.png` - png file
├── `qa-p10-session-view.png` - png file
├── `qa-p12-after-collapse.png` - png file
├── `qa-p12-after-expand.png` - png file
├── `qa-p12-before-collapse.png` - png file
├── `qa-p13-desktop-1280.png` - png file
├── `qa-p13-desktop-tray.png` - png file
├── `qa-p13-mixed-tray-mobile.png` - png file
├── `qa-p13-oversize-modal-desktop.png` - png file
├── `qa-p13-oversize-modal.png` - png file
├── `qa-p2-machine-card.png` - png file
├── `qa-p2-regression-desktop.png` - png file
├── `qa-p2-regression-mobile.png` - png file
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
├── `qa-s5.1-both-chips-after-yolo.png` - png file
├── `qa-s5.1-both-chips-desktop.png` - png file
├── `qa-s5.1-chip-haiku-only.png` - png file
├── `qa-s5.1-desktop-persisted.png` - png file
├── `qa-s5.1-initial.png` - png file
├── `qa-s5.1-mobile-persisted.png` - png file
├── `qa-s5.1-reentered-session.png` - png file
├── `qa-scrolled-bottom.md` - No description
├── `qa-session-autoreturn.png` - png file
├── `qa-session-back.png` - png file
├── `qa-session-desktop.png` - png file
├── `qa-session-latex-view.png` - png file
├── `qa-session-orchestrator.png` - png file
├── `qa-session-overview.png` - png file
├── `qa-session-view.png` - png file
├── `qa-sidebar-after-pop-scroll-preserved.png` - png file
├── `qa-sidebar-after-push.png` - png file
├── `qa-sidebar-before-subtool-click.png` - png file
├── `qa-sidebar-content-click-no-push.png` - png file
├── `qa-sidebar-content-interaction-test.png` - png file
├── `qa-sidebar-opened.png` - png file
├── `qa-sidebar-scroll-15k.md` - No description
├── `qa-sidebar-scroll-4000.png` - png file
├── `qa-sidebar-scrolled-before-push.png` - png file
├── `qa-sidebar-snapshot.md` - No description
├── `qa-sidebar-subtool-area.png` - png file
├── `qa-sidebar-subttools-desktop.png` - png file
├── `qa-sidebar-todo-colors.png` - png file
├── `qa-sidebar-todowrite-check.png` - png file
├── `qa-subtool-click-result.png` - png file
├── `qa-task-detail-view.png` - png file
├── `qa-tc1-detail-page.png` - png file
├── `qa-tc2-sidebar-open.png` - png file
├── `qa-tc5-mobile-sidebar.png` - png file
├── `qa-tc6-agent-sidebar-placeholder.png` - png file
├── `qa-todo-bash-inline.png` - png file
├── `qa-todo-sidebar.png` - png file
├── `screenshot-01-initial-state.png` - png file
├── `screenshot-01-initial.png` - png file
├── `screenshot-02-loading.png` - png file
├── `screenshot-02-session-opened.png` - png file
├── `screenshot-03-new-session-form.png` - png file
├── `screenshot-03-session-click.png` - png file
├── `screenshot-04-direct-nav.png` - png file
├── `screenshot-04-localhost8097.png` - png file
├── `screenshot-05-new-form-direct.png` - png file
├── `screenshot-05-scrolled-top.png` - png file
├── `screenshot-06-agent-card-clicked.png` - png file
├── `screenshot-06-before-redirect.png` - png file
├── `screenshot-07-sidebar-scrolled.png` - png file
├── `screenshot-07-stable-happy-app.png` - png file
├── `screenshot-08-new-session-form.png` - png file
├── `screenshot-08-sidebar-bottom.png` - png file
├── `screenshot-09-back-to-session.png` - png file
├── `screenshot-09-production-sessions.png` - png file
├── `screenshot-10-after-back.png` - png file
├── `screenshot-10-session-open.png` - png file
├── `screenshot-11-message-typed.png` - png file
├── `screenshot-11-session-view.png` - png file
├── `screenshot-12-message-sent.png` - png file
├── `screenshot-12-scrolled-up.png` - png file
├── `screenshot-13-qa-card-clicked.png` - png file
├── `screenshot-13-task-detail-view.png` - png file
├── `screenshot-14-mobile-session.png` - png file
├── `screenshot-14-qa-sidebar-bottom.png` - png file
├── `screenshot-15-back-attempt.png` - png file
├── `screenshot-15-mobile-home-tabs.png` - png file
├── `screenshot-16-new-session-form-mobile.png` - png file
├── `screenshot-17-empty-send-test.png` - png file
├── `session-scrolled-top.png` - png file
├── `session-top.png` - png file
├── `session-view-desktop.png` - png file
├── `session-view-initial.png` - png file
├── `sessions-list-view.png` - png file
├── `sidebar-agent-card.png` - png file
├── `sidebar-scrolled-bottom.png` - png file
├── `sidechain-after-test.png` - png file
├── `sidechain-before-test.png` - png file
├── `sidechain-dialog-open.png` - png file
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
├── `tmp-test-edit.ts` - ts file
├── `tool-render-demo-playwright.png` - png file
├── `tool-rendering-demo.png` - png file
├── `tools2-initial.png` - png file
├── `tools2-permission-states.png` - png file
├── `tools2-status-icons.png` - png file
├── `ui-specialist-desktop-codex-fixtures.png` - png file
├── `ui-specialist-desktop-dev-tools2.png` - png file
├── `ui-specialist-desktop-tool-cards.png` - png file
├── `ui-specialist-desktop-tool-rendering-current.png` - png file
├── `ui-specialist-mobile-codex-fixtures-image-diff-fallback.png` - png file
├── `ui-specialist-mobile-codex-fixtures-mcp.png` - png file
├── `ui-specialist-mobile-codex-fixtures-table-terminal.png` - png file
├── `ui-specialist-mobile-codex-fixtures-top.png` - png file
├── `ui-specialist-mobile-dev-tools2-cards.png` - png file
├── `ui-specialist-mobile-dev-tools2.png` - png file
├── `ui-specialist-mobile-session-fix-tool-cards.png` - png file
├── `ui-specialist-mobile-spec-current.png` - png file
├── `ui-specialist-mobile-start.md` - No description
├── `ui-specialist-mobile-subagent-cards.png` - png file
├── `ui-specialist-mobile-tool-cards.png` - png file
├── `ui-specialist-mobile-tool-rendering-current.png` - png file
├── `ui-specialist-mobile-view-image-fixture-scrolled.png` - png file
├── `ui-specialist-mobile-view-image-fixture.png` - png file
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
├── `user-codex-render-fixtures-top-mobile.png` - png file
├── `user-tool-demo-page-mobile.png` - png file
├── `user-tool-rendering-after-wait-mobile.png` - png file
├── `user-tool-rendering-current-mobile-top.png` - png file
├── `user-tool-rendering-fix-session-mobile.png` - png file
├── `user-tool-rendering-screenshot-attachment-preview.png` - png file
└── `yarn.lock` - lock file
```

---
*Auto-generated by doc-sync hook.*