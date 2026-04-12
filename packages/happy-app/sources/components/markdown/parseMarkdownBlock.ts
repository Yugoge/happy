import type { MarkdownBlock, MarkdownSpan } from "./parseMarkdown";
import { parseMarkdownSpans } from "./parseMarkdownSpans";

function splitTableCells(line: string): string[] {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function buildTableHeaders(headerLine: string): MarkdownSpan[][] {
    return splitTableCells(headerLine)
        .map(cell => parseMarkdownSpans(cell, false));
}

function buildTableRows(tableLines: string[]): MarkdownSpan[][][] {
    const rows: MarkdownSpan[][][] = [];
    for (let i = 2; i < tableLines.length; i++) {
        const rowLine = tableLines[i].trim();
        if (!rowLine.includes('|')) continue;
        const rowCells = splitTableCells(rowLine)
            .map(cell => parseMarkdownSpans(cell, false));
        if (rowCells.length > 0) rows.push(rowCells);
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
    const headers = buildTableHeaders(tableLines[0]);
    if (headers.length === 0) return { table: null, nextIndex: startIndex };
    const rows = buildTableRows(tableLines);
    return { table: { type: 'table', headers, rows }, nextIndex: index };
}

function parseLatexBlock(lines: string[], index: number, trimmed: string): { block: MarkdownBlock; nextIndex: number } | null {
    if (!trimmed.startsWith('$$')) return null;
    if (trimmed.endsWith('$$') && trimmed.length > 4) {
        return { block: { type: 'latex', content: trimmed.slice(2, -2).trim() }, nextIndex: index };
    }
    const latexContent = [trimmed.slice(2)];
    while (index < lines.length) {
        const nextLine = lines[index];
        index++;
        if (nextLine.trim().endsWith('$$')) {
            const last = nextLine.trim().slice(0, -2);
            if (last) latexContent.push(last);
            break;
        }
        latexContent.push(nextLine);
    }
    return { block: { type: 'latex', content: latexContent.join('\n').trim() }, nextIndex: index };
}

function parseCodeBlock(lines: string[], index: number, trimmed: string): { block: MarkdownBlock; nextIndex: number } {
    const language = trimmed.slice(3).trim() || null;
    const content: string[] = [];
    while (index < lines.length) {
        const nextLine = lines[index];
        if (nextLine.trim() === '```') { index++; break; }
        content.push(nextLine);
        index++;
    }
    const contentString = content.join('\n');
    const block: MarkdownBlock = language === 'mermaid'
        ? { type: 'mermaid', content: contentString }
        : { type: 'code-block', language, content: contentString };
    return { block, nextIndex: index };
}

function parseOptionsBlock(lines: string[], index: number): { block: MarkdownBlock | null; nextIndex: number } {
    const items: string[] = [];
    while (index < lines.length) {
        const nextLine = lines[index];
        if (nextLine.trim() === '</options>') { index++; break; }
        const optionMatch = nextLine.match(/<option>(.*?)<\/option>/);
        if (optionMatch) items.push(optionMatch[1]);
        index++;
    }
    if (items.length === 0) return { block: null, nextIndex: index };
    return { block: { type: 'options', items }, nextIndex: index };
}

function parseNumberedList(lines: string[], index: number, trimmed: string, firstMatch: RegExpMatchArray): { block: MarkdownBlock; nextIndex: number } {
    const allLines = [{ number: parseInt(firstMatch[1]), content: trimmed.slice(firstMatch[0].length) }];
    while (index < lines.length) {
        const nextLine = lines[index].trim();
        const nextMatch = nextLine.match(/^(\d+)\.\s+/);
        if (!nextMatch) break;
        allLines.push({ number: parseInt(nextMatch[1]), content: nextLine.slice(nextMatch[0].length) });
        index++;
    }
    const items = allLines.map(l => ({ number: l.number, spans: parseMarkdownSpans(l.content, false) }));
    return { block: { type: 'numbered-list', items }, nextIndex: index };
}

function parseUnorderedList(lines: string[], index: number, trimmed: string, firstMatch: RegExpMatchArray): { block: MarkdownBlock; nextIndex: number } {
    const allLines = [trimmed.slice(firstMatch[0].length)];
    while (index < lines.length) {
        const nextLine = lines[index].trim();
        const nextMatch = nextLine.match(/^([-*+])\s+/);
        if (!nextMatch) break;
        allLines.push(nextLine.slice(nextMatch[0].length));
        index++;
    }
    return { block: { type: 'list', items: allLines.map(l => parseMarkdownSpans(l, false)) }, nextIndex: index };
}

function processHeaderLine(line: string, blocks: MarkdownBlock[]): boolean {
    for (let i = 1; i <= 6; i++) {
        if (line.startsWith(`${'#'.repeat(i)} `)) {
            const level = i as 1 | 2 | 3 | 4 | 5 | 6;
            blocks.push({ type: 'header', level, content: parseMarkdownSpans(line.slice(i + 1).trim(), true) });
            return true;
        }
    }
    return false;
}

function processInlineBlocks(lines: string[], index: number, trimmed: string, blocks: MarkdownBlock[]): number | null {
    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) { blocks.push({ type: 'image', alt: imageMatch[1], url: imageMatch[2].trim() }); return index; }
    const numberedMatch = trimmed.match(/^(\d+)\.\s+/);
    if (numberedMatch) { const r = parseNumberedList(lines, index, trimmed, numberedMatch); blocks.push(r.block); return r.nextIndex; }
    const listMatch = trimmed.match(/^([-*+])\s+/);
    if (listMatch) { const r = parseUnorderedList(lines, index, trimmed, listMatch); blocks.push(r.block); return r.nextIndex; }
    if (trimmed.includes('|') && !trimmed.startsWith('```')) {
        const { table, nextIndex } = parseTable(lines, index - 1);
        if (table) { blocks.push(table); return nextIndex; }
    }
    return null;
}

function processLine(lines: string[], index: number, line: string, blocks: MarkdownBlock[]): number {
    if (processHeaderLine(line, blocks)) return index;
    const trimmed = line.trim();
    const latex = parseLatexBlock(lines, index, trimmed);
    if (latex) { blocks.push(latex.block); return latex.nextIndex; }
    if (trimmed.startsWith('```')) { const r = parseCodeBlock(lines, index, trimmed); blocks.push(r.block); return r.nextIndex; }
    if (trimmed === '---') { blocks.push({ type: 'horizontal-rule' }); return index; }
    if (trimmed.startsWith('<options>')) { const r = parseOptionsBlock(lines, index); if (r.block) blocks.push(r.block); return r.nextIndex; }
    const inlineResult = processInlineBlocks(lines, index, trimmed, blocks);
    if (inlineResult !== null) return inlineResult;
    if (trimmed.length > 0) blocks.push({ type: 'text', content: parseMarkdownSpans(trimmed, false) });
    return index;
}

export function parseMarkdownBlock(markdown: string) {
    const blocks: MarkdownBlock[] = [];
    const lines = markdown.split('\n');
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        index++;
        index = processLine(lines, index, line, blocks);
    }
    return blocks;
}
