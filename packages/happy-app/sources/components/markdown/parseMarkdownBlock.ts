import type { LinkDef, MarkdownBlock, MarkdownSpan } from "./parseMarkdown";
import { normalizeLinkLabel, parseMarkdownSpans } from "./parseMarkdownSpans";

// Cycle 8 (#10): link reference definition matcher. Strict — must be a
// single line, optional 0-3 leading spaces, label has no `]`, URL is a
// non-whitespace token, optional double-quoted title. Mirrors CommonMark
// §4.7 with intentional pruning of edge cases (no <url>, no multi-line title).
const LINK_DEF_RE = /^\s{0,3}\[([^\]]+)\]:\s+(\S+)(?:\s+"([^"]*)")?\s*$/;

// Cycle 8 (#11): footnote definition matcher. Single-line body. Pandoc
// allows multi-line indented continuation; that's an explicit non-goal (BA W2).
const FOOTNOTE_DEF_RE = /^\s{0,3}\[\^([^\]\s]+)\]:\s+(.+)$/;

// Cycle 8: shared parse context — linkDefs + footnoteDefs threaded through
// recursive parseMarkdownBlock + parseMarkdownSpans calls so reference-style
// links and footnote chips inside nested blocks (lists, blockquotes, table
// cells) resolve against the message-global definition pool.
export type BlockDefs = {
    linkDefs: Map<string, LinkDef>,
    footnoteDefs: Map<string, MarkdownSpan[]>,
};

export const EMPTY_DEFS: BlockDefs = { linkDefs: new Map(), footnoteDefs: new Map() };

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

function buildTaskListBlock(items: ListItemInfo[], defs: BlockDefs): MarkdownBlock {
    return {
        type: 'task-list',
        items: items.map(i => ({
            checked: i.taskChecked === true,
            depth: i.depth,
            spans: parseMarkdownSpans(i.content, false, defs.linkDefs, defs.footnoteDefs),
        })),
    };
}

function buildListBlockFromItems(items: ListItemInfo[], defs: BlockDefs): MarkdownBlock {
    const hasTask = items.some(i => i.taskChecked !== null);
    if (hasTask) return buildTaskListBlock(items, defs);
    return {
        type: 'list',
        items: items.map(i => ({ depth: i.depth, spans: parseMarkdownSpans(i.content, false, defs.linkDefs, defs.footnoteDefs) })),
    };
}

// Blockquote: count leading ">" for nesting; consume consecutive ">"-prefixed lines.
function countQuoteDepth(trimmedLine: string): { depth: number, rest: string } | null {
    const m = trimmedLine.match(/^(>+)\s?(.*)$/);
    if (!m) return null;
    return { depth: m[1].length, rest: m[2] };
}

function collectBlockquote(lines: string[], startIndex: number, defs: BlockDefs): { block: MarkdownBlock, nextIndex: number } {
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
    // Cycle 8: nested blockquote inherits parent message defs so reference links
    // and footnote chips inside quotes resolve against message-global pool.
    const content = parseMarkdownBlockWithDefs(innerLines.join('\n'), defs);
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
    defs: BlockDefs;
};

function tryHeader(ctx: ParseCtx, line: string): boolean {
    for (let i = 1; i <= 6; i++) {
        if (line.startsWith(`${'#'.repeat(i)} `)) {
            ctx.blocks.push({
                type: 'header',
                level: i as 1 | 2 | 3 | 4 | 5 | 6,
                content: parseMarkdownSpans(line.slice(i + 1).trim(), true, ctx.defs.linkDefs, ctx.defs.footnoteDefs),
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

// Cycle 7 (B3 #13): nested ordered lists — capture leading whitespace on raw
// line, derive depth (Math.floor(indent/2), capped at 6) mirroring parseListItemLine.
const NUMBERED_LIST_RE = /^(\s*)(\d+)\.\s(.*)$/;

function tryNumberedList(ctx: ParseCtx, line: string): boolean {
    const m = line.match(NUMBERED_LIST_RE);
    if (!m) return false;
    const items = [{ number: parseInt(m[2]), depth: Math.min(Math.floor(m[1].length / 2), 6), content: m[3] }];
    while (ctx.index < ctx.lines.length) {
        const nextMatch = ctx.lines[ctx.index].match(NUMBERED_LIST_RE);
        if (!nextMatch) break;
        items.push({ number: parseInt(nextMatch[2]), depth: Math.min(Math.floor(nextMatch[1].length / 2), 6), content: nextMatch[3] });
        ctx.index++;
    }
    ctx.blocks.push({
        type: 'numbered-list',
        items: items.map(l => ({ number: l.number, depth: l.depth, spans: parseMarkdownSpans(l.content, false, ctx.defs.linkDefs, ctx.defs.footnoteDefs) })),
    });
    return true;
}

function tryUnorderedList(ctx: ParseCtx, line: string): boolean {
    const firstInfo = parseListItemLine(line);
    if (!firstInfo) return false;
    const collected = collectListItems(ctx.lines, ctx.index, firstInfo);
    ctx.index = collected.nextIndex;
    ctx.blocks.push(buildListBlockFromItems(collected.items, ctx.defs));
    return true;
}

function tryBlockquote(ctx: ParseCtx, trimmed: string, lineStartIndex: number): boolean {
    if (!trimmed.startsWith('>')) return false;
    const collected = collectBlockquote(ctx.lines, lineStartIndex, ctx.defs);
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

// Cycle 8 (#9): <details><summary>...</summary>body</details> block parser.
// `<details>` opens block; optional `open` attribute → block.open=true.
// Optional `<summary>...</summary>` provides clickable label; absent →
// summary stays empty. Body lines until `</details>` are recursively parsed
// via parseMarkdownBlockWithDefs so nested constructs (lists, code, even
// nested <details>) work. If `</details>` is missing through end-of-input,
// falls through to literal text via early return.
const DETAILS_OPEN_RE = /^\s*<details(\s+open)?\s*>(.*)$/;
// Cycle 9 (CR-2 M7): SUMMARY_LINE_RE relaxed — group 2 captures inline body
// remainder after </summary>, so `<summary>X</summary>Y` form is recognized.
// When there is no inline body, group 2 captures empty string (existing
// multi-line case still works via bodyStart: i + 1 branch).
const SUMMARY_LINE_RE = /^\s*<summary>(.*?)<\/summary>\s*(.*)$/;

// Cycle 9 (CR-2 M5): scan from `from` (inclusive) so a single-line
// `<details><summary>...</summary>...</details>` form is recognized — the
// opening line itself can also carry the closing `</details>` token.
function findDetailsClose(lines: string[], from: number): number {
    for (let i = from; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === '</details>' || t.endsWith('</details>')) return i;
    }
    return -1;
}

// Cycle 9 (CR-2 M6): when openIndex === endIndex (same-line close),
// inlineRest (the captured (.*) after `<details>`) already contains the
// `</details>` suffix — strip it and skip the multi-line closerHead branch
// to avoid double-counting the same line.
function collectDetailsBody(lines: string[], openIndex: number, endIndex: number, inlineRest: string): string[] {
    const bodyLines: string[] = [];
    if (openIndex === endIndex) {
        const stripped = inlineRest.replace(/<\/details>\s*$/, '');
        if (stripped.length > 0) bodyLines.push(stripped);
        return bodyLines;
    }
    if (inlineRest.trim().length > 0) bodyLines.push(inlineRest);
    for (let i = openIndex + 1; i < endIndex; i++) bodyLines.push(lines[i]);
    const closerHead = lines[endIndex].replace(/<\/details>\s*$/, '');
    if (closerHead.trim().length > 0) bodyLines.push(closerHead);
    return bodyLines;
}

// Cycle 9 (CR-2 M7): when SUMMARY_LINE_RE matches with a non-empty group-2
// (inline body remainder after </summary>), mutate bodyLines[i] to the
// remainder and return bodyStart: i — the next iteration treats the same
// slot as the first body line. When group 2 is empty, behaves as before
// (existing multi-line form uses bodyStart: i + 1).
function extractDetailsSummary(bodyLines: string[], defs: BlockDefs): { summary: MarkdownSpan[], bodyStart: number } {
    for (let i = 0; i < bodyLines.length; i++) {
        const raw = bodyLines[i];
        if (raw.trim().length === 0) continue;
        const sm = raw.match(SUMMARY_LINE_RE);
        if (!sm) return { summary: [], bodyStart: 0 };
        const summarySpans = parseMarkdownSpans(sm[1], false, defs.linkDefs, defs.footnoteDefs);
        const inlineBody = sm[2] ?? '';
        if (inlineBody.trim().length > 0) {
            bodyLines[i] = inlineBody;
            return { summary: summarySpans, bodyStart: i };
        }
        return { summary: summarySpans, bodyStart: i + 1 };
    }
    return { summary: [], bodyStart: 0 };
}

function tryDetailsBlock(ctx: ParseCtx, line: string, lineStartIndex: number): boolean {
    const openMatch = line.match(DETAILS_OPEN_RE);
    if (!openMatch) return false;
    // Cycle 9 (CR-2 M5): scan from lineStartIndex (inclusive) so single-line
    // form `<details><summary>X</summary>Y</details>` is recognized.
    const endIndex = findDetailsClose(ctx.lines, lineStartIndex);
    if (endIndex === -1) return false;
    const isOpen = !!openMatch[1];
    const bodyLines = collectDetailsBody(ctx.lines, lineStartIndex, endIndex, openMatch[2]);
    const { summary, bodyStart } = extractDetailsSummary(bodyLines, ctx.defs);
    const bodyText = bodyLines.slice(bodyStart).join('\n');
    const bodyBlocks = parseMarkdownBlockWithDefs(bodyText, ctx.defs);
    ctx.blocks.push({ type: 'details', open: isOpen, summary, content: bodyBlocks });
    ctx.index = endIndex + 1;
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
    if (tryDetailsBlock(ctx, line, lineStartIndex)) return;
    if (tryBlockquote(ctx, trimmed, lineStartIndex)) return;
    if (tryNumberedList(ctx, line)) return;
    if (tryUnorderedList(ctx, line)) return;
    if (tryTable(ctx, trimmed, lineStartIndex)) return;
    if (trimmed.length > 0) {
        ctx.blocks.push({ type: 'text', content: parseMarkdownSpans(trimmed, false, ctx.defs.linkDefs, ctx.defs.footnoteDefs) });
    }
}

// Cycle 9 (CR-1): detect fence opener using the SAME predicate as `tryCodeBlock`
// at parseMarkdownBlock.ts:207 — `line.trim().startsWith('```' or '~~~')` —
// so the def-extractor and renderer agree on what counts as a fence (any
// leading whitespace OK, including tabs). Returns marker + run length when a
// fence opens, or null otherwise.
function detectFenceOpener(line: string): { marker: '`' | '~', len: number } | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('```') && !trimmed.startsWith('~~~')) return null;
    const marker = trimmed[0] as '`' | '~';
    let len = 0;
    while (len < trimmed.length && trimmed[len] === marker) len++;
    return { marker, len };
}

// Cycle 9 (CR-1): closer rules per CommonMark §4.5: same marker char, run
// length >= opener length, only trailing whitespace after the run (info
// string disallowed on closer — `\`\`\`ts` does NOT close a `\`\`\`` fence).
function isFenceCloser(line: string, marker: '`' | '~', openerLen: number): boolean {
    const trimmed = line.trim();
    const closeRunMatch = trimmed.match(/^([`~])\1*/);
    if (!closeRunMatch || closeRunMatch[1] !== marker) return false;
    if (closeRunMatch[0].length < openerLen) return false;
    return trimmed.slice(closeRunMatch[0].length).trim() === '';
}

// Cycle 9 (CR-1): classify one outside-fence line as def / fence-opener /
// body-line. Mutates linkDefs / footnoteRawDefs in place when a def is found.
type OutsideFenceResult =
    | { kind: 'def-consumed' }
    | { kind: 'opened', fence: { marker: '`' | '~', len: number } }
    | { kind: 'pushed' };

function classifyOutsideFenceLine(
    line: string,
    linkDefs: Map<string, LinkDef>,
    footnoteRawDefs: Map<string, string>,
): OutsideFenceResult {
    const opener = detectFenceOpener(line);
    if (opener) return { kind: 'opened', fence: opener };
    const lm = line.match(LINK_DEF_RE);
    if (lm && !lm[1].startsWith('^')) {
        linkDefs.set(normalizeLinkLabel(lm[1]), { url: lm[2], title: lm[3] });
        return { kind: 'def-consumed' };
    }
    const fm = line.match(FOOTNOTE_DEF_RE);
    if (fm) {
        footnoteRawDefs.set(fm[1], fm[2]);
        return { kind: 'def-consumed' };
    }
    return { kind: 'pushed' };
}

// Cycle 8: two-pass footnote resolution so cross-footnote references resolve
// (a footnote body can reference another footnote via [^other]).
function resolveFootnoteDefs(
    footnoteRawDefs: Map<string, string>,
    linkDefs: Map<string, LinkDef>,
): Map<string, MarkdownSpan[]> {
    const footnoteDefs = new Map<string, MarkdownSpan[]>();
    for (const [label, body] of footnoteRawDefs) {
        footnoteDefs.set(label, parseMarkdownSpans(body, false, linkDefs, new Map()));
    }
    for (const [label, body] of footnoteRawDefs) {
        footnoteDefs.set(label, parseMarkdownSpans(body, false, linkDefs, footnoteDefs));
    }
    return footnoteDefs;
}

// Cycle 8: pre-pass — sweep raw lines, capture link/footnote def lines into
// `defs`, return body lines (def lines stripped). Footnote bodies parsed to
// spans using linkDefs (a body containing [ref][] resolves).
//
// Cycle 9 (CR-1): fence-aware. While inside a fenced code block, def-shaped
// lines are NOT stripped — they pass through verbatim. Tracks marker char
// ('`' vs '~') and run length so a tilde fence is not closed by a backtick
// fence and vice versa. Unclosed fences preserve all remaining lines (no def
// stripping anywhere from fence-open to EOF).
function extractDefinitions(rawLines: string[]): { bodyLines: string[], defs: BlockDefs } {
    const linkDefs = new Map<string, LinkDef>();
    const footnoteRawDefs = new Map<string, string>();
    const bodyLines: string[] = [];
    let fence: { marker: '`' | '~', len: number } | null = null;
    for (const line of rawLines) {
        if (fence !== null) {
            if (isFenceCloser(line, fence.marker, fence.len)) fence = null;
            bodyLines.push(line);
            continue;
        }
        const result = classifyOutsideFenceLine(line, linkDefs, footnoteRawDefs);
        if (result.kind === 'opened') { fence = result.fence; bodyLines.push(line); }
        else if (result.kind === 'pushed') bodyLines.push(line);
    }
    return { bodyLines, defs: { linkDefs, footnoteDefs: resolveFootnoteDefs(footnoteRawDefs, linkDefs) } };
}

// Cycle 8: recursive entry — parses with caller-supplied defs (no re-extraction).
// Used by blockquote/details inner-block recursion so nested blocks see the
// message-global definition pool, not their own local sweep.
function parseMarkdownBlockWithDefs(markdown: string, defs: BlockDefs): MarkdownBlock[] {
    const ctx: ParseCtx = { lines: markdown.split('\n'), index: 0, blocks: [], defs };
    while (ctx.index < ctx.lines.length) {
        const line = ctx.lines[ctx.index];
        const lineStartIndex = ctx.index;
        ctx.index++;
        parseSingleLine(ctx, line, lineStartIndex);
    }
    return ctx.blocks;
}

// Cycle 8: top-level entry. Two-pass: (1) extract link/footnote defs, strip
// def lines from body; (2) parse body with extracted defs. Returned array
// has non-enumerable `footnotes` field (typed as ParsedMarkdown at callsite)
// so render-layer consumers can resolve [^label] chips.
export function parseMarkdownBlock(markdown: string): MarkdownBlock[] {
    const { bodyLines, defs } = extractDefinitions(markdown.split('\n'));
    const blocks = parseMarkdownBlockWithDefs(bodyLines.join('\n'), defs);
    Object.defineProperty(blocks, 'footnotes', {
        value: defs.footnoteDefs, enumerable: false, writable: false,
    });
    Object.defineProperty(blocks, 'linkDefs', {
        value: defs.linkDefs, enumerable: false, writable: false,
    });
    return blocks;
}
