import { stringifyToolCommand } from './toolCommand';
import type { ToolCall } from '@/sync/typesMessage';
import type { Metadata } from '@/sync/storageTypes';

export type TerminalRenderData = {
    command: string;
    stdout: string | null;
    stderr: string | null;
    error: string | null;
    statusLine: string | null;
    extraLines: number;
};

export type PlanRenderItem = {
    step: string;
    status: string;
};

export type AttachmentSummary = {
    label: string;
    path: string | null;
    size: string | null;
    dimensions: string | null;
    previewUri: string | null;
    previewUnavailableReason: string | null;
};

export type GenericToolSummary = {
    lines: string[];
    detailsHint: string | null;
};

// Codex tool-name discriminants — set by CLI sessionProtocolMapper. Claude generic
// tools (Grep/Glob/WebSearch/ToolSearch) use bare names and never match these,
// preserving the 2026-04-25 scope-leak fix.
const CODEX_TOOL_NAME_PREFIXES = ['Codex', 'functions.', 'multi_tool_use.', 'web.'] as const;
const CODEX_METADATA_TOOL_NAME_PREFIXES = ['mcp__'] as const;
const CODEX_TOOL_NAME_EXACT = new Set<string>(['file']);
const CODEX_SUBAGENT_CONTROL_TOOLS = new Set<string>([
    'functions.spawn_agent',
    'functions.send_input',
    'functions.wait_agent',
    'functions.resume_agent',
    'functions.close_agent',
]);

export function isCodexSourceTool(tool: ToolCall, metadata?: Metadata | null): boolean {
    if (CODEX_TOOL_NAME_EXACT.has(tool.name)) return true;
    if (metadata?.flavor === 'codex'
        && CODEX_METADATA_TOOL_NAME_PREFIXES.some((p) => tool.name.startsWith(p))) {
        return true;
    }
    return CODEX_TOOL_NAME_PREFIXES.some((p) => tool.name.startsWith(p));
}

export function shouldRenderToolContent(
    tool: ToolCall,
    hasSpecializedView: boolean,
    minimal: boolean,
    metadata?: Metadata | null,
): boolean {
    if (CODEX_SUBAGENT_CONTROL_TOOLS.has(tool.name)) return false;
    return hasSpecializedView || isCodexSourceTool(tool, metadata);
}

const TERMINAL_OUTPUT_KEYS = ['stdout', 'output', 'data', 'text', 'content'];
const TERMINAL_ERROR_KEYS = ['stderr', 'error', 'message'];
const EXIT_CODE_KEYS = ['exit_code', 'exitCode', 'exit_status', 'exitStatus', 'return_code', 'code'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringifyUnknown(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return stringifyInspectableValue(value);
}

function readValue(record: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return null;
}

function readNestedStatus(result: Record<string, unknown>): { code: string | null; status: string | null } {
    const code = stringifyUnknown(readValue(result, EXIT_CODE_KEYS));
    const status = stringifyUnknown(result.status);
    if (isRecord(result.metadata)) {
        return {
            code: code ?? stringifyUnknown(readValue(result.metadata, EXIT_CODE_KEYS)),
            status: status ?? stringifyUnknown(result.metadata.status),
        };
    }
    return { code, status };
}

function parseProtocolResult(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return value;
    try {
        const parsed = JSON.parse(trimmed);
        return isRecord(parsed) ? parsed : value;
    } catch {
        return value;
    }
}

function summarizeText(value: unknown, maxLength = 160): string | null {
    const text = stringifyUnknown(value);
    if (!text) return null;
    const singleLine = text.replace(/\s+/g, ' ').trim();
    if (!singleLine) return null;
    return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 3)}...` : singleLine;
}

function readArray(record: Record<string, unknown>, keys: string[]): unknown[] | null {
    for (const key of keys) {
        if (Array.isArray(record[key])) return record[key] as unknown[];
    }
    return null;
}

function summarizeReason(value: unknown): string | null {
    if (!isRecord(value)) return summarizeText(value);
    return [value.type, value.status, value.reason, value.message]
        .map((entry) => summarizeText(entry, 80))
        .filter(Boolean)
        .join(' · ') || null;
}

function summarizeMcpEmpty(tool: ToolCall, record: Record<string, unknown>): string | null {
    const templates = readArray(record, ['resourceTemplates', 'resource_templates', 'templates']);
    if (templates?.length === 0 || (tool.name.includes('resource_templates') && !templates)) {
        return 'No MCP resource templates returned';
    }
    const resources = readArray(record, ['resources']);
    if (resources?.length === 0 || (tool.name.includes('list_mcp_resources') && !resources)) {
        return 'No MCP resources returned';
    }
    return null;
}

function summarizeWebResult(record: Record<string, unknown>): string[] {
    const rows = readArray(record, ['results', 'search_query', 'image_query', 'weather', 'finance', 'sports', 'time']) ?? [];
    const first = rows.find(isRecord);
    if (!first) return [];
    return [
        summarizeText(first.title ?? first.name ?? first.location ?? first.ticker ?? first.league ?? first.time),
        summarizeText(first.snippet ?? first.summary ?? first.description ?? first.url ?? first.value),
    ].filter((line): line is string => !!line);
}

export function buildGenericToolSummary(tool: ToolCall): GenericToolSummary {
    const parsedResult = parseProtocolResult(tool.result);
    const resultRecord = isRecord(parsedResult) ? parsedResult : null;
    const lines: string[] = [];

    if (resultRecord) {
        const unavailable = tool.name === 'functions.request_user_input'
            ? summarizeText(resultRecord.error ?? resultRecord.message ?? resultRecord.reason)
            : null;
        if (unavailable) lines.push(unavailable);

        const mcpEmpty = summarizeMcpEmpty(tool, resultRecord);
        if (mcpEmpty) lines.push(mcpEmpty);

        if (tool.name.startsWith('web.')) {
            lines.push(...summarizeWebResult(resultRecord));
        }

        const error = summarizeText(resultRecord.error ?? resultRecord.message);
        if (error && !lines.includes(error)) lines.push(error);

        const reason = summarizeReason(resultRecord.reason);
        if (reason && !lines.includes(reason)) lines.push(reason);

        const status = summarizeText(resultRecord.status);
        if (status && status !== 'completed' && !lines.some((line) => line.includes(status))) {
            lines.push(`status: ${status}`);
        }

        const primaryOutput = summarizeText(resultRecord.output ?? resultRecord.content ?? resultRecord.summary);
        if (primaryOutput && lines.length === 0) lines.push(primaryOutput);
    } else {
        const text = summarizeText(parsedResult);
        if (text) lines.push(text);
    }

    if (lines.length === 0 && tool.state === 'completed') {
        lines.push('Completed with no visible output');
    }
    if (lines.length === 0 && tool.state === 'running') {
        lines.push('Running');
    }

    const hasDetails = tool.input !== undefined || tool.result !== undefined;
    return {
        lines: lines.slice(0, 3),
        detailsHint: hasDetails ? 'Raw input/output available in details' : null,
    };
}

function parseInspectableString(value: string): unknown {
    const trimmed = value.trim();
    if ((!trimmed.startsWith('{') || !trimmed.endsWith('}'))
        && (!trimmed.startsWith('[') || !trimmed.endsWith(']'))) {
        return value;
    }
    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' ? parsed : value;
    } catch {
        return value;
    }
}

export function countRenderableLines(text: string | null | undefined): number {
    if (!text || !text.trim()) return 0;
    return text.split('\n').length;
}

export function truncateRenderableLines(text: string | null | undefined, maxLines: number): string | null {
    if (!text || !text.trim()) return null;
    const lines = text.split('\n');
    if (lines.length <= maxLines) return text;
    return lines.slice(0, maxLines).join('\n');
}

export function stringifyInspectableValue(value: unknown): string {
    if (typeof value === 'string') {
        const parsed = parseInspectableString(value);
        if (parsed !== value) return stringifyInspectableValue(parsed);
        return value.length > 0 ? value : '""';
    }
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, nested) => {
        if (nested && typeof nested === 'object') {
            if (seen.has(nested)) return '[Circular]';
            seen.add(nested);
        }
        return nested;
    }, 2) ?? String(value);
}

export function truncateInspectableText(text: string, maxLines: number, maxChars: number) {
    const lines = text.split('\n');
    const lineTruncated = lines.length > maxLines;
    let preview = lineTruncated ? lines.slice(0, maxLines).join('\n') : text;
    const charTruncated = preview.length > maxChars;
    if (charTruncated) preview = preview.slice(0, maxChars);
    return {
        text: preview,
        truncated: lineTruncated || charTruncated,
        hiddenLines: Math.max(0, lines.length - Math.min(lines.length, maxLines)),
    };
}

export function readCodexCommand(input: any): string {
    const parsedCmd = input?.parsed_cmd;
    if (Array.isArray(parsedCmd)) {
        const command = parsedCmd.find((entry) => typeof entry?.cmd === 'string' && entry.cmd.trim());
        if (command) return command.cmd.trim();
    }
    return stringifyToolCommand(input?.command)
        ?? stringifyUnknown(input?.cmd)
        ?? stringifyUnknown(input?.title)
        ?? '';
}

function buildStatusLine(state: string, result: unknown): string | null {
    if (!isRecord(result)) return state === 'error' ? 'status: error' : null;
    const { code, status } = readNestedStatus(result);
    const statusPart = status && status !== 'completed' ? `status: ${status}` : null;
    const codePart = code !== null ? `exit ${code}` : null;
    return [codePart, statusPart].filter(Boolean).join(' · ') || null;
}

export function buildTerminalRenderData(
    input: any,
    state: string,
    result: unknown,
    previewLines?: number,
): TerminalRenderData {
    const parsedResult = parseProtocolResult(result);
    const command = readCodexCommand(input);
    let stdout: string | null = null;
    let stderr: string | null = null;
    let error: string | null = null;

    if (typeof parsedResult === 'string') {
        if (state === 'error') error = parsedResult;
        else stdout = parsedResult;
    } else if (isRecord(parsedResult)) {
        const hasTerminalKeys = [...TERMINAL_OUTPUT_KEYS, ...TERMINAL_ERROR_KEYS]
            .some((key) => key in parsedResult);
        stdout = stringifyUnknown(readValue(parsedResult, TERMINAL_OUTPUT_KEYS));
        stderr = stringifyUnknown(readValue(parsedResult, TERMINAL_ERROR_KEYS.slice(0, 1)));
        if (state === 'error') {
            const errorText = stringifyUnknown(readValue(parsedResult, TERMINAL_ERROR_KEYS)) ?? stringifyInspectableValue(parsedResult);
            error = errorText !== stderr ? errorText : null;
        } else if (!stdout && !stderr && !hasTerminalKeys) {
            stdout = stringifyInspectableValue(parsedResult);
        }
    }

    const statusLine = buildStatusLine(state, parsedResult);
    const totalLines = countRenderableLines(command) + countRenderableLines(stdout)
        + countRenderableLines(stderr) + countRenderableLines(error) + countRenderableLines(statusLine);

    if (previewLines === undefined) {
        return { command, stdout, stderr, error, statusLine, extraLines: 0 };
    }

    const previewCommand = truncateRenderableLines(command, previewLines) ?? command;
    const previewStdout = truncateRenderableLines(stdout, previewLines);
    const previewStderr = truncateRenderableLines(stderr, previewLines);
    const previewError = truncateRenderableLines(error, previewLines);
    const shownLines = countRenderableLines(previewCommand) + countRenderableLines(previewStdout)
        + countRenderableLines(previewStderr) + countRenderableLines(previewError)
        + countRenderableLines(statusLine);

    return {
        command: previewCommand,
        stdout: previewStdout,
        stderr: previewStderr,
        error: previewError,
        statusLine,
        extraLines: Math.max(0, totalLines - shownLines),
    };
}

export function extractPlanItems(input: any): PlanRenderItem[] {
    const rawPlan = input?.plan ?? input?.steps ?? input?.todos;
    if (Array.isArray(rawPlan)) {
        return rawPlan.map((item, index) => {
            if (typeof item === 'string') return { step: item, status: 'pending' };
            const step = stringifyUnknown(item?.step ?? item?.content ?? item?.text ?? item?.title)
                ?? `Step ${index + 1}`;
            const status = stringifyUnknown(item?.status) ?? 'pending';
            return { step, status };
        });
    }
    if (typeof rawPlan === 'string') {
        return rawPlan.split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => ({ step: line.replace(/^[-*\d.\s]+/, ''), status: 'pending' }));
    }
    return [];
}

export function summarizePlanItems(items: PlanRenderItem[]): string {
    const completed = items.filter((item) => item.status === 'completed').length;
    const inProgress = items.filter((item) => item.status === 'in_progress').length;
    if (items.length === 0) return 'Update plan';
    return `Plan: ${items.length} steps (${completed} done${inProgress ? `, ${inProgress} active` : ''})`;
}

export function extractToolUses(input: any): { name: string; summary: string | null }[] {
    const rawUses = Array.isArray(input?.tool_uses) ? input.tool_uses : [];
    return rawUses.map((use: any, index: number) => {
        const name = stringifyUnknown(use?.name ?? use?.tool_name ?? use?.recipient_name)
            ?? `tool ${index + 1}`;
        const summary = stringifyUnknown(use?.description ?? use?.parameters ?? use?.args);
        return { name, summary };
    });
}

export function extractAttachmentSummary(input: any, result?: unknown): AttachmentSummary {
    const parsedResult = parseProtocolResult(result);
    const resultRecord = isRecord(parsedResult) ? parsedResult : {};
    const path = stringifyUnknown(input?.path ?? input?.image_path ?? input?.ref ?? resultRecord.path
        ?? resultRecord.file_path ?? resultRecord.filePath) ?? null;
    const pathName = path ? path.split('/').filter(Boolean).pop() : null;
    const label = stringifyUnknown(input?.name ?? input?.title ?? resultRecord.name) ?? pathName ?? 'Attachment';
    const rawSize = input?.size ?? resultRecord.size;
    const size = typeof rawSize === 'number' ? `${rawSize} bytes` : stringifyUnknown(rawSize);
    const image = isRecord(input?.image) ? input.image : isRecord(resultRecord.image) ? resultRecord.image : null;
    const width = image ? stringifyUnknown(image.width) : stringifyUnknown(input?.width ?? resultRecord.width);
    const height = image ? stringifyUnknown(image.height) : stringifyUnknown(input?.height ?? resultRecord.height);
    const dimensions = width && height ? `${width}×${height}` : null;
    const previewUri = stringifyUnknown(
        input?.preview_uri ?? input?.previewUri ?? input?.url ?? input?.uri
        ?? resultRecord.preview_uri ?? resultRecord.previewUri ?? resultRecord.url ?? resultRecord.uri
        ?? (image ? image.preview_uri ?? image.previewUri ?? image.url ?? image.uri : null)
    );
    const previewUnavailableReason = stringifyUnknown(resultRecord.preview_unavailable_reason);
    return { label, path, size, dimensions, previewUri, previewUnavailableReason };
}
