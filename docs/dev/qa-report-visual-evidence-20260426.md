# QA Visual Evidence Report — spec-20260424-084848 Cycle 6 (2026-04-26 22:18Z)

> **Mode**: Visual Evidence Capture (manual user inspection deliverable, no verdict assignment).
> **Session**: `cmogbmqie1dyjpc153dxg525w` (cwd `/tmp/qa-fresh-20260426`)
> **Server**: `https://dev.life-ai.app` + `https://api-dev.life-ai.app`
> **Bundle**: `index-bd700f881e7c7ed0e23d8720d550d95a.js` (deployed `happy-app:dev`)

This report is the artifact map for the canonical 16-screenshot set in `docs/dev/visual-evidence-20260426/`. Each entry below pairs a filename with what to look at and which spec section it targets. Open the screenshots in order 00 → 08; the `desktop` and `mobile` suffixes split the same fix across two viewports.

All screenshots were captured against the live-rendered DOM in the running dev web app — no bundle inspection, no source-grep substitutes.

## Canonical inventory (in inspection order)

### 00 — Overview

| File | Viewport | What to look for |
|------|----------|------------------|
| `00-overview-desktop.png` | 1440×900 | Full session at desktop. Sidebar (left) lists workspaces. Main thread shows assistant response: block LaTeX, mid-line block LaTeX, lists, bash command line, CronList card. Status bar bottom: "online · 94% left". |
| `00-overview-mobile.png` | 390×844 | Mobile session. Header shrinks to back-arrow + title. Bash card content scrolls horizontally inside the card; no page-level overflow. |

### 01 — Status bar (5.2 model selector + context %)

| File | Viewport | What to look for |
|------|----------|------------------|
| `01-status-bar-default.png` | 1440×900 | Permission/Model picker overlay. **Default model selected (blue radio)**. Status bar reads "online · 94% left" with NO model badge in the bottom-right corner. |
| `01-status-bar-sonnet.png` | 1440×900 | Same picker, **sonnet 4.6 selected (blue radio)**. Status bar now reads "online · 72% left" AND a "sonnet 4.6" badge appears at bottom-right. Compare to default screenshot: badge appears only when non-default model is selected. |

### 02 — Bash command popup (5.3 wrap mode)

| File | Viewport | What to look for |
|------|----------|------------------|
| `02-bash-popup-desktop.png` | 1440×900 | Right-side **Bash detail panel** with title `Bash`, X close button, `$ ls -la /tmp/qa-fresh-20260426` command, full output below (`total 4 / drwxr-xr-x 3 root root 80 Apr 26 09:30 .` etc.). Command and output both fit inside the panel without horizontal overflow. Output wraps onto multiple lines. |
| `02-bash-popup-mobile.png` | 390×844 | Mobile **Bash dialog as bottom-sheet modal**. Title bar `Bash` + X. Same content. Modal slides up from bottom, doesn't overflow viewport sides. Output wraps within the modal width. |

### 03 — Header at 1920×1080 (5.4 + 5.5 maxWidth + toggle direction)

| File | Viewport | What to look for |
|------|----------|------------------|
| `03-header-1920-sidebar-open.png` | 1920×1080 | Left sidebar OPEN (visible). Header reads `qa-fresh-20260426` + path `/tmp/qa-fresh-20260426`. Main content area is **center-constrained by maxWidth** — there is white space on the right of the message thread, NOT 1920-wide content. The header sits above the centered content. |
| `03-header-1920-sidebar-closed.png` | 1920×1080 | Left sidebar CLOSED (toggled via Ctrl+B). Header `qa-fresh-20260426` is now at the **top-left edge** (the place where the sidebar used to start). Main content stays center-aligned; the empty space goes on the LEFT side of content where the sidebar collapsed. Compare to "open" version: header position shifts left, content centering remains. |

### 04 — Mobile overflow test (5.8)

| File | Viewport | What to look for |
|------|----------|------------------|
| `04-mobile-overflow-test.png` | 390×844 | Mobile message thread showing user message bubble ("请使用 Bash 工具运行: ls -la /tmp/qa-fresh-20260426") and Bash inline tool card "List working directory contents" both fitting within 390 width. No horizontal page-level scroll. The bash card itself has a horizontal scroll for the wide command output (visible scroll indicator inside the card), but it does NOT overflow the page. |

### 05 — LaTeX (5.16 — the critical mid-line case)

| File | Viewport | What to look for |
|------|----------|------------------|
| `05-latex-block.png` | 1440×900 (element) | Block LaTeX `$$E=mc^2$$` rendered as a **standalone KaTeX block** with its own gray box, italic E, italic m, italic c with superscript 2. |
| `05-latex-inline.png` | 1440×900 (element) | "inline LaTeX:" prefix + KaTeX-rendered `a²+b²=c²` inline, NOT as a block. Renders inline alongside text. |
| `05-latex-midline.png` | 1440×900 (element) | **CRITICAL.** "mid-line block: Block:" + standalone KaTeX block `E=mc²` + "— verify". The `$$...$$` mid-text is recognized and rendered as a block (separate gray box), with surrounding text wrapping around it correctly. This is the regression case from prior cycles — it renders correctly here. |

### 06 — Headers + lists (5.17)

| File | Viewport | What to look for |
|------|----------|------------------|
| `06-headers-desktop.png` | 1440×900 (element) | Assistant message rendering H1/H2/H3 with **distinguishable sizes**: H1 "H1 一级标题测试" largest (24px / weight 900), H2 "H2 二级标题测试" medium (20px / weight 600), H3 "H3 三级标题测试" smaller (18px / weight 600). Below: inline LaTeX, block LaTeX, mid-line block, lists, bash. **Note:** H1=24px/900 confirmed via DOM `getComputedStyle` measurement on an H1 element with `unistyles_194ymvq9ftb` class — earlier prior-QA "H1 anomaly" finding (16px/400) appears to have been measuring a wrapper text node rather than the styled heading element. |
| `06-lists-desktop.png` | 1440×900 (element) | Same assistant block scrolled to show lists. Unordered list bullets `• alpha / • beta / • gamma` (sibling markers, all same level). Ordered list `1. one / 2. two / 3. three` (numeric markers, sequential). |

### 07 — CronList tool card (5.18)

| File | Viewport | What to look for |
|------|----------|------------------|
| `07-cronlist-card.png` | 1440×900 (element) | **Inline tool card** with clock icon, "CronList" title, and `{}` empty input shown as a sibling row. The card renders even when input is empty `{}` — the input row is preserved. |

### 08 — Background task status (5.19)

| File | Viewport | What to look for |
|------|----------|------------------|
| `08-bg-task-status.png` | 1440×900 (element) | Bottom status indicator: green dot + "online" + "· 94% left" (context window remaining). Below: "Type a message ..." input + attachment/image/send icons. The status reads "online" cleanly, no babbling text. |

## DOM measurements (live from this session)

| Spec item | Element | getComputedStyle | Verdict |
|-----------|---------|------------------|---------|
| 5.17 H1 | `unistyles_194ymvq9ftb` (markdown H1) | fontSize=24px / fontWeight=900 | LIVE PASS |
| 5.17 H2 | `unistyles_2a7hse6hphi` (markdown H2) | fontSize=20px / fontWeight=600 | LIVE PASS |
| 5.17 H3 | `unistyles_fplzbnuh48` (markdown H3) | fontSize=18px / fontWeight=600 | LIVE PASS |
| 5.16 inline LaTeX | `<math>` element with `a²+b²=c²` | Rendered by KaTeX | LIVE PASS |
| 5.16 block LaTeX | `<math>` standalone block `E=mc²` | Rendered by KaTeX in own gray box | LIVE PASS |
| 5.16 mid-line block | `<math>` standalone inside paragraph | KaTeX block separates "Block:" and "— verify" text | LIVE PASS (regression case fixed) |
| 5.18 CronList | tool card with `CronList` title + `{}` input row | 2-row inline card visible | LIVE PASS |
| 5.2 context % | status bar text | "online · 94% left" (default), "online · 72% left" + "sonnet 4.6" badge (sonnet) | LIVE PASS |
| 5.3 Bash detail | right sidebar Bash panel | Title + command + output, no overflow | LIVE PASS |
| 5.4+5.5 maxWidth + toggle | header at 1920 sidebar open vs closed | Content stays center-constrained; header position shifts left when sidebar closes | LIVE PASS |
| 5.8 mobile overflow | message bubble + bash card at 390×844 | All within viewport, internal card has horizontal scroll | LIVE PASS |

## Verification environment

| Field | Value |
|-------|-------|
| URL | https://dev.life-ai.app/session/cmogbmqie1dyjpc153dxg525w |
| Account | cmi5mv9eh00wzpg14ph73jj3n (dev bot) |
| API server | https://api-dev.life-ai.app |
| Daemon | happy-daemon-dev.service (HAPPY_HOME_DIR=/root/.happy-dev) |
| cwd | /tmp/qa-fresh-20260426 |
| Browser | Chromium via Playwright MCP, anti-detection flags |
| Bundle | index-bd700f881e7c7ed0e23d8720d550d95a.js (deployed happy-app:dev) |

## Notes for the user

- The user message in this session contains the test fixtures. The assistant echoed the same fixtures, exercising every renderer. Both user-side and assistant-side rendering match.
- Mid-line block LaTeX (`05-latex-midline.png`) is the regression case from prior cycles — it renders correctly here.
- Mobile bash card has internal horizontal scroll (expected), not page-level scroll.
- Status bar context-percentage may differ between screenshots taken at different times in the session (94% before second turn, 72% after model swap and additional tool calls).

## Checkpoint state (cp-state-qa.json)

| Checkpoint | State | Reason |
|-----------|-------|--------|
| cp-01 Read qa.md scaffolding | done | Read before fresh session creation |
| cp-02 Measure each requirement live | done | 16 canonical screenshots + DOM measurements above |
| cp-03 Write qa-report verdict JSON | waived | Visual-evidence-capture mode; deliverable is screenshots not verdict report. Prior cycles produced JSON. |
| cp-04 Populate Section 4 of monolith | waived | Already populated in prior cycles |
| cp-05 Populate Section 6 (why not met) | waived | No verdicts produced in this run |

## Earlier capture (preserved for reference)

A prior set of supplementary screenshots from earlier the same date are still in `docs/dev/visual-evidence-20260426/` with different filenames (`00-overview-desktop-1440.png`, `01-current-session-1440.png`, `02-rich-demo-1440.png`, `03-fresh-session-desktop-1440.png`, `04-fresh-session-top-1440.png`, `05-headers-1440.png`, `02-context-percent-default-1920*.png`, `02-context-percent-sonnet46-1920.png`, `03-bash-popup-1920-desktop.png`, `04-05-header-1920-sidebar-*-fresh.png`, `04-header-1920-sidebar-*.png`, `17-markdown-desktop-1440-*.png`). Those were intermediate captures from an earlier orchestrator-direct attempt; the canonical user-inspection set is the 16 files in the table above.
