/**
 * Codex App Server Client — drives Codex via the v2 JSON-RPC protocol
 * (`codex app-server`), replacing the legacy MCP-based CodexMcpClient.
 *
 * Protocol: JSON-RPC 2.0 over stdio (newline-delimited JSON).
 * Reference: codex-rs/app-server/README.md in the openai/codex repo.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { logger } from '@/ui/logger';
import { execSync } from 'child_process';
import type {
    InitializeParams,
    NewConversationParams,
    NewConversationResponse,
    ResumeConversationParams,
    ResumeConversationResponse,
    InterruptConversationParams,
    ReviewDecision,
    EventMsg,
    JsonRpcRequest,
    JsonRpcResponse,
    ApprovalPolicy,
    SandboxMode,
    InputItem,
    ReasoningEffort,
    McpServerElicitationRequestParams,
    McpServerElicitationRequestResponse,
} from './codexAppServerTypes';
import type { SandboxConfig } from '@/persistence';
import { initializeSandbox, wrapForMcpTransport } from '@/sandbox/manager';
import packageJson from '../../package.json';

type PendingRequest = {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    method: string;
    epoch: number;
};

type LegacyPatchChanges = Record<string, Record<string, unknown>>;

export type ApprovalRequest =
    | {
          type: 'exec';
          callId: string;
          command?: string[];
          cwd?: string;
          reason?: string | null;
      }
    | {
          type: 'patch';
          callId: string;
          fileChanges?: Record<string, unknown>;
          reason?: string | null;
      }
    | {
          type: 'mcp_elicitation';
          callId: string;
          serverName: string;
          toolName?: string;
          toolDescription?: string;
          toolArguments?: unknown;
          message: string;
          mode: 'form' | 'url';
          reason?: string | null;
      };

export type ApprovalHandler = (params: ApprovalRequest) => Promise<ReviewDecision>;

/**
 * Check that `codex app-server` is available.
 */
function isAppServerAvailable(): boolean {
    try {
        const version = execSync('codex --version', { encoding: 'utf8' }).trim();
        const match = version.match(/codex-cli\s+(\d+\.\d+\.\d+)/);
        if (!match) return false;
        const [, ver] = match;
        const [major, minor] = ver.split('.').map(Number);
        // app-server available in recent versions
        return major > 0 || minor >= 100;
    } catch {
        return false;
    }
}

// Codex TurnPlanStepStatus is camelCase ("pending" | "inProgress" | "completed").
// The renderer (CodexPlanView) and mapper compare against snake_case
// ("in_progress"); normalize so per-status icons/strikethrough resolve correctly.
function normalizePlanStepStatus(status: unknown): string {
    if (status === 'inProgress') return 'in_progress';
    return typeof status === 'string' && status.length > 0 ? status : 'pending';
}

// Pass the structured plan array through untouched except for status
// normalization, preserving each { step, status } shape extractPlanItems reads.
function normalizePlanSteps(plan: unknown): Array<{ step: string; status: string }> | undefined {
    if (!Array.isArray(plan)) return undefined;
    return plan.map((entry: any) => ({
        step: typeof entry?.step === 'string' ? entry.step : '',
        status: normalizePlanStepStatus(entry?.status),
    }));
}

function normalizeRawFileChangeList(changes: unknown): LegacyPatchChanges | undefined {
    if (!Array.isArray(changes)) {
        return undefined;
    }

    const normalized: LegacyPatchChanges = {};
    for (const change of changes) {
        if (!change || typeof change !== 'object' || Array.isArray(change)) {
            continue;
        }

        const path = typeof change.path === 'string' ? change.path : null;
        if (!path) {
            continue;
        }

        const entry: Record<string, unknown> = {};

        // Forward the per-file body in EXACTLY the shape the app's patch readers
        // already consume (CodexPatchView.getPatchTexts :47-81 and
        // SidebarFileView.CodexPatchContent :176-187), across all three raw
        // Codex FileChange shapes (codexAppServerTypes FileChange union :169-172):
        //   - legacy flattened `diff` (string)        → entry.diff      (readers read change.diff)
        //   - updated file `unified_diff` (string)     → entry.unified_diff (readers read change.unified_diff)
        //   - added file `content` (string, kind add)  → entry.add.content  (readers read change.add.content)
        //   - deleted file `content` (string, kind del)→ entry.delete.content (readers read change.delete.content)
        // Before this fix only `diff` was forwarded, so post-protocol-evolution
        // add/delete/update bodies were dropped: paths rendered, diff stayed empty.
        const kindType = (change.kind && typeof change.kind === 'object' && !Array.isArray(change.kind))
            ? change.kind.type
            : undefined;

        if (typeof change.diff === 'string') {
            entry.diff = change.diff;
        }
        if (typeof change.unified_diff === 'string') {
            entry.unified_diff = change.unified_diff;
        }
        // Added/deleted files carry their full body under `content`; route it to
        // the kind-specific nested key the readers branch on. kindType is the
        // authority; fall back to presence of the matching body when kind is absent.
        if (typeof change.content === 'string') {
            if (kindType === 'add') {
                entry.add = { content: change.content };
            } else if (kindType === 'delete') {
                entry.delete = { content: change.content };
            }
        }

        if (change.kind && typeof change.kind === 'object' && !Array.isArray(change.kind)) {
            entry.kind = change.kind;
        }

        normalized[path] = entry;
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function pickToolArtifactFields(item: Record<string, unknown>): Record<string, unknown> {
    const keys = [
        'output', 'result', 'content', 'path', 'url', 'uri', 'previewUri', 'preview_uri',
        'image', 'images', 'artifacts', 'contentItems', 'files', 'file', 'filePath', 'file_path',
        'mimeType', 'mime_type', 'base64', 'imageBase64', 'image_base64', 'b64_json', 'data',
    ];
    return Object.fromEntries(keys.flatMap((key) => item[key] === undefined ? [] : [[key, item[key]]]));
}

// Item 2 (spec-20260607-124814): an unavailable functions.request_user_input may carry its
// reason in an error/message/reason/stderr field rather than output text. pickToolArtifactFields
// omits those, so the sessionProtocolMapper normalizer would never see the reason. Forward them
// (when present) ONLY for request_user_input (namespace null/empty/functions) — for every other
// dynamic tool this returns {} so the emitted event stays byte-identical to the pre-fix shape
// (codex review F1: an ungated spread would let an unrelated dynamic tool's top-level `error`
// trip isSessionToolEndError into state:'error').
function pickToolReasonFields(item: Record<string, unknown>): Record<string, unknown> {
    if (item.tool !== 'request_user_input') return {};
    const namespace = item.namespace;
    if (namespace !== null && namespace !== undefined && namespace !== '' && namespace !== 'functions') return {};
    const keys = ['error', 'message', 'reason', 'stderr'];
    return Object.fromEntries(keys.flatMap((key) => item[key] === undefined ? [] : [[key, item[key]]]));
}

export class CodexAppServerClient {
    private process: ChildProcess | null = null;
    private readline: ReadlineInterface | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private processEpoch = 0;
    private connected = false;
    private sandboxConfig?: SandboxConfig;
    private sandboxCleanup: (() => Promise<void>) | null = null;
    public sandboxEnabled = false;

    // Session state
    private _threadId: string | null = null;
    private _turnId: string | null = null;
    private threadDefaults: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        mcpServers?: Record<string, unknown>;
    } | null = null;

    // Turn completion tracking for the currently active sendTurnAndWait call.
    // A completion event only resolves once we have seen task_started for this turn.
    private pendingTurnCompletion: {
        resolve: (aborted: boolean) => void;
        started: boolean;
        turnId: string | null;
    } | null = null;

    // Tracks in-flight interruptTurn() RPCs so sendTurnAndWait can wait for them
    // before starting a new turn (prevents stale turn/interrupt from aborting the next turn).
    private pendingInterrupt: Promise<void> | null = null;
    private notificationProtocol: 'unknown' | 'legacy' | 'raw' = 'unknown';
    private completedTurnIds = new Set<string>();
    private rawFileChangesByItemId = new Map<string, LegacyPatchChanges>();
    private approvedMcpElicitationsForSession = new Set<string>();
    private rawChildThreadIds = new Set<string>();

    // Handlers set by the consumer (runCodex.ts)
    private eventHandler: ((msg: EventMsg) => void) | null = null;
    private approvalHandler: ApprovalHandler | null = null;

    constructor(sandboxConfig?: SandboxConfig) {
        this.sandboxConfig = sandboxConfig;
    }

    get threadId(): string | null {
        return this._threadId;
    }

    get turnId(): string | null {
        return this._turnId;
    }

    setEventHandler(handler: (msg: EventMsg) => void): void {
        this.eventHandler = handler;
    }

    setApprovalHandler(handler: ApprovalHandler): void {
        this.approvalHandler = handler;
    }

    private extractTurnId(params: any): string | null {
        const turnId = params?.turn?.id ?? params?.turnId ?? params?.turn_id ?? null;
        return typeof turnId === 'string' && turnId.length > 0 ? turnId : null;
    }

    private extractTurnStatus(params: any): string | null {
        const status = params?.turn?.status ?? params?.status ?? null;
        return typeof status === 'string' && status.length > 0 ? status : null;
    }

    private extractThreadId(params: any): string | null {
        const threadId = params?.thread?.id ?? params?.threadId ?? params?.thread_id ?? null;
        return typeof threadId === 'string' && threadId.length > 0 ? threadId : null;
    }

    private rawNotificationContext(params: any): Record<string, string> {
        const threadId = this.extractThreadId(params);
        const turnId = this.extractTurnId(params);
        return {
            ...(threadId ? { threadId, thread_id: threadId } : {}),
            ...(turnId ? { turnId, turn_id: turnId } : {}),
        };
    }

    private isRootThreadNotification(params: any): boolean {
        const threadId = this.extractThreadId(params);
        if (!threadId) {
            return true;
        }
        return threadId === this._threadId && !this.rawChildThreadIds.has(threadId);
    }

    private rememberReceiverThreadIds(item: any): void {
        const receiverThreadIds = Array.isArray(item?.receiverThreadIds) ? item.receiverThreadIds : [];
        for (const receiverThreadId of receiverThreadIds) {
            if (typeof receiverThreadId === 'string' && receiverThreadId.length > 0) {
                this.rawChildThreadIds.add(receiverThreadId);
            }
        }
    }

    private shouldHandleRawNotification(method: string): boolean {
        const isRawNotification = method === 'thread/started'
            || method === 'turn/started'
            || method === 'turn/completed'
            || method === 'thread/status/changed'
            || method === 'thread/tokenUsage/updated'
            || method === 'turn/plan/updated'
            || method.startsWith('item/');

        if (!isRawNotification) {
            return false;
        }

        if (this.notificationProtocol === 'legacy') {
            return false;
        }

        if (this.notificationProtocol === 'unknown') {
            this.notificationProtocol = 'raw';
        }

        return true;
    }

    private emitRawTurnCompletion(
        turnId: string | null,
        status: string | null,
        error: unknown,
        source: string,
    ): void {
        const aborted = status === 'cancelled' || status === 'canceled' || status === 'aborted' || status === 'interrupted';

        this.tryResolvePendingTurn(aborted, turnId, source);
        this._turnId = null;

        if (turnId && this.completedTurnIds.has(turnId)) {
            return;
        }
        if (turnId) {
            this.completedTurnIds.add(turnId);
        }

        if (aborted) {
            this.eventHandler?.({
                type: 'turn_aborted',
                ...(turnId ? { turn_id: turnId } : {}),
                ...(status ? { status } : {}),
                ...(error !== undefined && error !== null ? { error } : {}),
            });
            return;
        }

        this.eventHandler?.({
            type: 'task_complete',
            ...(turnId ? { turn_id: turnId } : {}),
            ...(status ? { status } : {}),
            ...(error !== undefined && error !== null ? { error } : {}),
        });
    }

    private handleRawNotification(method: string, params: any): boolean {
        if (!this.shouldHandleRawNotification(method)) {
            return false;
        }

        if (method === 'turn/started') {
            if (!this.isRootThreadNotification(params)) {
                return true;
            }
            const turnId = this.extractTurnId(params);
            if (turnId) {
                this._turnId = turnId;
            }
            this.markPendingTurnStarted(turnId);
            this.eventHandler?.({
                type: 'task_started',
                ...(turnId ? { turn_id: turnId } : {}),
            });
            return true;
        }

        if (method === 'turn/completed') {
            if (!this.isRootThreadNotification(params)) {
                return true;
            }
            this.emitRawTurnCompletion(
                this.extractTurnId(params),
                this.extractTurnStatus(params),
                params?.turn?.error ?? params?.error,
                method,
            );
            return true;
        }

        if (method === 'thread/status/changed') {
            const statusType = params?.status?.type;
            if (statusType === 'idle' && this.pendingTurnCompletion?.started && this.isRootThreadNotification(params)) {
                this.emitRawTurnCompletion(this._turnId, 'completed', null, method);
            }
            return true;
        }

        if (method === 'thread/tokenUsage/updated') {
            const tokenUsage = params?.tokenUsage;
            if (tokenUsage && typeof tokenUsage === 'object') {
                this.eventHandler?.({
                    type: 'token_count',
                    ...tokenUsage,
                });
            }
            return true;
        }

        // Codex app-server delivers the structured plan array on its own
        // turn/plan/updated notification (TurnPlanUpdatedNotification:
        // { threadId, turnId, explanation, plan: TurnPlanStep[] }), NOT inside
        // the item/* 'plan' item (whose ThreadItem variant is only { id, text }).
        // Forward the structured steps so the mapper (:941) emits
        // functions.update_plan with per-step rows. TurnPlanStepStatus is
        // camelCase ("inProgress"); normalize to the snake_case the renderer
        // (CodexPlanView / extractPlanItems) compares against.
        if (method === 'turn/plan/updated') {
            const planContext = this.rawNotificationContext(params);
            const callId = typeof params?.turnId === 'string' ? params.turnId : '';
            const plan = normalizePlanSteps(params?.plan);
            const text = typeof params?.explanation === 'string' ? params.explanation : '';
            this.eventHandler?.({
                type: 'plan_update_begin',
                call_id: callId,
                callId,
                plan,
                text,
                ...planContext,
            });
            this.eventHandler?.({
                type: 'plan_update_end',
                call_id: callId,
                callId,
                plan,
                text,
                ...planContext,
            });
            return true;
        }

        const item = params?.item;
        if (!item || typeof item !== 'object') {
            return method.startsWith('item/');
        }

        const eventContext = this.rawNotificationContext(params);

        // §5.13 AC9 (write_stdin) — DOCUMENTED PRODUCER LIMITATION, NOT a discrete
        // tool action card. The model emits `write_stdin` as a function_call
        // (~490 corpus hits) targeting a running exec session_id; codex 0.130 does
        // NOT surface it as its own ThreadItem variant. The app-server delivers it
        // only as the `item/commandExecution/terminalInteraction` delta
        // (TerminalInteractionNotification = { threadId, turnId, itemId, processId,
        // stdin }) — a stdin-echo into THIS already-open commandExecution PTY item,
        // with no call_id, no begin/end pair, and no result. There is therefore no
        // mappable tool-call lifecycle to emit; forcing a synthetic card would
        // either fabricate a producer event the protocol does not provide or
        // duplicate/break this exec terminal card. So write_stdin remains visible as
        // its echoed terminal text inside the commandExecution card below (intended).
        if (method === 'item/started' && item.type === 'commandExecution') {
            const callId = typeof item.id === 'string' ? item.id : '';
            this.eventHandler?.({
                type: 'exec_command_begin',
                call_id: callId,
                callId,
                command: item.command,
                cwd: item.cwd,
                description: item.command,
                ...eventContext,
            });
            return true;
        }

        if (method === 'item/completed' && item.type === 'commandExecution') {
            const callId = typeof item.id === 'string' ? item.id : '';
            this.eventHandler?.({
                type: 'exec_command_end',
                call_id: callId,
                callId,
                output: item.aggregatedOutput ?? '',
                exit_code: item.exitCode ?? null,
                duration_ms: item.durationMs ?? null,
                status: item.status,
                cwd: item.cwd,
                command: item.command,
                ...eventContext,
            });
            return true;
        }

        if (item.type === 'fileChange') {
            const callId = typeof item.id === 'string' ? item.id : '';
            const changes = normalizeRawFileChangeList(item.changes);

            if (callId && changes) {
                this.rawFileChangesByItemId.set(callId, changes);
            }

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'patch_apply_begin',
                    call_id: callId,
                    callId,
                    changes: changes ?? {},
                    ...eventContext,
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'patch_apply_end',
                    call_id: callId,
                    callId,
                    status: item.status,
                    ...eventContext,
                });

                if (callId && (item.status === 'completed' || item.status === 'failed' || item.status === 'declined')) {
                    this.rawFileChangesByItemId.delete(callId);
                }
                return true;
            }
        }

        if (method === 'item/completed' && item.type === 'agentMessage') {
            const text = typeof item.text === 'string' ? item.text : '';
            if (text.length > 0) {
                this.eventHandler?.({
                    type: 'agent_message',
                    message: text,
                    item_id: item.id,
                    phase: item.phase,
                    ...eventContext,
                });
            }

            if (item.phase === 'final_answer' && this.pendingTurnCompletion?.started && this.isRootThreadNotification(params)) {
                this.emitRawTurnCompletion(
                    this.extractTurnId(params),
                    'completed',
                    null,
                    `${method}:final_answer`,
                );
            }
            return true;
        }

        // §5.15 Phase E — Protocol contract: Codex 0.125.0
        // source: codex app-server generate-ts /tmp/codex-ts/v2/ThreadItem.ts
        // Activates 14 dormant cycle-1 renderers by emitting Option-2 EventMsg
        // discriminators (per-item-type-family) for collabAgentToolCall,
        // dynamicToolCall, mcpToolCall, plan, and imageView.

        if (item.type === 'collabAgentToolCall') {
            const callId = typeof item.id === 'string' ? item.id : '';
            const senderThreadId = typeof item.senderThreadId === 'string' ? item.senderThreadId : undefined;
            this.rememberReceiverThreadIds(item);

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'collab_agent_call_begin',
                    call_id: callId,
                    callId,
                    tool: item.tool,
                    prompt: item.prompt ?? null,
                    model: item.model ?? null,
                    senderThreadId,
                    receiverThreadIds: item.receiverThreadIds ?? [],
                    agentsStates: item.agentsStates ?? {},
                    ...eventContext,
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'collab_agent_call_end',
                    call_id: callId,
                    callId,
                    tool: item.tool,
                    status: item.status,
                    senderThreadId,
                    receiverThreadIds: item.receiverThreadIds ?? [],
                    agentsStates: item.agentsStates ?? {}, ...eventContext,
                });
                return true;
            }
        }

        if (item.type === 'dynamicToolCall') {
            const callId = typeof item.id === 'string' ? item.id : '';

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'dynamic_tool_call_begin',
                    call_id: callId,
                    callId,
                    namespace: item.namespace ?? null,
                    tool: item.tool,
                    arguments: item.arguments,
                    ...eventContext,
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'dynamic_tool_call_end',
                    call_id: callId,
                    callId,
                    namespace: item.namespace ?? null,
                    tool: item.tool,
                    status: item.status,
                    success: item.success ?? null,
                    durationMs: item.durationMs ?? null,
                    ...pickToolArtifactFields(item),
                    ...pickToolReasonFields(item),
                    ...eventContext,
                });
                return true;
            }
        }

        if (item.type === 'mcpToolCall') {
            const callId = typeof item.id === 'string' ? item.id : '';

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'mcp_tool_call_begin',
                    call_id: callId,
                    callId,
                    server: item.server,
                    tool: item.tool,
                    arguments: item.arguments,
                    ...eventContext,
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'mcp_tool_call_end',
                    call_id: callId,
                    callId,
                    server: item.server,
                    tool: item.tool,
                    status: item.status,
                    durationMs: item.durationMs ?? null,
                    ...pickToolArtifactFields(item),
                    ...eventContext,
                });
                return true;
            }
        }

        if (item.type === 'plan') {
            const callId = typeof item.id === 'string' ? item.id : '';
            const text = typeof item.text === 'string' ? item.text : '';
            // Defensive belt: most Codex builds carry the structured array on the
            // separate turn/plan/updated notification (handled above), but if a
            // build ever nests it on the plan item, forward + normalize it too so
            // the mapper (:941) can emit functions.update_plan with per-step rows;
            // text stays as fallback.
            const plan = normalizePlanSteps(item.plan ?? item.steps ?? item.items);

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'plan_update_begin',
                    call_id: callId,
                    callId,
                    plan,
                    text,
                    ...eventContext,
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'plan_update_end',
                    call_id: callId,
                    callId,
                    plan,
                    text,
                    ...eventContext,
                });
                return true;
            }
        }

        if (item.type === 'imageView') {
            const callId = typeof item.id === 'string' ? item.id : '';
            const path = typeof item.path === 'string' ? item.path : '';

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'image_view_begin',
                    call_id: callId,
                    callId,
                    path,
                    ...eventContext,
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'image_view_end',
                    call_id: callId,
                    callId,
                    path,
                    ...eventContext,
                });
                return true;
            }
        }

        // §5.13 AC4 — image generation inline result. Codex 0.130 surfaces an
        // image generation as the item/* family `imageGeneration` (generated
        // ThreadItem variant, verified against codex 0.130 v2/ThreadItem.ts:
        // { type:'imageGeneration', id, status, revisedPrompt: string|null,
        //   result: string /* raw base64 PNG */, savedPath?: AbsolutePathBuf }).
        // Without this handler the family fell through the broad item/* swallow
        // below and no tool-call envelope was produced, so the generated image was
        // swallowed (a later view_image is NOT a substitute). Forward
        // image_generation_begin/end carrying {call_id, status, revisedPrompt,
        // result, savedPath} so the mapper emits a tool-call envelope under the
        // REAL registered name (functions.image_generation) and normalizes the
        // base64 `result` into a data: preview_uri — the previously-registered
        // mcp__image_gen__imagegen / image_gen.imagegen are guesses never emitted.
        if (item.type === 'imageGeneration') {
            const callId = typeof item.id === 'string' ? item.id : '';
            const status = typeof item.status === 'string' ? item.status : '';
            const revisedPrompt = typeof item.revisedPrompt === 'string' ? item.revisedPrompt : null;
            const result = typeof item.result === 'string' ? item.result : '';
            const savedPath = typeof item.savedPath === 'string' ? item.savedPath : null;

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'image_generation_begin',
                    call_id: callId,
                    callId,
                    status,
                    revisedPrompt,
                    savedPath,
                    ...eventContext,
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'image_generation_end',
                    call_id: callId,
                    callId,
                    status,
                    revisedPrompt,
                    result,
                    savedPath,
                    ...eventContext,
                });
                return true;
            }
        }

        // §5.13 AC3 — web search visibility. Codex 0.130 surfaces a web search as
        // the item/* family `webSearch` (generated ThreadItem variant:
        // { type:'webSearch', id, query, action: WebSearchAction|null }). Without
        // this handler the family fell through the broad item/* swallow below and
        // no tool-call envelope was produced, so no card rendered. Forward
        // web_search_begin/end carrying {call_id, query, action} so the mapper
        // emits a tool-call envelope under the REAL registered name
        // (functions.web_search) — the previously-registered web.search_query is a
        // guess that is never emitted. action is one of WebSearchAction (the
        // generated ts-rs type uses snake_case discriminants — verified against
        // codex 0.130 WebSearchAction.ts):
        // { type:'search', query, queries } | { type:'open_page', url } |
        // { type:'find_in_page', url, pattern } | { type:'other' }.
        if (item.type === 'webSearch') {
            const callId = typeof item.id === 'string' ? item.id : '';
            const query = typeof item.query === 'string' ? item.query : '';
            const action = (item.action && typeof item.action === 'object') ? item.action : null;

            if (method === 'item/started') {
                this.eventHandler?.({
                    type: 'web_search_begin',
                    call_id: callId,
                    callId,
                    query,
                    action,
                    ...eventContext,
                });
                return true;
            }

            if (method === 'item/completed') {
                this.eventHandler?.({
                    type: 'web_search_end',
                    call_id: callId,
                    callId,
                    query,
                    action,
                    ...eventContext,
                });
                return true;
            }
        }

        return method.startsWith('item/');
    }

    // ─── Lifecycle ──────────────────────────────────────────────

    async connect(): Promise<void> {
        if (this.connected) return;

        if (!isAppServerAvailable()) {
            throw new Error(
                'Codex CLI not found or too old for app-server.\n\n' +
                'To install codex:\n  npm install -g @openai/codex\n\n' +
                'Alternatively, use Claude:\n  happy claude',
            );
        }

        let command = 'codex';
        let args = ['app-server', '--listen', 'stdio://'];
        this.sandboxEnabled = false;

        if (this.sandboxConfig?.enabled && process.platform !== 'win32') {
            try {
                this.sandboxCleanup = await initializeSandbox(this.sandboxConfig, process.cwd());
                const wrapped = await wrapForMcpTransport('codex', ['app-server', '--listen', 'stdio://']);
                command = wrapped.command;
                args = wrapped.args;
                this.sandboxEnabled = true;
                logger.info(`[CodexAppServer] Sandbox enabled`);
            } catch (error) {
                logger.warn('[CodexAppServer] Failed to initialize sandbox; continuing without.', error);
                this.sandboxCleanup = null;
            }
        }

        // Build env — same filtering as the old MCP client
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (typeof value === 'string') env[key] = value;
        }
        // Mute noisy rollout list logging
        const filter = 'codex_core::rollout::list=off';
        if (!env.RUST_LOG) {
            env.RUST_LOG = filter;
        } else if (!env.RUST_LOG.includes('codex_core::rollout::list=')) {
            env.RUST_LOG += `,${filter}`;
        }
        if (this.sandboxEnabled) {
            env.CODEX_SANDBOX = 'seatbelt';
        }

        logger.debug(`[CodexAppServer] Spawning: ${command} ${args.join(' ')}`);

        const epoch = ++this.processEpoch;
        const proc = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
        });
        this.process = proc;

        proc.on('error', (err) => {
            logger.debug('[CodexAppServer] Process error:', err);
        });

        proc.on('exit', (code, signal) => {
            logger.debug(`[CodexAppServer] Process exited: code=${code} signal=${signal}`);
            // Ignore stale process exits from prior generations during reconnect.
            if (this.process !== proc || this.processEpoch !== epoch) {
                logger.debug('[CodexAppServer] Ignoring stale process exit');
                return;
            }
            this.connected = false;
            // Reject all pending requests
            for (const [id, req] of this.pending) {
                if (req.epoch !== epoch) continue;
                req.reject(new Error(`Codex process exited (code=${code}) while waiting for ${req.method}`));
                this.pending.delete(id);
            }
            // Resolve pending turn completion (treat as abort)
            this.resolvePendingTurn(true);
        });

        // Pipe stderr for debug logging
        proc.stderr?.on('data', (chunk: Buffer) => {
            if (this.process !== proc || this.processEpoch !== epoch) return;
            const text = chunk.toString().trim();
            if (text) logger.debug(`[CodexAppServer:stderr] ${text}`);
        });

        // Parse newline-delimited JSON from stdout
        this.readline = createInterface({ input: proc.stdout! });
        this.readline.on('line', (line) => {
            if (this.process !== proc || this.processEpoch !== epoch) return;
            this.handleLine(line, epoch);
        });

        // Perform initialize handshake
        const initParams: InitializeParams = {
            clientInfo: {
                name: 'happy-codex',
                title: 'Happy Codex Client',
                version: packageJson.version,
            },
            capabilities: {
                experimentalApi: true,
            },
        };
        await this.request('initialize', initParams);
        this.notify('initialized');
        this.connected = true;
        logger.debug('[CodexAppServer] Connected and initialized');
    }

    private async disconnectInternal(opts?: { preserveThreadState?: boolean }): Promise<void> {
        if (!this.connected && !this.process) return;

        const proc = this.process;
        const pid = proc?.pid;
        const epoch = this.processEpoch;
        logger.debug(`[CodexAppServer] Disconnecting; pid=${pid ?? 'none'}`);

        this.readline?.close();
        this.readline = null;

        try {
            proc?.stdin?.end();
            proc?.kill('SIGTERM');
        } catch { /* ignore */ }

        // Force kill after 2s (unref so timer doesn't block process exit)
        if (pid) {
            const killTimer = setTimeout(() => {
                try {
                    process.kill(pid, 0); // check alive
                    process.kill(pid, 'SIGKILL');
                } catch { /* already dead */ }
            }, 2000);
            killTimer.unref();
        }

        this.process = null;
        this.connected = false;
        this._turnId = null;
        this.notificationProtocol = 'unknown';
        this.completedTurnIds.clear();
        if (!opts?.preserveThreadState) {
            this._threadId = null;
            this.threadDefaults = null;
            this.approvedMcpElicitationsForSession.clear();
            this.rawChildThreadIds.clear();
        }

        // Fail in-flight requests from this process generation.
        for (const [id, req] of this.pending) {
            if (req.epoch !== epoch) continue;
            req.reject(new Error(`Codex process disconnected while waiting for ${req.method}`));
            this.pending.delete(id);
        }

        // Resolve pending turn completion (treat as abort)
        this.resolvePendingTurn(true);

        if (this.sandboxCleanup) {
            try { await this.sandboxCleanup(); } catch { /* ignore */ }
            this.sandboxCleanup = null;
        }
        this.sandboxEnabled = false;

        logger.debug('[CodexAppServer] Disconnected');
    }

    async disconnect(): Promise<void> {
        await this.disconnectInternal();
    }

    private buildThreadConfig(mcpServers?: Record<string, unknown>): Record<string, unknown> | null {
        return mcpServers ? { mcp_servers: mcpServers } : null;
    }

    private rememberThreadDefaults(opts: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        mcpServers?: Record<string, unknown>;
    }): void {
        this.threadDefaults = {
            model: opts.model,
            cwd: opts.cwd,
            approvalPolicy: opts.approvalPolicy,
            sandbox: opts.sandbox,
            mcpServers: opts.mcpServers,
        };
    }

    // ─── Thread management ──────────────────────────────────────

    async startThread(opts: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        mcpServers?: Record<string, unknown>;
    }): Promise<{ threadId: string; model: string }> {
        const params: NewConversationParams = {
            model: opts.model ?? null,
            modelProvider: null,
            profile: null,
            cwd: opts.cwd ?? process.cwd(),
            approvalPolicy: opts.approvalPolicy ?? null,
            sandbox: opts.sandbox ?? null,
            config: this.buildThreadConfig(opts.mcpServers),
            baseInstructions: null,
            developerInstructions: null,
            compactPrompt: null,
            includeApplyPatchTool: null,
            experimentalRawEvents: true,
            persistExtendedHistory: true,
        };

        const result = await this.request('thread/start', params) as NewConversationResponse;
        this._threadId = result.thread.id;
        this._turnId = null;
        this.rememberThreadDefaults(opts);
        logger.debug('[CodexAppServer] Thread started:', this._threadId);
        return { threadId: result.thread.id, model: result.model };
    }

    async resumeThread(opts?: {
        threadId?: string;
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        mcpServers?: Record<string, unknown>;
    }): Promise<{ threadId: string; model: string }> {
        const threadId = opts?.threadId ?? this._threadId;
        if (!threadId) {
            throw new Error('No thread available to resume.');
        }

        const defaults = this.threadDefaults ?? {};
        const params: ResumeConversationParams = {
            threadId,
            model: opts?.model ?? defaults.model ?? null,
            modelProvider: null,
            cwd: opts?.cwd ?? defaults.cwd ?? process.cwd(),
            approvalPolicy: opts?.approvalPolicy ?? defaults.approvalPolicy ?? null,
            sandbox: opts?.sandbox ?? defaults.sandbox ?? null,
            config: this.buildThreadConfig(opts?.mcpServers ?? defaults.mcpServers),
            baseInstructions: null,
            developerInstructions: null,
            persistExtendedHistory: true,
        };

        const result = await this.request('thread/resume', params) as ResumeConversationResponse;
        this._threadId = result.thread.id;
        this._turnId = null;
        this.rememberThreadDefaults({
            model: opts?.model ?? defaults.model,
            cwd: opts?.cwd ?? defaults.cwd,
            approvalPolicy: opts?.approvalPolicy ?? defaults.approvalPolicy,
            sandbox: opts?.sandbox ?? defaults.sandbox,
            mcpServers: opts?.mcpServers ?? defaults.mcpServers,
        });
        logger.debug('[CodexAppServer] Thread resumed:', this._threadId);
        return { threadId: result.thread.id, model: result.model };
    }

    async reconnectAndResumeThread(): Promise<boolean> {
        const threadId = this._threadId;
        await this.disconnectInternal({ preserveThreadState: !!threadId });
        await this.connect();

        if (!threadId) {
            return false;
        }

        try {
            await this.resumeThread({ threadId });
            return true;
        } catch (error) {
            logger.warn('[CodexAppServer] Failed to resume thread after reconnect', error);
            this._threadId = null;
            this.threadDefaults = null;
            return false;
        }
    }

    // ─── Turn management ────────────────────────────────────────

    /** Default grace period after interrupt before forcing a restart (ms). */
    private static readonly ABORT_GRACE_MS = 3_000;

    private hasPendingTurnCompletion(): boolean {
        return this.pendingTurnCompletion !== null;
    }

    private resolvePendingTurn(aborted: boolean): void {
        if (!this.pendingTurnCompletion) return;
        this.pendingTurnCompletion.resolve(aborted);
        this.pendingTurnCompletion = null;
    }

    private markPendingTurnStarted(turnId?: string | null): void {
        if (!this.pendingTurnCompletion) return;
        this.pendingTurnCompletion.started = true;
        if (turnId) {
            this.pendingTurnCompletion.turnId = turnId;
        }
    }

    private tryResolvePendingTurn(aborted: boolean, turnId: string | null, source: string): void {
        const pending = this.pendingTurnCompletion;
        if (!pending) return;

        // Guard against stale completion notifications from the prior turn.
        if (!pending.started) {
            logger.debug(`[CodexAppServer] Ignoring ${source} before task_started`);
            return;
        }

        if (pending.turnId && turnId && pending.turnId !== turnId) {
            logger.debug(
                `[CodexAppServer] Ignoring ${source} for turn ${turnId}; awaiting ${pending.turnId}`,
            );
            return;
        }

        this.resolvePendingTurn(aborted);
    }

    private async waitForTurnCompletion(timeoutMs: number): Promise<boolean> {
        if (!this.hasPendingTurnCompletion()) {
            return true;
        }

        const deadline = Date.now() + Math.max(0, timeoutMs);
        while (this.hasPendingTurnCompletion()) {
            if (Date.now() >= deadline) {
                return false;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return true;
    }

    /**
     * Request turn interruption and optionally force-restart the app-server if
     * the turn does not settle within a short grace period.
     */
    async abortTurnWithFallback(opts?: {
        gracePeriodMs?: number;
        forceRestartOnTimeout?: boolean;
    }): Promise<{ hadActiveTurn: boolean; aborted: boolean; forcedRestart: boolean; resumedThread: boolean }> {
        const hadActiveTurn = this.hasPendingTurnCompletion();

        // No active turn pending in this client call-site.
        if (!hadActiveTurn) {
            return { hadActiveTurn: false, aborted: false, forcedRestart: false, resumedThread: false };
        }

        // Best-effort interrupt request first.
        await this.interruptTurn();

        const gracePeriodMs = opts?.gracePeriodMs ?? CodexAppServerClient.ABORT_GRACE_MS;
        const settled = await this.waitForTurnCompletion(gracePeriodMs);
        if (settled) {
            return { hadActiveTurn: true, aborted: true, forcedRestart: false, resumedThread: false };
        }

        const shouldForceRestart = opts?.forceRestartOnTimeout ?? true;
        if (!shouldForceRestart) {
            return { hadActiveTurn: true, aborted: false, forcedRestart: false, resumedThread: false };
        }

        logger.warn(`[CodexAppServer] interrupt did not settle turn in ${gracePeriodMs}ms; force-restarting app-server`);
        const pendingTurnId = this.pendingTurnCompletion?.turnId ?? this._turnId;
        if (this.pendingTurnCompletion?.started) {
            this.eventHandler?.({
                type: 'turn_aborted',
                reason: 'interrupted',
                ...(pendingTurnId ? { turn_id: pendingTurnId } : {}),
                forced_restart: true,
            });
        }
        const resumedThread = await this.reconnectAndResumeThread();
        return { hadActiveTurn: true, aborted: true, forcedRestart: true, resumedThread };
    }

    /**
     * Send a user turn and wait for it to complete.
     * Returns when task_complete or turn_aborted is received.
     */
    async sendTurn(prompt: string, opts?: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        effort?: ReasoningEffort;
        inputItems?: InputItem[];
    }): Promise<void> {
        if (!this._threadId) {
            throw new Error('No active thread. Call startThread first.');
        }

        const input: InputItem[] = opts?.inputItems ?? [
            { type: 'text', text: prompt },
        ];

        // Build params — only include optional fields when set (server uses thread defaults otherwise)
        const params: Record<string, unknown> = {
            threadId: this._threadId,
            input,
        };
        if (opts?.cwd) params.cwd = opts.cwd;
        if (opts?.approvalPolicy) params.approvalPolicy = opts.approvalPolicy;
        if (opts?.model) params.model = opts.model;
        if (opts?.effort) params.effort = opts.effort;

        // Map sandbox mode to the camelCase policy format the server expects
        if (opts?.sandbox) {
            switch (opts.sandbox) {
                case 'workspace-write':
                    params.sandboxPolicy = { type: 'workspaceWrite' };
                    break;
                case 'danger-full-access':
                    params.sandboxPolicy = { type: 'dangerFullAccess' };
                    break;
                case 'read-only':
                    params.sandboxPolicy = { type: 'readOnly' };
                    break;
            }
        }

        // turn/start returns immediately; turn completes via events.
        // We don't await completion here — the caller's event handler
        // tracks task_complete / turn_aborted.
        const result = await this.request('turn/start', params) as { turn?: { id?: string | null } };
        const turnId = result?.turn?.id;
        if (typeof turnId === 'string' && turnId.length > 0) {
            this._turnId = turnId;
            if (this.pendingTurnCompletion) {
                this.pendingTurnCompletion.turnId = turnId;
            }
        }
    }

    /** Default timeout for waiting on turn completion (ms). 10 minutes. */
    private static readonly TURN_TIMEOUT_MS = 10 * 60 * 1000;

    /**
     * Send a user turn and wait for it to complete (task_complete or turn_aborted).
     * Returns { aborted: true } if the turn was aborted (user cancel, permission reject, etc.).
     */
    async sendTurnAndWait(prompt: string, opts?: {
        model?: string;
        cwd?: string;
        approvalPolicy?: ApprovalPolicy;
        sandbox?: SandboxMode;
        effort?: ReasoningEffort;
        turnTimeoutMs?: number;
        inputItems?: InputItem[];
    }): Promise<{ aborted: boolean }> {
        // Wait for any in-flight interruptTurn() to complete before starting a new
        // turn. Otherwise the stale turn/interrupt RPC can reach Codex after our
        // turn/start and abort the wrong turn.
        if (this.pendingInterrupt) {
            await this.pendingInterrupt;
            // Yield to the event loop so any stale turn_aborted/task_complete
            // notifications queued by the interrupted turn are processed now
            // (harmlessly, since pendingTurnCompletion is null at this point).
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const timeoutMs = opts?.turnTimeoutMs ?? CodexAppServerClient.TURN_TIMEOUT_MS;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const completion = new Promise<boolean>((resolve) => {
            this.pendingTurnCompletion = {
                resolve,
                started: false,
                turnId: null,
            };

            timer = setTimeout(() => {
                if (this.pendingTurnCompletion) {
                    logger.warn(`[CodexAppServer] Turn timed out after ${timeoutMs}ms — treating as abort`);
                    this.resolvePendingTurn(true);
                }
            }, timeoutMs);
        });

        try {
            await this.sendTurn(prompt, opts);
        } catch (err) {
            if (timer) clearTimeout(timer);
            this.pendingTurnCompletion = null;
            throw err;
        }

        const aborted = await completion;
        if (timer) clearTimeout(timer);
        return { aborted };
    }

    async interruptTurn(): Promise<void> {
        if (!this._threadId) return;
        if (!this._turnId) {
            logger.debug('[CodexAppServer] interruptTurn: no active turnId, skipping');
            return;
        }
        const params: InterruptConversationParams = {
            threadId: this._threadId,
            turnId: this._turnId,
        };
        const doInterrupt = async () => {
            try {
                await this.request('turn/interrupt', params);
            } catch (err) {
                // Ignore if no turn is active
                logger.debug('[CodexAppServer] interruptTurn error (may be expected):', err);
            } finally {
                this.pendingInterrupt = null;
            }
        };
        this.pendingInterrupt = doInterrupt();
        return this.pendingInterrupt;
    }

    // ─── State queries ──────────────────────────────────────────

    hasActiveThread(): boolean {
        return this._threadId !== null;
    }

    // ─── JSON-RPC transport ─────────────────────────────────────

    /** Default timeout for RPC requests (ms). */
    private static readonly REQUEST_TIMEOUT_MS = 30_000;

    private request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
        const timeout = timeoutMs ?? CodexAppServerClient.REQUEST_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            if (!this.process?.stdin?.writable) {
                reject(new Error(`Cannot send ${method}: stdin not writable`));
                return;
            }
            const id = this.nextId++;

            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out after ${timeout}ms (id=${id})`));
            }, timeout);

            this.pending.set(id, {
                resolve: (result) => { clearTimeout(timer); resolve(result); },
                reject: (err) => { clearTimeout(timer); reject(err); },
                method,
                epoch: this.processEpoch,
            });

            const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
            const line = JSON.stringify(msg) + '\n';
            logger.debug(`[CodexAppServer] → ${method} (id=${id})`);
            this.process.stdin.write(line);
        });
    }

    private notify(method: string, params?: unknown): void {
        if (!this.process?.stdin?.writable) return;
        const msg: JsonRpcRequest = { jsonrpc: '2.0', method, params };
        this.process.stdin.write(JSON.stringify(msg) + '\n');
        logger.debug(`[CodexAppServer] → ${method} (notification)`);
    }

    private respond(id: number, result: unknown): void {
        if (!this.process?.stdin?.writable) return;
        const msg: JsonRpcResponse = { jsonrpc: '2.0', id, result };
        this.process.stdin.write(JSON.stringify(msg) + '\n');
        logger.debug(`[CodexAppServer] → response (id=${id})`);
    }

    private handleLine(line: string, sourceEpoch: number = this.processEpoch): void {
        if (sourceEpoch !== this.processEpoch) {
            return;
        }
        if (!line.trim()) return;

        let msg: any;
        try {
            msg = JSON.parse(line);
        } catch {
            logger.debug('[CodexAppServer] Non-JSON line:', line.substring(0, 200));
            return;
        }

        // Response to our request
        if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
            const pending = this.pending.get(msg.id);
            if (pending) {
                if (pending.epoch !== sourceEpoch) {
                    logger.debug(`[CodexAppServer] Ignoring response from stale epoch for id=${msg.id}`);
                    return;
                }
                this.pending.delete(msg.id);
                if (msg.error) {
                    pending.reject(new Error(`${pending.method}: ${msg.error.message} (code=${msg.error.code})`));
                } else {
                    pending.resolve(msg.result);
                }
            }
            return;
        }

        // Server → client request (approvals)
        if (msg.id != null && msg.method) {
            this.handleServerRequest(msg.id, msg.method, msg.params).catch((err) => {
                logger.debug('[CodexAppServer] Error handling server request:', err);
            });
            return;
        }

        // Notification (no id)
        if (msg.method) {
            this.handleNotification(msg.method, msg.params);
            return;
        }

        logger.debug('[CodexAppServer] Unhandled message:', JSON.stringify(msg).substring(0, 300));
    }

    /**
     * Map our internal ReviewDecision to the wire format the server expects.
     * Server uses: accept, acceptForSession, decline, cancel
     * Our handler uses: approved, approved_for_session, denied, abort
     */
    /**
     * Map our internal ReviewDecision to the wire format codex expects.
     * v2 methods (item/*) use: accept/acceptForSession/decline/cancel
     * Legacy methods (execCommandApproval/applyPatchApproval) use: approved/approved_for_session/denied/abort
     */
    private mapDecisionToWire(decision: ReviewDecision, legacy: boolean): string | Record<string, unknown> {
        if (typeof decision === 'string') {
            if (legacy) {
                // Legacy wire format — pass through as-is (approved/denied/abort)
                return decision;
            }
            // v2 wire format
            switch (decision) {
                case 'approved': return 'accept';
                case 'approved_for_session': return 'acceptForSession';
                case 'denied': return 'decline';
                case 'abort': return 'cancel';
                default: return 'decline';
            }
        }
        // Object variant: approved_execpolicy_amendment → pass through as-is
        if ('approved_execpolicy_amendment' in decision) {
            return decision;
        }
        return legacy ? 'denied' : 'decline';
    }

    private isMcpToolApprovalElicitation(params: McpServerElicitationRequestParams): boolean {
        // Accept every known elicitation shape — RPC method itself is the discriminator.
        return params.mode === 'form' || params.mode === 'url';
    }

    private mapDecisionToMcpElicitationResponse(
        decision: ReviewDecision,
    ): McpServerElicitationRequestResponse {
        if (typeof decision === 'string') {
            switch (decision) {
                case 'approved':
                case 'approved_for_session':
                    return { action: 'accept', content: {}, _meta: null };
                case 'denied':
                    return { action: 'decline', content: null, _meta: null };
                case 'abort':
                    return { action: 'cancel', content: null, _meta: null };
                default:
                    return { action: 'decline', content: null, _meta: null };
            }
        }

        // Exec-policy amendments are meaningful for shell approvals, not MCP elicitations.
        return { action: 'decline', content: null, _meta: null };
    }

    private extractMcpToolName(params: McpServerElicitationRequestParams): string | undefined {
        const metaToolName = params._meta?.tool_name;
        if (typeof metaToolName === 'string' && metaToolName.length > 0) {
            return metaToolName;
        }

        const match = params.message.match(/tool\s+"([^"]+)"/i);
        return match?.[1];
    }

    private mcpElicitationSessionKey(serverName: string, toolName?: string): string {
        return `${serverName}:${toolName ?? '*'}`;
    }

    private async handleMcpElicitationRequest(
        id: number,
        params: McpServerElicitationRequestParams,
    ): Promise<void> {
        if (!this.isMcpToolApprovalElicitation(params)) {
            logger.debug(
                `[CodexAppServer] Declining unsupported MCP elicitation: ${params.serverName}`,
            );
            this.respond(id, { action: 'cancel', content: null, _meta: null });
            return;
        }

        const meta = params._meta ?? {};
        const toolName = this.extractMcpToolName(params);
        const toolDescription = typeof meta.tool_description === 'string'
            ? meta.tool_description
            : undefined;
        const sessionKey = this.mcpElicitationSessionKey(params.serverName, toolName);
        if (this.approvedMcpElicitationsForSession.has(sessionKey)) {
            this.respond(id, { action: 'accept', content: {}, _meta: null });
            return;
        }

        const callId = `mcp:${params.serverName}:${id}`;
        const decision = await this.handleApproval({
            type: 'mcp_elicitation',
            callId,
            serverName: params.serverName,
            toolName,
            toolDescription,
            toolArguments: meta.tool_params,
            message: params.message,
            mode: params.mode,
            reason: params.message,
        });

        if (decision === 'approved_for_session') {
            this.approvedMcpElicitationsForSession.add(sessionKey);
        }
        this.respond(id, this.mapDecisionToMcpElicitationResponse(decision));
    }

    private async handleServerRequest(id: number, method: string, params: any): Promise<void> {
        // Command execution approval
        if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
            const legacy = method === 'execCommandApproval';
            const decision = await this.handleApproval({
                type: 'exec',
                callId: params.itemId ?? String(id),
                command: params.command != null ? [params.command] : [],
                cwd: params.cwd,
                reason: params.reason,
            });
            this.respond(id, { decision: this.mapDecisionToWire(decision, legacy) });
            return;
        }

        // File change / patch approval
        if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
            const legacy = method === 'applyPatchApproval';
            const callId = params.itemId ?? params.callId ?? String(id);
            const decision = await this.handleApproval({
                type: 'patch',
                callId,
                fileChanges: params.fileChanges ?? (typeof callId === 'string'
                    ? this.rawFileChangesByItemId.get(callId)
                    : undefined),
                reason: params.reason,
            });
            this.respond(id, { decision: this.mapDecisionToWire(decision, legacy) });
            return;
        }

        // MCP tool-call approval. Codex 0.125 emits this when an MCP tool is not
        // read-only under approval modes such as on-failure. The request id can be
        // 0, so the generic JSON-RPC handler must route it explicitly instead of
        // treating an empty response as rejection.
        if (method === 'mcpServer/elicitation/request') {
            await this.handleMcpElicitationRequest(id, params);
            return;
        }

        // Unknown server request — respond so server doesn't hang
        logger.debug(`[CodexAppServer] Unknown server request: ${method}`);
        this.respond(id, {});
    }

    private async handleApproval(params: Parameters<ApprovalHandler>[0]): Promise<ReviewDecision> {
        if (this.approvalHandler) {
            try {
                return await this.approvalHandler(params);
            } catch (err) {
                logger.debug('[CodexAppServer] Approval handler error:', err);
                return 'denied';
            }
        }
        return 'denied'; // default: deny if no handler
    }

    private handleNotification(method: string, params: any): void {
        // codex/event notifications: either `codex/event` or `codex/event/<type>`
        if (method === 'codex/event' || method.startsWith('codex/event/')) {
            this.notificationProtocol = 'legacy';
            const msg = params?.msg;
            if (msg) {
                // Extract turn_id from task_started events
                if (msg.type === 'task_started' && msg.turn_id) {
                    this._turnId = msg.turn_id;
                }
                if (msg.type === 'task_started') {
                    this.markPendingTurnStarted(msg.turn_id ?? msg.turnId ?? null);
                }
                // Fire event handler first (so consumer processes the event)
                this.eventHandler?.(msg);
                // Then resolve turn completion promise
                if (msg.type === 'task_complete' || msg.type === 'turn_aborted') {
                    const turnId = msg.turn_id ?? msg.turnId ?? null;
                    // Mark as completed so v2 turn/completed doesn't duplicate
                    if (turnId) {
                        this.completedTurnIds.add(turnId);
                    }
                    this.tryResolvePendingTurn(
                        msg.type === 'turn_aborted',
                        turnId,
                        `codex/event/${msg.type}`,
                    );
                    this._turnId = null;
                }
            }
            return;
        }

        if (this.handleRawNotification(method, params)) {
            logger.debug(`[CodexAppServer] Raw notification: ${method}`);
            return;
        }

        // v2 lifecycle notifications
        if (method === 'thread/started' || method === 'turn/started' ||
            method === 'turn/completed' || method === 'thread/status/changed') {
            logger.debug(`[CodexAppServer] Lifecycle notification: ${method}`);
            // Mark the turn as started so the completion guard lets it through.
            if (method === 'turn/started') {
                const turnId = this.extractTurnId(params);
                if (turnId) {
                    this._turnId = turnId;
                }
                this.markPendingTurnStarted(turnId);
            }
            // turn/completed is a fallback signal — for mid-inference interrupts,
            // Codex may only signal completion here (not via codex/event turn_aborted).
            // emitRawTurnCompletion deduplicates via completedTurnIds if legacy already handled it.
            if (method === 'turn/completed' && this.isRootThreadNotification(params)) {
                this.emitRawTurnCompletion(
                    this.extractTurnId(params),
                    this.extractTurnStatus(params),
                    params?.turn?.error ?? params?.error,
                    method,
                );
            }
            return;
        }

        logger.debug(`[CodexAppServer] Notification: ${method}`);
    }
}
