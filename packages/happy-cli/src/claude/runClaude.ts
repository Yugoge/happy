import os from 'node:os';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import axios from 'axios';

import { ApiClient } from '@/api/api';
import { logger } from '@/ui/logger';
import { loop } from '@/claude/loop';
import { AgentState, AttachmentMetadata, Metadata } from '@/api/types';
import packageJson from '../../package.json';
import { Credentials, readSettings } from '@/persistence';
import { EnhancedMode, PermissionMode } from './loop';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { startCaffeinate, stopCaffeinate } from '@/utils/caffeinate';
import { parseSpecialCommand } from '@/parsers/specialCommands';
import { getEnvironmentInfo } from '@/ui/doctor';
import { configuration } from '@/configuration';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { initialMachineMetadata } from '@/daemon/run';
import { startHappyServer } from '@/claude/utils/startHappyServer';
import { startHookServer } from '@/claude/utils/startHookServer';
import { generateHookSettingsFile, cleanupHookSettingsFile } from '@/claude/utils/generateHookSettings';
import { registerKillSessionHandler } from './registerKillSessionHandler';
import { projectPath } from '../projectPath';
import { resolve } from 'node:path';
import { startOfflineReconnection, connectionState } from '@/utils/serverConnectionErrors';
import { claudeLocal } from '@/claude/claudeLocal';
import { createSessionScanner } from '@/claude/utils/sessionScanner';
import { Session } from './session';
import { applySandboxPermissionPolicy, resolveInitialClaudePermissionMode } from './utils/permissionMode';

/** JavaScript runtime to use for spawning Claude Code */
export type JsRuntime = 'node' | 'bun'

export interface StartOptions {
    model?: string
    permissionMode?: PermissionMode
    startingMode?: 'local' | 'remote'
    shouldStartDaemon?: boolean
    claudeEnvVars?: Record<string, string>
    claudeArgs?: string[]
    startedBy?: 'daemon' | 'terminal'
    noSandbox?: boolean
    /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
    jsRuntime?: JsRuntime
    /** Existing happy session ID to reconnect to (for recovery after reboot) */
    recoverSessionId?: string
}

/**
 * Downloads message attachments to a temp directory and returns their local paths.
 * Allows Claude to access attached files via @path references.
 */
async function downloadAttachments(attachments: AttachmentMetadata[]): Promise<string[]> {
    const tmpDir = path.join(os.tmpdir(), 'happy-attachments');
    fs.mkdirSync(tmpDir, { recursive: true });
    const localPaths: string[] = [];

    for (const att of attachments) {
        try {
            const sanitized = att.filename.replace(/[/\\]/g, '_').replace(/\.\./g, '_').slice(0, 100) || 'file';
            const localPath = path.join(tmpDir, `${att.id}-${sanitized}`);
            const response = await axios.get(att.url, { responseType: 'arraybuffer', timeout: 30000 });
            fs.writeFileSync(localPath, Buffer.from(response.data));
            localPaths.push(localPath);
            logger.debug(`[attachments] Downloaded ${att.filename} → ${localPath}`);
        } catch (e) {
            logger.debug(`[attachments] Failed to download ${att.filename}: ${e}`);
        }
    }

    return localPaths;
}

export async function runClaude(credentials: Credentials, options: StartOptions = {}): Promise<void> {
    logger.debug(`[CLAUDE] ===== CLAUDE MODE STARTING =====`);
    logger.debug(`[CLAUDE] This is the Claude agent, NOT Gemini`);
    
    const workingDirectory = process.cwd();
    const sessionTag = options.recoverSessionId || randomUUID();

    // Log environment info at startup
    logger.debugLargeJson('[START] Happy process started', getEnvironmentInfo());
    logger.debug(`[START] Options: startedBy=${options.startedBy}, startingMode=${options.startingMode}, recoverSession=${options.recoverSessionId || 'none'}`);

    // Validate daemon spawn requirements - fail fast on invalid config
    if (options.startedBy === 'daemon' && options.startingMode === 'local') {
        throw new Error('Daemon-spawned sessions cannot use local/interactive mode. Use --happy-starting-mode remote or spawn sessions directly from terminal.');
    }

    // Set backend for offline warnings (before any API calls)
    connectionState.setBackend('Claude');

    // Create session service
    const api = await ApiClient.create(credentials);

    // Create a new session
    let state: AgentState = {};

    // Get machine ID from settings (should already be set up)
    const settings = await readSettings();
    let machineId = settings?.machineId
    const sandboxConfig = options.noSandbox ? undefined : settings?.sandboxConfig;
    const sandboxEnabled = Boolean(sandboxConfig?.enabled);
    const initialPermissionMode = applySandboxPermissionPolicy(
        resolveInitialClaudePermissionMode(options.permissionMode, options.claudeArgs),
        sandboxEnabled,
    );
    const dangerouslySkipPermissions =
        initialPermissionMode === 'bypassPermissions' ||
        initialPermissionMode === 'yolo' ||
        sandboxEnabled ||
        Boolean(options.claudeArgs?.includes('--dangerously-skip-permissions'));
    if (!machineId) {
        console.error(`[START] No machine ID found in settings, which is unexpected since authAndSetupMachineIfNeeded should have created it. Please report this issue on https://github.com/slopus/happy-cli/issues`);
        process.exit(1);
    }
    logger.debug(`Using machineId: ${machineId}`);

    // Create machine if it doesn't exist
    await api.getOrCreateMachine({
        machineId,
        metadata: initialMachineMetadata
    });

    let metadata: Metadata = {
        path: workingDirectory,
        host: os.hostname(),
        version: packageJson.version,
        os: os.platform(),
        machineId: machineId,
        homeDir: os.homedir(),
        happyHomeDir: configuration.happyHomeDir,
        happyLibDir: projectPath(),
        happyToolsDir: resolve(projectPath(), 'tools', 'unpacked'),
        startedFromDaemon: options.startedBy === 'daemon',
        hostPid: process.pid,
        startedBy: options.startedBy || 'terminal',
        // Initialize lifecycle state
        lifecycleState: 'running',
        lifecycleStateSince: Date.now(),
        flavor: 'claude',
        sandbox: sandboxConfig?.enabled ? sandboxConfig : null,
        dangerouslySkipPermissions,
    };
    const response = options.recoverSessionId
        ? await api.reconnectSession(options.recoverSessionId, metadata)
        : await api.getOrCreateSession({ tag: sessionTag, metadata, state });

    // If recovering, extract Claude session ID from server metadata and pass --resume
    if (options.recoverSessionId && response) {
        const serverMeta = response.metadata as Metadata | null;
        const claudeSessionId = serverMeta?.claudeSessionId;
        if (claudeSessionId) {
            logger.debug(`[START] Recovery: found claudeSessionId=${claudeSessionId} in server metadata, adding --resume`);
            if (!options.claudeArgs) options.claudeArgs = [];
            // Remove any existing --resume to avoid duplicates
            const resumeIdx = options.claudeArgs.indexOf('--resume');
            if (resumeIdx === -1) {
                options.claudeArgs.push('--resume', claudeSessionId);
            }
        } else {
            logger.debug(`[START] Recovery: no claudeSessionId in server metadata — Claude will start fresh`);
        }
    }

    // Handle server unreachable case - run Claude locally with hot reconnection
    // Note: connectionState.notifyOffline() was already called by api.ts with error details
    if (!response) {
        let offlineSessionId: string | null = null;

        const reconnection = startOfflineReconnection({
            serverUrl: configuration.serverUrl,
            onReconnected: async () => {
                const resp = await api.getOrCreateSession({ tag: randomUUID(), metadata, state });
                if (!resp) throw new Error('Server unavailable');
                const session = api.sessionSyncClient(resp);
                const scanner = await createSessionScanner({
                    sessionId: null,
                    workingDirectory,
                    onMessage: (msg) => session.sendClaudeSessionMessage(msg)
                });
                if (offlineSessionId) scanner.onNewSession(offlineSessionId);
                return { session, scanner };
            },
            onNotify: console.log,
            onCleanup: () => {
                // Scanner cleanup handled automatically when process exits
            }
        });

        try {
            await claudeLocal({
                path: workingDirectory,
                sessionId: null,
                onSessionFound: (id) => { offlineSessionId = id; },
                onThinkingChange: () => {},
                abort: new AbortController().signal,
                claudeEnvVars: options.claudeEnvVars,
                claudeArgs: options.claudeArgs,
                mcpServers: {},
                allowedTools: [],
                sandboxConfig,
            });
        } finally {
            reconnection.cancel();
            stopCaffeinate();
        }
        process.exit(0);
    }

    logger.debug(`Session created: ${response.id}`);

    // Always report to daemon if it exists
    try {
        logger.debug(`[START] Reporting session ${response.id} to daemon`);
        const result = await notifyDaemonSessionStarted(response.id, metadata);
        if (result.error) {
            logger.debug(`[START] Failed to report to daemon (may not be running):`, result.error);
        } else {
            logger.debug(`[START] Reported session ${response.id} to daemon`);
        }
    } catch (error) {
        logger.debug('[START] Failed to report to daemon (may not be running):', error);
    }

    // Note: SDK metadata extraction (tools/slash commands) was removed because it
    // created a blank Claude session with prompt 'hello' on every startup/recovery.

    // Create realtime session
    const session = api.sessionSyncClient(response);

    // Start Happy MCP server
    const happyServer = await startHappyServer(session);
    logger.debug(`[START] Happy MCP server started at ${happyServer.url}`);

    // Variable to track current session instance (updated via onSessionReady callback)
    // Used by hook server to notify Session when Claude changes session ID
    let currentSession: Session | null = null;
    // For --resume sessions, Claude fires the SessionStart hook before onSessionReady sets
    // currentSession (resumed sessions start faster than fresh ones). Store the pending ID
    // so it can be applied the moment currentSession becomes available.
    let pendingSessionId: string | null = null;

    // Start Hook server for receiving Claude session notifications
    const hookServer = await startHookServer({
        onSessionHook: (sessionId, data) => {
            logger.debug(`[START] Session hook received: ${sessionId}`, data);

            // Update session ID in the Session instance
            if (currentSession) {
                const previousSessionId = currentSession.sessionId;
                if (previousSessionId !== sessionId) {
                    logger.debug(`[START] Claude session ID changed: ${previousSessionId} -> ${sessionId}`);
                    currentSession.onSessionFound(sessionId);
                }
            } else {
                // currentSession not ready yet (race condition on --resume): store for later
                logger.debug(`[START] Session hook arrived before session ready, storing pending ID: ${sessionId}`);
                pendingSessionId = sessionId;
            }
        }
    });
    logger.debug(`[START] Hook server started on port ${hookServer.port}`);

    // Generate hook settings file for Claude
    const hookSettingsPath = generateHookSettingsFile(hookServer.port);
    logger.debug(`[START] Generated hook settings file: ${hookSettingsPath}`);

    // Print log file path
    const logPath = logger.logFilePath;
    logger.infoDeveloper(`Session: ${response.id}`);
    logger.infoDeveloper(`Logs: ${logPath}`);

    // Set initial agent state
    session.updateAgentState((currentState) => ({
        ...currentState,
        controlledByUser: options.startingMode !== 'remote'
    }));

    // Start caffeinate to prevent sleep on macOS
    const caffeinateStarted = startCaffeinate();
    if (caffeinateStarted) {
        logger.infoDeveloper('Sleep prevention enabled (macOS)');
    }

    // Import MessageQueue2 and create message queue
    const messageQueue = new MessageQueue2<EnhancedMode>(mode => hashObject({
        isPlan: mode.permissionMode === 'plan',
        model: mode.model,
        fallbackModel: mode.fallbackModel,
        customSystemPrompt: mode.customSystemPrompt,
        appendSystemPrompt: mode.appendSystemPrompt,
        allowedTools: mode.allowedTools,
        disallowedTools: mode.disallowedTools
    }));

    // Forward messages to the queue
    // Permission modes: Use the unified 7-mode type, mapping happens at SDK boundary in claudeRemote.ts
    let currentPermissionMode: PermissionMode | undefined = initialPermissionMode;
    let currentModel = options.model; // Track current model state
    let currentFallbackModel: string | undefined = undefined; // Track current fallback model
    let currentCustomSystemPrompt: string | undefined = undefined; // Track current custom system prompt
    let currentAppendSystemPrompt: string | undefined = undefined; // Track current append system prompt
    let currentAllowedTools: string[] | undefined = undefined; // Track current allowed tools
    let currentDisallowedTools: string[] | undefined = undefined; // Track current disallowed tools
    session.onUserMessage((message) => {

        // Resolve permission mode from meta - pass through as-is, mapping happens at SDK boundary
        let messagePermissionMode: PermissionMode | undefined = currentPermissionMode;
        if (message.meta?.permissionMode) {
            messagePermissionMode = applySandboxPermissionPolicy(message.meta.permissionMode, sandboxEnabled);
            currentPermissionMode = messagePermissionMode;
            logger.debug(`[loop] Permission mode updated from user message to: ${currentPermissionMode}`);
        } else {
            logger.debug(`[loop] User message received with no permission mode override, using current: ${currentPermissionMode}`);
        }

        // Resolve model - use message.meta.model if provided, otherwise use current model
        let messageModel = currentModel;
        if (message.meta?.hasOwnProperty('model')) {
            messageModel = message.meta.model || undefined; // null becomes undefined
            currentModel = messageModel;
            logger.debug(`[loop] Model updated from user message: ${messageModel || 'reset to default'}`);
        } else {
            logger.debug(`[loop] User message received with no model override, using current: ${currentModel || 'default'}`);
        }

        // Resolve custom system prompt - use message.meta.customSystemPrompt if provided, otherwise use current
        let messageCustomSystemPrompt = currentCustomSystemPrompt;
        if (message.meta?.hasOwnProperty('customSystemPrompt')) {
            messageCustomSystemPrompt = message.meta.customSystemPrompt || undefined; // null becomes undefined
            currentCustomSystemPrompt = messageCustomSystemPrompt;
            logger.debug(`[loop] Custom system prompt updated from user message: ${messageCustomSystemPrompt ? 'set' : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no custom system prompt override, using current: ${currentCustomSystemPrompt ? 'set' : 'none'}`);
        }

        // Resolve fallback model - use message.meta.fallbackModel if provided, otherwise use current fallback model
        let messageFallbackModel = currentFallbackModel;
        if (message.meta?.hasOwnProperty('fallbackModel')) {
            messageFallbackModel = message.meta.fallbackModel || undefined; // null becomes undefined
            currentFallbackModel = messageFallbackModel;
            logger.debug(`[loop] Fallback model updated from user message: ${messageFallbackModel || 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no fallback model override, using current: ${currentFallbackModel || 'none'}`);
        }

        // Resolve append system prompt - use message.meta.appendSystemPrompt if provided, otherwise use current
        let messageAppendSystemPrompt = currentAppendSystemPrompt;
        if (message.meta?.hasOwnProperty('appendSystemPrompt')) {
            messageAppendSystemPrompt = message.meta.appendSystemPrompt || undefined; // null becomes undefined
            currentAppendSystemPrompt = messageAppendSystemPrompt;
            logger.debug(`[loop] Append system prompt updated from user message: ${messageAppendSystemPrompt ? 'set' : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no append system prompt override, using current: ${currentAppendSystemPrompt ? 'set' : 'none'}`);
        }

        // Resolve allowed tools - use message.meta.allowedTools if provided, otherwise use current
        let messageAllowedTools = currentAllowedTools;
        if (message.meta?.hasOwnProperty('allowedTools')) {
            messageAllowedTools = message.meta.allowedTools || undefined; // null becomes undefined
            currentAllowedTools = messageAllowedTools;
            logger.debug(`[loop] Allowed tools updated from user message: ${messageAllowedTools ? messageAllowedTools.join(', ') : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no allowed tools override, using current: ${currentAllowedTools ? currentAllowedTools.join(', ') : 'none'}`);
        }

        // Resolve disallowed tools - use message.meta.disallowedTools if provided, otherwise use current
        let messageDisallowedTools = currentDisallowedTools;
        if (message.meta?.hasOwnProperty('disallowedTools')) {
            messageDisallowedTools = message.meta.disallowedTools || undefined; // null becomes undefined
            currentDisallowedTools = messageDisallowedTools;
            logger.debug(`[loop] Disallowed tools updated from user message: ${messageDisallowedTools ? messageDisallowedTools.join(', ') : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no disallowed tools override, using current: ${currentDisallowedTools ? currentDisallowedTools.join(', ') : 'none'}`);
        }

        // Check for special commands before processing
        const specialCommand = parseSpecialCommand(message.content.text);

        if (specialCommand.type === 'compact') {
            logger.debug('[start] Detected /compact command');
            const enhancedMode: EnhancedMode = {
                permissionMode: messagePermissionMode || 'default',
                model: messageModel,
                fallbackModel: messageFallbackModel,
                customSystemPrompt: messageCustomSystemPrompt,
                appendSystemPrompt: messageAppendSystemPrompt,
                allowedTools: messageAllowedTools,
                disallowedTools: messageDisallowedTools
            };
            messageQueue.pushIsolateAndClear(specialCommand.originalMessage || message.content.text, enhancedMode);
            logger.debugLargeJson('[start] /compact command pushed to queue:', message);
            return;
        }

        if (specialCommand.type === 'clear') {
            logger.debug('[start] Detected /clear command');
            const enhancedMode: EnhancedMode = {
                permissionMode: messagePermissionMode || 'default',
                model: messageModel,
                fallbackModel: messageFallbackModel,
                customSystemPrompt: messageCustomSystemPrompt,
                appendSystemPrompt: messageAppendSystemPrompt,
                allowedTools: messageAllowedTools,
                disallowedTools: messageDisallowedTools
            };
            messageQueue.pushIsolateAndClear(specialCommand.originalMessage || message.content.text, enhancedMode);
            logger.debugLargeJson('[start] /compact command pushed to queue:', message);
            return;
        }

        // Push with resolved permission mode, model, system prompts, and tools
        const enhancedMode: EnhancedMode = {
            permissionMode: messagePermissionMode || 'default',
            model: messageModel,
            fallbackModel: messageFallbackModel,
            customSystemPrompt: messageCustomSystemPrompt,
            appendSystemPrompt: messageAppendSystemPrompt,
            allowedTools: messageAllowedTools,
            disallowedTools: messageDisallowedTools
        };
        // Attach files: download first, then append @path refs after message text
        const attachments = message.meta?.attachments;
        if (attachments && attachments.length > 0) {
            downloadAttachments(attachments).then(localPaths => {
                const refs = localPaths.map(p => `@${p}`).join(' ');
                const text = message.content.text;
                const textWithAttachments = refs ? (text ? `${text}\n\n${refs}` : refs) : text;
                messageQueue.push(textWithAttachments, enhancedMode);
                logger.debugLargeJson('User message with attachments pushed to queue:', message);
            }).catch(err => {
                logger.debug(`[WARN] Attachment download failed: ${err?.message}, sending message without attachments`);
                messageQueue.push(message.content.text, enhancedMode);
            });
        } else {
            messageQueue.push(message.content.text, enhancedMode);
            logger.debugLargeJson('User message pushed to queue:', message);
        }
    });

    // Setup signal handlers for graceful shutdown
    const cleanup = async () => {
        logger.debug('[START] Received termination signal, cleaning up...');

        try {
            // Update lifecycle state to archived before closing
            if (session) {
                session.updateMetadata((currentMetadata) => ({
                    ...currentMetadata,
                    lifecycleState: 'archived',
                    lifecycleStateSince: Date.now(),
                    archivedBy: 'cli',
                    archiveReason: 'User terminated'
                }));
                
                // Cleanup session resources (intervals, callbacks)
                currentSession?.cleanup();

                // Send session death message
                session.sendSessionDeath();
                await session.flush();
                await session.close();
            }

            // Stop caffeinate
            stopCaffeinate();

            // Stop Happy MCP server
            happyServer.stop();

            // Stop Hook server and cleanup settings file
            hookServer.stop();
            cleanupHookSettingsFile(hookSettingsPath);

            logger.debug('[START] Cleanup complete, exiting');
            process.exit(0);
        } catch (error) {
            logger.debug('[START] Error during cleanup:', error);
            process.exit(1);
        }
    };

    // Handle termination signals
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);

    // Handle uncaught exceptions and rejections
    process.on('uncaughtException', (error) => {
        logger.debug('[START] Uncaught exception:', error);
        cleanup();
    });

    process.on('unhandledRejection', (reason) => {
        logger.debug('[START] Unhandled rejection:', reason);
        cleanup();
    });

    registerKillSessionHandler(session.rpcHandlerManager, cleanup);

    // Create claude loop
    const exitCode = await loop({
        path: workingDirectory,
        model: options.model,
        permissionMode: initialPermissionMode,
        startingMode: options.startingMode,
        messageQueue,
        api,
        allowedTools: happyServer.toolNames.map(toolName => `mcp__happy__${toolName}`),
        onModeChange: (newMode) => {
            session.sendSessionEvent({ type: 'switch', mode: newMode });
            session.updateAgentState((currentState) => ({
                ...currentState,
                controlledByUser: newMode === 'local'
            }));
        },
        onSessionReady: (sessionInstance) => {
            // Store reference for hook server callback
            currentSession = sessionInstance;
            // Apply any session ID that arrived before we were ready (--resume race condition)
            if (pendingSessionId && pendingSessionId !== sessionInstance.sessionId) {
                logger.debug(`[START] Applying pending session ID: ${pendingSessionId}`);
                sessionInstance.onSessionFound(pendingSessionId);
                pendingSessionId = null;
            }
        },
        mcpServers: {
            'happy': {
                type: 'stdio' as const,
                command: options.jsRuntime === 'bun' ? 'bun' : 'node',
                args: [resolve(projectPath(), 'dist', 'codex', 'happyMcpStdioBridge.mjs'), '--url', happyServer.url],
            }
        },
        session,
        claudeEnvVars: options.claudeEnvVars,
        claudeArgs: options.claudeArgs,
        sandboxConfig,
        hookSettingsPath,
        jsRuntime: options.jsRuntime
    });

    // Cleanup session resources (intervals, callbacks) - prevents memory leak
    // Note: currentSession is set by onSessionReady callback during loop()
    (currentSession as Session | null)?.cleanup();

    // Send session death message
    session.sendSessionDeath();

    // Wait for socket to flush
    logger.debug('Waiting for socket to flush...');
    await session.flush();

    // Close session
    logger.debug('Closing session...');
    await session.close();

    // Stop caffeinate before exiting
    stopCaffeinate();
    logger.debug('Stopped sleep prevention');

    // Stop Happy MCP server
    happyServer.stop();
    logger.debug('Stopped Happy MCP server');

    // Stop Hook server and cleanup settings file
    hookServer.stop();
    cleanupHookSettingsFile(hookSettingsPath);
    logger.debug('Stopped Hook server and cleaned up settings file');

    // Exit with the code from Claude
    process.exit(exitCode);
}
