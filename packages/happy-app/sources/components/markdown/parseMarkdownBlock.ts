import type { MarkdownBlock } from "./parseMarkdown";
import { parseMarkdownSpans } from "./parseMarkdownSpans";

// Unordered list item detector: captures leading indentation (group 1) and content (group 2).
const LIST_ITEM_RE = /^(\s*)[-*+]\s(.*)$/;
// Task list prefix inside a captured list item: [x], [X], or [ ].
const TASK_PREFIX_RE = /^\[([xX ])\]\s(.*)$/;
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;

type ListItemInfo = {
    depth: number;
    content: string;
    taskChecked: boolean | null; // null = regular list item; true/false = task list item
};

function parseListItemLine(line: string): ListItemInfo | null {
    const m = line.match(LIST_ITEM_RE);
    if (!m) return null;
    const indent = m[1].length;
    const depth = Math.min(Math.floor(indent / 2), 6);
    const raw = m[2];
    const taskMatch = raw.match(TASK_PREFIX_RE);
    if (taskMatch) {
        return { depth, content: taskMatch[2], taskChecked: taskMatch[1] !== ' ' };
    }
    return { depth, content: raw, taskChecked: null };
}

function collectListItems(lines: string[], startIndex: number, first: ListItemInfo): { items: ListItemInfo[], nextIndex: number } {
    const items: ListItemInfo[] = [first];
    let index = startIndex;
    while (index < lines.length) {
        const info = parseListItemLine(lines[index]);
        if (!info) break;
        items.push(info);
        index++;
    }
    return { items, nextIndex: index };
}

function buildTaskListBlock(items: ListItemInfo[]): MarkdownBlock {
    return {
        type: 'task-list',
        items: items.map(i => ({
            checked: i.taskChecked === true,
            depth: i.depth,
            spans: parseMarkdownSpans(i.content, false),
        })),
    };
}

function buildListBlockFromItems(items: ListItemInfo[]): MarkdownBlock {
    const hasTask = items.some(i => i.taskChecked !== null);
    if (hasTask) return buildTaskListBlock(items);
    return {
        type: 'list',
        items: items.map(i => ({ depth: i.depth, spans: parseMarkdownSpans(i.content, false) })),
    };
}

// Blockquote: count leading ">" for nesting; consume consecutive ">"-prefixed lines.
function countQuoteDepth(trimmedLine: string): { depth: number, rest: string } | null {
    const m = trimmedLine.match(/^(>+)\s?(.*)$/);
    if (!m) return null;
    return { depth: m[1].length, rest: m[2] };
}

function collectBlockquote(lines: string[], startIndex: number): { block: MarkdownBlock, nextIndex: number } {
    let index = startIndex;
    let maxDepth = 0;
    const innerLines: string[] = [];
    while (index < lines.length) {
        const info = countQuoteDepth(lines[index].trim());
        if (!info) break;
        if (info.depth > maxDepth) maxDepth = info.depth;
        // Strip one ">" per iteration so recursive parse nests the inner blockquote.
        const stripped = info.depth > 1 ? `${'>'.repeat(info.depth - 1)} ${info.rest}` : info.rest;
        innerLines.push(stripped);
        index++;
    }
    const content = parseMarkdownBlock(innerLines.join('\n'));
    return { block: { type: 'blockquote', depth: maxDepth, content }, nextIndex: index };
}

function extractTableRows(tableLines: string[]): string[][] {
    const rows: string[][] = [];
    for (let i = 2; i < tableLines.length; i++) {
        const rowLine = tableLines[i].trim();
        if (rowLine.includes('|')) {
            rows.push(rowLine.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
        }
    }
    return rows;
}

function parseTable(lines: string[], startIndex: number): { table: MarkdownBlock | null; nextIndex: number } {
    let index = startIndex;
    const tableLines: string[] = [];
    while (index < lines.length && lines[index].includes('|')) {
        tableLines.push(lines[index]);
        index++;
    }
    if (tableLines.length < 2) return { table: null, nextIndex: startIndex };
    const separatorLine = tableLines[1].trim();
    const isSeparator = /^[|\s\-:=]*$/.test(separatorLine) && separatorLine.includes('-');
    if (!isSeparator) return { table: null, nextIndex: startIndex };
    const headerLine = tableLines[0].trim();
    const headers = headerLine.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    if (headers.length === 0) return { table: null, nextIndex: startIndex };
    const rows = extractTableRows(tableLines);
    return { table: { type: 'table', headers, rows }, nextIndex: index };
}

// Parse context: shared across helpers so each branch can advance cursor and append a block.
type ParseCtx = {
    lines: string[];
    index: number;
    blocks: MarkdownBlock[];
};

function tryHeader(ctx: ParseCtx, line: string): boolean {
    for (let i = 1; i <= 6; i++) {
        if (line.startsWith(`${'#'.repeat(i)} `)) {
            ctx.blocks.push({
                type: 'header',
                level: i as 1 | 2 | 3 | 4 | 5 | 6,
                content: parseMarkdownSpans(line.slice(i + 1).trim(), true),
            });
            return true;
        }
    }
    return false;
}

function tryImage(ctx: ParseCtx, trimmed: string): boolean {
    const match = trimmed.match(IMAGE_RE);
    if (!match) return false;
    ctx.blocks.push({ type: 'image', alt: match[1], url: match[2] });
    return true;
}

function consumeLatexLines(ctx: ParseCtx, firstSegment: string): string {
    const latexContent = [firstSegment];
    while (ctx.index < ctx.lines.length) {
        const nextLine = ctx.lines[ctx.index];
        ctx.index++;
        if (nextLine.trim().endsWith('$$')) {
            const last = nextLine.trim().slice(0, -2);
            if (last) latexContent.push(last);
            break;
        }
        latexContent.push(nextLine);
    }
    return latexContent.join('\n').trim();
}

function tryLatexBlock(ctx: ParseCtx, trimmed: string): boolean {
    if (!trimmed.startsWith('$$')) return false;
    if (trimmed.endsWith('$$') && trimmed.length > 4) {
        ctx.blocks.push({ type: 'latex', content: trimmed.slice(2, -2).trim() });
        return true;
    }
    const content = consumeLatexLines(ctx, trimmed.slice(2));
    ctx.blocks.push({ type: 'latex', content });
    return true;
}

function consumeCodeLines(ctx: ParseCtx): string {
    const content: string[] = [];
    while (ctx.index < ctx.lines.length) {
        const nextLine = ctx.lines[ctx.index];
        if (nextLine.trim() === '```') {
            ctx.index++;
            break;
        }
        content.push(nextLine);
        ctx.index++;
    }
    return content.join('\n');
}

function tryCodeBlock(ctx: ParseCtx, trimmed: string): boolean {
    if (!trimmed.startsWith('```')) return false;
    const language = trimmed.slice(3).trim() || null;
    const contentString = consumeCodeLines(ctx);
    if (language === 'mermaid') {
        ctx.blocks.push({ type: 'mermaid', content: contentString });
    } else {
        ctx.blocks.push({ type: 'code-block', language, content: contentString });
    }
    return true;
}

function consumeOptionLines(ctx: ParseCtx): string[] {
    const items: string[] = [];
    while (ctx.index < ctx.lines.length) {
        const nextLine = ctx.lines[ctx.index];
        if (nextLine.trim() === '</options>') {
            ctx.index++;
            break;
        }
        const optionMatch = nextLine.match(/<option>(.*?)<\/option>/);
        if (optionMatch) items.push(optionMatch[1]);
        ctx.index++;
    }
    return items;
}

function tryOptionsBlock(ctx: ParseCtx, trimmed: string): boolean {
    if (!trimmed.startsWith('<options>')) return false;
    const items = consumeOptionLines(ctx);
    if (items.length > 0) ctx.blocks.push({ type: 'options', items });
    return true;
}

function tryNumberedList(ctx: ParseCtx, trimmed: string): boolean {
    const numberedListMatch = trimmed.match(/^(\d+)\.\s/);
    if (!numberedListMatch) return false;
    const allLines = [{ number: parseInt(numberedListMatch[1]), content: trimmed.slice(numberedListMatch[0].length) }];
    while (ctx.index < ctx.lines.length) {
        const nextLine = ctx.lines[ctx.index].trim();
        const nextMatch = nextLine.match(/^(\d+)\.\s/);
        if (!nextMatch) break;
        allLines.push({ number: parseInt(nextMatch[1]), content: nextLine.slice(nextMatch[0].length) });
        ctx.index++;
    }
    ctx.blocks.push({
        type: 'numbered-list',
        items: allLines.map(l => ({ number: l.number, spans: parseMarkdownSpans(l.content, false) })),
    });
    return true;
}

function tryUnorderedList(ctx: ParseCtx, line: string): boolean {
    const firstInfo = parseListItemLine(line);
    if (!firstInfo) return false;
    const collected = collectListItems(ctx.lines, ctx.index, firstInfo);
    ctx.index = collected.nextIndex;
    ctx.blocks.push(buildListBlockFromItems(collected.items));
    return true;
}

function tryBlockquote(ctx: ParseCtx, trimmed: string, lineStartIndex: number): boolean {
    if (!trimmed.startsWith('>')) return false;
    const collected = collectBlockquote(ctx.lines, lineStartIndex);
    ctx.blocks.push(collected.block);
    ctx.index = collected.nextIndex;
    return true;
}

function tryTable(ctx: ParseCtx, trimmed: string, lineStartIndex: number): boolean {
    if (!trimmed.includes('|') || trimmed.startsWith('```')) return false;
    const { table, nextIndex } = parseTable(ctx.lines, lineStartIndex);
    if (!table) return false;
    ctx.blocks.push(table);
    ctx.index = nextIndex;
    return true;
}

function parseSingleLine(ctx: ParseCtx, line: string, lineStartIndex: number): void {
    if (tryHeader(ctx, line)) return;
    const trimmed = line.trim();
    if (tryLatexBlock(ctx, trimmed)) return;
    if (tryCodeBlock(ctx, trimmed)) return;
    if (tryImage(ctx, trimmed)) return;
    if (trimmed === '---') { ctx.blocks.push({ type: 'horizontal-rule' }); return; }
    if (tryOptionsBlock(ctx, trimmed)) return;
    if (tryBlockquote(ctx, trimmed, lineStartIndex)) return;
    if (tryNumberedList(ctx, trimmed)) return;
    if (tryUnorderedList(ctx, line)) return;
    if (tryTable(ctx, trimmed, lineStartIndex)) return;
    if (trimmed.length > 0) {
        ctx.blocks.push({ type: 'text', content: parseMarkdownSpans(trimmed, false) });
    }
}

export function parseMarkdownBlock(markdown: string) {
    const ctx: ParseCtx = { lines: markdown.split('\n'), index: 0, blocks: [] };
    while (ctx.index < ctx.lines.length) {
        const line = ctx.lines[ctx.index];
        const lineStartIndex = ctx.index;
        ctx.index++;
        parseSingleLine(ctx, line, lineStartIndex);
    }
    return ctx.blocks;
}
