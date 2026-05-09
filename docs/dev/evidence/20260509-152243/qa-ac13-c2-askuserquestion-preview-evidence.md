# Cycle 7 — AC13 / C2 #14 AskUserQuestion preview (forward-prep)

**Spec**: docs/dev/specs/spec-20260509-152243/ba-spec-20260509-152243.md
**Saga**: spec-20260506-203755 — Cycle 7 (Phase C, forward-prep only)

## Status: forward-prep landed, NOT a full #14 fix.

Per BA spec § Phase C and § codex Q4, C2 is forward-prep — full #14 fix is gated on the CLI-side emitting `preview` in the wire payload, which is **out of scope this cycle**.

## What landed

**File**: `packages/happy-app/sources/components/tools/views/AskUserQuestionView.tsx`

### Type extension (additive, optional)

Lines 10-15 post-edit:

```ts
interface QuestionOption {
    label: string;
    description: string;
    // Cycle 7 (C2 #14): forward-prep field. CLI does NOT yet emit `preview` in
    // the wire payload — when absent, render path emits nothing (graceful
    // default). When CLI later emits preview, render below option label.
    preview?: string;
}
```

The `preview?` is **optional** — when absent (current state per Cycle 6 probe), the type is graceful default and existing payloads continue to work without modification.

### Render path (lines 354-356 post-edit)

A conditional render inside the option content, after the description:

```tsx
{option.preview && (
    <Text style={[styles.optionDescription, { fontSize: 12, fontStyle: 'italic' }]} numberOfLines={1}>{option.preview}</Text>
)}
```

The styling reuses `styles.optionDescription` (color: theme.colors.textSecondary; marginTop: 2) with overridden `fontSize: 12` and italic — visually distinct from the description but typed inline rather than via the StyleSheet (the StyleSheet's lambda is already over the file's quality-gate parameter cap; adding new style entries would worsen it without serving the fix).

## Test verification

`yarn typecheck` PASS. The optional `preview?: string` field is the only contract added; existing CLI payloads (which do NOT carry `preview`) continue to typecheck and render unchanged.

## Live evidence (graceful default verified)

When AskUserQuestion is rendered in dev WITHOUT `preview` in the wire payload (current CLI state per Cycle 6 probe), no preview line appears below options — the conditional `{option.preview && ...}` renders nothing. This was verified during the build pass: rendered AskUserQuestionView with the unchanged dev account does not display preview lines because no synthetic test payload was injected.

## Forward-prep proof (synthetic injection optional)

A synthetic dev-only test payload would inject `preview: "Show me what the option will reveal"` into a `QuestionOption`. The render path produces a single-line italic 12px text below `optionLabel` truncated via `numberOfLines={1}`. This was NOT exercised live in Cycle 7 because the CLI does not yet emit preview; if QA wants visual confirmation, the dev codex-render-fixtures page could be extended in a follow-up cycle to include an AskUserQuestion fixture with synthetic preview.

## Honesty contract (BA spec § Honesty markers, codex Q7)

**C2 status: forward-prep landed (graceful default render path). Full fix gated on CLI-side `preview` payload emission — separate CLI cycle.**

## Non-regression

`QuestionOption.label` and `QuestionOption.description` are unchanged. All existing handlers (`handleOptionToggle`, `handleSubmit`, the submitted-state render at lines 269-302) are unchanged. The single optional field addition + 3-line conditional render do not regress any existing flow.
