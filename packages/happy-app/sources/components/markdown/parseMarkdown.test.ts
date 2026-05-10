import { describe, expect, it } from 'vitest';
import { MarkdownSpan, parseMarkdown } from './parseMarkdown';

function expectTextBlock(markdown: string): MarkdownSpan[] {
    const blocks = parseMarkdown(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('text');
    if (blocks[0]?.type !== 'text') {
        throw new Error('Expected markdown text block');
    }
    return blocks[0].content;
}

function expectSpan(spans: MarkdownSpan[], text: string) {
    const span = spans.find(s => s.text === text);
    expect(span).toBeTruthy();
    return span!;
}

describe('parseMarkdown', () => {
    it('parses unordered lists across common markdown bullet markers and preserves clickable links', () => {
        const blocks = parseMarkdown([
            '* first item',
            '+ second item with [docs](https://example.com/docs)',
            '- third item with https://example.com/raw.',
        ].join('\n'));

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('list');

        if (blocks[0]?.type !== 'list') {
            throw new Error('Expected markdown list block');
        }

        expect(blocks[0].items).toHaveLength(3);
        expect(blocks[0].items[1].spans).toEqual([
            { styles: [], text: 'second item with ', url: null },
            { styles: [], text: 'docs', url: 'https://example.com/docs' },
        ]);
        expect(blocks[0].items[2].spans).toEqual([
            { styles: [], text: 'third item with ', url: null },
            { styles: [], text: 'https://example.com/raw', url: 'https://example.com/raw' },
            { styles: [], text: '.', url: null },
        ]);
    });

    it('parses standalone markdown image blocks', () => {
        const blocks = parseMarkdown('![Markdown renderable image](data:image/png;base64,abc123)');

        expect(blocks).toEqual([
            {
                type: 'image',
                alt: 'Markdown renderable image',
                url: 'data:image/png;base64,abc123',
            },
        ]);
    });

    it('auto-linkifies bare URLs in text blocks', () => {
        const blocks = parseMarkdown('Visit https://example.com/docs for more.');

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('text');

        if (blocks[0]?.type !== 'text') {
            throw new Error('Expected markdown text block');
        }

        expect(blocks[0].content).toEqual([
            { styles: [], text: 'Visit ', url: null },
            { styles: [], text: 'https://example.com/docs', url: 'https://example.com/docs' },
            { styles: [], text: ' for more.', url: null },
        ]);
    });

    it('keeps emphasis bounded before strikethrough, links, code, and escapes', () => {
        const spans = expectTextBlock('***bold italic*** then ~~strike~~ and [link](https://example.com) and `code` and \\*literal\\*');

        expect([...expectSpan(spans, 'bold italic').styles].sort()).toEqual(['bold', 'italic']);
        expect(expectSpan(spans, 'strike').styles).toEqual(['strikethrough']);
        expect(expectSpan(spans, 'link').url).toBe('https://example.com');
        expect(expectSpan(spans, 'code').styles).toEqual(['code']);
        expect(spans.map(s => s.text).join('')).toContain('*literal*');
        expect(spans.filter(s => s.text.includes(' then ') || s.text.includes(' and ')).every(s => s.styles.length === 0)).toBe(true);
    });

    it('preserves existing inline primitive boundaries', () => {
        expect(expectSpan(expectTextBlock('Inline math $E=mc^2$ after.'), 'E=mc^2').latex).toBe(true);

        const kbdSpans = expectTextBlock('<kbd>Ctrl</kbd> + <kbd>C</kbd>');
        expect(expectSpan(kbdSpans, 'Ctrl').styles).toEqual(['kbd']);
        expect(expectSpan(kbdSpans, 'C').styles).toEqual(['kbd']);
        expect(kbdSpans.map(s => s.text).join('')).not.toContain('<kbd>');

        expect(expectTextBlock('Visit https://example.com/docs.')).toEqual([
            { styles: [], text: 'Visit ', url: null },
            { styles: [], text: 'https://example.com/docs', url: 'https://example.com/docs' },
            { styles: [], text: '.', url: null },
        ]);

        const codeSpans = expectTextBlock('`**not bold** [not](https://bad.example)` then **bold**');
        expect(codeSpans[0]).toEqual({ styles: ['code'], text: '**not bold** [not](https://bad.example)', url: null });
        expect(expectSpan(codeSpans, 'bold').styles).toEqual(['bold']);

        const escapeSpans = expectTextBlock('Escaped \\*literal\\* and \\[not a link](https://example.com)');
        expect(escapeSpans.map(s => s.text).join('')).toBe('Escaped *literal* and [not a link](https://example.com)');
        expect(escapeSpans.every(s => s.url === null && !s.styles.includes('italic'))).toBe(true);
    });

    it('keeps table data shape while allowing render-time inline parsing', () => {
        const blocks = parseMarkdown([
            '| Format | SuperWide | Empty |',
            '| --- | --- | --- |',
            '| **bold** ~~strike~~ [link](https://example.com) `code` | WIDE_TABLE_SENTINEL_ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ | |',
        ].join('\n'));

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('table');
        if (blocks[0]?.type !== 'table') {
            throw new Error('Expected markdown table block');
        }
        expect(blocks[0].headers).toEqual(['Format', 'SuperWide', 'Empty']);
        expect(blocks[0].rows).toHaveLength(1);
        expect(blocks[0].rows[0]).toHaveLength(3);
        expect(blocks[0].rows[0][0]).toBe('**bold** ~~strike~~ [link](https://example.com) `code`');
        expect(blocks[0].rows[0][2]).toBe('');
    });

    it('covers shared parser call sites without raw delimiter leakage', () => {
        const headerBlocks = parseMarkdown('# ***Heading*** then [docs](https://example.com) and `code`');
        expect(headerBlocks[0]?.type).toBe('header');
        if (headerBlocks[0]?.type === 'header') {
            expect(expectSpan(headerBlocks[0].content, 'docs').url).toBe('https://example.com');
            expect(expectSpan(headerBlocks[0].content, 'code').styles).toEqual(['code']);
            expect(headerBlocks[0].content.map(s => s.text).join('')).not.toContain('***');
        }

        const listBlocks = parseMarkdown('- ***item*** then ~~strike~~ and [docs](https://example.com)');
        expect(listBlocks[0]?.type).toBe('list');
        if (listBlocks[0]?.type === 'list') {
            expect(expectSpan(listBlocks[0].items[0].spans, 'strike').styles).toEqual(['strikethrough']);
            expect(expectSpan(listBlocks[0].items[0].spans, 'docs').url).toBe('https://example.com');
        }

        const taskBlocks = parseMarkdown('- [x] ***done*** then `code`');
        expect(taskBlocks[0]?.type).toBe('task-list');
        if (taskBlocks[0]?.type === 'task-list') {
            expect(taskBlocks[0].items[0].checked).toBe(true);
            expect(expectSpan(taskBlocks[0].items[0].spans, 'code').styles).toEqual(['code']);
        }

        const numberedBlocks = parseMarkdown('1. ***first*** then ~~strike~~');
        expect(numberedBlocks[0]?.type).toBe('numbered-list');
        if (numberedBlocks[0]?.type === 'numbered-list') {
            expect(numberedBlocks[0].items[0].number).toBe(1);
            expect(expectSpan(numberedBlocks[0].items[0].spans, 'strike').styles).toEqual(['strikethrough']);
        }
    });

    // Cycle 7 (B3 #13): nested ordered lists carry depth derived from leading
    // whitespace — depth = floor(indent / 2), capped at 6 (mirrors parseListItemLine).
    // Render handler in MarkdownView indents items by depth * 16 px.
    it('captures depth on nested ordered list items while preserving flat-list spans and links', () => {
        const blocks = parseMarkdown([
            '1. outer first',
            '2. outer second with [docs](https://example.com)',
            '   1. inner first',
            '   2. inner second',
            '3. outer third',
        ].join('\n'));

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('numbered-list');
        if (blocks[0]?.type !== 'numbered-list') {
            throw new Error('Expected markdown numbered-list block');
        }

        const items = blocks[0].items;
        expect(items).toHaveLength(5);
        expect(items.map(i => i.number)).toEqual([1, 2, 1, 2, 3]);
        expect(items.map(i => i.depth)).toEqual([0, 0, 1, 1, 0]);
        expect(expectSpan(items[1].spans, 'docs').url).toBe('https://example.com');
    });

    // ---------------------------------------------------------------------
    // Cycle 8 — Parser slice (saga closer)
    //   #10 reference-style links, #11 footnotes, #9 HTML inline + <details>
    // ---------------------------------------------------------------------

    // AC-10-REFLINK-PARSE
    it('parses full reference-style links with definition', () => {
        const spans = expectTextBlock('See [docs][ref] for more.\n\n[ref]: https://example.com/docs');
        expect(expectSpan(spans, 'docs').url).toBe('https://example.com/docs');
        expect(spans.map(s => s.text).join('')).not.toContain('[ref]:');
        expect(spans.map(s => s.text).join('')).not.toContain('[ref]');
    });

    // AC-10-REFLINK-COLLAPSED
    it('parses collapsed reference-style links', () => {
        const spans = expectTextBlock('See [docs][] now.\n\n[docs]: https://example.com/docs');
        expect(expectSpan(spans, 'docs').url).toBe('https://example.com/docs');
    });

    // AC-10-REFLINK-SHORTCUT
    it('parses shortcut reference-style links', () => {
        const spans = expectTextBlock('See [docs] now.\n\n[docs]: https://example.com/docs');
        expect(expectSpan(spans, 'docs').url).toBe('https://example.com/docs');
    });

    // AC-10-REFLINK-NOMATCH
    it('renders unmatched reference link as literal text', () => {
        const spans = expectTextBlock('See [text][missing] now.');
        expect(spans.map(s => s.text).join('')).toContain('[text][missing]');
        expect(spans.every(s => s.url === null)).toBe(true);
    });

    // AC-10-REFLINK-CASE
    it('normalizes reference label by lowercasing and whitespace collapse', () => {
        const spans = expectTextBlock('[Ref Label][REF  LABEL]\n\n[ref label]: https://example.com');
        expect(expectSpan(spans, 'Ref Label').url).toBe('https://example.com');
    });

    // AC-11-FOOTNOTE-INLINE + AC-11-FOOTNOTE-DEF (combined per AC table)
    it('parses inline footnote reference to chip span and captures definition', () => {
        const result = parseMarkdown('See more[^1] here.\n\n[^1]: details here.');
        expect(result).toHaveLength(1);
        expect(result[0]?.type).toBe('text');
        if (result[0]?.type !== 'text') throw new Error('Expected text block');
        const chip = result[0].content.find(s => s.styles.includes('footnote-ref'));
        expect(chip).toBeTruthy();
        expect(chip!.footnoteLabel).toBe('1');
        expect(result[0].content.map(s => s.text).join('')).not.toContain('[^1]:');
        expect(result.footnotes.has('1')).toBe(true);
        expect(result.footnotes.get('1')!.map(s => s.text).join('')).toBe('details here.');
    });

    // AC-11-FOOTNOTE-NOMATCH
    it('renders unmatched footnote reference as literal text', () => {
        const spans = expectTextBlock('See [^X] here.');
        expect(spans.map(s => s.text).join('')).toContain('[^X]');
        expect(spans.every(s => !s.styles.includes('footnote-ref'))).toBe(true);
    });

    // AC-11-FOOTNOTE-MULTIPLE
    it('handles multiple footnotes with distinct labels', () => {
        const result = parseMarkdown('First[^a] second[^b] third[^c].\n\n[^a]: A.\n[^b]: B.\n[^c]: C.');
        if (result[0]?.type !== 'text') throw new Error('Expected text block');
        const chips = result[0].content.filter(s => s.styles.includes('footnote-ref'));
        expect(chips).toHaveLength(3);
        expect(chips.map(c => c.footnoteLabel)).toEqual(['a', 'b', 'c']);
        expect(result.footnotes.size).toBe(3);
        expect(result[0].content.map(s => s.text).join('')).not.toContain('[^a]:');
    });

    // AC-9-HTML-MARK
    it('parses <mark> highlight span', () => {
        const spans = expectTextBlock('A <mark>highlighted</mark> word.');
        expect(expectSpan(spans, 'highlighted').styles).toEqual(['mark']);
    });

    // AC-9-HTML-SUB
    it('parses <sub> subscript span', () => {
        const spans = expectTextBlock('H<sub>2</sub>O');
        expect(expectSpan(spans, '2').styles).toEqual(['sub']);
        expect(spans.map(s => s.text).join('')).toBe('H2O');
    });

    // AC-9-HTML-SUP
    it('parses <sup> superscript span', () => {
        const spans = expectTextBlock('E=mc<sup>2</sup>');
        expect(expectSpan(spans, '2').styles).toEqual(['sup']);
        expect(spans.map(s => s.text).join('')).toBe('E=mc2');
    });

    // AC-9-HTML-ABBR (double-quote)
    it('parses <abbr title=...> with tooltip field (double-quote)', () => {
        const spans = expectTextBlock('The <abbr title="World Wide Web">WWW</abbr> rocks.');
        const abbr = expectSpan(spans, 'WWW');
        expect(abbr.styles).toEqual(['abbr']);
        expect(abbr.tooltip).toBe('World Wide Web');
    });

    // AC-9-HTML-ABBR (single-quote — R5 risk defense)
    it('parses <abbr title=...> with tooltip field (single-quote)', () => {
        const spans = expectTextBlock("The <abbr title='Hyper Text'>HT</abbr> short.");
        const abbr = expectSpan(spans, 'HT');
        expect(abbr.styles).toEqual(['abbr']);
        expect(abbr.tooltip).toBe('Hyper Text');
    });

    // AC-9-HTML-DETAILS (default closed)
    it('parses <details><summary>...</summary>body</details> as block (closed by default)', () => {
        const blocks = parseMarkdown('<details>\n<summary>Click me</summary>\nHidden body paragraph.\n</details>');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('details');
        if (blocks[0]?.type !== 'details') throw new Error('Expected details block');
        expect(blocks[0].open).toBe(false);
        expect(blocks[0].summary.map(s => s.text).join('')).toBe('Click me');
        expect(blocks[0].content).toHaveLength(1);
        expect(blocks[0].content[0]?.type).toBe('text');
    });

    // AC-9-HTML-DETAILS-OPEN
    it('respects <details open> attribute', () => {
        const blocks = parseMarkdown('<details open>\n<summary>X</summary>\nY\n</details>');
        if (blocks[0]?.type !== 'details') throw new Error('Expected details block');
        expect(blocks[0].open).toBe(true);
    });

    // AC-9-HTML-KBD-NONREG (existing-non-regress)
    it('preserves existing <kbd> behavior when other HTML tokens are present', () => {
        const spans = expectTextBlock('<kbd>Ctrl</kbd> + <mark>X</mark> + <kbd>C</kbd>');
        expect(expectSpan(spans, 'Ctrl').styles).toEqual(['kbd']);
        expect(expectSpan(spans, 'C').styles).toEqual(['kbd']);
        expect(expectSpan(spans, 'X').styles).toEqual(['mark']);
    });

    // AC-INTERACTION-NOREGRESS-TABLE — table cells are stored as raw strings;
    // table-level extraction must not be derailed by reflink/footnote markers.
    // Render-time resolution tested via live render in QA evidence; here we
    // simply verify the cell text is preserved verbatim through block parse.
    it('keeps table cells verbatim when they contain reflink + footnote + <mark>', () => {
        const blocks = parseMarkdown([
            '| A | B | C |',
            '| --- | --- | --- |',
            '| [docs][ref] | [^1] | <mark>x</mark> |',
            '',
            '[ref]: https://example.com/docs',
            '[^1]: footnote body.',
        ].join('\n'));
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('table');
        if (blocks[0]?.type !== 'table') throw new Error('Expected table block');
        expect(blocks[0].rows[0]).toEqual(['[docs][ref]', '[^1]', '<mark>x</mark>']);
        // Top-level result also exposes the link/footnote defs for render-time resolution.
        expect((blocks as any).linkDefs.get('ref').url).toBe('https://example.com/docs');
        expect(blocks.footnotes.has('1')).toBe(true);
    });

    // AC-INTERACTION-NOREGRESS-EMPHASIS — bold + reflink + mark in one paragraph.
    it('mixes bold + reflink + mark in a single paragraph without state leak', () => {
        const spans = expectTextBlock('**bold** then [docs][ref] then <mark>highlighted</mark> end.\n\n[ref]: https://example.com');
        expect(expectSpan(spans, 'bold').styles).toEqual(['bold']);
        expect(expectSpan(spans, 'docs').url).toBe('https://example.com');
        expect(expectSpan(spans, 'highlighted').styles).toEqual(['mark']);
        // No leftover ref-def line; no italic/strikethrough leak across boundaries.
        expect(spans.map(s => s.text).join('')).not.toContain('[ref]:');
        expect(spans.every(s => !s.styles.includes('italic') && !s.styles.includes('strikethrough'))).toBe(true);
    });

    // AC-INTERACTION-NOREGRESS-NESTED-OL — nested OL with reflink + depth field.
    it('resolves reference links inside nested ordered list items and preserves depth', () => {
        const blocks = parseMarkdown([
            '1. outer one',
            '   1. inner with [docs][ref]',
            '2. outer two',
            '',
            '[ref]: https://example.com/docs',
        ].join('\n'));
        expect(blocks[0]?.type).toBe('numbered-list');
        if (blocks[0]?.type !== 'numbered-list') throw new Error('Expected numbered-list block');
        const items = blocks[0].items;
        expect(items.map(i => i.depth)).toEqual([0, 1, 0]);
        expect(expectSpan(items[1].spans, 'docs').url).toBe('https://example.com/docs');
    });

    // ========================================================================
    // Cycle 9 — 4-issue closer fixtures (CR-1 fence-aware, CR-2 compact details,
    // CR-3 sub/sup style, CR-4 i18n hardcode + interaction).
    // ========================================================================

    // AC-CR1-CODE-FENCE-PROTECTED
    it('preserves [ref]: lines inside fenced code block (no def stripping)', () => {
        const blocks = parseMarkdown('```\n[ref]: https://example.com\nsome code\n```');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('code-block');
        if (blocks[0]?.type !== 'code-block') throw new Error('Expected code-block');
        expect(blocks[0].content).toBe('[ref]: https://example.com\nsome code');
        expect((blocks as any).linkDefs.has('ref')).toBe(false);
    });

    // AC-CR1-FOOTNOTE-FENCE-PROTECTED
    it('preserves [^1]: lines inside fenced code block (no footnote stripping)', () => {
        const blocks = parseMarkdown('```\n[^1]: footnote-like in code\n```');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('code-block');
        if (blocks[0]?.type !== 'code-block') throw new Error('Expected code-block');
        expect(blocks[0].content).toBe('[^1]: footnote-like in code');
        expect(blocks.footnotes.has('1')).toBe(false);
    });

    // AC-CR1-TILDE-FENCE-PROTECTED
    it('tilde fences also protect def-shaped lines', () => {
        const blocks = parseMarkdown('~~~\n[ref]: url\n~~~');
        // Renderer's tryCodeBlock only handles `\`\`\``-fences; tilde produces text/falls
        // through. The DEF EXTRACTOR (which IS in our hands) MUST still treat tilde
        // fence as a protected region — `[ref]: url` MUST NOT be collected.
        expect((blocks as any).linkDefs.has('ref')).toBe(false);
    });

    // AC-CR1-OUTSIDE-FENCE-STILL-EXTRACTED — non-regression
    it('def line OUTSIDE fence still extracted (non-regression)', () => {
        const blocks = parseMarkdown('[ref]: https://example.com\n\nSee [text][ref].');
        expect((blocks as any).linkDefs.get('ref').url).toBe('https://example.com');
        // The `[ref]:` def line itself MUST NOT appear as a text block.
        const allText = blocks.map(b => (b as any).content)
            .filter(c => Array.isArray(c))
            .flat()
            .map((s: any) => s.text || '')
            .join('');
        expect(allText).not.toContain('[ref]:');
        // The reference-style link should resolve.
        const textBlock = blocks.find(b => b.type === 'text');
        expect(textBlock).toBeTruthy();
        if (textBlock?.type !== 'text') throw new Error('Expected text block');
        expect(expectSpan(textBlock.content, 'text').url).toBe('https://example.com');
    });

    // AC-CR1-MISMATCHED-CLOSER-NOT-CLOSING
    it('```ts (info string on closer) does NOT close the fence', () => {
        const blocks = parseMarkdown('```\n[ref]: a\n```ts\n[ref]: b\n```');
        // Fence opens at line 0, line 2 (`\`\`\`ts`) cannot close (info string disallowed
        // on closer per CommonMark §4.5). Fence closes at line 4. All inner content
        // is preserved verbatim; no link def collected.
        expect((blocks as any).linkDefs.has('ref')).toBe(false);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('code-block');
        if (blocks[0]?.type !== 'code-block') throw new Error('Expected code-block');
        expect(blocks[0].content).toContain('[ref]: a');
        expect(blocks[0].content).toContain('```ts');
        expect(blocks[0].content).toContain('[ref]: b');
    });

    // AC-CR1-TAB-INDENTED-FENCE — iter-2 REJ-2 fix
    it('tab-indented fence still protects def-shaped lines (renderer-consistent)', () => {
        const blocks = parseMarkdown('\t```\n[ref]: https://example.com\n\t```');
        // tryCodeBlock @ parseMarkdownBlock.ts:207 uses `trimmed.startsWith('\`\`\`')`,
        // so a tab-indented fence is rendered as a code block. The def-extractor MUST
        // agree (same predicate) — the `[ref]:` line MUST NOT be collected.
        expect((blocks as any).linkDefs.has('ref')).toBe(false);
    });

    // AC-CR1-UNCLOSED-FENCE — iter-2 REJ-3 fix
    it('unclosed fence preserves remaining lines, no def stripping after open', () => {
        const blocks = parseMarkdown('```\n[ref]: url\nmore stuff\n');
        // No closing fence; EOF reached while inside fence. Def extractor MUST NOT
        // strip [ref]: nor footnote-shaped lines anywhere from open-fence to EOF.
        expect((blocks as any).linkDefs.has('ref')).toBe(false);
        expect(blocks.footnotes.size).toBe(0);
    });

    // AC-CR2-DETAILS-COMPACT
    it('parses compact <details><summary>X</summary>Y</details> as block', () => {
        const blocks = parseMarkdown('<details><summary>Click me</summary>Hidden body.</details>');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('details');
        if (blocks[0]?.type !== 'details') throw new Error('Expected details block');
        expect(blocks[0].open).toBe(false);
        expect(blocks[0].summary[0]?.text).toBe('Click me');
        // body is a single text block with content 'Hidden body.'
        expect(blocks[0].content).toHaveLength(1);
        expect(blocks[0].content[0]?.type).toBe('text');
        if (blocks[0].content[0]?.type !== 'text') throw new Error('Expected text body');
        expect(blocks[0].content[0].content[0]?.text).toBe('Hidden body.');
    });

    // AC-CR2-DETAILS-COMPACT-OPEN
    it('compact <details open><summary>S</summary>B</details> respects open=true', () => {
        const blocks = parseMarkdown('<details open><summary>S</summary>B</details>');
        expect(blocks[0]?.type).toBe('details');
        if (blocks[0]?.type !== 'details') throw new Error('Expected details block');
        expect(blocks[0].open).toBe(true);
        expect(blocks[0].summary[0]?.text).toBe('S');
        if (blocks[0].content[0]?.type !== 'text') throw new Error('Expected text body');
        expect(blocks[0].content[0].content[0]?.text).toBe('B');
    });

    // AC-CR1-CR2-INTERACTION — compact <details> body containing fenced code with def line.
    it('compact <details> body with fenced code containing a def line — code preserved, no def leak', () => {
        const input = '<details>\n<summary>S</summary>\n```\n[ref]: url\n```\n</details>';
        const blocks = parseMarkdown(input);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.type).toBe('details');
        if (blocks[0]?.type !== 'details') throw new Error('Expected details block');
        expect(blocks[0].summary[0]?.text).toBe('S');
        // Body should contain a code-block with `[ref]: url` verbatim.
        const codeBlock = blocks[0].content.find(b => b.type === 'code-block');
        expect(codeBlock).toBeTruthy();
        if (codeBlock?.type !== 'code-block') throw new Error('Expected code-block in body');
        expect(codeBlock.content).toContain('[ref]: url');
        // The def MUST NOT have leaked into the top-level linkDefs.
        expect((blocks as any).linkDefs.has('ref')).toBe(false);
    });

    // AC-CR3-SUB-SUP-DISTINCT — style-snapshot fixture
    // Sub vs sup MUST NOT be byte-identical at the property level: translateY signs
    // differ (+4 vs -4), fontSize equal (10), lineHeight equal (14).
    it('sub and sup style payloads are property-level distinct (translateY ±4)', async () => {
        // Read MarkdownView.tsx source and assert the literal style entries.
        // We can't import StyleSheet from RN in a vitest unit (RN is a heavy
        // platform module), so we parse the source file directly. This ties
        // the assertion to the file's literal text and catches accidental
        // re-equalization.
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const src = await fs.readFile(
            path.resolve(__dirname, 'MarkdownView.tsx'),
            'utf8',
        );
        // Match `sub: { ... translateY: <signed-int> ... }` and same for sup.
        const subMatch = src.match(/sub:\s*\{[^}]*?translateY:\s*(-?\d+)[^}]*?\}/);
        const supMatch = src.match(/sup:\s*\{[^}]*?translateY:\s*(-?\d+)[^}]*?\}/);
        expect(subMatch).toBeTruthy();
        expect(supMatch).toBeTruthy();
        const subTy = parseInt(subMatch![1], 10);
        const supTy = parseInt(supMatch![1], 10);
        expect(subTy).toBe(4);
        expect(supTy).toBe(-4);
        expect(subTy).not.toBe(supTy);
        // Both should declare fontSize: 10 and lineHeight: 14.
        expect(/sub:\s*\{[^}]*?fontSize:\s*10/.test(src)).toBe(true);
        expect(/sup:\s*\{[^}]*?fontSize:\s*10/.test(src)).toBe(true);
        expect(/sub:\s*\{[^}]*?lineHeight:\s*14/.test(src)).toBe(true);
        expect(/sup:\s*\{[^}]*?lineHeight:\s*14/.test(src)).toBe(true);
    });
});
