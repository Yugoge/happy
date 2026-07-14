import { render } from "ink";
import { Session } from "./session";
import { MessageBuffer } from "@/ui/ink/messageBuffer";
import { RemoteModeDisplay } from "@/ui/ink/RemoteModeDisplay";
import React from "react";
import { claudeRemote } from "./claudeRemote";
import { PermissionHandler } from "./utils/permissionHandler";
import { Future } from "@/utils/future";
import { SDKAssistantMessage, SDKMessage, SDKUserMessage } from "./sdk";
import { formatClaudeMessageForInk } from "@/ui/messageFormatterInk";
import { logger } from "@/ui/logger";
import { SDKToLogConverter } from "./utils/sdkToLogConverter";
import { PLAN_FAKE_REJECT } from "./sdk/prompts";
import { EnhancedMode } from "./loop";
import { RawJSONLines } from "@/claude/types";
import { OutgoingMessageQueue } from "./utils/OutgoingMessageQueue";
import { getToolName } from "./utils/getToolName";
import { createSessionScanner } from "./utils/sessionScanner";
import { getAskUserQuestionToolCallIds } from "./utils/questionNotification";
import { isStopHookFeedback } from "./utils/stopHookFilter";
import { createCurrentModelCodeEmitter, type CurrentModelCodeEmitter } from "./utils/currentModelCodeEmitter";
import { canonicalizeClaudeConfigDir } from "./utils/claudeConfigDir";

interface PermissionsField {
    date: number;
    result: 'approved' | 'denied';
    mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    allowedTools?: string[];
}

type LauncherState = {
    exitReason: 'switch' | 'exit' | null;
    abortController: AbortController | null;
    abortFuture: Future<void> | null;
    planModeToolCalls: Set<string>;
    ongoingToolCalls: Map<string, { parentToolCallId: string | null }>;
    notifiedQuestionToolCalls: Set<string>;
    sentSidechainUuids: Set<string>;
};

type LoopState = {
    pending: { message: string; mode: EnhancedMode; hash: string } | null;
    previousSessionId: string | null;
    consecutiveCrashes: number;
    MAX_CONSECUTIVE_CRASHES: number;
};

type MetaScannerState = {
    scanner: { cleanup: () => Promise<void>; onNewSession: (id: string) => void } | null;
    promise: Promise<void> | null;
};

type Services = { permissionHandler: PermissionHandler; messageQueue: OutgoingMessageQueue; sdkToLogConverter: SDKToLogConverter; currentModelCodeEmitter: CurrentModelCodeEmitter; emitAccountConfigDir: (dir: string) => void; emitModelMode: (key: string) => void; emitPermissionMode: (key: string) => void };

function createLauncherState(): LauncherState {
    return {
        exitReason: null, abortController: null, abortFuture: null,
        planModeToolCalls: new Set(), ongoingToolCalls: new Map(),
        notifiedQuestionToolCalls: new Set(), sentSidechainUuids: new Set(),
    };
}

function setupTTY(messageBuffer: MessageBuffer, state: LauncherState, abort: () => Promise<void>, doSwitch: () => void): any {
    if (!process.stdout.isTTY || !process.stdin.isTTY) return null;
    console.clear();
    const inkInstance = render(React.createElement(RemoteModeDisplay, {
        messageBuffer, logPath: process.env.DEBUG ? undefined : undefined,
        onExit: async () => { if (!state.exitReason) { state.exitReason = 'exit'; } await abort(); },
        onSwitchToLocal: doSwitch,
    }), { exitOnCtrlC: false, patchConsole: false });
    process.stdin.resume();
    if (process.stdin.isTTY) { process.stdin.setRawMode(true); }
    process.stdin.setEncoding("utf8");
    return inkInstance;
}

async function uploadResumeHistory(session: Session) {
    if (!session.claudeArgs) return;
    const idx = session.claudeArgs.indexOf('--resume');
    if (idx === -1 || idx + 1 >= session.claudeArgs.length) return;
    const scanner = await createSessionScanner({
        sessionId: session.claudeArgs[idx + 1], sendExisting: true, workingDirectory: session.path,
        onMessage: (m) => { if (m.type !== 'summary' && !(m as any).isMeta && !isStopHookFeedback(m)) { session.client.sendClaudeSessionMessage(m); } }
    });
    await scanner.cleanup();
}

function trackAssistantContent(message: SDKAssistantMessage, state: LauncherState) {
    if (!message.message.content || !Array.isArray(message.message.content)) return;
    for (const c of message.message.content) {
        if (c.type === 'tool_use' && (c.name === 'exit_plan_mode' || c.name === 'ExitPlanMode')) { state.planModeToolCalls.add(c.id! as string); }
        if (c.type === 'tool_use') { state.ongoingToolCalls.set(c.id!, { parentToolCallId: message.parent_tool_use_id ?? null }); }
    }
}

function trackToolResults(message: SDKUserMessage, state: LauncherState, messageQueue: OutgoingMessageQueue) {
    if (!message.message.content || !Array.isArray(message.message.content)) return;
    for (const c of message.message.content) {
        if (c.type === 'tool_result' && c.tool_use_id) { state.ongoingToolCalls.delete(c.tool_use_id); messageQueue.releaseToolCall(c.tool_use_id); }
    }
}

function notifyQuestions(message: SDKMessage, state: LauncherState, session: Session) {
    for (const id of getAskUserQuestionToolCallIds(message)) {
        if (state.notifiedQuestionToolCalls.has(id)) continue;
        state.notifiedQuestionToolCalls.add(id);
        session.api.push().sendSessionNotification({
            kind: 'question', metadata: session.client.getMetadata(),
            data: { sessionId: session.client.sessionId, tool: 'AskUserQuestion', toolCallId: id, type: 'question_request', provider: 'claude' }
        });
    }
}

function rewritePlanModeBlock(c: any, planCalls: Set<string>): any {
    if (c.type === 'tool_result' && c.tool_use_id && planCalls.has(c.tool_use_id) && c.content === PLAN_FAKE_REJECT) {
        return { ...c, is_error: false, content: 'Plan approved', mode: c.mode };
    }
    return c;
}

function hackPlanModeExit(message: SDKUserMessage, state: LauncherState): SDKMessage {
    if (!message.message.content || !Array.isArray(message.message.content)) return message;
    return { ...message, message: { ...message.message, content: message.message.content.map(c => rewritePlanModeBlock(c, state.planModeToolCalls)) } };
}

function addPermissionsToToolResults(logMessage: RawJSONLines, ph: PermissionHandler) {
    if (logMessage.type !== 'user' || !logMessage.message?.content) return;
    const content = Array.isArray(logMessage.message.content) ? logMessage.message.content : [];
    for (let i = 0; i < content.length; i++) {
        const c = content[i];
        if (c.type !== 'tool_result' || !c.tool_use_id) continue;
        const resp = ph.getResponses().get(c.tool_use_id);
        if (!resp) continue;
        const p: PermissionsField = { date: resp.receivedAt || Date.now(), result: resp.approved ? 'approved' : 'denied' };
        if (resp.mode) { p.mode = resp.mode; }
        if (resp.allowTools?.length) { p.allowedTools = resp.allowTools; }
        content[i] = { ...c, permissions: p };
    }
}

function extractToolCallIds(msg: SDKAssistantMessage): string[] {
    const ids: string[] = [];
    if (msg.message.content && Array.isArray(msg.message.content)) {
        for (const b of msg.message.content) { if (b.type === 'tool_use' && b.id) { ids.push(b.id); } }
    }
    return ids;
}

function queueLogMessage(logMessage: RawJSONLines, message: SDKMessage, mq: OutgoingMessageQueue, state: LauncherState) {
    // Silently drop stop-hook feedback records (spec §5.9) — dev telemetry, never user-facing
    if (isStopHookFeedback(logMessage)) { return; }
    if (logMessage.type === 'assistant' && message.type === 'assistant') {
        const ids = extractToolCallIds(message as SDKAssistantMessage);
        if (ids.length > 0 && (message as SDKAssistantMessage).parent_tool_use_id === undefined) {
            mq.enqueue(logMessage, { delay: 250, toolCallIds: ids });
            return;
        }
    }
    mq.enqueue(logMessage);
    if ((logMessage as any).isSidechain === true && typeof (logMessage as any).uuid === 'string') {
        state.sentSidechainUuids.add((logMessage as any).uuid);
    }
}

function buildOnMessage(state: LauncherState, session: Session, buf: MessageBuffer, svc: Services) {
    return (message: SDKMessage) => {
        formatClaudeMessageForInk(message, buf);
        svc.permissionHandler.onMessage(message);
        svc.currentModelCodeEmitter.onMessage(message);
        if (message.type === 'assistant') { trackAssistantContent(message as SDKAssistantMessage, state); }
        notifyQuestions(message, state, session);
        if (message.type === 'user') { trackToolResults(message as SDKUserMessage, state, svc.messageQueue); }
        const msg = message.type === 'user' ? hackPlanModeExit(message as SDKUserMessage, state) : message;
        const log = svc.sdkToLogConverter.convert(msg);
        if (!log) return;
        addPermissionsToToolResults(log, svc.permissionHandler);
        queueLogMessage(log, message, svc.messageQueue, state);
    };
}

async function cleanupAfterLaunch(state: LauncherState, svc: Services, session: Session, meta: MetaScannerState) {
    session.consumeOneTimeFlags();
    for (const [id, { parentToolCallId }] of state.ongoingToolCalls) {
        const c = svc.sdkToLogConverter.generateInterruptedToolResult(id, parentToolCallId);
        if (c) { session.client.sendClaudeSessionMessage(c); }
    }
    state.ongoingToolCalls.clear();
    await svc.messageQueue.flush();
    svc.messageQueue.destroy();
    state.abortController = null;
    state.abortFuture?.resolve(undefined);
    state.abortFuture = null;
    svc.permissionHandler.reset();
    state.sentSidechainUuids.clear();
    if (meta.promise) { await meta.promise.catch(() => {}); meta.promise = null; }
    if (meta.scanner) { await meta.scanner.cleanup(); meta.scanner = null; }
}

function buildNextMessage(session: Session, ctrl: AbortController, ph: PermissionHandler, loop: LoopState, mode: { hash: string | null; mode: EnhancedMode | null }) {
    return async () => {
        // Record the restart-initial's hash/mode so a SECOND consecutive mode change
        // (e.g. account B->C, or model B->C) right after an isolate is compared against
        // the actually-running mode — not a stale null, which would skip the restart.
        if (loop.pending) { const p = loop.pending; loop.pending = null; mode.hash = p.hash; mode.mode = p.mode; ph.handleModeChange(p.mode.permissionMode); return p; }
        const msg = await session.queue.waitForMessagesAndGetAsString(ctrl.signal);
        if (!msg) return null;
        if ((mode.hash && msg.hash !== mode.hash) || msg.isolate) { loop.pending = msg; return null; }
        mode.hash = msg.hash;
        mode.mode = msg.mode;
        ph.handleModeChange(mode.mode.permissionMode);
        return { message: msg.message, mode: msg.mode };
    };
}

function handleScannerMessage(message: RawJSONLines, session: Session, state: LauncherState) {
    // Silently drop stop-hook feedback records (spec §5.9) before any delivery path
    if (isStopHookFeedback(message)) { return; }
    if ((message as any).isMeta === true) { session.client.sendClaudeSessionMessage(message); }
    const uuid = (message as any).uuid;
    if ((message as any).isSidechain === true && typeof uuid === 'string' && !state.sentSidechainUuids.has(uuid)) {
        state.sentSidechainUuids.add(uuid);
        session.client.sendClaudeSessionMessage(message);
    }
}

function buildOnSessionFound(session: Session, state: LauncherState, conv: SDKToLogConverter, meta: MetaScannerState) {
    return (sessionId: string) => {
        conv.updateSessionId(sessionId);
        session.onSessionFound(sessionId);
        if (meta.scanner || meta.promise) return;
        meta.promise = createSessionScanner({
            sessionId, workingDirectory: session.path, sendExisting: false,
            onMessage: (m) => handleScannerMessage(m, session, state),
        }).then(s => { meta.scanner = s; });
    };
}

function sendDoneNotification(session: Session) {
    session.api.push().sendSessionNotification({
        kind: 'done', metadata: session.client.getMetadata(),
        data: { sessionId: session.client.sessionId, type: 'ready', provider: 'claude' }
    });
}

function buildOnReady(session: Session, loop: LoopState) {
    return () => {
        session.client.closeClaudeSessionTurn('completed');
        if (!loop.pending && session.queue.size() === 0) { sendDoneNotification(session); }
    };
}

function initServices(session: Session): Services {
    const permissionHandler = new PermissionHandler(session);
    const messageQueue = new OutgoingMessageQueue((log) => session.client.sendClaudeSessionMessage(log));
    const sdkToLogConverter = new SDKToLogConverter(
        { sessionId: session.sessionId || 'unknown', cwd: session.path, version: process.env.npm_package_version },
        permissionHandler.getResponses(),
    );
    permissionHandler.setOnPermissionRequest((id: string) => { messageQueue.releaseToolCall(id); });
    // Cycle 10 M3': emit metadata.currentModelCode from SDK system/init messages
    // so the app's resolveContextWindow() helper can pick the correct
    // 200K vs 1M denominator on the normal Claude SDK path.
    const currentModelCodeEmitter = createCurrentModelCodeEmitter((updater) => session.client.updateMetadata(updater));
    // Emit metadata.currentClaudeConfigDir from the active account's CLAUDE_CONFIG_DIR
    // at each query start, so the app shows the current account in any session (parity
    // with currentModelCode). Guard against redundant metadata writes for the common
    // case where the account is unchanged across restarts of a long-running session.
    let lastEmittedConfigDir: string | undefined;
    const emitAccountConfigDir = (dir: string) => {
        // M3 — canonicalize at emit so the persisted binding is one stable form and
        // the change-guard compares canonical values (no redundant metadata writes).
        const canonical = canonicalizeClaudeConfigDir(dir);
        if (!canonical || lastEmittedConfigDir === canonical) return;
        lastEmittedConfigDir = canonical;
        session.client.updateMetadata(m => ({ ...m, currentClaudeConfigDir: canonical }));
    };
    // Emit metadata.currentModelMode / currentPermissionMode from the current query's
    // SELECTED keys at each query start, so the app restores the user's model/permission
    // selection cross-device (parity with currentClaudeConfigDir). Change-guarded to avoid
    // redundant metadata writes when the selection is unchanged across restarts.
    let lastEmittedModelMode: string | undefined;
    const emitModelMode = (key: string) => {
        if (lastEmittedModelMode === key) return;
        lastEmittedModelMode = key;
        session.client.updateMetadata(m => ({ ...m, currentModelMode: key }));
    };
    let lastEmittedPermissionMode: string | undefined;
    const emitPermissionMode = (key: string) => {
        if (lastEmittedPermissionMode === key) return;
        lastEmittedPermissionMode = key;
        session.client.updateMetadata(m => ({ ...m, currentPermissionMode: key }));
    };
    return { permissionHandler, messageQueue, sdkToLogConverter, currentModelCodeEmitter, emitAccountConfigDir, emitModelMode, emitPermissionMode };
}

async function invokeClaude(
    state: LauncherState, session: Session, svc: Services, onMessage: (msg: SDKMessage) => void,
    loop: LoopState, ctrl: AbortController, mode: { hash: string | null; mode: EnhancedMode | null }, meta: MetaScannerState,
) {
    await claudeRemote({
        sessionId: session.sessionId, path: session.path, allowedTools: session.allowedTools ?? [],
        mcpServers: session.mcpServers, hookSettingsPath: session.hookSettingsPath, jsRuntime: session.jsRuntime,
        canCallTool: svc.permissionHandler.handleToolCall,
        isAborted: (id: string) => svc.permissionHandler.isAborted(id),
        nextMessage: buildNextMessage(session, ctrl, svc.permissionHandler, loop, mode),
        onSessionFound: buildOnSessionFound(session, state, svc.sdkToLogConverter, meta),
        onThinkingChange: session.onThinkingChange, claudeEnvVars: session.claudeEnvVars, claudeArgs: session.claudeArgs,
        onMessage, signal: ctrl.signal,
        onCompletionEvent: (msg: string) => { session.client.sendSessionEvent({ type: 'message', message: msg }); },
        onSessionReset: () => { session.clearSessionId(); },
        onAccountConfigDir: svc.emitAccountConfigDir,
        onModelMode: svc.emitModelMode,
        onPermissionMode: svc.emitPermissionMode,
        onReady: buildOnReady(session, loop),
    });
}

function handleNormalExit(state: LauncherState, session: Session, buf: MessageBuffer, ctrl: AbortController) {
    if (!state.exitReason && ctrl.signal.aborted) {
        session.client.closeClaudeSessionTurn('cancelled');
        session.client.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
    }
    if (!state.exitReason) {
        buf.addMessage('Claude session ended. Waiting for next command...', 'status');
        session.client.sendSessionEvent({ type: 'message', message: 'Claude process exited, waiting for next command' });
    }
}

async function handleCrash(state: LauncherState, session: Session, buf: MessageBuffer, loop: LoopState, e: unknown) {
    logger.debug('[remote]: launch error', e);
    if (state.exitReason) return;
    loop.consecutiveCrashes++;
    session.client.closeClaudeSessionTurn('failed');
    if (loop.consecutiveCrashes >= loop.MAX_CONSECUTIVE_CRASHES) {
        session.client.sendSessionEvent({ type: 'message', message: `Claude crashed ${loop.consecutiveCrashes} times consecutively, stopping session` });
        state.exitReason = 'exit';
    } else {
        session.client.sendSessionEvent({ type: 'message', message: `Claude process exited unexpectedly (crash ${loop.consecutiveCrashes}/${loop.MAX_CONSECUTIVE_CRASHES}), waiting for next command` });
        buf.addMessage(`Claude crashed (${loop.consecutiveCrashes}/${loop.MAX_CONSECUTIVE_CRASHES}). Waiting ${loop.consecutiveCrashes * 2}s before retry...`, 'status');
        await new Promise(resolve => setTimeout(resolve, loop.consecutiveCrashes * 2000));
    }
}

async function runSingleLaunch(state: LauncherState, session: Session, buf: MessageBuffer, svc: Services, onMessage: (msg: SDKMessage) => void, loop: LoopState) {
    buf.addMessage('═'.repeat(40), 'status');
    if (session.sessionId !== loop.previousSessionId) {
        buf.addMessage('Starting new Claude session...', 'status');
        svc.permissionHandler.reset();
        svc.sdkToLogConverter.resetParentChain();
    } else {
        buf.addMessage('Continuing Claude session...', 'status');
    }
    loop.previousSessionId = session.sessionId;
    const ctrl = new AbortController();
    state.abortController = ctrl;
    state.abortFuture = new Future<void>();
    const mode = { hash: null as string | null, mode: null as EnhancedMode | null };
    const meta: MetaScannerState = { scanner: null, promise: null };
    try {
        await invokeClaude(state, session, svc, onMessage, loop, ctrl, mode, meta);
        loop.consecutiveCrashes = 0;
        handleNormalExit(state, session, buf, ctrl);
    } catch (e) {
        await handleCrash(state, session, buf, loop, e);
    } finally {
        await cleanupAfterLaunch(state, svc, session, meta);
    }
}

function cleanupTTY(state: LauncherState, ink: any, buf: MessageBuffer, abort: () => Promise<void>) {
    process.stdin.off('data', abort);
    if (process.stdin.isTTY) { process.stdin.setRawMode(false); }
    if (ink) { ink.unmount(); }
    buf.clear();
    if (state.abortFuture) { state.abortFuture.resolve(undefined); }
}

export async function claudeRemoteLauncher(session: Session): Promise<'switch' | 'exit'> {
    const state = createLauncherState();
    const buf = new MessageBuffer();
    async function abort() { if (state.abortController && !state.abortController.signal.aborted) { state.abortController.abort(); } await state.abortFuture?.promise; }
    function doSwitch() { if (!state.exitReason) { state.exitReason = 'switch'; } abort(); }
    const ink = setupTTY(buf, state, abort, doSwitch);
    session.client.rpcHandlerManager.registerHandler('abort', async () => { await abort(); });
    session.client.rpcHandlerManager.registerHandler('switch', doSwitch);
    const svc = initServices(session);
    await uploadResumeHistory(session);
    const onMessage = buildOnMessage(state, session, buf, svc);
    const loop: LoopState = { pending: null, previousSessionId: null, consecutiveCrashes: 0, MAX_CONSECUTIVE_CRASHES: 5 };
    try {
        while (!state.exitReason) { await runSingleLaunch(state, session, buf, svc, onMessage, loop); }
    } finally { svc.permissionHandler.reset(); cleanupTTY(state, ink, buf, abort); }
    return state.exitReason || 'exit';
}
