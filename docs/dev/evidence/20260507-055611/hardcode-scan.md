### hardcode scan target files
## packages/happy-app/sources/components/markdown/parseMarkdownSpans.ts
## packages/happy-app/sources/components/markdown/MarkdownView.tsx
## packages/happy-app/sources/components/markdown/parseMarkdown.test.ts
24:            '+ second item with [docs](https://example.com/docs)',
25:            '- third item with https://example.com/raw.',
38:            { styles: [], text: 'docs', url: 'https://example.com/docs' },
42:            { styles: [], text: 'https://example.com/raw', url: 'https://example.com/raw' },
60:        const blocks = parseMarkdown('Visit https://example.com/docs for more.');
71:            { styles: [], text: 'https://example.com/docs', url: 'https://example.com/docs' },
77:        const spans = expectTextBlock('***bold italic*** then ~~strike~~ and [link](https://example.com) and `code` and \\*literal\\*');
81:        expect(expectSpan(spans, 'link').url).toBe('https://example.com');
95:        expect(expectTextBlock('Visit https://example.com/docs.')).toEqual([
97:            { styles: [], text: 'https://example.com/docs', url: 'https://example.com/docs' },
101:        const codeSpans = expectTextBlock('`**not bold** [not](https://bad.example)` then **bold**');
102:        expect(codeSpans[0]).toEqual({ styles: ['code'], text: '**not bold** [not](https://bad.example)', url: null });
105:        const escapeSpans = expectTextBlock('Escaped \\*literal\\* and \\[not a link](https://example.com)');
106:        expect(escapeSpans.map(s => s.text).join('')).toBe('Escaped *literal* and [not a link](https://example.com)');
114:            '| **bold** ~~strike~~ [link](https://example.com) `code` | WIDE_TABLE_SENTINEL_ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ | |',
125:        expect(blocks[0].rows[0][0]).toBe('**bold** ~~strike~~ [link](https://example.com) `code`');
130:        const headerBlocks = parseMarkdown('# ***Heading*** then [docs](https://example.com) and `code`');
133:            expect(expectSpan(headerBlocks[0].content, 'docs').url).toBe('https://example.com');
138:        const listBlocks = parseMarkdown('- ***item*** then ~~strike~~ and [docs](https://example.com)');
142:            expect(expectSpan(listBlocks[0].items[0].spans, 'docs').url).toBe('https://example.com');

### hardcode scan workflow-artifact files (documentation/checkpoint allowlist review)
## docs/dev/specs/spec-20260506-203755.md
133:- **packages/happy-app/sources/components/markdown/parseMarkdownSpans.ts:143-157** -- added `\*` and escaped-link literal handling so `\*literal\*` and `\[not a link](https://example.com)` stay plain and do not auto-link the escaped URL.
211:- 用户附件渲染（缩略图 + `@/tmp/...` 路径）
## .claude/specs/spec-20260506-203755/cp-state-dev.json
## docs/dev/dev-report-20260507-055611.json
Conclusion: flagged URLs/paths are spec/dev-report documentation, fixture URLs, or required environment references; no executable hardcoded secret/credential/path was added by the reported parser/rendering files.
