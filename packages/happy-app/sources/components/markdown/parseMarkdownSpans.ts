import type { LinkDef, MarkdownSpan } from "./parseMarkdown";

// Cycle 8 (#10): CommonMark-style label normalization for reference links.
// Lowercase + collapse internal whitespace per spec §4.7. Used for both def
// extraction (block layer) and reference lookup (span layer) to keep the
// keys aligned. Non-ASCII case-folding is explicit non-goal (BA W3).
export function normalizeLinkLabel(label: string): string {
    return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

const ESCAPABLE_PUNCTUATION = new Set(['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '|', '~']);

// Decode common HTML entities (&lt;, &gt;, &amp;, &quot;, &#NNN;, &nbsp;)
// so Claude's content with escaped HTML renders as intended literal characters.
function decodeEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

function trimUrlTrailing(rawUrl: string): { url: string, trailing: string } {
    let url = rawUrl;
    let trailing = '';
    while (/[),.;:!?]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
    }
    return { url, trailing };
}

function pushTextWithAutoLinks(spans: MarkdownSpan[], text: string, styles: MarkdownSpan['styles']) {
    const decoded = decodeEntities(text);
    const urlPattern = /https?:\/\/[^\s<]+/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = urlPattern.exec(decoded)) !== null) {
        const plainText = decoded.slice(lastIndex, match.index);
        if (plainText) {
            spans.push({ styles, text: plainText, url: null });
        }
        const { url, trailing } = trimUrlTrailing(match[0]);
        if (url) {
            spans.push({ styles, text: url, url });
        }
        if (trailing) {
            spans.push({ styles, text: trailing, url: null });
        }
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < decoded.length) {
        spans.push({ styles, text: decoded.slice(lastIndex), url: null });
    }
}

function pushPlainText(spans: MarkdownSpan[], text: string, styles: MarkdownSpan['styles']) {
    const decoded = decodeEntities(text);
    if (decoded) {
        spans.push({ styles, text: decoded, url: null });
    }
}

function isEscaped(source: string, matchIndex: number): boolean {
    let backslashCount = 0;
    for (let i = matchIndex - 1; i >= 0 && source[i] === '\\'; i--) {
        backslashCount++;
    }
    return backslashCount % 2 === 1;
}

function isEscapedDollar(source: string, matchIndex: number): boolean {
    return isEscaped(source, matchIndex);
}

function isPriceLikeDollar(source: string, matchIndex: number): boolean {
    if (matchIndex === 0) return false;
    const prev = source[matchIndex - 1];
    return /[A-Za-z0-9]/.test(prev);
}

function findUnescaped(source: string, needle: string, fromIndex: number): number {
    let index = source.indexOf(needle, fromIndex);
    while (index !== -1) {
        if (!isEscaped(source, index)) return index;
        index = source.indexOf(needle, index + 1);
    }
    return -1;
}

function consumeDelimited(
    spans: MarkdownSpan[],
    source: string,
    index: number,
    delimiter: string,
    styles: MarkdownSpan['styles'],
    header: boolean,
): number | null {
    const end = findUnescaped(source, delimiter, index + delimiter.length);
    if (end === -1 || end === index + delimiter.length) return null;
    const suppressForHeader = header && styles.every(style => style === 'bold' || style === 'italic');
    pushTextWithAutoLinks(spans, source.slice(index + delimiter.length, end), suppressForHeader ? [] : styles);
    return end + delimiter.length;
}

function consumeCodeSpan(spans: MarkdownSpan[], source: string, index: number): number | null {
    const end = findUnescaped(source, '`', index + 1);
    if (end === -1) return null;
    spans.push({ styles: ['code'], text: source.slice(index + 1, end), url: null });
    return end + 1;
}

function consumeKbdSpan(spans: MarkdownSpan[], source: string, index: number): number | null {
    if (!source.startsWith('<kbd>', index)) return null;
    const end = source.indexOf('</kbd>', index + 5);
    if (end === -1) return null;
    spans.push({ styles: ['kbd'], text: source.slice(index + 5, end), url: null });
    return end + 6;
}

function consumeLink(spans: MarkdownSpan[], source: string, index: number): number | null {
    const textEnd = findUnescaped(source, ']', index + 1);
    if (textEnd === -1 || source[textEnd + 1] !== '(') return null;
    const urlEnd = findUnescaped(source, ')', textEnd + 2);
    if (urlEnd === -1) return null;
    spans.push({ styles: [], text: decodeEntities(source.slice(index + 1, textEnd)), url: source.slice(textEnd + 2, urlEnd) });
    return urlEnd + 1;
}

// Cycle 8 (#10): emit a resolved reference-link span with the def's url.
function emitRefLinkSpan(spans: MarkdownSpan[], text: string, def: LinkDef): void {
    spans.push({ styles: [], text: decodeEntities(text), url: def.url });
}

// Cycle 8 (#10): full reference [text][ref] — second `[...]` carries the label.
// Empty label collapses to [ref][]. Returns next index or null if unmatched.
function consumeFullOrCollapsedRef(
    spans: MarkdownSpan[], source: string,
    firstClose: number, innerText: string, linkDefs: Map<string, LinkDef>,
): number | null {
    const refClose = findUnescaped(source, ']', firstClose + 2);
    if (refClose === -1) return null;
    const refLabel = source.slice(firstClose + 2, refClose);
    const lookupKey = refLabel.length === 0 ? innerText : refLabel;
    const def = linkDefs.get(normalizeLinkLabel(lookupKey));
    if (!def) return null;
    emitRefLinkSpan(spans, innerText, def);
    return refClose + 1;
}

// Cycle 8 (#10): reference-style links — full [text][ref], collapsed [ref][],
// shortcut [ref]. Fires only AFTER consumeLink rejects (no `(` after `]`).
// Unmatched references return null so the literal `[...]` text flows through.
function consumeReferenceLink(
    spans: MarkdownSpan[], source: string, index: number,
    linkDefs: Map<string, LinkDef> | undefined,
): number | null {
    if (!linkDefs || linkDefs.size === 0) return null;
    const firstClose = findUnescaped(source, ']', index + 1);
    if (firstClose === -1) return null;
    const innerText = source.slice(index + 1, firstClose);
    if (innerText.startsWith('^')) return null;
    if (source[firstClose + 1] === '[') {
        return consumeFullOrCollapsedRef(spans, source, firstClose, innerText, linkDefs);
    }
    const def = linkDefs.get(normalizeLinkLabel(innerText));
    if (!def) return null;
    emitRefLinkSpan(spans, innerText, def);
    return firstClose + 1;
}

// Cycle 8 (#11): footnote reference [^label]. Label may NOT contain whitespace
// or `]`. Unmatched (no def in map) returns null so literal `[^x]` flows through.
function consumeFootnoteRef(
    spans: MarkdownSpan[], source: string, index: number,
    footnoteDefs: Map<string, MarkdownSpan[]> | undefined,
): number | null {
    if (source[index + 1] !== '^') return null;
    if (!footnoteDefs || footnoteDefs.size === 0) return null;
    const close = findUnescaped(source, ']', index + 2);
    if (close === -1 || close === index + 2) return null;
    const label = source.slice(index + 2, close);
    if (/\s/.test(label)) return null;
    if (!footnoteDefs.has(label)) return null;
    spans.push({ styles: ['footnote-ref'], text: label, url: null, footnoteLabel: label });
    return close + 1;
}

// Cycle 8 (#9): paired HTML inline tag tokenizer. Used by <mark>, <sub>,
// <sup>. Returns null if the closing tag is missing so literal text flows.
function consumeHtmlPairedTag(
    spans: MarkdownSpan[], source: string, index: number,
    tag: string, style: MarkdownSpan['styles'][number],
): number | null {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    if (!source.startsWith(open, index)) return null;
    const end = source.indexOf(close, index + open.length);
    if (end === -1) return null;
    spans.push({ styles: [style], text: source.slice(index + open.length, end), url: null });
    return end + close.length;
}

// Cycle 8 (#9): <abbr title="..."> with single OR double quote attribute.
const ABBR_OPEN_RE = /^<abbr\s+title=(["'])([^"']*?)\1\s*>/;
function consumeAbbrSpan(spans: MarkdownSpan[], source: string, index: number): number | null {
    if (!source.startsWith('<abbr', index)) return null;
    const m = source.slice(index).match(ABBR_OPEN_RE);
    if (!m) return null;
    const close = '</abbr>';
    const end = source.indexOf(close, index + m[0].length);
    if (end === -1) return null;
    spans.push({ styles: ['abbr'], text: source.slice(index + m[0].length, end), url: null, tooltip: m[2] });
    return end + close.length;
}

function consumeLatex(spans: MarkdownSpan[], source: string, index: number): number | null {
    if (source.startsWith('$$', index)) {
        if (isEscapedDollar(source, index) || isPriceLikeDollar(source, index)) return null;
        const end = findUnescaped(source, '$$', index + 2);
        if (end === -1 || end === index + 2) return null;
        spans.push({ styles: [], text: source.slice(index + 2, end), url: null, latex: true, latexDisplay: true });
        return end + 2;
    }
    if (source[index] !== '$' || isEscapedDollar(source, index) || isPriceLikeDollar(source, index)) return null;
    const end = findUnescaped(source, '$', index + 1);
    if (end === -1 || end === index + 1) return null;
    const content = source.slice(index + 1, end);
    if (/^\s|\s$/.test(content)) return null;
    spans.push({ styles: [], text: content, url: null, latex: true });
    return end + 1;
}

function readEscapedLiteral(source: string, index: number): { text: string, end: number } | null {
    if (source[index] !== '\\' || index + 1 >= source.length) return null;
    const next = source[index + 1];
    if (next === '[') {
        const textEnd = findUnescaped(source, ']', index + 2);
        if (textEnd !== -1 && source[textEnd + 1] === '(') {
            const urlEnd = findUnescaped(source, ')', textEnd + 2);
            if (urlEnd !== -1) {
                return { text: source.slice(index + 1, urlEnd + 1), end: urlEnd + 1 };
            }
        }
    }
    if (!ESCAPABLE_PUNCTUATION.has(next)) return null;
    return { text: next, end: index + 2 };
}

type SpanCtx = {
    linkDefs?: Map<string, LinkDef>,
    footnoteDefs?: Map<string, MarkdownSpan[]>,
};

// Cycle 8 (#9): dispatch to all `<...>` HTML inline elements (kbd + 4 new).
function consumeHtmlInline(spans: MarkdownSpan[], source: string, index: number): number | null {
    if (source.startsWith('<kbd>', index)) return consumeKbdSpan(spans, source, index);
    if (source.startsWith('<mark>', index)) return consumeHtmlPairedTag(spans, source, index, 'mark', 'mark');
    if (source.startsWith('<sub>', index)) return consumeHtmlPairedTag(spans, source, index, 'sub', 'sub');
    if (source.startsWith('<sup>', index)) return consumeHtmlPairedTag(spans, source, index, 'sup', 'sup');
    if (source.startsWith('<abbr', index)) return consumeAbbrSpan(spans, source, index);
    return null;
}

// Cycle 8: bracket dispatch. Order: footnote > inline link > reference link.
function consumeBracket(spans: MarkdownSpan[], source: string, index: number, ctx: SpanCtx): number | null {
    const fn = consumeFootnoteRef(spans, source, index, ctx.footnoteDefs);
    if (fn !== null) return fn;
    const inline = consumeLink(spans, source, index);
    if (inline !== null) return inline;
    return consumeReferenceLink(spans, source, index, ctx.linkDefs);
}

function consumeToken(spans: MarkdownSpan[], source: string, index: number, header: boolean, ctx: SpanCtx): number | null {
    if (source[index] === '`') return consumeCodeSpan(spans, source, index);
    if (source[index] === '<') return consumeHtmlInline(spans, source, index);
    if (source[index] === '$') return consumeLatex(spans, source, index);
    if (source.startsWith('~~', index)) return consumeDelimited(spans, source, index, '~~', ['strikethrough'], header);
    if (source.startsWith('***', index)) return consumeDelimited(spans, source, index, '***', ['bold', 'italic'], header);
    if (source.startsWith('**', index)) return consumeDelimited(spans, source, index, '**', ['bold'], header);
    if (source[index] === '*') return consumeDelimited(spans, source, index, '*', ['italic'], header);
    if (source[index] === '[') return consumeBracket(spans, source, index, ctx);
    return null;
}

// Cycle 8: try escape-literal at index; emit + return next index if matched.
function tryEscape(
    spans: MarkdownSpan[], markdown: string, index: number,
    flushPlainText: (end: number) => void,
): number | null {
    const escaped = readEscapedLiteral(markdown, index);
    if (!escaped) return null;
    flushPlainText(index);
    pushPlainText(spans, escaped.text, []);
    return escaped.end;
}

// Cycle 8: try tokenizer at index; flush + push if matched.
function tryToken(
    spans: MarkdownSpan[], markdown: string, index: number, header: boolean, ctx: SpanCtx,
    flushPlainText: (end: number) => void,
): number | null {
    if (isEscaped(markdown, index)) return null;
    const tokenSpans: MarkdownSpan[] = [];
    const consumed = consumeToken(tokenSpans, markdown, index, header, ctx);
    if (consumed === null) return null;
    flushPlainText(index);
    spans.push(...tokenSpans);
    return consumed;
}

export function parseMarkdownSpans(
    markdown: string, header: boolean,
    linkDefs?: Map<string, LinkDef>,
    footnoteDefs?: Map<string, MarkdownSpan[]>,
) {
    const spans: MarkdownSpan[] = [];
    const ctx: SpanCtx = { linkDefs, footnoteDefs };
    let lastIndex = 0;
    let index = 0;
    const flushPlainText = (end: number) => {
        if (end > lastIndex) pushTextWithAutoLinks(spans, markdown.slice(lastIndex, end), []);
    };
    while (index < markdown.length) {
        const next = tryEscape(spans, markdown, index, flushPlainText)
            ?? tryToken(spans, markdown, index, header, ctx, flushPlainText);
        if (next !== null) { index = next; lastIndex = index; continue; }
        index++;
    }
    if (lastIndex < markdown.length) pushTextWithAutoLinks(spans, markdown.slice(lastIndex), []);
    return spans;
}
