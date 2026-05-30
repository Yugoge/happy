import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createId } from '@paralleldrive/cuid2';
import type { ReasoningOutput } from './reasoningProcessor';
import type { DiffToolCall, DiffToolResult } from './diffProcessor';
import { createEnvelope, type CreateEnvelopeOptions, type SessionEnvelope } from '@slopus/happy-wire';
import {
    emitLifecycleEnd,
    emitLifecycleStart,
    flushOpenLifecycles,
    getSubagentLifecycles,
    LIFECYCLE_ENVELOPE_NAME,
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
};

type CodexMapperResult = {
    currentTurnId: string | null;
    startedSubagents: Set<string>;
    activeSubagents: Set<string>;
    providerSubagentToSessionSubagent: Map<string, string>;
    subagentLifecycles: Map<string, LifecycleState>;
    envelopes: SessionEnvelope[];
    emittedCollabBeginCallIds?: Set<string>;
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
const MARKDOWN_LINK_TARGET_REGEX = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
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

function firstImagePathFromText(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    for (const match of value.matchAll(MARKDOWN_LINK_TARGET_REGEX)) {
        const path = pathFromImageString(match[1]);
        if (path) return path;
    }

    for (const match of value.matchAll(IMAGE_PATH_IN_TEXT_REGEX)) {
        const path = pathFromImageString(match[0]);
        if (path) return path;
    }

    return null;
}

function buildPathImagePreview(path: string): Record<string, unknown> {
    const mime = imageMimeForPath(path);
    if (!mime) return { path, preview_unavailable_reason: 'unsupported image type' };
    try {
        const stat = statSync(path);
        if (!stat.isFile()) return { path, preview_unavailable_reason: 'image path is not a file' };
        if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
            return { path, size: stat.size, preview_unavailable_reason: 'image file is too large to preview inline' };
        }
        const base64 = readFileSync(path).toString('base64');
        return { path, size: stat.size, preview_uri: `data:${mime};base64,${base64}` };
    } catch {
        return { path, preview_unavailable_reason: 'image file unavailable' };
    }
}

function buildBase64ImagePreview(value: string, mime: string): Record<string, unknown> {
    return { preview_uri: browserLoadableImageUri(value) ? value : `data:${mime};base64,${value}` };
}

function buildImageToolResult(message: Record<string, unknown>): Record<string, unknown> | undefined {
    const type = typeof message.type === 'string' ? message.type : '';
    const name = `${type} ${message.server ?? ''} ${message.namespace ?? ''} ${message.tool ?? ''}`.toLowerCase();
    if (type !== 'image_view_end' && !/(screenshot|image)/.test(name)) return undefined;
    const source = parseRecord(message.result) ?? parseRecord(message.output) ?? message;
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
            : path ? buildPathImagePreview(path)
                : { preview_unavailable_reason: 'image preview data unavailable' };
    return { ...source, ...preview };
}

function toolEndEnvelope(
    call: string,
    message: Record<string, unknown>,
    opts: CreateEnvelopeOptions,
): SessionEnvelope {
    const output = buildToolEndOutput(message);
    const result = buildCodexCommandResult(message) ?? buildImageToolResult(message);
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
        return { currentTurnId: turnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, envelopes: [turnStart] };
    }

    if (type === 'task_complete' || type === 'turn_aborted') {
        if (!state.currentTurnId) {
            return { currentTurnId: null, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, envelopes: [] };
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
        return {
            currentTurnId: null, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds,
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
        envelopes.push(createEnvelope('agent', { t: 'text', text: message.message }, opts));
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
        return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, envelopes };
    }

    if (type === 'collab_agent_call_end') {
        const call = pickCallId(message);
        const tool = typeof message.tool === 'string' ? message.tool : '', verb = COLLAB_VERB_MAP[tool] ?? tool;
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
        const entry = ssn ? subagentLifecycles.get(ssn) : undefined;
        const fromAS = (verb === 'wait_agent' || verb === 'close_agent') ? readAgentsStatesMessage(message) : undefined;
        if (verb === 'wait_agent' && entry && fromAS !== undefined) entry.bufferedFinalSummary = fromAS;
        else if (verb === 'close_agent' && ssn) {
            const status = typeof message.status === 'string' ? message.status : 'completed';
            const buf = entry?.bufferedFinalSummary;
            const finalSummary = (buf !== undefined && buf !== null) ? buf : (fromAS ?? undefined);
            const terminal = (status === 'completed') ? 'completed' : 'errored';
            emitLifecycleEnd(ssn, terminal, { status, ...(finalSummary !== undefined && finalSummary !== null ? { final_summary: finalSummary } : {}), lifecycle_state: terminal }, opts, subagentLifecycles, envelopes);
        }
        return { currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, emittedCollabBeginCallIds, envelopes };
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
        envelopes.push(toolEndEnvelope(call, message, opts));
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
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
        };
    }

    if (type === 'mcp_tool_call_end') {
        const call = pickCallId(message);
        const envelopes: SessionEnvelope[] = [];
        maybeEmitSubagentStart(subagent, opts, startedSubagents, activeSubagents, envelopes);
        envelopes.push(toolEndEnvelope(call, message, opts));
        return {
            currentTurnId: state.currentTurnId, startedSubagents, activeSubagents, providerSubagentToSessionSubagent, subagentLifecycles, envelopes,
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
        envelopes.push(toolEndEnvelope(call, message, opts));
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
