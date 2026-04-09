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

interface PermissionsField {
    date: number;
    result: 'approved' | 'denied';
    mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    allowedTools?: string[];
}

interface LauncherState {
    exitReason: 'switch' | 'exit' | null;
    abortController: AbortController | null;
    abortFuture: Future<void> | null;
    planModeToolCalls: Set<string>;
    ongoingToolCalls: Map<string, { parentToolCallId: string | null }>;
    notifiedQuestionToolCalls: Set<string>;
    sentSidechainUuids: Set<string>;
}

function createLauncherState(): LauncherState {
    return {
        exitReason: null,
        abortController: null,
        abortFuture: null,
        planModeToolCalls: new Set<string>(),
        ongoingToolCalls: new Map<string, { parentToolCallId: string | null }>(),
        notifiedQuestionToolCalls: new Set<string>(),
        sentSidechainUuids: new Set<string>(),
    };
}

function createAbortHelpers(state: LauncherState) {
    async function abort() {
        if (state.abortController && !state.abortController.signal.aborted) {
            state.abortController.abort();
        }
        await state.abortFuture?.promise;
    }
    async function doAbort() {
        logger.debug('[remote]: doAbort');
        await abort();
    }
    async function doSwitch() {
        logger.debug('[remote]: doSwitch');
        if (!state.exitReason) { state.exitReason = 'switch'; }
        await abort();
    }
    return { abort, doAbort, doSwitch };
}

function createDisplayProps(
    messageBuffer: MessageBuffer,
    session: Session,
    state: LauncherState,
    helpers: ReturnType<typeof createAbortHelpers>,
) {
    return {
        messageBuffer,
        logPath: process.env.DEBUG ? session.logPath : undefined,
        onExit: async () => {
            logger.debug('[remote]: Exiting client via Ctrl-C');
            if (!state.exitReason) { state.exitReason = 'exit'; }
            await helpers.abort();
        },
        onSwitchToLocal: () => {
            logger.debug('[remote]: Switching to local mode via double space');
            helpers.doSwitch();
        }
    };
}

/** Set up TTY rendering if available */
function setupUI(state: LauncherState, messageBuffer: MessageBuffer, session: Session, helpers: ReturnType<typeof createAbortHelpers>) {
    const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
    logger.debug(`[claudeRemoteLauncher] TTY available: ${hasTTY}`);
    let inkInstance: any = null;
    if (!hasTTY) return { hasTTY, inkInstance };
    console.clear();
    const props = createDisplayProps(messageBuffer, session, state, helpers);
    inkInstance = render(React.createElement(RemoteModeDisplay, props), { exitOnCtrlC: false, patchConsole: false });
    process.stdin.resume();
    if (process.stdin.isTTY) { process.stdin.setRawMode(true); }
    process.stdin.setEncoding("utf8");
    return { hasTTY, inkInstance };
}

/** Detect and track plan mode tool calls from assistant messages */
function detectPlanModeToolCalls(message: SDKMessage, state: LauncherState) {
    if (message.type !== 'assistant') return;
    const content = (message as SDKAssistantMessage).message.content;
    if (!content || !Array.isArray(content)) return;
    for (const c of content) {
        if (c.type === 'tool_use' && (c.name === 'exit_plan_mode' || c.name === 'ExitPlanMode')) {
            logger.debug('[remote]: detected plan mode tool call ' + c.id!);
            state.planModeToolCalls.add(c.id! as string);
        }
    }
}

/** Track active tool calls from assistant messages */
function trackToolCalls(message: SDKMessage, state: LauncherState) {
    if (message.type !== 'assistant') return;
    const umessage = message as SDKAssistantMessage;
    const content = umessage.message.content;
    if (!content || !Array.isArray(content)) return;
    for (const c of content) {
        if (c.type === 'tool_use') {
            logger.debug('[remote]: detected tool use ' + c.id! + ' parent: ' + umessage.parent_tool_use_id);
            state.ongoingToolCalls.set(c.id!, { parentToolCallId: umessage.parent_tool_use_id ?? null });
        }
    }
}

/** Send push notification when Claude asks a clarifying question */
function notifyQuestions(message: SDKMessage, state: LauncherState, session: Session) {
    for (const toolCallId of getAskUserQuestionToolCallIds(message)) {
        if (state.notifiedQuestionToolCalls.has(toolCallId)) continue;
        state.notifiedQuestionToolCalls.add(toolCallId);
        session.api.push().sendSessionNotification({
            kind: 'question',
            metadata: session.client.getMetadata(),
            data: {
                sessionId: session.client.sessionId,
                tool: 'AskUserQuestion',
                toolCallId,
                type: 'question_request',
                provider: 'claude',
            }
        });
    }
}

/** Handle user tool results: clear ongoing tracking, release delayed messages */
function handleToolResults(message: SDKMessage, state: LauncherState, messageQueue: OutgoingMessageQueue) {
    if (message.type !== 'user') return;
    const content = (message as SDKUserMessage).message.content;
    if (!content || !Array.isArray(content)) return;
    for (const c of content) {
        if (c.type === 'tool_result' && c.tool_use_id) {
            state.ongoingToolCalls.delete(c.tool_use_id);
            messageQueue.releaseToolCall(c.tool_use_id);
        }
    }
}

/** Transform a single content block for plan mode exit hack */
function transformPlanModeBlock(c: any, planModeToolCalls: Set<string>): any {
    if (c.type !== 'tool_result' || !c.tool_use_id) return c;
    if (!planModeToolCalls.has(c.tool_use_id!)) return c;
    if (c.content !== PLAN_FAKE_REJECT) return c;
    logger.debug('[remote]: hack plan mode exit');
    return { ...c, is_error: false, content: 'Plan approved', mode: c.mode };
}

/** Hack plan mode exit: replace fake rejection with approval */
function hackPlanModeExit(message: SDKMessage, state: LauncherState): SDKMessage {
    if (message.type !== 'user') return message;
    const umessage = message as SDKUserMessage;
    const content = umessage.message.content;
    if (!content || !Array.isArray(content)) return message;
    const transformed = content.map((c) => transformPlanModeBlock(c, state.planModeToolCalls));
    return { ...umessage, message: { ...umessage.message, content: transformed } };
}

/** Add permissions metadata to a single tool result block */
function addPermissionToBlock(c: any, permissionHandler: PermissionHandler): any {
    if (c.type !== 'tool_result' || !c.tool_use_id) return c;
    const response = permissionHandler.getResponses().get(c.tool_use_id);
    if (!response) return c;
    const permissions: PermissionsField = {
        date: response.receivedAt || Date.now(),
        result: response.approved ? 'approved' : 'denied'
    };
    if (response.mode) permissions.mode = response.mode;
    if (response.allowTools && response.allowTools.length > 0) {
        permissions.allowedTools = response.allowTools;
    }
    return { ...c, permissions };
}

/** Add permissions metadata to tool result content blocks */
function addPermissionsToToolResults(logMessage: RawJSONLines, permissionHandler: PermissionHandler) {
    if (logMessage.type !== 'user' || !logMessage.message?.content) return;
    const content = Array.isArray(logMessage.message.content) ? logMessage.message.content : [];
    for (let i = 0; i < content.length; i++) {
        content[i] = addPermissionToBlock(content[i], permissionHandler);
    }
}

/** Queue assistant message with optional delay for top-level tool calls */
function queueAssistantMessage(
    logMessage: RawJSONLines,
    message: SDKMessage,
    messageQueue: OutgoingMessageQueue,
): boolean {
    if (logMessage.type !== 'assistant' || message.type !== 'assistant') return false;
    const assistantMsg = message as SDKAssistantMessage;
    const content = assistantMsg.message.content;
    if (!content || !Array.isArray(content)) return false;
    const toolCallIds: string[] = [];
    for (const block of content) {
        if (block.type === 'tool_use' && block.id) toolCallIds.push(block.id);
    }
    if (toolCallIds.length === 0) return false;
    if (assistantMsg.parent_tool_use_id !== undefined) return false;
    messageQueue.enqueue(logMessage, { delay: 250, toolCallIds });
    return true;
}

/** Track sidechain UUID after message is enqueued, for deduplication with JSONL scanner */
function trackSidechainUuid(logMessage: RawJSONLines, state: LauncherState) {
    const msg = logMessage as any;
    if (msg.isSidechain === true && typeof msg.uuid === 'string') {
        state.sentSidechainUuids.add(msg.uuid);
    }
}

/** Build the onMessage callback that processes SDK messages */
function buildOnMessage(
    state: LauncherState,
    session: Session,
    messageBuffer: MessageBuffer,
    messageQueue: OutgoingMessageQueue,
    permissionHandler: PermissionHandler,
    sdkToLogConverter: SDKToLogConverter,
) {
    return function onMessage(message: SDKMessage) {
        formatClaudeMessageForInk(message, messageBuffer);
        permissionHandler.onMessage(message);
        detectPlanModeToolCalls(message, state);
        trackToolCalls(message, state);
        notifyQuestions(message, state, session);
        handleToolResults(message, state, messageQueue);
        const msg = hackPlanModeExit(message, state);
        const logMessage = sdkToLogConverter.convert(msg);
        if (!logMessage) return;
        addPermissionsToToolResults(logMessage, permissionHandler);
        if (!queueAssistantMessage(logMessage, message, messageQueue)) {
            messageQueue.enqueue(logMessage);
        }
        trackSidechainUuid(logMessage, state);
    };
}

/** Upload .jsonl history to server for resume/recovery sessions */
async function uploadRecoveryHistory(session: Session, resumeClaudeSessionId: string) {
    const scanner = await createSessionScanner({
        sessionId: resumeClaudeSessionId,
        sendExisting: true,
        workingDirectory: session.path,
        onMessage: (message) => {
            const isMetaMessage = (message as { isMeta?: boolean }).isMeta === true;
            if (message.type !== 'summary' && !isMetaMessage) {
                session.client.sendClaudeSessionMessage(message);
            }
        }
    });
    await scanner.cleanup();
    logger.debug(`[claudeRemoteLauncher] Recovery mode: history uploaded and scanner stopped`);
}

/** Extract resume session ID from claudeArgs */
function extractResumeSessionId(claudeArgs: string[] | undefined): string | null {
    if (!claudeArgs) return null;
    const resumeIdx = claudeArgs.indexOf('--resume');
    if (resumeIdx === -1 || resumeIdx + 1 >= claudeArgs.length) return null;
    const id = claudeArgs[resumeIdx + 1];
    logger.debug(`[claudeRemoteLauncher] Found resume session ID: ${id}`);
    return id;
}

/** Create the meta/sidechain message scanner callback for onSessionFound */
function createScannerMessageHandler(session: Session, state: LauncherState) {
    return (message: RawJSONLines) => {
        if ((message as { isMeta?: boolean }).isMeta === true) {
            session.client.sendClaudeSessionMessage(message);
        }
        // Forward sidechain messages (subagent internal operations)
        const uuid = (message as any).uuid;
        if ((message as { isSidechain?: boolean }).isSidechain === true
            && typeof uuid === 'string'
            && !state.sentSidechainUuids.has(uuid)) {
            state.sentSidechainUuids.add(uuid);
            session.client.sendClaudeSessionMessage(message);
        }
    };
}

/** Build the nextMessage callback for claudeRemote */
function buildNextMessage(
    session: Session,
    state: LauncherState,
    permissionHandler: PermissionHandler,
    modeState: { hash: string | null; mode: EnhancedMode | null; pending: { message: string; mode: EnhancedMode } | null },
    controller: AbortController,
) {
    return async () => {
        if (modeState.pending) {
            const p = modeState.pending;
            modeState.pending = null;
            permissionHandler.handleModeChange(p.mode.permissionMode);
            return p;
        }
        const msg = await session.queue.waitForMessagesAndGetAsString(controller.signal);
        if (!msg) return null;
        if ((modeState.hash && msg.hash !== modeState.hash) || msg.isolate) {
            logger.debug('[remote]: mode has changed, pending message');
            modeState.pending = msg;
            return null;
        }
        modeState.hash = msg.hash;
        modeState.mode = msg.mode;
        permissionHandler.handleModeChange(modeState.mode.permissionMode);
        return { message: msg.message, mode: msg.mode };
    };
}

/** Handle the finally block cleanup after each Claude launch */
async function cleanupAfterLaunch(
    state: LauncherState,
    sdkToLogConverter: SDKToLogConverter,
    session: Session,
    messageQueue: OutgoingMessageQueue,
    permissionHandler: PermissionHandler,
    modeState: { hash: string | null; mode: EnhancedMode | null },
    metaScannerRef: { scanner: any; promise: Promise<void> | null },
) {
    session.consumeOneTimeFlags();
    logger.debug('[remote]: launch finally');
    terminateOngoingToolCalls(state, sdkToLogConverter, session);
    logger.debug('[remote]: flushing message queue');
    await messageQueue.flush();
    messageQueue.destroy();
    logger.debug('[remote]: message queue flushed');
    state.abortController = null;
    state.abortFuture?.resolve(undefined);
    state.abortFuture = null;
    logger.debug('[remote]: launch done');
    permissionHandler.reset();
    state.sentSidechainUuids.clear();
    modeState.hash = null;
    modeState.mode = null;
    await cleanupMetaScanner(metaScannerRef);
}

/** Terminate all ongoing tool calls with interrupted results */
function terminateOngoingToolCalls(state: LauncherState, sdkToLogConverter: SDKToLogConverter, session: Session) {
    for (const [toolCallId, { parentToolCallId }] of state.ongoingToolCalls) {
        const converted = sdkToLogConverter.generateInterruptedToolResult(toolCallId, parentToolCallId);
        if (converted) {
            logger.debug('[remote]: terminating tool call ' + toolCallId + ' parent: ' + parentToolCallId);
            session.client.sendClaudeSessionMessage(converted);
        }
    }
    state.ongoingToolCalls.clear();
}

/** Clean up meta message scanner */
async function cleanupMetaScanner(ref: { scanner: any; promise: Promise<void> | null }) {
    if (ref.promise !== null) {
        await (ref.promise as Promise<void>).catch(() => {});
        ref.promise = null;
    }
    if (ref.scanner !== null) {
        await (ref.scanner as { cleanup: () => Promise<void> }).cleanup();
        ref.scanner = null;
    }
}

/** Clean up resources when the launcher exits */
function cleanupLauncher(
    state: LauncherState,
    permissionHandler: PermissionHandler,
    helpers: ReturnType<typeof createAbortHelpers>,
    ui: { inkInstance: any },
    messageBuffer: MessageBuffer,
) {
    permissionHandler.reset();
    process.stdin.off('data', helpers.abort);
    if (process.stdin.isTTY) { process.stdin.setRawMode(false); }
    if (ui.inkInstance) { ui.inkInstance.unmount(); }
    messageBuffer.clear();
    if (state.abortFuture) { state.abortFuture.resolve(undefined); }
}

/** Log session start/continue messages */
function logSessionStart(
    isNewSession: boolean,
    session: Session,
    messageBuffer: MessageBuffer,
    permissionHandler: PermissionHandler,
    sdkToLogConverter: SDKToLogConverter,
    previousSessionRef: { id: string | null },
) {
    messageBuffer.addMessage('═'.repeat(40), 'status');
    if (isNewSession) {
        messageBuffer.addMessage('Starting new Claude session...', 'status');
        permissionHandler.reset();
        sdkToLogConverter.resetParentChain();
        logger.debug(`[remote]: New session detected (previous: ${previousSessionRef.id}, current: ${session.sessionId})`);
    } else {
        messageBuffer.addMessage('Continuing Claude session...', 'status');
        logger.debug(`[remote]: Continuing existing session: ${session.sessionId}`);
    }
}

/** Run a single claudeRemote invocation */
async function runClaudeRemote(
    session: Session,
    state: LauncherState,
    controller: AbortController,
    modeState: { hash: string | null; mode: EnhancedMode | null; pending: any },
    metaScannerRef: { scanner: any; promise: Promise<void> | null },
    permissionHandler: PermissionHandler,
    sdkToLogConverter: SDKToLogConverter,
    onMessage: (message: SDKMessage) => void,
) {
    await claudeRemote({
        sessionId: session.sessionId,
        path: session.path,
        allowedTools: session.allowedTools ?? [],
        mcpServers: session.mcpServers,
        hookSettingsPath: session.hookSettingsPath,
        jsRuntime: session.jsRuntime,
        canCallTool: permissionHandler.handleToolCall,
        isAborted: (toolCallId: string) => permissionHandler.isAborted(toolCallId),
        nextMessage: buildNextMessage(session, state, permissionHandler, modeState, controller),
        onSessionFound: (sessionId) => onSessionFound(sessionId, session, state, sdkToLogConverter, metaScannerRef),
        onThinkingChange: session.onThinkingChange,
        claudeEnvVars: session.claudeEnvVars,
        claudeArgs: session.claudeArgs,
        onMessage,
        onCompletionEvent: (message: string) => {
            logger.debug(`[remote]: Completion event: ${message}`);
            session.client.sendSessionEvent({ type: 'message', message });
        },
        onSessionReset: () => {
            logger.debug('[remote]: Session reset');
            session.clearSessionId();
        },
        onReady: () => handleOnReady(session, state),
        signal: controller.signal,
    });
}

/** Handle onSessionFound: update converter ID and start JSONL scanner */
function onSessionFound(
    sessionId: string,
    session: Session,
    state: LauncherState,
    sdkToLogConverter: SDKToLogConverter,
    metaScannerRef: { scanner: any; promise: Promise<void> | null },
) {
    sdkToLogConverter.updateSessionId(sessionId);
    session.onSessionFound(sessionId);
    if (!metaScannerRef.scanner && !metaScannerRef.promise) {
        metaScannerRef.promise = createSessionScanner({
            sessionId,
            workingDirectory: session.path,
            sendExisting: false,
            onMessage: createScannerMessageHandler(session, state),
        }).then(s => { metaScannerRef.scanner = s; });
    }
}

/** Handle onReady: close turn and send notification */
function handleOnReady(session: Session, state: LauncherState) {
    session.client.closeClaudeSessionTurn('completed');
    if (state.exitReason || session.queue.size() > 0) return;
    session.api.push().sendSessionNotification({
        kind: 'done',
        metadata: session.client.getMetadata(),
        data: {
            sessionId: session.client.sessionId,
            type: 'ready',
            provider: 'claude',
        }
    });
}

/** Handle normal Claude exit */
function handleNormalExit(state: LauncherState, session: Session, messageBuffer: MessageBuffer) {
    if (!state.exitReason && state.abortController?.signal.aborted) {
        session.client.closeClaudeSessionTurn('cancelled');
        session.client.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
    }
    if (!state.exitReason) {
        logger.debug('[remote]: Claude exited normally, waiting for next command');
        messageBuffer.addMessage('Claude session ended. Waiting for next command...', 'status');
        session.client.sendSessionEvent({ type: 'message', message: 'Claude process exited, waiting for next command' });
    }
}

const MAX_CONSECUTIVE_CRASHES = 5;

/** Handle Claude crash */
function handleCrash(
    e: unknown,
    state: LauncherState,
    session: Session,
    messageBuffer: MessageBuffer,
    crashRef: { count: number },
) {
    logger.debug('[remote]: launch error', e);
    if (state.exitReason) return;
    crashRef.count++;
    session.client.closeClaudeSessionTurn('failed');
    if (crashRef.count >= MAX_CONSECUTIVE_CRASHES) {
        logger.debug(`[remote]: ${crashRef.count} consecutive crashes, stopping`);
        session.client.sendSessionEvent({ type: 'message', message: `Claude crashed ${crashRef.count} times consecutively, stopping session` });
        state.exitReason = 'exit';
    } else {
        session.client.sendSessionEvent({ type: 'message', message: `Claude process exited unexpectedly (crash ${crashRef.count}/${MAX_CONSECUTIVE_CRASHES}), waiting for next command` });
        messageBuffer.addMessage(`Claude crashed (${crashRef.count}/${MAX_CONSECUTIVE_CRASHES}). Waiting ${crashRef.count * 2}s before retry...`, 'status');
    }
}

/** Handle a single Claude launch iteration */
async function handleLaunchIteration(
    session: Session,
    state: LauncherState,
    messageBuffer: MessageBuffer,
    messageQueue: OutgoingMessageQueue,
    permissionHandler: PermissionHandler,
    sdkToLogConverter: SDKToLogConverter,
    onMessage: (message: SDKMessage) => void,
    previousSessionRef: { id: string | null },
    crashRef: { count: number },
) {
    const isNewSession = session.sessionId !== previousSessionRef.id;
    logSessionStart(isNewSession, session, messageBuffer, permissionHandler, sdkToLogConverter, previousSessionRef);
    previousSessionRef.id = session.sessionId;
    const controller = new AbortController();
    state.abortController = controller;
    state.abortFuture = new Future<void>();
    const modeState = { hash: null as string | null, mode: null as EnhancedMode | null, pending: null as any };
    const metaScannerRef = { scanner: null as any, promise: null as Promise<void> | null };
    try {
        await runClaudeRemote(session, state, controller, modeState, metaScannerRef, permissionHandler, sdkToLogConverter, onMessage);
        crashRef.count = 0;
        handleNormalExit(state, session, messageBuffer);
    } catch (e) {
        handleCrash(e, state, session, messageBuffer, crashRef);
    } finally {
        await cleanupAfterLaunch(state, sdkToLogConverter, session, messageQueue, permissionHandler, modeState, metaScannerRef);
    }
}

/** Initialize launcher dependencies and return them */
function initLauncherDeps(session: Session, state: LauncherState, messageBuffer: MessageBuffer) {
    const helpers = createAbortHelpers(state);
    const ui = setupUI(state, messageBuffer, session, helpers);
    session.client.rpcHandlerManager.registerHandler('abort', helpers.doAbort);
    session.client.rpcHandlerManager.registerHandler('switch', helpers.doSwitch);
    const permissionHandler = new PermissionHandler(session);
    const messageQueue = new OutgoingMessageQueue(
        (logMessage) => session.client.sendClaudeSessionMessage(logMessage)
    );
    return { helpers, ui, permissionHandler, messageQueue };
}

/** Configure converter and permission request handler */
function initConverterAndHandlers(session: Session, deps: ReturnType<typeof initLauncherDeps>) {
    deps.permissionHandler.setOnPermissionRequest((toolCallId: string) => {
        deps.messageQueue.releaseToolCall(toolCallId);
    });
    return new SDKToLogConverter({
        sessionId: session.sessionId || 'unknown',
        cwd: session.path,
        version: process.env.npm_package_version
    }, deps.permissionHandler.getResponses());
}

/** Main loop: repeatedly launch Claude until exit */
async function launcherLoop(
    session: Session,
    state: LauncherState,
    messageBuffer: MessageBuffer,
    deps: { messageQueue: OutgoingMessageQueue; permissionHandler: PermissionHandler },
    sdkToLogConverter: SDKToLogConverter,
    onMessage: (message: SDKMessage) => void,
) {
    const previousSessionRef = { id: null as string | null };
    const crashRef = { count: 0 };
    while (!state.exitReason) {
        logger.debug('[remote]: launch');
        await handleLaunchIteration(session, state, messageBuffer, deps.messageQueue, deps.permissionHandler, sdkToLogConverter, onMessage, previousSessionRef, crashRef);
        if (crashRef.count > 0 && !state.exitReason) {
            await new Promise(resolve => setTimeout(resolve, crashRef.count * 2000));
        }
    }
}

export async function claudeRemoteLauncher(session: Session): Promise<'switch' | 'exit'> {
    logger.debug('[claudeRemoteLauncher] Starting remote launcher');
    const state = createLauncherState();
    const messageBuffer = new MessageBuffer();
    const deps = initLauncherDeps(session, state, messageBuffer);
    const resumeClaudeSessionId = extractResumeSessionId(session.claudeArgs);
    if (resumeClaudeSessionId) {
        await uploadRecoveryHistory(session, resumeClaudeSessionId);
    }
    const sdkToLogConverter = initConverterAndHandlers(session, deps);
    const onMessage = buildOnMessage(state, session, messageBuffer, deps.messageQueue, deps.permissionHandler, sdkToLogConverter);
    try {
        await launcherLoop(session, state, messageBuffer, deps, sdkToLogConverter, onMessage);
    } finally {
        cleanupLauncher(state, deps.permissionHandler, deps.helpers, deps.ui, messageBuffer);
    }
    return state.exitReason || 'exit';
}
