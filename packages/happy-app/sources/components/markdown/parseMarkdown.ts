import { parseMarkdownBlock } from "./parseMarkdownBlock"

export type LinkDef = { url: string; title?: string };

export type MarkdownBlock = {
    type: 'text'
    content: MarkdownSpan[]
} | {
    type: 'header'
    level: 1 | 2 | 3 | 4 | 5 | 6
    content: MarkdownSpan[]
} | {
    type: 'list',
    items: { depth: number, spans: MarkdownSpan[] }[]
} | {
    type: 'numbered-list',
    items: { number: number, depth: number, spans: MarkdownSpan[] }[]
} | {
    type: 'task-list',
    items: { checked: boolean, depth: number, spans: MarkdownSpan[] }[]
} | {
    type: 'blockquote',
    depth: number,
    content: MarkdownBlock[]
} | {
    type: 'code-block',
    language: string | null,
    content: string
} | {
    type: 'mermaid',
    content: string
} | {
    type: 'latex',
    content: string
} | {
    type: 'horizontal-rule'
} | {
    type: 'options',
    items: string[]
} | {
    type: 'table',
    headers: string[],
    rows: string[][]
} | {
    type: 'image',
    alt: string,
    url: string
} | {
    // Cycle 8 (#9): collapsible <details><summary>...</summary>body</details>.
    // Body lines are recursively parsed into nested blocks. open=true if the
    // raw HTML carried the `open` attribute (HTML5 default-closed otherwise).
    type: 'details',
    open: boolean,
    summary: MarkdownSpan[],
    content: MarkdownBlock[]
}

export type MarkdownSpan = {
    // Cycle 8 (#9, #11): added 'mark', 'sub', 'sup', 'abbr', 'footnote-ref'
    // to the style union. 'kbd' was the pre-existing single non-text inline
    // primitive; the new 4 + 1 (footnote-ref) reuse the same span.styles[]
    // pipeline so the render layer can map style names to React Native Text
    // props uniformly.
    styles: ('italic' | 'bold' | 'semibold' | 'code' | 'strikethrough' | 'kbd'
           | 'mark' | 'sub' | 'sup' | 'abbr' | 'footnote-ref')[],
    text: string,
    url: string | null,
    latex?: boolean,
    latexDisplay?: boolean,
    // Cycle 8 (#9): <abbr title="..."> tooltip payload. Render layer reveals
    // on tap. Falls back to undefined for non-abbr spans.
    tooltip?: string,
    // Cycle 8 (#11): footnote reference label. Pairs with parseMarkdown
    // result's `footnotes` map (label -> body spans) so render layer can
    // resolve the chip to its body on tap.
    footnoteLabel?: string,
}

// Cycle 8 (#11): top-level parseMarkdown returns a MarkdownBlock[] enriched
// with a `footnotes` map (label -> parsed body spans) and a `linkDefs` map
// (normalized label -> {url, title?}). Existing callers that destructure as
// MarkdownBlock[] (length, [].type, [].content) are unaffected; new callers
// (MarkdownView render layer, footnote-aware tests) read `result.footnotes`
// to resolve [^label] chips and `result.linkDefs` to resolve render-time
// reference links inside table cells.
export type ParsedMarkdown = MarkdownBlock[] & {
    footnotes: Map<string, MarkdownSpan[]>,
    linkDefs: Map<string, LinkDef>,
};

export function parseMarkdown(markdown: string): ParsedMarkdown {
    return parseMarkdownBlock(markdown) as ParsedMarkdown;
}
