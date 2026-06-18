import * as React from 'react';
import { stringifyToolCommand } from './toolCommand';
import { parseToolUseError } from './toolErrorParser';
import { isMcpInlineChipOnlyTool } from '@/components/tools/mcpHelpers';
import type { Message, ToolCall } from '@/sync/typesMessage';
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
    // Bare names (reducer normalizes functions.* prefix for these four verbs)
    'spawn_agent',
    'send_input',
    'wait_agent',
    'close_agent',
]);

// Cycle 6 — D.5 subagent lifecycle merged card. Synthetic envelope name.
export const CODEX_LIFECYCLE_TOOL = 'functions.subagent_lifecycle';

// Map<sessionSubagent, messageId> derived once per messages[] reference change
// in ChatList; consumed by MessageView to suppress underlying spawn/wait/close
// cards when a lifecycle envelope exists for the same sessionSubagent.
// Default-not-suppress: an empty Map renders ALL cards (failure mode = 4 cards
// instead of 0 cards, per AC8).
export type LifecycleSuppressionMap = ReadonlyMap<string, string>;

export const LifecycleSuppressionContext = React.createContext<LifecycleSuppressionMap>(new Map());

export function buildLifecycleSuppressionMap(messages: ReadonlyArray<Message>): LifecycleSuppressionMap {
    const map = new Map<string, string>();
    for (const m of messages) {
        if (m.kind !== 'tool-call') continue;
        // Primary source: explicit lifecycle envelope emitted by sessionProtocolMapper.
        if (m.tool.name === CODEX_LIFECYCLE_TOOL) {
            const sessionSubagent = (m.tool.input as Record<string, unknown> | undefined)?.sessionSubagent;
            if (typeof sessionSubagent === 'string' && sessionSubagent.length > 0) {
                map.set(sessionSubagent, m.id);
            }
            continue;
        }
    }
    return map;
}

// B13 (Cycle 13): predicate used by the lifecycle INLINE card to filter the
// four control verbs (spawn/send/wait/close/resume) out of the subagent's own
// tool list. Lifecycle-LOCAL: applied only inside CodexSubagentLifecycleView so
// the shared useFilteredTools hook semantics (Claude Task/Agent + mobile detail)
// stay untouched (codex finding 1 / AC-REG-1).
export function isCodexSubagentControlTool(name: string): boolean {
    return CODEX_SUBAGENT_CONTROL_TOOLS.has(name);
}

// B13 (Cycle 13): the lifecycle result is an OBJECT ({ final_summary, message })
// not a string, so the sidebar/detail Result gate (typeof result === 'string')
// drops it. Extract the displayable final summary from either an object result
// or a string result so the detail surfaces can render it without data loss
// (codex finding 3 / AC-B13-2).
export function extractLifecycleResultText(result: unknown): string | null {
    if (typeof result === 'string') return result.length > 0 ? result : null;
    if (isRecord(result)) {
        const summary = result.final_summary ?? result.message ?? result.summary;
        if (typeof summary === 'string' && summary.length > 0) return summary;
    }
    return null;
}

// ITEM 2 (AC-ITEM2-3): when an ERRORED lifecycle carries NO final_summary (the
// flushOpenLifecycles turn-abort shape {status, lifecycle_state}), build a short
// status/lifecycle_state line so the mobile detail surfaces the error instead of
// a blank dead-end (ToolErrorSection is suppressed for the lifecycle envelope).
// Returns null when there is nothing meaningful to show.
export function extractLifecycleStatusFallback(result: unknown): string | null {
    if (!isRecord(result)) return null;
    const state = typeof result.lifecycle_state === 'string' ? result.lifecycle_state : null;
    const status = typeof result.status === 'string' ? result.status : null;
    const error = typeof result.error === 'string' ? result.error : null;
    const parts = [
        state ? `lifecycle: ${state}` : null,
        status ? `status: ${status}` : null,
        error,
    ].filter((p): p is string => !!p);
    return parts.length > 0 ? parts.join('\n') : null;
}

// Returns true if the given control-tool message should be suppressed because
// a lifecycle envelope exists for its sessionSubagent. Returns false (render)
// for any tool that is NOT in CODEX_SUBAGENT_CONTROL_TOOLS.
export function isControlToolSuppressedByLifecycle(
    tool: ToolCall,
    suppressionMap: LifecycleSuppressionMap,
): boolean {
    if (!CODEX_SUBAGENT_CONTROL_TOOLS.has(tool.name)) return false;
    const sessionSubagent = (tool.input as Record<string, unknown> | undefined)?.sessionSubagent;
    if (typeof sessionSubagent !== 'string' || sessionSubagent.length === 0) return false;
    return suppressionMap.has(sessionSubagent);
}

export function isCodexSourceTool(tool: ToolCall, metadata?: Metadata | null): boolean {
    if (CODEX_TOOL_NAME_EXACT.has(tool.name)) return true;
    if (metadata?.flavor === 'codex'
        && CODEX_METADATA_TOOL_NAME_PREFIXES.some((p) => tool.name.startsWith(p))) {
        return true;
    }
    return CODEX_TOOL_NAME_PREFIXES.some((p) => tool.name.startsWith(p));
}

// AC6 (Cycle 16 Wave 2): request_user_input invoked OUTSIDE Plan mode does NOT
// arrive as state==='error' — it arrives as a COMPLETED function_call_output whose
// output text is 'request_user_input is unavailable in Default mode' (captured
// tier-1 live shape). The error-state guard below misses it, so the minimal-gate
// suppresses it and no card renders. This predicate detects ONLY that
// completed-with-unavailable/failure-shaped result so the inline body can surface
// despite minimal:true. SCOPED to functions.request_user_input.
//
// MODE-CONTEXT anchored (codex review): the signal is NOT the bare word
// 'unavailable'/'only available' (a legitimate user answer like 'I am unavailable
// tomorrow' must NOT trigger) — it is the tool-availability message that names the
// Codex mode (Default/Plan) or the tool itself. This eliminates the false positive
// while still covering both captured phrasings:
//   'request_user_input is unavailable in Default mode'
//   'request_user_input is only available in Plan mode'
const REQUEST_USER_INPUT_UNAVAILABLE_PATTERNS = [
    /\b(?:unavailable|not available|only available)\b[^]*\b(?:Default|Plan)\s+mode\b/i,
    /\brequest_user_input\b[^]*\b(?:unavailable|not available|only available)\b/i,
] as const;

// All result fields whose text may carry the availability message; scanned with
// .some() (codex review) so a leading field like status:'completed' does NOT mask
// the real message carried in output/error/message (the captured live shape puts it
// under output).
const REQUEST_USER_INPUT_RESULT_FIELDS = [
    'output', 'error', 'message', 'reason', 'content', 'stderr', 'status',
] as const;

function matchesRequestUserInputUnavailable(text: string | null): boolean {
    return text !== null && REQUEST_USER_INPUT_UNAVAILABLE_PATTERNS.some((re) => re.test(text));
}

export function isRequestUserInputUnavailableResult(tool: ToolCall): boolean {
    if (tool.name !== 'functions.request_user_input') return false;
    const parsed = parseProtocolResult(tool.result);
    if (!isRecord(parsed)) return matchesRequestUserInputUnavailable(stringifyUnknown(parsed));
    return REQUEST_USER_INPUT_RESULT_FIELDS.some(
        (field) => matchesRequestUserInputUnavailable(stringifyUnknown(parsed[field])),
    );
}

// Item 2 (spec-20260607-124814) — ADD-ONLY: extract the human-readable unavailable
// reason from a normalized error-shaped request_user_input result so detail/inline
// surfaces can show it WITHOUT re-deriving the mode-anchored match. The happy-cli
// producer now normalizes the unavailable case to {status:'failed', success:false,
// error:<reason>}; this reads that reason (preferring the cleaned error field, falling
// back to the first mode-anchored field) for any consumer that already knows the result
// is error-shaped. Returns null when no mode-anchored reason is present. Pure/additive:
// it does NOT alter tool.state and does NOT change any existing export.
export function extractRequestUserInputUnavailableReason(result: unknown): string | null {
    const parsed = parseProtocolResult(result);
    if (isRecord(parsed)) {
        const direct = stringifyUnknown(parsed.error);
        if (matchesRequestUserInputUnavailable(direct)) return direct;
        for (const field of REQUEST_USER_INPUT_RESULT_FIELDS) {
            const text = stringifyUnknown(parsed[field]);
            if (matchesRequestUserInputUnavailable(text)) return text;
        }
        return null;
    }
    const text = stringifyUnknown(parsed);
    return matchesRequestUserInputUnavailable(text) ? text : null;
}

// #5 (Cluster C / AC-C4): the read-only RequestUserInputView needs a structured
// view of a request_user_input call. The Codex producer carries the prompt in
// input.prompt / input.question, and may carry one or more structured questions
// (input.questions[] — header/question/options) mirroring AskUserQuestion. The
// completed user response, when present, lives in the result under
// answer/answers/response/output/message (object) OR is the bare string result.
// Pure/additive: no existing export changes.
export type RequestUserInputOption = {
    label: string;
    description: string | null;
};

export type RequestUserInputQuestion = {
    header: string | null;
    question: string;
    options: RequestUserInputOption[];
};

export type RequestUserInputSummary = {
    prompt: string | null;
    questions: RequestUserInputQuestion[];
    answer: string | null;
};

// codex#4: Codex options may carry { label, description }. Keep both so the
// read-only card can render the description as secondary text under each option.
function toOption(option: unknown): RequestUserInputOption | null {
    if (typeof option === 'string') {
        const label = option.trim();
        return label ? { label, description: null } : null;
    }
    if (isRecord(option)) {
        const label = stringifyUnknown(option.label ?? option.value ?? option.title ?? option.text);
        if (!label) return null;
        return { label, description: stringifyUnknown(option.description) };
    }
    return null;
}

function extractRequestUserInputQuestions(input: unknown): RequestUserInputQuestion[] {
    if (!isRecord(input)) return [];
    const raw = input.questions;
    if (!Array.isArray(raw)) return [];
    const out: RequestUserInputQuestion[] = [];
    for (const entry of raw) {
        if (typeof entry === 'string') {
            const text = entry.trim();
            if (text) out.push({ header: null, question: text, options: [] });
            continue;
        }
        if (!isRecord(entry)) continue;
        const question = stringifyUnknown(entry.question ?? entry.prompt ?? entry.text ?? entry.label);
        if (!question) continue;
        const header = stringifyUnknown(entry.header ?? entry.title);
        const options = (Array.isArray(entry.options) ? entry.options : [])
            .map(toOption)
            .filter((o): o is RequestUserInputOption => !!o);
        out.push({ header, question, options });
    }
    return out;
}

// Flatten a single answer value to readable text. A value may be a plain string,
// a list of strings, or a nested object that itself carries the selected answer(s)
// under answer/answers/value/label (the AskUserQuestion-style shape). codex#2:
// stringifyUnknown on a nested object would leak raw JSON, so unwrap the nested
// answer fields first and only fall back to a string scalar.
function flattenAnswerValue(value: unknown): string | null {
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        const parts = value.map(flattenAnswerValue).filter((p): p is string => !!p);
        return parts.length > 0 ? parts.join(', ') : null;
    }
    if (isRecord(value)) {
        const nested = value.answers ?? value.answer ?? value.value ?? value.label ?? value.text;
        if (nested !== undefined && nested !== value) return flattenAnswerValue(nested);
        return null;
    }
    return null;
}

// The completed response, if any: object answer/answers/response/output/message
// or a bare string result. answers (a Record/array) is flattened to readable
// lines so a structured multi-question answer is shown without raw JSON.
function extractRequestUserInputAnswer(result: unknown): string | null {
    const parsed = parseProtocolResult(result);
    if (typeof parsed === 'string') {
        const text = parsed.trim();
        return text || null;
    }
    if (!isRecord(parsed)) return null;
    const answers = parsed.answers;
    if (isRecord(answers)) {
        const lines = Object.entries(answers)
            .map(([k, v]) => {
                const value = flattenAnswerValue(v);
                return value ? `${k}: ${value}` : null;
            })
            .filter((l): l is string => !!l);
        if (lines.length > 0) return lines.join('\n');
    }
    if (Array.isArray(answers)) {
        const lines = answers.map(flattenAnswerValue).filter((l): l is string => !!l);
        if (lines.length > 0) return lines.join('\n');
    }
    return flattenAnswerValue(
        parsed.answer ?? parsed.response ?? parsed.output ?? parsed.message,
    );
}

export function extractRequestUserInputSummary(tool: ToolCall): RequestUserInputSummary {
    const input = isRecord(tool.input) ? tool.input : {};
    const prompt = stringifyUnknown(input.prompt ?? input.question);
    const questions = extractRequestUserInputQuestions(input);
    // The answer is meaningful only on a completed (non-error) call; a failed /
    // unavailable call surfaces its reason through the B11 failure helper instead.
    const answer = tool.state === 'completed' ? extractRequestUserInputAnswer(tool.result) : null;
    return { prompt: prompt ?? null, questions, answer };
}

// AC-C2 (#5 / codex#6): RequestUserInputView reuses the EXISTING B11 failure
// logic, but buildRequestUserInputFailureLine expects an ALREADY-PARSED result
// (it is called after parseProtocolResult in buildGenericToolSummary). This
// high-level wrapper parses internally so the view can pass a raw tool.result
// (string OR object) without re-implementing the object-precedence /
// tag-stripping rules. Strips <tool_use_error>, object precedence
// stderr??error??message??reason, string unwrapped, preserves line breaks,
// non-empty fallback for an errorless failure.
export function buildRequestUserInputFailureLineFromResult(result: unknown): string | null {
    return buildRequestUserInputFailureLine(parseProtocolResult(result));
}

// Cycle 7 (M5 #17): MCP namespace tools render chip-only unless a specialized
// view is registered, regardless of codex source.
export function shouldRenderToolContent(
    tool: ToolCall, hasSpecializedView: boolean, minimal: boolean, metadata?: Metadata | null,
): boolean {
    // B11 (Cycle 13): a FAILED functions.request_user_input must show its error
    // INLINE (Claude Code parity, no failure-card). For a string <tool_use_error>
    // payload ToolView.buildToolConfig force-sets minimal=true, which the next gate
    // would suppress — so this SCOPED exception (exact tool-name + error-state) is
    // returned BEFORE the minimal-gate to let the GenericToolPreview body render.
    // Narrowly gated: does NOT widen to other tools and does NOT regress any other
    // tool's header-only minimal (codex F5).
    if (tool.name === 'functions.request_user_input' && tool.state === 'error') return true;
    // AC6 (Cycle 16 Wave 2): EXTEND the above — a COMPLETED request_user_input whose
    // output reports it is unavailable/only-available-in-Plan-mode also renders inline
    // (the live Default-mode shape is completed, not error). Scoped to the exact tool +
    // an unavailable-shaped result, so a normal completed answer stays header-only.
    if (isRequestUserInputUnavailableResult(tool)) return true;
    // AC-C1 (#5, option b): once RequestUserInputView is registered the read-only
    // card must render for a COMPLETED answer while a still-RUNNING request stays
    // truly header-only (no padded empty content wrapper — the codex#5 hazard).
    // Scoped to the exact tool + a registered view and placed BEFORE the minimal
    // gate so minimal:true does not suppress the completed answer card; the
    // :222/:227 error/unavailable exceptions above already cover those states.
    // When the view is NOT registered (hasSpecializedView false) this is skipped
    // so the legacy header-only behavior is preserved.
    if (tool.name === 'functions.request_user_input' && hasSpecializedView) {
        return tool.state !== 'running';
    }
    // AC2 fix: minimal=true means header-only — suppress body regardless of specialized view.
    // CodexPatch has minimal=true AND a specialized view; without this guard its body renders
    // Octicons name="file-diff" inline, duplicating CodexDiff's file-diff icon.
    if (minimal) { return false; }
    if (CODEX_SUBAGENT_CONTROL_TOOLS.has(tool.name)) return false;
    if (!hasSpecializedView && isMcpInlineChipOnlyTool(tool.name)) return false;
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

// B11 (Cycle 13): strip <tool_use_error> wrapper tags from a candidate so the
// raw markup is never rendered inline; falls back to a plain summary when the
// candidate is not wrapped (codex F4).
function extractFailureText(candidate: unknown): string | null {
    if (typeof candidate === 'string') {
        const unwrapped = parseToolUseError(candidate).errorMessage;
        if (unwrapped !== null) return summarizeText(unwrapped);
    }
    return summarizeText(candidate);
}

// B11 (Cycle 13, codex G3 review): the request_user_input failure must show the
// ACTUAL error/stderr inline, so — unlike the generic summarizeText path — this
// extractor strips <tool_use_error> tags but PRESERVES line breaks and does NOT
// apply the 160-char single-line summary cap (a multi-line stderr would otherwise
// lose its actionable lines). Scoped to buildRequestUserInputFailureLine only.
function extractRequestUserInputFailureText(candidate: unknown): string | null {
    let text = typeof candidate === 'string' ? candidate : stringifyUnknown(candidate);
    if (text === null) return null;
    const unwrapped = parseToolUseError(text).errorMessage;
    if (unwrapped !== null) text = unwrapped;
    const trimmed = text.replace(/[ \t]+/g, ' ').trim();
    return trimmed.length > 0 ? trimmed : null;
}

// B11 (Cycle 13): a FAILED functions.request_user_input surfaces its error/stderr
// INLINE for BOTH payload shapes — a string <tool_use_error> result (resultRecord
// null) AND a structured object (read stderr ?? error ?? message ?? reason, codex
// F3). Tags are stripped in either case (codex F4); line breaks preserved (codex
// G3). Falls back to a scoped message when the failed call carries no error text
// so the inline body is never empty (worse than header-only) — codex G3.
function buildRequestUserInputFailureLine(parsedResult: unknown): string | null {
    let candidate: unknown = parsedResult;
    if (isRecord(parsedResult)) {
        candidate = parsedResult.stderr ?? parsedResult.error
            ?? parsedResult.message ?? parsedResult.reason;
    }
    return extractRequestUserInputFailureText(candidate)
        ?? 'Request user input failed with no error output';
}

export function buildGenericToolSummary(tool: ToolCall): GenericToolSummary {
    const parsedResult = parseProtocolResult(tool.result);
    const resultRecord = isRecord(parsedResult) ? parsedResult : null;
    const lines: string[] = [];

    if (tool.name === 'functions.request_user_input' && tool.state === 'error') {
        const failure = buildRequestUserInputFailureLine(parsedResult);
        if (failure) lines.push(failure);
    }

    if (resultRecord) {
        const unavailable = tool.name === 'functions.request_user_input'
            ? extractFailureText(resultRecord.error ?? resultRecord.message ?? resultRecord.reason)
            : null;
        if (unavailable && !lines.includes(unavailable)) lines.push(unavailable);

        const mcpEmpty = summarizeMcpEmpty(tool, resultRecord);
        if (mcpEmpty) lines.push(mcpEmpty);

        if (tool.name.startsWith('web.')) {
            lines.push(...summarizeWebResult(resultRecord));
        }

        const error = extractFailureText(resultRecord.error ?? resultRecord.message);
        if (error && !lines.includes(error)) lines.push(error);

        const reason = summarizeReason(resultRecord.reason);
        if (reason && !lines.includes(reason)) lines.push(reason);

        const status = summarizeText(resultRecord.status);
        if (status && status !== 'completed' && !lines.some((line) => line.includes(status))) {
            lines.push(`status: ${status}`);
        }

        const primaryOutput = summarizeText(resultRecord.output ?? resultRecord.content ?? resultRecord.summary);
        if (primaryOutput && lines.length === 0) lines.push(primaryOutput);
    } else if (lines.length === 0) {
        // B11: the request_user_input failure branch above may already have pushed
        // the tag-stripped error line; only fall back to the raw string summary
        // when nothing was extracted (otherwise the literal <tool_use_error> markup
        // would be re-appended for a string payload).
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

const ATTACHMENT_MIME_KEYS = ['mime_type', 'mimeType', 'media_type', 'mediaType'];
const ATTACHMENT_BASE64_KEYS = ['base64', 'imageBase64', 'image_base64', 'b64_json', 'data'];
// B12 AC-B12-3 (replay-child raw shape): the MCP/replay wire result nests image
// bytes inside an array of content items (contentItems / content / contentBlocks)
// with NO top-level preview_uri (rolloutHistoryReplay.buildChildEndEnvelope emits
// payload.output verbatim, bypassing buildImageToolResult). The flat readValue
// above cannot see nested data, so recurse into these arrays to find an image
// item's { type:'image', data, mimeType }.
const ATTACHMENT_CONTENT_ARRAY_KEYS = ['contentItems', 'content', 'contentBlocks'];

function mimeForAttachmentPath(value: string | null): string | null {
    if (!value) return null;
    const ext = value.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
    };
    return map[ext] ?? null;
}

// Recognize an inline-renderable image URI from an EXPLICIT uri/preview field.
// Only a data:image/* or http(s) URL is accepted — a non-image url/uri (e.g. a
// docs link) is NOT promoted to a preview (codex F2: prevents a broken <Image>).
// A data:* URI with a non-image media type is rejected too.
function recognizeImageUri(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^data:image\//i.test(trimmed)) return trimmed;
    if (/^data:/i.test(trimmed)) return null; // non-image data: URI
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return null;
}

// Recognize a renderable image from a TRUSTED base64 field (b64_json/data/…).
// Standard base64 contains '/' (codex F1), so the charset check permits it; we
// require a POSITIVE image signal (an image mime hint) before synthesizing a
// data URI so a long non-image base64-shaped blob is not rendered as an image.
function recognizeImageBase64(value: unknown, mimeHint: string | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Already a usable image URI (some payloads put a data:image/ URI here).
    const asUri = recognizeImageUri(trimmed);
    if (asUri) return asUri;
    // Bare base64 blob: base64 charset only, length > 64, AND an image mime hint
    // (the only positive signal that this blob is actually an image).
    if (mimeHint && /^image\//i.test(mimeHint)
        && /^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.replace(/\s+/g, '').length > 64) {
        return `data:${mimeHint};base64,${trimmed.replace(/\s+/g, '')}`;
    }
    return null;
}

// Doubly-encoded MCP shape (e.g. mcp__playwright__browser_take_screenshot):
// the image item is hidden inside a content-array text item whose `text` is
// itself a STRINGIFIED JSON wrapper — { type:'text', text: JSON.stringify({
// content: [ … , { type:'image', data, mimeType } ] }) }. A JSON-looking string
// is parsed (once, inside try/catch) and re-walked so the nested image surfaces.
// Bounded: only strings whose trimmed start is '{' or '[' are parsed, parse
// failures are ignored, and the recursion shares findNestedImageDataUri's depth
// cap so a malicious/huge/cyclic payload cannot blow up.
function maybeParseJsonContainer(value: unknown): Record<string, unknown> | unknown[] | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (isRecord(parsed) || Array.isArray(parsed)) return parsed;
    } catch {
        // Not valid JSON (ordinary text that merely starts with a brace) — ignore.
    }
    return null;
}

// B12 AC-B12-3: recursively locate a nested image content item carrying base64
// bytes + a mime in an MCP/replay contentItems[]/content[] array (depth-bounded
// to avoid pathological deep payloads). Returns the recognized data:image URI
// via the SAME recognizeImageBase64 guard (positive image-mime signal required),
// so a non-image content block is never promoted to a preview.
//
// ADDITIVE (doubly-encoded MCP screenshot shape): when an item carries a
// JSON-looking STRING (its `text` field, or a bare string entry in a content
// array), the string is JSON-parsed and re-walked so an image nested inside a
// stringified-JSON wrapper (the Playwright screenshot shape) is also found. The
// flat preview_uri / data-URI / base64 / known content-array image paths are
// unchanged.
function findNestedImageDataUri(value: unknown, depth = 0): string | null {
    if (depth > 6) return null;
    if (!isRecord(value)) {
        // A bare JSON-looking string inside a content array may itself wrap the
        // image (the screenshot wrapper). Parse-and-recurse, depth-bounded.
        const parsed = maybeParseJsonContainer(value);
        return parsed ? findNestedImageDataUri(parsed, depth + 1) : null;
    }
    for (const key of ATTACHMENT_CONTENT_ARRAY_KEYS) {
        const items = value[key];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
            // A bare string entry that looks like JSON — parse and recurse.
            if (typeof item === 'string') {
                const nestedFromString = findNestedImageDataUri(item, depth + 1);
                if (nestedFromString) return nestedFromString;
                continue;
            }
            if (!isRecord(item)) continue;
            // codex review: only an EXACT image item type (not any 'image*'
            // prefix) backstops a missing mime — so a non-image typed block with a
            // long base64-shaped `data` cannot false-positive into a preview.
            const itemMime = stringifyUnknown(readValue(item, ATTACHMENT_MIME_KEYS))
                ?? (item.type === 'image' || item.type === 'input_image' ? 'image/png' : null);
            const itemBase64 = stringifyUnknown(readValue(item, ATTACHMENT_BASE64_KEYS));
            const recognized = recognizeImageBase64(itemBase64, itemMime);
            if (recognized) return recognized;
            // Doubly-encoded shape: a { type:'text', text:<stringified-JSON> } item
            // whose text wraps a nested image content array. Parse-and-recurse.
            const parsedText = maybeParseJsonContainer(item.text);
            if (parsedText) {
                const nestedFromText = findNestedImageDataUri(parsedText, depth + 1);
                if (nestedFromText) return nestedFromText;
            }
            const nested = findNestedImageDataUri(item, depth + 1);
            if (nested) return nested;
        }
    }
    return null;
}

export function extractAttachmentSummary(input: any, result?: unknown): AttachmentSummary {
    const parsedResult = parseProtocolResult(result);
    const resultRecord = isRecord(parsedResult) ? parsedResult : {};
    // B05: Claude Read carries the path in input.file_path and the result under
    // a nested { file: { filePath, content } }. Recognize both so an image Read
    // is detectable app-side.
    const fileRecord = isRecord(resultRecord.file) ? resultRecord.file : {};
    const path = stringifyUnknown(input?.path ?? input?.image_path ?? input?.ref ?? input?.file_path
        ?? resultRecord.path ?? resultRecord.file_path ?? resultRecord.filePath
        ?? resultRecord.output_path ?? resultRecord.outputPath
        ?? fileRecord.filePath ?? fileRecord.file_path ?? fileRecord.path) ?? null;
    const pathName = path ? path.split('/').filter(Boolean).pop() : null;
    const label = stringifyUnknown(input?.name ?? input?.title ?? resultRecord.name) ?? pathName ?? 'Attachment';
    const rawSize = input?.size ?? resultRecord.size;
    const size = typeof rawSize === 'number' ? `${rawSize} bytes` : stringifyUnknown(rawSize);
    const image = isRecord(input?.image) ? input.image : isRecord(resultRecord.image) ? resultRecord.image : null;
    const width = image ? stringifyUnknown(image.width) : stringifyUnknown(input?.width ?? resultRecord.width);
    const height = image ? stringifyUnknown(image.height) : stringifyUnknown(input?.height ?? resultRecord.height);
    const dimensions = width && height ? `${width}×${height}` : null;
    const mimeHint = stringifyUnknown(
        readValue(resultRecord, ATTACHMENT_MIME_KEYS) ?? (image ? readValue(image, ATTACHMENT_MIME_KEYS) : null)
    ) ?? mimeForAttachmentPath(path);
    // Prefer an explicit URI/preview field; otherwise broaden to base64/data-uri
    // blobs carried under recognized keys (B12 real-payload recognition).
    const explicitUri = stringifyUnknown(
        input?.preview_uri ?? input?.previewUri ?? input?.url ?? input?.uri
        ?? resultRecord.preview_uri ?? resultRecord.previewUri ?? resultRecord.url ?? resultRecord.uri
        ?? (image ? image.preview_uri ?? image.previewUri ?? image.url ?? image.uri : null)
    );
    // codex F2: only an actual image URI becomes a preview — never fall through
    // to a raw non-image url/uri (which would render a broken <Image>).
    let previewUri = recognizeImageUri(explicitUri);
    if (!previewUri) {
        const base64 = readValue(resultRecord, ATTACHMENT_BASE64_KEYS)
            ?? readValue(fileRecord, ATTACHMENT_BASE64_KEYS)
            ?? (image ? readValue(image, ATTACHMENT_BASE64_KEYS) : null)
            ?? readValue(isRecord(input) ? input : {}, ATTACHMENT_BASE64_KEYS);
        previewUri = recognizeImageBase64(stringifyUnknown(base64), mimeHint);
        // B12 AC-B12-3: last resort — recurse into nested contentItems[]/content[]
        // (the raw replay-child shape with no top-level preview_uri or flat base64).
        if (!previewUri) {
            previewUri = findNestedImageDataUri(resultRecord)
                ?? (isRecord(input) ? findNestedImageDataUri(input) : null);
        }
    }
    const previewUnavailableReason = stringifyUnknown(resultRecord.preview_unavailable_reason);
    return { label, path, size, dimensions, previewUri, previewUnavailableReason };
}

// True ONLY when the attachment has an actually-renderable preview URI. The
// Read view renders nothing without a previewUri, so Read.minimal must gate on
// THIS (not the looser extension check) — otherwise an image-extension Read
// whose result carries no preview would relax minimal yet render an empty body
// (codex F3). ReadView uses the same predicate so the two never disagree.
export function attachmentHasRenderableImagePreview(summary: AttachmentSummary): boolean {
    return Boolean(summary.previewUri);
}

// B05 R2 (codex F1): resolve the inline preview URI for a Claude `Read` STRICTLY
// from a producer-emitted STRUCTURED object result. The happy-cli mapper always
// emits the image preview as an object (`{ path, preview_uri }`); a real text
// Read result is always a string (the file's text). Gating on an object result
// here prevents a pathological text file whose content is literally
// `{"preview_uri":"data:image/…"}` from being JSON-parsed and mis-rendered as an
// image (the shared extractAttachmentSummary parses such strings for Codex's
// string-over-wire payloads — that behavior is preserved for Codex tools). Used
// by ReadView so the Claude Read preview never fires on a text Read.
export function readImagePreviewUri(input: unknown, result?: unknown): string | null {
    if (!isRecord(result)) return null;
    return attachmentHasRenderableImagePreview(extractAttachmentSummary(input, result))
        ? extractAttachmentSummary(input, result).previewUri
        : null;
}
