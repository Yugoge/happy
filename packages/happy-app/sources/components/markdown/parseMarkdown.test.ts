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
});
