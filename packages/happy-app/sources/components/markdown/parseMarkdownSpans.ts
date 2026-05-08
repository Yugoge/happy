import type { MarkdownSpan } from "./parseMarkdown";

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

function consumeToken(spans: MarkdownSpan[], source: string, index: number, header: boolean): number | null {
    if (source[index] === '`') return consumeCodeSpan(spans, source, index);
    if (source.startsWith('<kbd>', index)) return consumeKbdSpan(spans, source, index);
    if (source[index] === '$') return consumeLatex(spans, source, index);
    if (source.startsWith('~~', index)) return consumeDelimited(spans, source, index, '~~', ['strikethrough'], header);
    if (source.startsWith('***', index)) return consumeDelimited(spans, source, index, '***', ['bold', 'italic'], header);
    if (source.startsWith('**', index)) return consumeDelimited(spans, source, index, '**', ['bold'], header);
    if (source[index] === '*') return consumeDelimited(spans, source, index, '*', ['italic'], header);
    if (source[index] === '[') return consumeLink(spans, source, index);
    return null;
}

export function parseMarkdownSpans(markdown: string, header: boolean) {
    const spans: MarkdownSpan[] = [];
    let lastIndex = 0;
    let index = 0;

    const flushPlainText = (end: number) => {
        if (end > lastIndex) {
            pushTextWithAutoLinks(spans, markdown.slice(lastIndex, end), []);
        }
    };

    while (index < markdown.length) {
        const escaped = readEscapedLiteral(markdown, index);
        if (escaped) {
            flushPlainText(index);
            pushPlainText(spans, escaped.text, []);
            index = escaped.end;
            lastIndex = index;
            continue;
        }
        if (!isEscaped(markdown, index)) {
            const tokenSpans: MarkdownSpan[] = [];
            const consumed = consumeToken(tokenSpans, markdown, index, header);
            if (consumed !== null) {
                flushPlainText(index);
                spans.push(...tokenSpans);
                index = consumed;
                lastIndex = index;
                continue;
            }
        }
        index++;
    }

    if (lastIndex < markdown.length) {
        pushTextWithAutoLinks(spans, markdown.slice(lastIndex), []);
    }

    return spans;
}
