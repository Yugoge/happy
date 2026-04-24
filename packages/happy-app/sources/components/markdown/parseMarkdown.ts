import { parseMarkdownBlock } from "./parseMarkdownBlock"

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
    items: { number: number, spans: MarkdownSpan[] }[]
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
}

export type MarkdownSpan = {
    styles: ('italic' | 'bold' | 'semibold' | 'code' | 'strikethrough' | 'kbd')[],
    text: string,
    url: string | null,
    latex?: boolean,
}

export function parseMarkdown(markdown: string) {
    return parseMarkdownBlock(markdown);
}
