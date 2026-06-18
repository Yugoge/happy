import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { createId } from '@paralleldrive/cuid2';
import type { ReasoningOutput } from './reasoningProcessor';
import type { DiffToolCall, DiffToolResult } from './diffProcessor';
import { createEnvelope, type CreateEnvelopeOptions, type SessionEnvelope } from '@slopus/happy-wire';
import {
    emitLifecycleEnd,
    emitLifecycleStart,
    flushOpenLifecycles,
    getSubagentLifecycles,
    isAuthoritativeFinalSummary,
    isNonEmptyFinalSummary,
    LIFECYCLE_ENVELOPE_NAME,
    promoteRealAgentNickname,
    readAgentsStatesMessage,
    type LifecycleState,
} from './subagentLifecycle';

export type CodexTurnState = {
    currentTurnId: string | null;
    startedSubagents?: Set<string>;
    activeSubagents?: Set<string>;
    providerSubagentToSessionSubagent?: Map<string, string>;
    subagentLifecycles?: Map<string, LifecycleState>;
    // Cycle 7 (M2/M2.a): historical epoch-ms parsed from the replay rollout record's top-level
    // `timestamp`. When set (A2 replay path only), EVERY createEnvelope call for that record inherits
    // it via buildEnvelopeOptions so the merged lifecycle card and all same-record envelopes sit at the
    // correct chronological position. The live (A1) mapper path never sets this, so createEnvelope keeps
    // its Date.now() default. Only ever a finite number (NaN-guarded by the replay caller).
    recordTime?: number;
    // Cycle 8 (M5): per-turn Set of collab control-verb BEGIN `call_id`s that were actually emitted
    // (a tool-call-start envelope was pushed). A collab control-verb END whose call_id is NOT in this
    // Set is a TRUE orphan (no matching begin) and its top-level tool-call-end envelope is suppressed
    // (the scattered-card symptom). Cleared on every parent turn boundary (task_started/complete/abort)
    // so the discriminator is turn-scoped. An END whose begin WAS emitted is never suppressed (A2-safe).
    emittedCollabBeginCallIds?: Set<string>;
    // Cycle 9 (A2-M1): for a MULTI-target wait_agent, persist the BEGIN call's full receiverThreadIds
    // list keyed by the provider call_id, so the END handler can enumerate EXACTLY those targets (NOT
    // the output status{} map, which is partial in 242/245 real cases). Cleared on every parent turn
    // boundary alongside emittedCollabBeginCallIds.
    waitTargetsByCallId?: Map<string, string[]>;
    // Cycle 9 (NO-regression fix): gates replay-only rendering branches (currently the multi-target
    // wait_agent BEGIN fan-out at the collab_agent_call_begin handler). Set ONLY by the replay caller
    // (rolloutHistoryReplay.ts); the live/A1 caller (runCodex.ts) never sets it, so the live path stays
    // byte-equal to baseline — multi-target waits collapse to a single begin/end via firstReceiverThreadId.
    replay?: boolean;
    // Codex Playwright-screenshot fix: the Codex SESSION/THREAD working directory (the cwd the codex run
    // was started with). The Playwright MCP `browser_take_screenshot` tool saves its PNG relative to THIS
    // dir and reports a RELATIVE path in the result markdown link / input filename, so a relative path
    // must be resolved against this base before reading the saved file off disk. Both callers pass
    // `process.cwd()` (runCodex starts the thread with cwd: process.cwd(); replay runs in the same cwd).
    // When absent, the producer falls back to process.cwd() at read time.
    sessionCwd?: string;
    // OBJ-7 / MIN-1 LIVE (AC-A5): the LIVE mcp_tool_call_end event (codexAppServerClient.ts:639-651) does
    // NOT forward item.arguments, so a relative Playwright-screenshot `filename` captured at
    // mcp_tool_call_begin is otherwise discarded by the time the END is mapped — the live filename-only
    // screenshot case silently no-ops. The mapper is STATELESS across calls (cross-message state lives in
    // runCodex.ts locals and is threaded in via this state object and read back from the mapper result),
    // so begin-args must be persisted here keyed by call_id and merged into the END message. Mirrors the
    // emittedCollabBeginCallIds / waitTargetsByCallId threading: seeded by the caller, returned by the
    // begin/end handlers, read back by the caller. Cleared on every parent turn boundary.
    toolArgsByCallId?: Map<string, Record<string, unknown>>;
};

type CodexMapperResult = {
    currentTurnId: string | null;
    startedSubagents: Set<string>;
    activeSubagents: Set<string>;
    providerSubagentToSessionSubagent: Map<string, string>;
    subagentLifecycles: Map<string, LifecycleState>;
    envelopes: SessionEnvelope[];
    emittedCollabBeginCallIds?: Set<string>;
    waitTargetsByCallId?: Map<string, string[]>;
    toolArgsByCallId?: Map<string, Record<string, unknown>>;
};

type LegacyToolLikeMessage = {
    type: 'tool-call' | 'tool-call-result';
    callId: string;
    name?: string;
    input?: unknown;
    output?: {
        content?: string;
        status?: 'completed' | 'canceled';
    };
};

type TurnEndStatus = 'completed' | 'failed' | 'cancelled';
const CALL_SUBAGENT_PREFIX = 'call:';
const OWNER_SUBAGENT_PREFIX = 'owner:';
const IMAGE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseRecord(value: unknown): Record<string, unknown> | null {
    if (isRecord(value)) return value;
    if (typeof value !== 'string' || !value.trim().startsWith('{')) return null;
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function readStringByKey(value: unknown, keys: Set<string>, depth = 0): string | null {
    if (depth > 4) return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = readStringByKey(item, keys, depth + 1);
            if (found) return found;
        }
        return null;
    }
    if (!isRecord(value)) return null;
    for (const [key, nested] of Object.entries(value)) {
        if (keys.has(key) && typeof nested === 'string' && nested.length > 0) return nested;
    }
    for (const nested of Object.values(value)) {
        const found = readStringByKey(nested, keys, depth + 1);
        if (found) return found;
    }
    return null;
}

const IMAGE_URI_KEYS = new Set(['previewUri', 'preview_uri', 'url', 'uri']);
const IMAGE_PATH_KEYS = new Set(['path', 'filePath', 'file_path', 'outputPath', 'output_path']);
const IMAGE_BASE64_KEYS = new Set(['base64', 'imageBase64', 'image_base64', 'b64_json', 'data']);
const IMAGE_MIME_KEYS = new Set(['mimeType', 'mime_type', 'mediaType', 'media_type']);
// Locator for the start of a markdown link target — `](` (optionally image-prefixed `![..](`). The
// actual target is then read by a balanced-paren scanner (markdownLinkTargets) rather than a regex, so
// a target containing SPACES (`shot 1.png`) or inner PARENTHESES (`shot (1).png`) is captured whole
// instead of being truncated at the first space/`)`.
const MARKDOWN_LINK_OPEN_REGEX = /!?\[[^\]]*]\(/g;
const IMAGE_PATH_IN_TEXT_REGEX = /(?:file:\/\/)?(?:\/[^\s"'<>()[\]]+|[A-Za-z]:[\\/][^\s"'<>()[\]]+|[^\s"'<>()[\]]+)\.(?:png|jpe?g|gif|webp|svg)\b/gi;

function getStartedSubagents(state: CodexTurnState): Set<string> {
    return state.startedSubagents ?? new Set<string>();
}

function getActiveSubagents(state: CodexTurnState): Set<string> {
    return state.activeSubagents ?? new Set<string>();
}

function getProviderSubagentToSessionSubagent(state: CodexTurnState): Map<string, string> {
    return state.providerSubagentToSessionSubagent ?? new Map<string, string>();
}

// Cycle 8 (M5): lazily materialize the per-turn emitted-collab-begin Set so the orphan-end
// discriminator ("no matching begin emitted for this call_id") has a backing store. Returns the
// existing Set when present so begins recorded earlier in the turn survive into the end handler.
function getEmittedCollabBeginCallIds(state: CodexTurnState): Set<string> {
    return state.emittedCollabBeginCallIds ?? new Set<string>();
}

// Cycle 9 (A2-M1): lazily materialize the per-turn map of multi-target wait BEGIN target lists.
function getWaitTargetsByCallId(state: CodexTurnState): Map<string, string[]> {
    return state.waitTargetsByCallId ?? new Map<string, string[]>();
}

// OBJ-7 / MIN-1 LIVE (AC-A5): lazily materialize the per-turn map of LIVE tool BEGIN args keyed by
// call_id, so a relative Playwright-screenshot `filename` captured at mcp_tool_call_begin survives into
// the args-less mcp_tool_call_end. Returns the existing map when present so begins recorded earlier in
// the turn survive into the end handler (the live caller threads it via state and reads it back).
function getToolArgsByCallId(state: CodexTurnState): Map<string, Record<string, unknown>> {
    return state.toolArgsByCallId ?? new Map<string, Record<string, unknown>>();
}

// Cycle 9 (A2-M1): all receiver thread ids from a collab message (NOT just the first), filtered to
// non-empty strings. Used for multi-target wait per-target enumeration.
function allReceiverThreadIds(message: Record<string, unknown>): string[] {
    const receiverThreadIds = message.receiverThreadIds;
    if (!Array.isArray(receiverThreadIds)) return [];
    return receiverThreadIds.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

// Cycle 9 (A2-M1): a stable per-target synthetic call id `${call}#${index}:${receiverThreadId}` so the
// N per-target begin/end pairs of one multi-target wait do not collide on the shared provider call_id.
function perTargetCallId(call: string, index: number, receiverThreadId: string): string {
    return `${call}#${index}:${receiverThreadId}`;
}

// Cycle 9 (A2-M2): extract a single target's OWN status from a wait_agent END message. Precedence:
// agentsStates[id] (live) → output status[id] (rollout). Returns the matched status record or undefined
// when the target is absent from BOTH (the dominant 242/245 partial-status case — the caller then emits
// an explicit `unreported` marker rather than borrowing another target's status).
function perTargetStatus(message: Record<string, unknown>, targetId: string): Record<string, unknown> | undefined {
    const agentsStates = message.agentsStates;
    if (isRecord(agentsStates)) {
        const entry = agentsStates[targetId];
        if (isRecord(entry)) return entry;
    }
    const status = message.status;
    if (isRecord(status)) {
        const entry = status[targetId];
        if (isRecord(entry)) return entry;
    }
    return undefined;
}

function maybeEmitSubagentStart(
    subagent: string | undefined,
    opts: CreateEnvelopeOptions,
    startedSubagents: Set<string>,
    activeSubagents: Set<string>,
    envelopes: SessionEnvelope[],
): void {
    if (!subagent || startedSubagents.has(subagent)) {
        return;
    }

    envelopes.push(createEnvelope('agent', { t: 'start' }, { ...opts, subagent }));
    startedSubagents.add(subagent);
    activeSubagents.add(subagent);
}

function emitSubagentStops(
    opts: CreateEnvelopeOptions,
    startedSubagents: Set<string>,
    activeSubagents: Set<string>,
): SessionEnvelope[] {
    const envelopes: SessionEnvelope[] = [];
    for (const subagent of activeSubagents) {
        envelopes.push(createEnvelope('agent', { t: 'stop' }, { ...opts, subagent }));
    }
    activeSubagents.clear();
    startedSubagents.clear();
    return envelopes;
}

function maybeEmitSubagentStop(
    subagent: string | undefined,
    opts: CreateEnvelopeOptions,
    activeSubagents: Set<string>,
    envelopes: SessionEnvelope[],
): void {
    if (!subagent || !activeSubagents.has(subagent)) {
        return;
    }

    envelopes.push(createEnvelope('agent', { t: 'stop' }, { ...opts, subagent }));
    activeSubagents.delete(subagent);
}

function pickWrapperTurnId(message?: Record<string, unknown>): string | null {
    const turnId = message?.turn_id ?? message?.turnId;
    return typeof turnId === 'string' && turnId.length > 0 ? turnId : null;
}

function pickWrapperThreadId(message: Record<string, unknown>): string | undefined {
    const threadId = message.thread_id ?? message.threadId;
    return typeof threadId === 'string' && threadId.length > 0 ? threadId : undefined;
}

function buildEnvelopeOptions(
    currentTurnId: string | null,
    subagent?: string,
    message?: Record<string, unknown>,
    recordTime?: number,
): CreateEnvelopeOptions {
    const turn = pickWrapperTurnId(message) ?? currentTurnId;
    return {
        ...(turn ? { turn } : {}),
        ...(subagent ? { subagent } : {}),
        // Cycle 7 (M2.a): thread the per-record historical time into opts so createEnvelope uses it
        // instead of Date.now(). Only set when finite — the replay caller guards against NaN.
        ...(typeof recordTime === 'number' && Number.isFinite(recordTime) ? { time: recordTime } : {}),
    };
}

function firstReceiverThreadId(message: Record<string, unknown>): string | undefined {
    const receiverThreadIds = message.receiverThreadIds;
    if (!Array.isArray(receiverThreadIds)) return undefined;
    return receiverThreadIds.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function resolveSessionSubagent(
    message: Record<string, unknown>,
    providerSubagentToSessionSubagent: Map<string, string>,
): string | undefined {
    const providerThreadId = pickWrapperThreadId(message);
    if (!providerThreadId) {
        return undefined;
    }

    return providerSubagentToSessionSubagent.get(providerThreadId);
}

function ensureReceiverSessionSubagent(
    providerThreadId: string,
    providerSubagentToSessionSubagent: Map<string, string>,
): string {
    const existing = providerSubagentToSessionSubagent.get(providerThreadId);
    if (existing) return existing;
    const created = createId();
    providerSubagentToSessionSubagent.set(providerThreadId, created);
    return created;
}

function callSubagentKey(callId: string): string {
    return `${CALL_SUBAGENT_PREFIX}${callId}`;
}

function ownerSubagentKey(sessionSubagent: string): string {
    return `${OWNER_SUBAGENT_PREFIX}${sessionSubagent}`;
}

function pickCallId(message: Record<string, unknown>): string {
    const callId = message.call_id ?? message.callId ?? message.id;
    if (typeof callId === 'string' && callId.length > 0) {
        return callId;
    }
    return randomUUID();
}

function summarizeCommand(command: unknown): string | null {
    if (typeof command === 'string' && command.trim().length > 0) {
        return command;
    }
    if (Array.isArray(command)) {
        const cmd = command.map(v => String(v)).join(' ').trim();
        return cmd.length > 0 ? cmd : null;
    }
    return null;
}

function commandToTitle(command: string | null): string {
    if (!command) {
        return 'Run command';
    }
    const short = command.length > 80 ? `${command.slice(0, 77)}...` : command;
    return `Run \`${short}\``;
}

function patchDescription(changes: unknown): string {
    if (!changes || typeof changes !== 'object') {
        return 'Applying patch';
    }
    const fileCount = Object.keys(changes as Record<string, unknown>).length;
    if (fileCount === 1) {
        return 'Applying patch to 1 file';
    }
    return `Applying patch to ${fileCount} files`;
}

function pickTurnEndStatus(message: Record<string, unknown>, type: unknown): TurnEndStatus {
    const rawStatus = message.status;
    if (rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled') {
        return rawStatus;
    }
    if (rawStatus === 'canceled') {
        return 'cancelled';
    }

    // Abort events are treated as cancelled unless they explicitly look like failures.
    if (type === 'turn_aborted') {
        const reason = message.reason;
        const error = message.error;
        if ((typeof reason === 'string' && /(fail|error)/i.test(reason))
            || (typeof error === 'string' && error.length > 0)
            || (error !== undefined && error !== null && typeof error === 'object')) {
            return 'failed';
        }
        return 'cancelled';
    }

    if (message.error !== undefined && message.error !== null) {
        return 'failed';
    }

    return 'completed';
}

const TOOL_END_OMIT_KEYS = new Set([
    'type',
    'call_id',
    'callId',
    'parent_call_id',
    'parentCallId',
    'subagent',
    'threadId',
    'thread_id',
    'turnId',
    'turn_id',
    'id',
]);

// Item 2 (spec-20260607-124814): a Codex functions.request_user_input invoked
// OUTSIDE Plan mode arrives as a COMPLETED dynamic_tool_call_end whose availability
// message is buried in the output text (status stays 'completed', no error-shaped
// field). The app reducer (typesRaw.isSessionToolEndError) therefore never derives
// state:'error', so the inline card + detail page render as a normal/success card.
// The producer normalizes this case into an error-shaped result the EXISTING reducer
// already recognizes, so the failure styling fires WITHOUT editing the app reducer/view.
//
// MODE-CONTEXT anchored (mirrors codexToolRendering REQUEST_USER_INPUT_UNAVAILABLE_PATTERNS,
// kept CLI-local — happy-cli must NOT import happy-app): the signal is NOT the bare word
// 'unavailable' (a legitimate answer like 'I am unavailable tomorrow' must NOT trigger) —
// it is the tool-availability message naming the Codex mode (Default/Plan) or the tool.
//
// Pattern 2 is TIGHTER than the app-side mirror on the CLI side (codex review F4): it requires
// the tool-availability GRAMMAR `request_user_input is/isn't/is not (un)available`, not mere
// co-occurrence of the tool name and an availability word — so a user answer like
// 'For request_user_input, I am unavailable tomorrow' does NOT flip state. The state flip is
// CLI-exclusive, so a false positive here is the dangerous case; the app-side mirror only
// gates inline body rendering (cosmetic), so its looser pattern stays unchanged (guard).
const REQUEST_USER_INPUT_UNAVAILABLE_PATTERNS = [
    /\b(?:unavailable|not available|only available)\b[^]*\b(?:Default|Plan)\s+mode\b/i,
    /\brequest_user_input\b\s+(?:is\s+not|isn['’]t|is)\s+(?:currently\s+)?(?:unavailable|not available|only available)\b/i,
] as const;

// Only top-level reason-bearing fields are inspected (no recursive scan of arbitrary
// content/data) so a normal answer that merely mentions a mode word cannot false-positive.
// `content` is included to match the app-side detection field set (codexToolRendering
// REQUEST_USER_INPUT_RESULT_FIELDS, codex review F3) — but readReasonText only reads a STRING
// content, so an array/object `content` is never scanned (non-recursive preserved).
const REQUEST_USER_INPUT_REASON_FIELDS = [
    'output', 'error', 'message', 'reason', 'stderr', 'content',
] as const;

// Strip a <tool_use_error>…</tool_use_error> wrapper (Codex/Claude error envelope) so the
// raw markup never lands in the normalized error reason; return the inner text otherwise
// the original string trimmed.
function unwrapToolUseError(text: string): string {
    const match = text.match(/<tool_use_error>([^]*?)<\/tool_use_error>/i);
    return (match ? match[1] : text).trim();
}

function readReasonText(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
}

// True only for the mode-anchored unavailable/only-available message.
function matchesRequestUserInputUnavailable(text: string | null): boolean {
    return text !== null && REQUEST_USER_INPUT_UNAVAILABLE_PATTERNS.some((re) => re.test(text));
}

// Scoped to functions.request_user_input (namespace null/''/'functions'). When the
// dynamic_tool_call_end message reports the unavailable/only-available-in-mode shape,
// returns the cleaned reason; otherwise null (no normalization).
function detectRequestUserInputUnavailableReason(message: Record<string, unknown>): string | null {
    const tool = typeof message.tool === 'string' ? message.tool : '';
    if (tool !== 'request_user_input') return null;
    const namespace = typeof message.namespace === 'string' ? message.namespace : '';
    if (namespace !== '' && namespace !== 'functions') return null;
    for (const field of REQUEST_USER_INPUT_REASON_FIELDS) {
        const text = readReasonText(message[field]);
        if (text === null) continue;
        const cleaned = unwrapToolUseError(text);
        if (matchesRequestUserInputUnavailable(cleaned)) return cleaned;
    }
    return null;
}

// Inject the error-shape the EXISTING app reducer recognizes (status:'failed' +
// success:false + non-empty error). status+error survive TOOL_END_OMIT_KEYS and force
// buildToolEndOutput into the JSON-object branch (the bare-string collapse fires only when
// the sole non-omitted key is a string output). Returns the message unchanged when not an
// unavailable request_user_input — strictly scoped, so other dynamic tools are byte-identical.
function normalizeRequestUserInputUnavailable(message: Record<string, unknown>): Record<string, unknown> {
    const reason = detectRequestUserInputUnavailableReason(message);
    if (reason === null) return message;
    return {
        ...message,
        status: 'failed',
        success: false,
        error: reason,
        output: typeof message.output === 'string' && message.output.length > 0 ? message.output : reason,
    };
}

function buildToolEndOutput(message: Record<string, unknown>): string | undefined {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(message)) {
        if (!TOOL_END_OMIT_KEYS.has(key) && value !== undefined) {
            payload[key] = value;
        }
    }
    const keys = Object.keys(payload);
    if (keys.length === 0) return undefined;
    if (keys.length === 1 && typeof payload.output === 'string') return payload.output;
    return JSON.stringify(payload);
}

function buildCodexCommandResult(message: Record<string, unknown>): Record<string, unknown> | undefined {
    if (message.type !== 'exec_command_end') return undefined;
    const output = typeof message.output === 'string' ? message.output : '';
    return {
        output,
        stdout: typeof message.stdout === 'string' ? message.stdout : output,
        stderr: typeof message.stderr === 'string' ? message.stderr : null,
        exit_code: typeof message.exit_code === 'number' ? message.exit_code : null,
        status: typeof message.status === 'string' ? message.status : null,
        duration_ms: typeof message.duration_ms === 'number' ? message.duration_ms : null,
        cwd: typeof message.cwd === 'string' ? message.cwd : null,
        command: message.command ?? null,
        empty_output: output.length === 0,
        source: 'codex.exec_command_end',
    };
}

function imageMimeForPath(path: string): string | null {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_MIME_BY_EXTENSION[extension] ?? null;
}

function browserLoadableImageUri(uri: string): boolean {
    return /^data:image\//i.test(uri) || /^https?:\/\//i.test(uri);
}

function pathFromImageString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('file://')) {
        try {
            return decodeURIComponent(new URL(trimmed).pathname);
        } catch {
            return decodeURIComponent(trimmed.slice('file://'.length));
        }
    }
    if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed) || !!imageMimeForPath(trimmed)) {
        return trimmed;
    }
    return null;
}

// Percent-decode a captured path (e.g. `shot%201.png` -> `shot 1.png`) when it is valid percent-encoding;
// otherwise return it unchanged (a literal `%` that is not an escape must not throw / drop the path).
function percentDecode(path: string): string {
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
}

// Scan `text` for markdown link targets, reading each target with a balanced-paren scanner so a target
// containing spaces or inner parentheses is captured in full. After the opening `](`, read characters
// until the closing `)` that balances the link's own parens (depth tracking), then strip an optional
// trailing ` "title"` segment. Yields each raw target (already trimmed).
function* markdownLinkTargets(text: string): Generator<string> {
    MARKDOWN_LINK_OPEN_REGEX.lastIndex = 0;
    let open: RegExpExecArray | null;
    while ((open = MARKDOWN_LINK_OPEN_REGEX.exec(text)) !== null) {
        let depth = 1;
        let i = open.index + open[0].length;
        const start = i;
        for (; i < text.length && depth > 0; i++) {
            const ch = text[i];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
        }
        if (depth !== 0) continue; // unterminated link — skip
        let target = text.slice(start, i - 1).trim();
        const titleMatch = target.match(/\s+"[^"]*"$/);
        if (titleMatch) target = target.slice(0, target.length - titleMatch[0].length).trim();
        if (target.length > 0) yield target;
    }
}

function firstImagePathFromText(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    for (const target of markdownLinkTargets(value)) {
        // Percent-decode first so `shot%201.png` resolves to the on-disk `shot 1.png`.
        const path = pathFromImageString(percentDecode(target));
        if (path) return path;
    }

    for (const match of value.matchAll(IMAGE_PATH_IN_TEXT_REGEX)) {
        const path = pathFromImageString(match[0]);
        if (path) return path;
    }

    return null;
}

// Resolve a possibly-relative image path against the Codex session/thread cwd. A `file://` URL (which
// may arrive on a DIRECT path field like `{ path: 'file:///tmp/shot.png' }`, not only inside a markdown
// link) is converted to its absolute filesystem path first; absolute paths are returned as-is; a
// relative path is joined onto `baseDir` (the session cwd, falling back to process.cwd() when the caller
// did not thread one). The Playwright MCP screenshot tool saves its PNG relative to the session cwd and
// reports a RELATIVE path, so this is the only sound base dir.
function resolveImagePath(path: string, baseDir?: string): string {
    if (path.startsWith('file://')) {
        return pathFromImageString(path) ?? path;
    }
    if (isAbsolute(path)) return path;
    return resolvePath(baseDir ?? process.cwd(), path);
}

function buildPathImagePreview(path: string, baseDir?: string): Record<string, unknown> {
    const mime = imageMimeForPath(path);
    if (!mime) return { path, preview_unavailable_reason: 'unsupported image type' };
    const resolved = resolveImagePath(path, baseDir);
    try {
        const stat = statSync(resolved);
        if (!stat.isFile()) return { path, preview_unavailable_reason: 'image path is not a file' };
        if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
            return { path, size: stat.size, preview_unavailable_reason: 'image file is too large to preview inline' };
        }
        const base64 = readFileSync(resolved).toString('base64');
        return { path, size: stat.size, preview_uri: `data:${mime};base64,${base64}` };
    } catch {
        return { path, preview_unavailable_reason: 'image file unavailable' };
    }
}

function buildBase64ImagePreview(value: string, mime: string): Record<string, unknown> {
    return { preview_uri: browserLoadableImageUri(value) ? value : `data:${mime};base64,${value}` };
}

// The Playwright MCP screenshot tool. Live name is `mcp__playwright__browser_take_screenshot`, which
// the codex app-server forwards as a mcp_tool_call_end with server='playwright' tool='browser_take_screenshot'.
function isPlaywrightScreenshotTool(message: Record<string, unknown>): boolean {
    return message.server === 'playwright' && message.tool === 'browser_take_screenshot';
}

// Bound on how deep the result-text harvest recurses through nested MCP content[] arrays and
// doubly-encoded JSON-string wrappers, so a pathological/cyclic payload cannot blow the stack.
const RESULT_TEXT_MAX_DEPTH = 6;

// Recursively harvest every plausibly-text field of a tool result that might carry the saved-file
// markdown link `- [Screenshot of viewport](<path>)`. The LIVE Playwright-screenshot shape is deeply
// nested AND doubly JSON-encoded:
//   result.content[0].text === JSON.stringify({ content: [ { type:'text', text:'### Result\n- [..](path)' },
//                                                          { type:'image', data:'<corrupt…b64>' } ] })
// so the link lives at result.content[0].text -> JSON.parse -> .content[0].text. A flat read of the
// top-level content/result/output strings (the old behavior) never reaches it. This walker therefore:
//   (a) recurses into MCP `content[]` / `result.content[]` / `contentItems[]` arrays, reading each
//       { type:'text', text } / { content } item; AND
//   (b) when a collected string is itself JSON (trimmed starts with `{` or `[`), JSON.parse it
//       (try/catch) and recurse to harvest the inner content[].text — unwrapping the doubly-encoded
//       wrapper. Bounded by RESULT_TEXT_MAX_DEPTH so huge/cyclic payloads can't loop forever, and only
//       brace/bracket-leading strings are parsed so ordinary text is never JSON.parsed.
function collectResultText(message: Record<string, unknown>): string[] {
    const texts: string[] = [];
    const visit = (value: unknown, depth: number): void => {
        if (depth > RESULT_TEXT_MAX_DEPTH) return;
        if (typeof value === 'string') {
            if (value.length === 0) return;
            texts.push(value);
            // The string may itself be a JSON-encoded MCP result wrapper — unwrap and recurse.
            const trimmed = value.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    visit(JSON.parse(trimmed), depth + 1);
                } catch {
                    // not JSON — already harvested the raw string above.
                }
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item, depth + 1);
            return;
        }
        if (isRecord(value)) {
            visit(value.text, depth + 1);
            visit(value.content, depth + 1);
        }
    };
    visit(message.content, 0);
    visit(message.result, 0);
    visit(message.output, 0);
    visit(message.contentItems, 0);
    return texts;
}

// Read the tool INPUT filename (priority b) from a Playwright-screenshot result message. The codex
// app-server forwards screenshot input args under `arguments`/`input` (when present) — fall back to a
// top-level `filename` field. Only a non-empty string is returned.
function screenshotInputFilename(message: Record<string, unknown>): string | null {
    const candidates: unknown[] = [message.filename];
    for (const key of ['arguments', 'input']) {
        const args = parseRecord(message[key]);
        if (args) candidates.push(args.filename);
    }
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
    }
    return null;
}

// PRODUCER fix for `mcp__playwright__browser_take_screenshot`: Codex's tool-output bounding layer
// elides the doubly-encoded inline PNG base64 with a U+2026 '…' at ~512KB, so the inline base64 the
// generic image extractor would pick up is irreversibly corrupted. Instead resolve the SAVED file off
// disk and synthesize a clean preview_uri (the same shape view_image/image_generation produce). Path
// resolution priority:
//   (a) the markdown link `- [Screenshot of viewport](<path>)` parsed out of the result text;
//   (b) else the tool input `filename`;
//   (c) else a direct path field / path-shaped result/output string (legacy artifact shape).
// Relative paths resolve against the Codex session cwd. On success -> { path, size, preview_uri };
// on any failure (not found / unsupported / too big / unreadable) -> the existing
// preview_unavailable_reason fallback. The corrupt inline base64 is NEVER used.
function resolveScreenshotPath(message: Record<string, unknown>): string | null {
    for (const text of collectResultText(message)) {
        const fromLink = firstImagePathFromText(text);
        if (fromLink) return fromLink;
    }
    const filename = screenshotInputFilename(message);
    if (filename) return pathFromImageString(filename) ?? filename;
    return readStringByKey(message, IMAGE_PATH_KEYS)
        ?? pathFromImageString(message.result)
        ?? pathFromImageString(message.output);
}

function buildScreenshotFileResult(message: Record<string, unknown>, baseDir?: string): Record<string, unknown> {
    const path = resolveScreenshotPath(message);
    if (!path) return { preview_unavailable_reason: 'screenshot file path unavailable' };
    return buildPathImagePreview(path, baseDir);
}

// Shared image_generation_end normalizer (used by the live/replay mapper handler AND the replay child-merge
// path, codex#6). codex finding 6: `result` is a RAW base64 PNG (not a path/uri), and the generic image
// extraction (buildImageToolResult/IMAGE_BASE64_KEYS) does NOT treat `result` as base64 — so normalize it
// into a browser-loadable data:image/png;base64 preview_uri here (idempotent if it already arrives as a
// data:/http(s) URI). The multi-MB raw `result` is dropped once normalized so it is not re-serialized into
// both `output` and `result`. A result-less completion falls back to the on-disk `savedPath` (codex
// finding 1) so the image still renders via the path-based preview. Also stamps `type:'image_generation_end'`
// so buildImageToolResult's image guard accepts it on the child path.
export function normalizeImageGenerationEnd(message: Record<string, unknown>): Record<string, unknown> {
    const rawResult = typeof message.result === 'string' ? message.result.trim() : '';
    const savedPath = typeof message.savedPath === 'string' ? message.savedPath.trim() : '';
    const normalized: Record<string, unknown> = { ...message, type: 'image_generation_end' };
    if (rawResult.length > 0) {
        normalized.preview_uri = browserLoadableImageUri(rawResult) ? rawResult : `data:image/png;base64,${rawResult}`;
        delete normalized.result;
    } else if (savedPath.length > 0) {
        normalized.path = savedPath;
    }
    return normalized;
}

// Exported for the replay child-merge path (AC-A5): child rollout image/mcp tool ENDs are synthesized
// outside the mapper (buildChildEndEnvelope), so they must call the same image-preview synthesis directly
// to reconstruct preview_uri from the on-disk saved file (relative paths resolve against `baseDir`, the
// child rollout's session_meta cwd). Returns the image result record, or undefined for a non-image tool.
export function buildImageToolResult(message: Record<string, unknown>, baseDir?: string): Record<string, unknown> | undefined {
    const type = typeof message.type === 'string' ? message.type : '';
    const name = `${type} ${message.server ?? ''} ${message.namespace ?? ''} ${message.tool ?? ''}`.toLowerCase();
    if (type !== 'image_view_end' && !/(screenshot|image)/.test(name)) return undefined;
    const source = parseRecord(message.result) ?? parseRecord(message.output) ?? message;
    // Playwright-screenshot-specific path: the inline base64 is corrupted by Codex's output bounding
    // (U+2026 elision), so prefer the SAVED file on disk and ignore the inline base64 entirely. Strictly
    // scoped to mcp__playwright__browser_take_screenshot — every other tool keeps the generic path below.
    if (isPlaywrightScreenshotTool(message)) {
        const fileResult = buildScreenshotFileResult(message, baseDir);
        // The file-based result is AUTHORITATIVE: drop any stale preview_uri / preview_unavailable_reason
        // carried on the source message (the live shape ships a top-level preview_unavailable_reason AND a
        // corrupt inline payload) so success yields ONLY a clean preview_uri and failure yields ONLY a
        // preview_unavailable_reason — never both, and never the corrupt inline base64.
        const { preview_uri: _staleUri, preview_unavailable_reason: _staleReason, ...sourceRest } = source;
        return { ...sourceRest, ...fileResult };
    }
    const resultUri = typeof message.result === 'string' && browserLoadableImageUri(message.result) ? message.result : null;
    const outputUri = typeof message.output === 'string' && browserLoadableImageUri(message.output) ? message.output : null;
    const uri = readStringByKey(source, IMAGE_URI_KEYS) ?? readStringByKey(message, IMAGE_URI_KEYS)
        ?? resultUri ?? outputUri;
    const path = pathFromImageString(uri)
        ?? readStringByKey(source, IMAGE_PATH_KEYS)
        ?? readStringByKey(message, IMAGE_PATH_KEYS)
        ?? pathFromImageString(message.result)
        ?? pathFromImageString(message.output)
        ?? firstImagePathFromText(message.result)
        ?? firstImagePathFromText(message.output);
    const base64 = readStringByKey(source, IMAGE_BASE64_KEYS) ?? readStringByKey(message, IMAGE_BASE64_KEYS);
    const mime = readStringByKey(source, IMAGE_MIME_KEYS) ?? (path ? imageMimeForPath(path) : null) ?? 'image/png';
    const preview = uri && browserLoadableImageUri(uri) ? { preview_uri: uri }
        : base64 ? buildBase64ImagePreview(base64, mime)
            : path ? buildPathImagePreview(path, baseDir)
                : { preview_unavailable_reason: 'image preview data unavailable' };
    return { ...source, ...preview };
}

// OBJ-7 / MIN-1 LIVE (AC-A5): merge persisted tool BEGIN args into the args-less END message so a relative
// screenshot `filename` (captured at mcp_tool_call_begin) reaches screenshotInputFilename. The END's OWN
// fields are AUTHORITATIVE and win — begin args only fill gaps (codex#2): the top-level `filename` is
// back-filled ONLY when neither the END's top-level `filename` NOR its parsed `arguments.filename` is
// present (those are the two places screenshotInputFilename reads), and `arguments` is merged with the
// END's own keys overriding the begin args. This helper is called ONLY for the Playwright screenshot tool
// (codex#3 — see the call site gate), so it never alters a non-screenshot MCP end's serialized output.
function mergeBeginArgsIntoEnd(message: Record<string, unknown>, beginArgs: Record<string, unknown>): Record<string, unknown> {
    const endArgs = parseRecord(message.arguments);
    const mergedArgs = { ...beginArgs, ...(endArgs ?? {}) };
    const merged: Record<string, unknown> = { ...message, arguments: mergedArgs };
    const endHasFilename = typeof message.filename === 'string' && message.filename.trim().length > 0;
    const endArgsHasFilename = typeof endArgs?.filename === 'string' && (endArgs.filename as string).trim().length > 0;
    if (!endHasFilename && !endArgsHasFilename && typeof beginArgs.filename === 'string') {
        merged.filename = beginArgs.filename;
    }
    return merged;
}

function toolEndEnvelope(
    call: string,
    message: Record<string, unknown>,
    opts: CreateEnvelopeOptions,
    baseDir?: string,
): SessionEnvelope {
    const output = buildToolEndOutput(message);
    const result = buildCodexCommandResult(message) ?? buildImageToolResult(message, baseDir);
    return createEnvelope('agent', {
        t: 'tool-call-end',
        call,
        ...(output !== undefined ? { output } : {}),
        ...(result !== undefined ? { result } : {}),
    }, opts);
}

export function mapCodexMcpMessageToSessionEnvelopes(message: Record<string, unknown>, state: CodexTurnState): CodexMapperResult {
    const type = message.type;
    const startedSubagents = getStartedSubagents(state);
    const activeSubagents = getActiveSubagents(state);
    const providerSubagentToSessionSubagent = getProviderSubagentToSessionSubagent(state);
    const subagentLifecycles = getSubagentLifecycles(state);
    const emittedCollabBeginCallIds = getEmittedCollabBeginCallIds(state);
    const waitTargetsByCallId = getWaitTargetsByCallId(state);
    const toolArgsByCallId = getToolArgsByCallId(state);
    // Codex session/thread cwd — the base dir for resolving a relative saved-screenshot path. Both
    // callers thread process.cwd(); buildPathImagePreview falls back to process.cwd() when absent.
    const sessionCwd = state.sessionCwd;

    if (type === 'task_started') {
        const turnId = pickWrapperTurnId(message) ?? createId();
        const turnStart = createEnvelope('agent', { t: 'turn-start' }, { turn: turnId, ...(typeof state.recordTime === 'number' && Number.isFinite(state.recordTime) ? { time: state.recordTime } : {}) });
        startedSubagents.clear();
        activeSubagents.clear();
        providerSubagentToSessionSubagent.clear();
        subagentLifecycles.clear();
        // Cycle 8 (M5): clear the emitted-begin Set on the parent turn boundary so orphan-end
        // suppression is scoped to the current turn (a stale begin from a prior turn must not
        // greenwash an end in this turn).
        emittedCollabBeginCallIds.clear();
        waitTargetsByCallId.clear();
        toolArgsByCallId.clear();
        return { currentTurnId: turnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, waitTargetsByCallId, toolArgsByCallId, envelopes: [turnStart] };
    }

    if (type === 'task_complete' || type === 'turn_aborted') {
        if (!state.currentTurnId) {
            return { currentTurnId: null, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, waitTargetsByCallId, toolArgsByCallId, envelopes: [] };
        }
        // Cycle 7 (M2.a): lifecycle-END / turn-end for a close/abort record inherit THIS record's time.
        const lifecycleOpts = { turn: state.currentTurnId, ...(typeof state.recordTime === 'number' && Number.isFinite(state.recordTime) ? { time: state.recordTime } : {}) } satisfies CreateEnvelopeOptions;
        const turnStatus = pickTurnEndStatus(message, type);
        const lifecycleEnvelopes: SessionEnvelope[] = [];
        flushOpenLifecycles(turnStatus === 'completed' ? 'completed' : 'errored', turnStatus, lifecycleOpts, subagentLifecycles, lifecycleEnvelopes);
        providerSubagentToSessionSubagent.clear();
        subagentLifecycles.clear();
        // Cycle 8 (M5): the parent turn ended — drop the emitted-begin Set so the next turn starts clean.
        emittedCollabBeginCallIds.clear();
        waitTargetsByCallId.clear();
        toolArgsByCallId.clear();
        return {
            currentTurnId: null, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, waitTargetsByCallId, toolArgsByCallId,
            envelopes: [
                ...lifecycleEnvelopes,
                ...emitSubagentStops(lifecycleOpts, startedSubagents, activeSubagents),
                createEnvelope('agent', { t: 'turn-end', status: turnStatus }, lifecycleOpts),
            ],
        };
    }

    if (type === 'token_count') {
        return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes: [] };
    }

    const subagent = resolveSessionSubagent(message, providerSubagentToSessionSubagent);
    const opts = buildEnvelopeOptions(state.currentTurnId, subagent, message, state.recordTime);

    if (type === 'agent_message') {
        if (typeof message.message !== 'string') {
            return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes: [] };
        }

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);

        // #1 / OBJ-5 (AC-A1): a subagent's FINAL answer is single-sourced in the lifecycle Result, so OMIT
        // the visible child {t:'text'} envelope for it when a lifecycle entry exists (the fix is OMISSION,
        // not replacement — codex#4: no new session-protocol shape). Intermediate (non-final) subagent text
        // STILL emits as visible text; a final answer with NO lifecycle entry is NOT suppressed (preserve
        // text, no data loss); non-subagent finals are unchanged.
        const lifecycleEntry = subagent ? subagentLifecycles.get(subagent) : undefined;
        const isFinalAnswer = message.phase === 'final_answer';
        // iter-2 BUG 2: only suppress the final-answer child for a NON-TERMINAL lifecycle entry. If the
        // lifecycle is already terminal (completed/errored — its Result was already emitted by
        // emitLifecycleEnd/flushOpenLifecycles, and flushOpenLifecycles SKIPS terminal entries), a LATE
        // final_answer arriving after the terminal would be suppressed AND never re-buffered into a Result —
        // i.e. rendered NOWHERE. So for a terminal entry, emit the child text envelope normally; Cluster B's
        // app-side equality guard drops it only if the Result already contains the same text (no duplicate),
        // but it can never vanish.
        const lifecycleIsTerminal = lifecycleEntry?.state === 'completed' || lifecycleEntry?.state === 'errored';
        const suppressFinalChildText = !!lifecycleEntry && isFinalAnswer && !lifecycleIsTerminal;
        if (!suppressFinalChildText) {
            envelopes.push(createEnvelope('agent', { t: 'text', text: message.message }, opts));
        }

        // OBJ-5 / MIN-4 (AC-A1 source-tagged buffer precedence): bufferedFinalSummary feeds the lifecycle
        // Result via flush/close. Provenance rules so intermediate chatter never becomes a false Result and
        // a real final_answer is authoritative:
        //   - a NON-EMPTY phase==='final_answer' agent_message → authoritative ('final_answer');
        //   - a non-final agent_message → kept on the entry as 'intermediate' (diagnostics only) but ONLY
        //     when nothing authoritative is already buffered (never clobber a real final_answer with later
        //     intermediate chatter), and NEVER promoted to the Result (isAuthoritativeFinalSummary gates it);
        //   - a whitespace-only final_answer does NOT populate the summary (trim().length>0).
        if (lifecycleEntry) {
            if (isFinalAnswer) {
                if (isNonEmptyFinalSummary(message.message)) {
                    lifecycleEntry.bufferedFinalSummary = message.message;
                    lifecycleEntry.bufferedFinalSummarySource = 'final_answer';
                }
            } else if (lifecycleEntry.bufferedFinalSummarySource !== 'final_answer' && lifecycleEntry.bufferedFinalSummarySource !== 'agentsStates') {
                // Non-authoritative intermediate text — retain the latest for diagnostics, but never erase
                // a non-empty value with an empty one, and never mark it authoritative.
                if (isNonEmptyFinalSummary(message.message)) {
                    lifecycleEntry.bufferedFinalSummary = message.message;
                    lifecycleEntry.bufferedFinalSummarySource = 'intermediate';
                }
            }
        }
        if (subagent && message.phase === 'final_answer') {
            maybeEmitSubagentStop(subagent, opts, activeSubagents, envelopes);
            envelopes.push(createEnvelope('agent', {
                t: 'tool-call-end',
                call: subagent,
                output: message.message,
            }, buildEnvelopeOptions(
                state.currentTurnId,
                providerSubagentToSessionSubagent.get(ownerSubagentKey(subagent)),
                message,
                state.recordTime,
            )));
        }
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'agent_reasoning' || type === 'agent_reasoning_delta') {
        const text = typeof message.text === 'string'
            ? message.text
            : (typeof message.delta === 'string' ? message.delta : null);

        if (!text) {
            return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes: [] };
        }

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(createEnvelope('agent', { t: 'text', text, thinking: true }, opts));
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    // exec_approval_request is intentionally NOT mapped here — the permission
    // handler already renders the approval UI via agent state.  Mapping it to
    // tool-call-start too would create a duplicate tool call card.
    if (type === 'exec_command_begin') {
        const call = pickCallId(message);
        const { call_id: _callIdSnake, callId: _callIdCamel, type: _type, ...args } = message;

        const command = summarizeCommand((args as Record<string, unknown>).command);
        const description = typeof (args as Record<string, unknown>).description === 'string'
            ? ((args as Record<string, string>).description)
            : (command ?? 'Execute command');

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'CodexBash',
                title: commandToTitle(command),
                description,
                args: args as Record<string, unknown>,
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'exec_command_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(toolEndEnvelope(call, message, opts));
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'patch_apply_begin') {
        const call = pickCallId(message);
        const autoApproved = (message as { auto_approved?: unknown }).auto_approved;
        const changes = (message as { changes?: unknown }).changes;

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'CodexPatch',
                title: 'Apply patch',
                description: patchDescription(changes),
                args: {
                    auto_approved: autoApproved,
                    changes,
                },
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'patch_apply_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(toolEndEnvelope(call, message, opts));
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    // §5.15 Phase E — Codex protocol-extension activation (cycle 2).
    // Translates Option-2 EventMsg discriminators emitted by codexAppServerClient.ts
    // (collabAgentToolCall, dynamicToolCall, mcpToolCall, plan, imageView) into
    // tool-call-start / tool-call-end envelopes that drive the cycle 1 dormant
    // renderers in happy-app/sources/components/tools/_all.tsx.
    // Source of truth: codex app-server generate-ts /tmp/codex-ts/v2/ThreadItem.ts (Codex 0.125.0)

    // CollabAgentTool enum -> happy-app knownTools verb keys
    const COLLAB_VERB_MAP: Record<string, string> = {
        spawnAgent: 'spawn_agent',
        sendInput: 'send_input',
        resumeAgent: 'resume_agent',
        wait: 'wait_agent',
        closeAgent: 'close_agent',
    };

    if (type === 'collab_agent_call_begin') {
        // Cycle 8 (Path A+): real spawn-begin per event_mapping.rs:75-86 has empty receiver_thread_ids;
        // for spawn_agent allocate provisional ssn keyed on call_id, bind receiverThreadId at spawn-end.
        const call = pickCallId(message);
        const tool = typeof message.tool === 'string' ? message.tool : '';
        const verb = COLLAB_VERB_MAP[tool] ?? tool;
        const name = `functions.${verb}`;

        // Cycle 9 (A2-M1): a MULTI-target wait_agent (BEGIN receiverThreadIds length >= 2) renders ONE
        // per-target tool-call-start per begin target — NOT a single collapsed parent (firstReceiverThreadId).
        // The full begin target list is persisted by call_id so the END handler enumerates EXACTLY these
        // targets (the output status{} map is partial in 242/245 real cases). Each target resolves its own
        // ssn and gets a stable synthetic call id; every synthetic id is added to emittedCollabBeginCallIds.
        // NO-regression gate: the per-target fan-out is REPLAY-ONLY. The live caller (runCodex.ts) never
        // sets state.replay, so live multi-target waits fall through to the single-target path below
        // (firstReceiverThreadId), staying byte-equal to baseline. mapCodexMcpMessageToSessionEnvelopes is
        // shared by replay AND live; without this gate the live path emitted N per-target starts whose
        // matching ends never fired -> N-1 dangling starts on ~30% of multi-target waits.
        const waitTargets = verb === 'wait_agent' ? allReceiverThreadIds(message) : [];
        if (verb === 'wait_agent' && waitTargets.length >= 2 && state.replay === true) {
            waitTargetsByCallId.set(call, waitTargets);
            const envelopes: SessionEnvelope[] = [];
            maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
            waitTargets.forEach((tid, index) => {
                const ssn = ensureReceiverSessionSubagent(tid, providerSubagentToSessionSubagent);
                if (subagent) providerSubagentToSessionSubagent.set(ownerSubagentKey(ssn), subagent);
                const syntheticCall = perTargetCallId(call, index, tid);
                providerSubagentToSessionSubagent.set(callSubagentKey(syntheticCall), ssn);
                const isChild = subagentLifecycles.has(ssn);
                const childOpts = isChild ? { ...opts, subagent: ssn } : opts;
                const args = isChild
                    ? { tool, prompt: message.prompt ?? null, model: message.model ?? null, senderThreadId: message.senderThreadId ?? null, receiverThreadIds: [tid], agentsStates: message.agentsStates ?? {} }
                    : { tool, prompt: message.prompt ?? null, model: message.model ?? null, senderThreadId: message.senderThreadId ?? null, receiverThreadIds: [tid], agentsStates: message.agentsStates ?? {}, ...(ssn ? { sessionSubagent: ssn } : {}) };
                envelopes.push(createEnvelope('agent', { t: 'tool-call-start', call: syntheticCall, name, title: `Subagent: ${verb}`, description: `wait_agent target ${tid}`, args }, childOpts));
                emittedCollabBeginCallIds.add(syntheticCall);
            });
            return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, waitTargetsByCallId, envelopes };
        }

        const receiverThreadId = firstReceiverThreadId(message);
        let sessionSubagent: string | undefined;
        if (verb === 'spawn_agent') {
            sessionSubagent = providerSubagentToSessionSubagent.get(callSubagentKey(call)) ?? createId();
            providerSubagentToSessionSubagent.set(callSubagentKey(call), sessionSubagent);
            if (receiverThreadId) providerSubagentToSessionSubagent.set(receiverThreadId, sessionSubagent);
        } else if (receiverThreadId) {
            sessionSubagent = ensureReceiverSessionSubagent(receiverThreadId, providerSubagentToSessionSubagent);
            providerSubagentToSessionSubagent.set(callSubagentKey(call), sessionSubagent);
        } else if (verb === 'send_input' || verb === 'wait_agent' || verb === 'close_agent' || verb === 'resume_agent') {
            // M1 fallback (Cycle 6 AC-C6-1): when receiverThreadId is absent for known control verbs,
            // resolve sessionSubagent from the single active lifecycle if exactly one exists.
            // Gated to known control verbs only to avoid misattributing future/unknown collab verbs.
            const activeLifecycles = [...subagentLifecycles.entries()]
                .filter(([, lc]) => lc.state !== 'completed' && lc.state !== 'errored');
            if (activeLifecycles.length === 1) {
                sessionSubagent = activeLifecycles[0][0];
                // Register for collab_agent_call_end matching via callSubagentKey.
                providerSubagentToSessionSubagent.set(callSubagentKey(call), sessionSubagent);
            }
            // If activeLifecycles.length > 1: leave sessionSubagent undefined (no wrong attribution).
        }
        if (sessionSubagent && subagent) providerSubagentToSessionSubagent.set(ownerSubagentKey(sessionSubagent), subagent);
        const prompt = typeof message.prompt === 'string' ? message.prompt : '';
        const description = prompt.length > 0 ? (prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt) : `${verb || 'subagent'} call`;
        const title = verb ? `Subagent: ${verb}` : 'Subagent call';
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        // Cycle 7 (M1): emit the lifecycle-start envelope FIRST (before the control-verb child) so the
        // reducer/tracer registers `ssn` as a parent-id before the child links to it (INV-3 / M1.c —
        // `ssn` is a cuid2, not orphan-buffered, so ordering is load-bearing). For spawn_agent this
        // registers ssn; for later control verbs the lifecycle already exists from the spawn.
        if (verb === 'spawn_agent' && sessionSubagent) emitLifecycleStart(sessionSubagent, call, prompt, typeof message.agentNickname === 'string' ? message.agentNickname : null, opts, subagentLifecycles, envelopes);
        // Cycle 7 (M1/M1.a/M1.b): emit the control verb as a recursion-safe sidechain CHILD of the
        // lifecycle card when a lifecycle exists for ssn. The child carries:
        //   - opts.subagent = ssn         -> normalizes to a sidechain child (parentUUID = ssn)
        //   - ev.call = provider call_id  -> NEVER ssn (M1.a — else getToolCallParentIds self-registers
        //                                    content.id = ssn and the child self-parents -> recursion)
        //   - args WITHOUT sessionSubagent (M1.b — else getToolCallParentIds self-registers via the
        //                                    sessionSubagent parent-id -> recursion)
        // When no lifecycle exists (sessionSubagent undefined), fall back to the prior top-level shape.
        const isChild = sessionSubagent !== undefined && subagentLifecycles.has(sessionSubagent);
        const childOpts = isChild ? { ...opts, subagent: sessionSubagent } : opts;
        const args = isChild
            ? { tool, prompt: message.prompt ?? null, model: message.model ?? null, senderThreadId: message.senderThreadId ?? null, receiverThreadIds: message.receiverThreadIds ?? [], agentsStates: message.agentsStates ?? {} }
            : { tool, prompt: message.prompt ?? null, model: message.model ?? null, senderThreadId: message.senderThreadId ?? null, receiverThreadIds: message.receiverThreadIds ?? [], agentsStates: message.agentsStates ?? {}, ...(sessionSubagent ? { sessionSubagent } : {}) };
        envelopes.push(createEnvelope('agent', { t: 'tool-call-start', call, name, title, description, args }, childOpts));
        // Cycle 8 (M5): record that a control-verb BEGIN tool-call-start was emitted for this call_id so
        // the matching END is recognised as legitimate (not a true orphan) and is never suppressed.
        emittedCollabBeginCallIds.add(call);
        return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, waitTargetsByCallId, envelopes };
    }

    if (type === 'collab_agent_call_end') {
        const call = pickCallId(message);
        const tool = typeof message.tool === 'string' ? message.tool : '', verb = COLLAB_VERB_MAP[tool] ?? tool;

        // Cycle 9 (A2-M1/M2): a MULTI-target wait_agent END reuses the PERSISTED begin target list
        // (keyed by call_id) — NOT the output status{} map (partial in 242/245 cases). Emit one end per
        // begin target with that target's OWN status (agentsStates[id] → status[id]); targets absent from
        // BOTH get an explicit `unreported` terminal marker (NEVER a borrowed status). Synthetic per-target
        // call ids match the begin so the reducer pairs them; each was already in emittedCollabBeginCallIds.
        const persistedWaitTargets = verb === 'wait_agent' ? waitTargetsByCallId.get(call) : undefined;
        if (persistedWaitTargets && persistedWaitTargets.length >= 2) {
            const envelopes: SessionEnvelope[] = [];
            maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
            persistedWaitTargets.forEach((tid, index) => {
                const targetSsn = providerSubagentToSessionSubagent.get(callSubagentKey(perTargetCallId(call, index, tid)))
                    ?? providerSubagentToSessionSubagent.get(tid);
                const syntheticCall = perTargetCallId(call, index, tid);
                const isChildEnd = targetSsn !== undefined && subagentLifecycles.has(targetSsn);
                const childEndOpts = isChildEnd ? { ...opts, subagent: targetSsn } : opts;
                const own = perTargetStatus(message, tid);
                const endMessage: Record<string, unknown> = own !== undefined
                    ? { type: 'collab_agent_call_end', call_id: syntheticCall, tool, receiverThreadIds: [tid], agentsStates: { [tid]: own }, status: own }
                    // A2-M2: absent from both agentsStates[id] AND status[id] -> explicit unreported marker.
                    : { type: 'collab_agent_call_end', call_id: syntheticCall, tool, receiverThreadIds: [tid], status: 'unreported', lifecycle_state: 'unreported' };
                envelopes.push(toolEndEnvelope(syntheticCall, endMessage, childEndOpts));
                // Codex finding #3 / Cycle-7 parity: buffer THIS target's final-summary message on its
                // lifecycle entry (when present) so a later close_agent terminal inherits it — the
                // single-target wait path does the same via readAgentsStatesMessage / bufferedFinalSummary.
                const entry = targetSsn ? subagentLifecycles.get(targetSsn) : undefined;
                if (entry && isRecord(own)) {
                    const msg = own.message;
                    // OBJ-5 (AC-A1): only a NON-EMPTY agentsStates.message is authoritative; a null/empty
                    // message MUST NOT erase an existing authoritative summary (the prior code overwrote
                    // with null here, clobbering a real final answer).
                    // iter-2 BUG 1: a real phase==='final_answer' is authoritative and MUST NOT be overwritten
                    // by a LATER wait agentsStates.message — because the final-answer child text envelope was
                    // OMITTED (the #1 suppression), letting a divergent wait message clobber it would zero-render
                    // the real answer (it lives ONLY in the buffer). So a wait write is gated to entries whose
                    // buffer is NOT already an authoritative 'final_answer'.
                    if (isNonEmptyFinalSummary(msg) && entry.bufferedFinalSummarySource !== 'final_answer') {
                        entry.bufferedFinalSummary = msg;
                        entry.bufferedFinalSummarySource = 'agentsStates';
                    }
                }
            });
            waitTargetsByCallId.delete(call);
            return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, waitTargetsByCallId, envelopes };
        }

        let ssn = providerSubagentToSessionSubagent.get(callSubagentKey(call));
        // Cycle 8 (Path A+): spawn-end binds receiverThreadId per event_mapping.rs:104-114; retro-emit
        // lifecycle-start when no prior begin (idempotent — subagentLifecycle.ts:59).
        if (verb === 'spawn_agent') {
            const endRcv = firstReceiverThreadId(message);
            if (!ssn) ssn = endRcv ? ensureReceiverSessionSubagent(endRcv, providerSubagentToSessionSubagent) : createId();
            providerSubagentToSessionSubagent.set(callSubagentKey(call), ssn);
            if (endRcv) providerSubagentToSessionSubagent.set(endRcv, ssn);
        }
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        // Cycle 7 (M1.c): retro-emit lifecycle-start BEFORE the control-verb child end so `ssn` is
        // registered as a parent-id before the child links to it (idempotent — subagentLifecycle.ts:59).
        if (verb === 'spawn_agent' && ssn && !subagentLifecycles.has(ssn)) emitLifecycleStart(ssn, call, typeof message.prompt === 'string' ? message.prompt : '', typeof message.agentNickname === 'string' ? message.agentNickname : null, opts, subagentLifecycles, envelopes);
        // OBJ-6 / MIN-7 (AC-A3 T2): the REAL provider nickname lives in the spawn function_call_output
        // ({agent_id, nickname}); the replay path forwards it onto this spawn-END as message.agentNickname.
        // The lifecycle was created at spawn-BEGIN with the synthesized 'Subagent N' ordinal label (the
        // begin had no nickname), so promote the real nickname onto the entry now — a real provider nickname
        // WINS over the synthesized label. A null/empty/missing nickname leaves the synthesized label intact.
        if (verb === 'spawn_agent' && ssn) promoteRealAgentNickname(ssn, message.agentNickname, subagentLifecycles);
        // Cycle 7 (M1/M1.a/M1.b): emit the control-verb tool-call-END as a recursion-safe sidechain CHILD
        // (matching the begin: call = provider call_id (never ssn), opts.subagent = ssn) so begin/end pair
        // under the same sidechain parent. END carries no args, so M1.b (omit sessionSubagent) is automatic.
        const isChildEnd = ssn !== undefined && subagentLifecycles.has(ssn);
        const childEndOpts = isChildEnd ? { ...opts, subagent: ssn } : opts;
        // Cycle 8 (M5, RC-3 discriminator): a TRUE orphan END is one that (a) cannot link to a lifecycle
        // (isChildEnd false), AND (b) had NO matching BEGIN emitted for this call_id this turn, AND (c) is
        // not the spawn_agent retro-start case (spawn always synthesizes an ssn above, so it never reaches
        // here unlinked). Such an END would render as a scattered top-level tool-call-end card — suppress
        // it. The discriminator keys on "no emitted BEGIN", NOT merely "ssn undefined": an end whose begin
        // WAS emitted (in the Set) or whose ssn resolves (isChildEnd) is a legitimate end and is emitted
        // normally — this protects the A2 control-verb-children behavior from over-suppression.
        const isTrueOrphanEnd = !isChildEnd && verb !== 'spawn_agent' && !emittedCollabBeginCallIds.has(call);
        if (!isTrueOrphanEnd) {
            envelopes.push(toolEndEnvelope(call, message, childEndOpts));
        }
        // Cycle 7 §5.3.D.5: real path event.agentsStates[id].message; wait buffers, close emits.
        // OBJ-5 (AC-A1): only a NON-EMPTY agentsStates.message is authoritative; a null/empty fromAS MUST
        // NOT erase an existing authoritative summary (the prior code overwrote with a null fromAS here).
        const entry = ssn ? subagentLifecycles.get(ssn) : undefined;
        const fromAS = (verb === 'wait_agent' || verb === 'close_agent') ? readAgentsStatesMessage(message) : undefined;
        if (verb === 'wait_agent' && entry && isNonEmptyFinalSummary(fromAS) && entry.bufferedFinalSummarySource !== 'final_answer') {
            // iter-2 BUG 1: an authoritative 'final_answer' is NOT overwritten by a later wait message (the
            // final-answer child text is OMITTED, so the buffer is the only carrier — clobbering it with a
            // divergent wait message would zero-render the real answer). null/empty still never erases.
            entry.bufferedFinalSummary = fromAS;
            entry.bufferedFinalSummarySource = 'agentsStates';
        } else if (verb === 'close_agent' && ssn) {
            const status = typeof message.status === 'string' ? message.status : 'completed';
            // Precedence (codex#1): the existing AUTHORITATIVE buffer first (a real final_answer / earlier
            // wait agentsStates.message — NOT intermediate chatter), then this close's own non-empty
            // agentsStates.message (itself authoritative). isAuthoritativeFinalSummary gates provenance so an
            // 'intermediate'-sourced buffer can never win over the close-time agentsStates.message.
            const buf = entry && isAuthoritativeFinalSummary(entry) ? entry.bufferedFinalSummary : undefined;
            const finalSummary = buf ?? (isNonEmptyFinalSummary(fromAS) ? fromAS : undefined);
            const terminal = (status === 'completed') ? 'completed' : 'errored';
            emitLifecycleEnd(ssn, terminal, { status, ...(isNonEmptyFinalSummary(finalSummary) ? { final_summary: finalSummary } : {}), lifecycle_state: terminal }, opts, subagentLifecycles, envelopes);
        }
        return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, waitTargetsByCallId, envelopes };
    }

    if (type === 'dynamic_tool_call_begin') {
        const call = pickCallId(message);
        const tool = typeof message.tool === 'string' ? message.tool : '';
        const namespace = typeof message.namespace === 'string' && message.namespace.length > 0
            ? message.namespace
            : 'functions';
        const name = `${namespace}.${tool}`;
        const args = (message.arguments && typeof message.arguments === 'object')
            ? (message.arguments as Record<string, unknown>)
            : {};

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name,
                title: tool || 'Dynamic tool',
                description: tool || 'Dynamic tool call',
                args,
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'dynamic_tool_call_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        // Item 2: normalize an unavailable functions.request_user_input into an error
        // shape the existing app reducer flags as state:'error' (no-op for every other tool).
        envelopes.push(toolEndEnvelope(call, normalizeRequestUserInputUnavailable(message), opts, sessionCwd));
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'mcp_tool_call_begin') {
        const call = pickCallId(message);
        const server = typeof message.server === 'string' ? message.server : '';
        const tool = typeof message.tool === 'string' ? message.tool : '';
        const name = server.length > 0
            ? `mcp__${server}__${tool}`
            : `functions.${tool}`;
        const args = (message.arguments && typeof message.arguments === 'object')
            ? (message.arguments as Record<string, unknown>)
            : {};
        const title = server.length > 0 ? `MCP: ${server}.${tool}` : `MCP: ${tool}`;

        // OBJ-7 / MIN-1 LIVE (AC-A5): persist the LIVE begin args (notably a relative screenshot `filename`)
        // keyed by call_id so the args-less mcp_tool_call_end can recover them — the live end event does NOT
        // forward item.arguments, so without this the live filename-only screenshot case cannot resolve.
        if (Object.keys(args).length > 0) toolArgsByCallId.set(call, args);

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name,
                title,
                description: tool || 'MCP tool call',
                args,
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, waitTargetsByCallId, toolArgsByCallId, envelopes,
        };
    }

    if (type === 'mcp_tool_call_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        // OBJ-7 / MIN-1 LIVE (AC-A5): merge the persisted begin args into the args-less live END so a
        // relative screenshot `filename` reaches screenshotInputFilename when the markdown link is absent.
        // SCOPED to the Playwright screenshot tool ONLY (codex#3): merging `arguments` into a non-screenshot
        // MCP end would flip buildToolEndOutput from a plain `output` string to JSON — a live-path regression.
        // The END's own fields win over the begin args (begin args only FILL gaps the end lacks).
        const beginArgs = toolArgsByCallId.get(call);
        const endMessage = (beginArgs && isPlaywrightScreenshotTool(message)) ? mergeBeginArgsIntoEnd(message, beginArgs) : message;
        // sessionCwd resolves a relative saved-screenshot path (mcp__playwright__browser_take_screenshot).
        envelopes.push(toolEndEnvelope(call, endMessage, opts, sessionCwd));
        toolArgsByCallId.delete(call);
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, waitTargetsByCallId, toolArgsByCallId, envelopes,
        };
    }

    if (type === 'plan_update_begin') {
        const call = pickCallId(message);
        const text = typeof message.text === 'string' ? message.text : '';
        const plan = message.plan ?? message.steps ?? message.items ?? text;
        const description = text.length > 0
            ? (text.length > 80 ? `${text.slice(0, 77)}...` : text)
            : 'Update plan';

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'functions.update_plan',
                title: 'Update plan',
                description,
                args: { plan, text },
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'plan_update_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(toolEndEnvelope(call, message, opts));
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'image_view_begin') {
        const call = pickCallId(message);
        const path = typeof message.path === 'string' ? message.path : '';
        const description = path.length > 0
            ? (path.length > 80 ? `View: ${path.slice(0, 74)}...` : `View: ${path}`)
            : 'View image';

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'functions.view_image',
                title: 'View image',
                description,
                args: { path },
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'image_view_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(toolEndEnvelope(call, message, opts, sessionCwd));
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    // §5.13 AC3 — web search visibility. The app-server forwards web_search_begin/
    // end (from the codex 0.130 `webSearch` item family) carrying {query, action}.
    // Emit a tool-call-start/end under the REAL registered name functions.web_search
    // so a visible web-search card renders (header chip carrying the query); the
    // guessed web.search_query key is NOT used as the live name.
    if (type === 'web_search_begin') {
        const call = pickCallId(message);
        const query = typeof message.query === 'string' ? message.query : '';
        const action = (message.action && typeof message.action === 'object') ? message.action : null;
        const description = query.length > 0
            ? (query.length > 80 ? `${query.slice(0, 77)}...` : query)
            : 'Web search';

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'functions.web_search',
                title: 'Web search',
                description,
                args: { query, action },
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'web_search_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(toolEndEnvelope(call, message, opts));
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    // §5.13 AC4 — image generation inline result. The app-server forwards
    // image_generation_begin/end (from the codex 0.130 `imageGeneration` item
    // family) carrying {status, revisedPrompt, result, savedPath}. Emit a
    // tool-call-start/end under the REAL registered name functions.image_generation
    // so the generated image renders inline via CodexAttachmentView; the guessed
    // mcp__image_gen__imagegen / image_gen.imagegen keys are NOT used as the live name.
    if (type === 'image_generation_begin') {
        const call = pickCallId(message);
        const revisedPrompt = typeof message.revisedPrompt === 'string' ? message.revisedPrompt : '';
        const description = revisedPrompt.length > 0
            ? (revisedPrompt.length > 80 ? `${revisedPrompt.slice(0, 77)}...` : revisedPrompt)
            : 'Generating image';

        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(
            createEnvelope('agent', {
                t: 'tool-call-start',
                call,
                name: 'functions.image_generation',
                title: 'Generated image',
                description,
                args: { prompt: revisedPrompt },
            }, opts)
        );
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'image_generation_end') {
        const call = pickCallId(message);
        const normalized = normalizeImageGenerationEnd(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(toolEndEnvelope(call, normalized, opts, sessionCwd));
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes: [] };
}

export function mapCodexProcessorMessageToSessionEnvelopes(
    message: ReasoningOutput | DiffToolCall | DiffToolResult,
    state: CodexTurnState,
): SessionEnvelope[] {
    const toolLikeMessage = message as LegacyToolLikeMessage;
    const opts = buildEnvelopeOptions(state.currentTurnId);

    if (message.type === 'reasoning') {
        return [createEnvelope('agent', {
            t: 'text',
            text: message.message,
            thinking: true,
        }, opts)];
    }

    if (message.type === 'tool-call') {
        const title = typeof (toolLikeMessage.input as { title?: unknown } | undefined)?.title === 'string'
            ? (toolLikeMessage.input as { title: string }).title
            : `${toolLikeMessage.name || 'Tool'} call`;

        return [createEnvelope('agent', {
            t: 'tool-call-start',
            call: toolLikeMessage.callId,
            name: toolLikeMessage.name || 'unknown',
            title,
            description: title,
            args: (toolLikeMessage.input && typeof toolLikeMessage.input === 'object'
                ? toolLikeMessage.input
                : {}) as Record<string, unknown>,
        }, opts)];
    }

    if (message.type === 'tool-call-result') {
        const envelopes: SessionEnvelope[] = [];
        const content = toolLikeMessage.output?.content;
        if (typeof content === 'string' && content.trim().length > 0) {
            envelopes.push(createEnvelope('agent', {
                t: 'text',
                text: content,
                thinking: true,
            }, opts));
        }
        const output = buildToolEndOutput(toolLikeMessage as unknown as Record<string, unknown>);
        envelopes.push(createEnvelope('agent', {
            t: 'tool-call-end',
            call: toolLikeMessage.callId,
            ...(output !== undefined ? { output } : {}),
        }, opts));
        return envelopes;
    }

    return [];
}
