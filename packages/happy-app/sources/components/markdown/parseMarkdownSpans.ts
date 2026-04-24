import type { MarkdownSpan } from "./parseMarkdown";

// Updated pattern to handle nested markdown and asterisks
// Capture groups 1-9: existing bold/italic/link/code; 10-11: inline latex $...$;
// 12-13: strikethrough ~~...~~; 14-15: <kbd>...</kbd>
const pattern = /(\*\*(.*?)(?:\*\*|$))|(\*(.*?)(?:\*|$))|(\[([^\]]+)\](?:\(([^)]+)\))?)|(`(.*?)(?:`|$))|(\$([^\s$][^$\n]*?[^\s$]|[^\s$\d\\])\$)|(~~(.*?)(?:~~|$))|(<kbd>([\s\S]*?)<\/kbd>)/g;

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

function isEscapedDollar(source: string, matchIndex: number): boolean {
    let backslashCount = 0;
    for (let i = matchIndex - 1; i >= 0 && source[i] === '\\'; i--) {
        backslashCount++;
    }
    return backslashCount % 2 === 1;
}

function isPriceLikeDollar(source: string, matchIndex: number): boolean {
    if (matchIndex === 0) return false;
    const prev = source[matchIndex - 1];
    return /[A-Za-z0-9]/.test(prev);
}

function handleLatexMatch(spans: MarkdownSpan[], source: string, match: RegExpExecArray): void {
    if (isEscapedDollar(source, match.index) || isPriceLikeDollar(source, match.index)) {
        pushTextWithAutoLinks(spans, match[10], []);
        return;
    }
    spans.push({ styles: [], text: match[11], url: null, latex: true });
}

function handleLinkMatch(spans: MarkdownSpan[], match: RegExpExecArray) {
    if (match[7]) {
        spans.push({ styles: [], text: match[6], url: match[7] });
    } else {
        pushTextWithAutoLinks(spans, `[${match[6]}]`, []);
    }
}

function handleMatchedToken(spans: MarkdownSpan[], source: string, match: RegExpExecArray, header: boolean) {
    if (match[1]) {
        pushTextWithAutoLinks(spans, match[2], header ? [] : ['bold']);
    } else if (match[3]) {
        pushTextWithAutoLinks(spans, match[4], header ? [] : ['italic']);
    } else if (match[5]) {
        handleLinkMatch(spans, match);
    } else if (match[8]) {
        spans.push({ styles: ['code'], text: match[9], url: null });
    } else if (match[10]) {
        handleLatexMatch(spans, source, match);
    } else if (match[12]) {
        pushTextWithAutoLinks(spans, match[13], ['strikethrough']);
    } else if (match[14]) {
        spans.push({ styles: ['kbd'], text: match[15], url: null });
    }
}

export function parseMarkdownSpans(markdown: string, header: boolean) {
    const spans: MarkdownSpan[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(markdown)) !== null) {
        const plainText = markdown.slice(lastIndex, match.index);
        if (plainText) {
            pushTextWithAutoLinks(spans, plainText, []);
        }
        handleMatchedToken(spans, markdown, match, header);
        lastIndex = pattern.lastIndex;
    }

    if (lastIndex < markdown.length) {
        pushTextWithAutoLinks(spans, markdown.slice(lastIndex), []);
    }

    return spans;
}
