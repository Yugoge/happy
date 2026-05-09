# Cycle 7 — AC10 Evidence (B3 #13 nested ordered lists)

**Spec**: docs/dev/specs/spec-20260509-152243/ba-spec-20260509-152243.md
**Saga**: spec-20260506-203755 — Cycle 7 (Phase B-1)

## What landed

### Type extension (additive, no break)

**File**: `packages/happy-app/sources/components/markdown/parseMarkdown.ts:14-15`

```ts
} | {
    type: 'numbered-list',
    items: { number: number, depth: number, spans: MarkdownSpan[] }[]
}
```

`depth` is **required** in the type — but because all parsed items now carry `depth: 0` for previously-flat lists, all existing call sites are NOT broken (the existing flat fixture continues to pass without assertion changes).

### Parser change

**File**: `packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts:216-235` (function `tryNumberedList`)

- Function signature changed from `(ctx, trimmed: string)` to `(ctx, line: string)` — raw line preserves leading whitespace needed for depth detection.
- Regex updated to `/^(\s*)(\d+)\.\s(.*)$/` (group 1 = whitespace, group 2 = number, group 3 = content).
- `depth = Math.min(Math.floor(indent / 2), 6)` — exactly mirrors `parseListItemLine` at line 20 (UL pattern). Two-space indent = one depth level; cap at 6.
- Continuation loop now matches `ctx.lines[ctx.index]` (raw, not trimmed) so continuation items also detect their indent.
- Empty lines / paragraphs still terminate the list (regex fails on blank lines because `\d+\.\s` cannot match an empty trailing string after the whitespace group).

Dispatch in `parseSingleLine` (line 269 post-edit) updated to pass `line` instead of `trimmed`.

### Render handler

**File**: `packages/happy-app/sources/components/markdown/MarkdownView.tsx:208-219`

`RenderNumberedListBlock` props type extended with `depth: number`. The list-item `<View>` style adds `paddingLeft: item.depth * 16` — exactly mirrors `RenderListBlock` at line 178. **No new lines added; impact = 0 LOC for MarkdownView.tsx (still 755 lines, well under the 800 cap).**

## Test verification

`packages/happy-app/sources/components/markdown/parseMarkdown.test.ts:160-184` — new fixture:

```ts
it('captures depth on nested ordered list items while preserving flat-list spans and links', () => {
    const blocks = parseMarkdown([
        '1. outer first',
        '2. outer second with [docs](https://example.com)',
        '   1. inner first',
        '   2. inner second',
        '3. outer third',
    ].join('\n'));
    // ... asserts items.length===5, numbers=[1,2,1,2,3], depths=[0,0,1,1,0],
    // and that the inline link in item[1] still parses with url=https://example.com
});
```

`yarn vitest run sources/components/markdown/parseMarkdown.test.ts`:
- 7 existing fixtures PASS unchanged (AC-NONREG-PARSER preserved)
- 1 new B3 fixture PASS (covers depth = [0,0,1,1,0] + inline link in item[1] = nested + spans)

## Non-regression specifically for the existing flat numbered-list fixture (line 152)

The existing `it('covers shared parser call sites without raw delimiter leakage')` at lines 129-158 contains:

```ts
const numberedBlocks = parseMarkdown('1. ***first*** then ~~strike~~');
expect(numberedBlocks[0]?.type).toBe('numbered-list');
if (numberedBlocks[0]?.type === 'numbered-list') {
    expect(numberedBlocks[0].items[0].number).toBe(1);
    expect(expectSpan(numberedBlocks[0].items[0].spans, 'strike').styles).toEqual(['strikethrough']);
}
```

Through the new parser:
- regex `/^(\s*)(\d+)\.\s(.*)$/` matches `'1. ***first*** then ~~strike~~'` with indent=`''`, number=`1`, content=`'***first*** then ~~strike~~'`.
- `depth = Math.min(Math.floor(0/2), 6) = 0`.
- `items[0]` becomes `{ number: 1, depth: 0, spans: [...] }`.
- `expect(items[0].number).toBe(1)` PASSES.
- `expect(expectSpan(...).styles).toEqual(['strikethrough'])` PASSES (spans tokenizer is unchanged).

The fixture is invariant under the additive `depth` field.

## Stop-on-blocker check

Per BA spec § Phase B Execution Constraints (constraint 3): if B3 reveals a structural blocker requiring non-additive changes to `numbered-list` shape or breaking the existing flat fixture, dev STOPS and emits clarification. **No blocker encountered.** The depth field is purely additive; the existing fixture passes unchanged; the LOC budget is preserved (MarkdownView.tsx 755 → 755).
