# Continuation Spec — Cycle 9 (post Cycle 8 CLOSE: NO)

**Predecessor**: task-id 20260509-225006 (Cycle 8 — Parser slice)
**Predecessor close-report**: `docs/dev/close-report-20260509-225006.md` (CLOSE: NO)
**Saga**: `spec-20260506-203755` (the 17-bug rendering audit) — **NOT YET CLOSED**

## Why Cycle 8 was rejected

QA + dev attested PASS. Codex close-debate caught 4 issues, all confirmed by file-level inspection + reproducer fixtures:

### CR-1 (NEW REGRESSION) — Code-block content mutation by def-extractor
**File**: `packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts:364-386` (`extractDefinitions`)
**Bug**: pre-pass walks ALL lines and removes lines matching `LINK_DEF_RE` / `FOOTNOTE_DEF_RE`, with NO code-fence state tracking. A line like `[ref]: url` inside a fenced code block gets stripped → code block content silently mutated.
**Severity**: HIGH — this is a NEW regression introduced by THIS cycle. Any message containing fenced code with reference-link-shaped strings (common in markdown tutorials, README snippets) will render incorrectly.
**Fix**: track ``` ` ``` fence state in `extractDefinitions`; skip def-line pruning when inside a fenced code block.
**Test**: fixture asserting `\`\`\`\n[ref]: url\n\`\`\`` produces a `code-block` block with verbatim content `[ref]: url`.

### CR-2 — Compact `<details>` falls through
**File**: `packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts:330` (`findDetailsClose`)
**Bug**: scan starts at `lineStartIndex+1`, so single-line `<details><summary>x</summary>body</details>` never matches `</details>` close → falls through to text parser, renders literally.
**Severity**: USER-NEED for #9 (BA spec §10 AC-9-HTML-DETAILS doesn't restrict to multi-line).
**Fix**: scan from `lineStartIndex` (inclusive); detect inline-close-on-same-line.
**Test**: fixture for compact form `<details open><summary>S</summary>B</details>`.

### CR-3 — sub/sup styles byte-identical
**File**: `packages/happy-app/sources/components/markdown/MarkdownView.tsx:524-525`
**Bug**: BA spec §11 specified `transform: [{ translateY: -4 }]` for sup and `[{ translateY: +4 }]` for sub. Both styles currently lack this transform → render byte-identically. User cannot distinguish `H<sub>2</sub>O` from `H<sup>2</sup>O`.
**Severity**: USER-NEED for #9 (renders both ways look the same).
**Fix**: add the transforms per BA spec §11. Also reduce font-size (~0.75em) per typographic convention.
**Test**: fixture asserting AC-9-HTML-SUB and AC-9-HTML-SUP produce different style payloads (not just different style names).

### CR-4 — i18n violation on footnote modal title
**File**: `packages/happy-app/sources/components/markdown/MarkdownInlineDecorations.tsx:42`
**Bug**: `Modal.alert(\`Footnote ${label}\`, ...)` — hardcoded English string violates CLAUDE.md "Never hardcode strings in JSX - always use t('key')" rule.
**Severity**: CLEANLINESS-OF-THIS-DIFF (the violation was introduced by Cycle 8).
**Fix**: add `t('markdown.footnoteTitle', { label })` translation key to all 9 language files; replace hardcode.
**Test**: existing i18n-checker pass (or visual confirmation in Chinese mode).

## Cycle 9 scope

Fix all 4 issues above. No new features. No scope expansion. Acceptance:

- AC-CR1-CODE-FENCE-PROTECTED: fixture passes (def line inside fenced code preserved)
- AC-CR2-DETAILS-COMPACT: fixture passes (single-line `<details>` parses as block)
- AC-CR3-SUB-SUP-DISTINCT: fixture asserts non-byte-identical style payloads + transform present
- AC-CR4-I18N-FOOTNOTE: hardcoded title replaced by `t(...)` call across all 9 language files
- All 27 existing fixtures still green
- All 11 cumulative AC-NONREG-* still hold
- MarkdownView.tsx ≤ 800 lines
- typecheck clean for markdown layer

## Saga state after Cycle 9 PASS

If Cycle 9 lands cleanly: 19/19 catalog rows DONE + #6 permanent out-of-saga = saga finally closes.

## Next action

`/dev --spec docs/dev/specs/spec-20260509-225006/continuation-cycle9.md` (or `/redev` since this session has the spec context)
