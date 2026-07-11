import { EnhancedMode } from "./loop";
import { query, type QueryOptions, type SDKMessage, type SDKSystemMessage, AbortError, SDKUserMessage } from '@/claude/sdk'
import { mapToClaudeMode } from "./utils/permissionMode";
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { join, resolve } from 'node:path';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { projectPath } from "@/projectPath";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { logger } from "@/lib";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { getProjectPath } from "./utils/path";
import { awaitFileExist } from "@/modules/watcher/awaitFileExist";
import { systemPrompt } from "./utils/systemPrompt";
import { PermissionResult } from "./sdk/types";
import type { JsRuntime } from "./runClaude";

/**
 * Copy a resumable Claude session .jsonl from one account's config dir into
 * another's, so that switching CLAUDE_CONFIG_DIR mid-session still resumes with
 * full conversation context. The project sub-path is derived identically to
 * getProjectPath() (only the config-dir prefix differs between accounts). The
 * source account is the most complete at switch time (its query just ended), so
 * the destination is overwritten. Best-effort: callers guard with try/catch.
 */
function migrateClaudeSessionFile(fromConfigDir: string, toConfigDir: string, workingDirectory: string, sessionId: string): void {
    const projectId = resolve(workingDirectory).replace(/[^a-zA-Z0-9-]/g, '-');
    const src = join(fromConfigDir, 'projects', projectId, `${sessionId}.jsonl`);
    if (!existsSync(src)) return; // nothing to migrate (e.g. first spawn)
    const destDir = join(toConfigDir, 'projects', projectId);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, join(destDir, `${sessionId}.jsonl`));
}

export async function claudeRemote(opts: {

    // Fixed parameters
    sessionId: string | null,
    path: string,
    mcpServers?: Record<string, any>,
    claudeEnvVars?: Record<string, string>,
    claudeArgs?: string[],
    allowedTools: string[],
    signal?: AbortSignal,
    canCallTool: (toolName: string, input: unknown, mode: EnhancedMode, options: { signal: AbortSignal }) => Promise<PermissionResult>,
    /** Path to temporary settings file with SessionStart hook (required for session tracking) */
    hookSettingsPath: string,
    /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
    jsRuntime?: JsRuntime,

    // Dynamic parameters
    nextMessage: () => Promise<{ message: string, mode: EnhancedMode } | null>,
    onReady: () => void,
    isAborted: (toolCallId: string) => boolean,

    // Callbacks
    onSessionFound: (id: string) => void,
    onThinkingChange?: (thinking: boolean) => void,
    onMessage: (message: SDKMessage) => void,
    onCompletionEvent?: (message: string) => void,
    onSessionReset?: () => void,
    /** Reports the active Claude account's CLAUDE_CONFIG_DIR at query start (initial + post-switch), so the app can display the current account. Mirrors the currentModelCode emitter. */
    onAccountConfigDir?: (configDir: string) => void,
    /** Reports the current query's SELECTED model key (initial.mode.model) at query start, so the app can restore the user's model selection cross-device. Mirrors onAccountConfigDir. */
    onModelMode?: (key: string) => void,
    /** Reports the current query's SELECTED permission key (initial.mode.permissionMode) at query start, so the app can restore the user's permission selection cross-device. Mirrors onAccountConfigDir. */
    onPermissionMode?: (key: string) => void
}) {

    // Check if session is valid
    let startFrom = opts.sessionId;
    if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
        startFrom = null;
    }
    
    // Extract --resume from claudeArgs if present (for first spawn)
    if (!startFrom && opts.claudeArgs) {
        for (let i = 0; i < opts.claudeArgs.length; i++) {
            if (opts.claudeArgs[i] === '--resume') {
                if (i + 1 < opts.claudeArgs.length) {
                    const nextArg = opts.claudeArgs[i + 1];
                    if (!nextArg.startsWith('-') && nextArg.includes('-')) {
                        startFrom = nextArg;
                        logger.debug(`[claudeRemote] Found --resume with session ID: ${startFrom}`);
                        break;
                    } else {
                        logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                        break;
                    }
                } else {
                    logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                    break;
                }
            }
        }
    }

    // Set environment variables for Claude Code SDK
    if (opts.claudeEnvVars) {
        Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
            process.env[key] = value;
        });
    }

    // Get initial message — always wait for user input, even on --resume
    const initial = await opts.nextMessage();
    if (!initial) { // No initial message - exit
        return;
    }

    // ── Per-message Claude account switch (mirrors mid-session model switch) ──────
    // The app carries the selected account's CLAUDE_CONFIG_DIR in message meta.
    // A change flips the mode hash upstream, which tears down the prior query and
    // re-enters claudeRemote here. When the selected account differs from the one
    // the SDK child is currently pointed at, migrate the resumable session file
    // into the new account's config dir (so `resume` preserves conversation
    // context), then repoint CLAUDE_CONFIG_DIR so the freshly-spawned claude child
    // authenticates as the new account. process.env carries the active dir across
    // restarts; claudeEnvVars is updated too so loop.ts:73 re-application stays in
    // sync with the last-selected account (correct prior-dir on the next switch).
    const selectedConfigDir = initial.mode.claudeConfigDir;
    if (selectedConfigDir && selectedConfigDir !== process.env.CLAUDE_CONFIG_DIR) {
        const priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
        if (startFrom && priorConfigDir) {
            try {
                migrateClaudeSessionFile(priorConfigDir, selectedConfigDir, opts.path, startFrom);
            } catch (e) {
                logger.debug(`[claudeRemote] Claude session-file migration failed, context may reset: ${e}`);
            }
        }
        process.env.CLAUDE_CONFIG_DIR = selectedConfigDir;
        if (opts.claudeEnvVars) { opts.claudeEnvVars.CLAUDE_CONFIG_DIR = selectedConfigDir; }
        logger.debug(`[claudeRemote] Claude account switched to config dir: ${selectedConfigDir}`);
    }

    // Report the active account's config dir once per query start (covers the
    // initial account and any post-switch value). Mirrors the currentModelCode
    // emitter: purely additive REPORTING so the app can show the current account
    // in any session. When the env is unset (e.g. daemon default), do not report.
    if (opts.onAccountConfigDir && process.env.CLAUDE_CONFIG_DIR) {
        opts.onAccountConfigDir(process.env.CLAUDE_CONFIG_DIR);
    }

    // Report the current query's SELECTED model + permission keys once per query
    // start (initial + every post-switch/isolate restart). Mirrors the account
    // emitter above: purely additive REPORTING so the app can restore the user's
    // selection cross-device. Only emit non-empty strings (undefined = default,
    // which the app already resolves via its own default fallback).
    if (opts.onModelMode && typeof initial.mode.model === 'string' && initial.mode.model) {
        opts.onModelMode(initial.mode.model);
    }
    if (opts.onPermissionMode && typeof initial.mode.permissionMode === 'string' && initial.mode.permissionMode) {
        opts.onPermissionMode(initial.mode.permissionMode);
    }

    // Handle special commands
    const specialCommand = parseSpecialCommand(initial.message);

    // Handle /clear command
    if (specialCommand.type === 'clear') {
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Context was reset');
        }
        if (opts.onSessionReset) {
            opts.onSessionReset();
        }
        return;
    }

    // Handle /compact command
    let isCompactCommand = false;
    if (specialCommand.type === 'compact') {
        logger.debug('[claudeRemote] /compact command detected - will process as normal but with compaction behavior');
        isCompactCommand = true;
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Compaction started');
        }
    }

    // Prepare SDK options
    let mode = initial.mode;
    const mappedPermissionMode = mapToClaudeMode(initial.mode.permissionMode);
    const sdkOptions: QueryOptions = {
        cwd: opts.path,
        resume: startFrom ?? undefined,
        mcpServers: opts.mcpServers,
        permissionMode: mappedPermissionMode,
        model: initial.mode.model,
        fallbackModel: initial.mode.fallbackModel,
        customSystemPrompt: initial.mode.customSystemPrompt ? initial.mode.customSystemPrompt + '\n\n' + systemPrompt : undefined,
        appendSystemPrompt: initial.mode.appendSystemPrompt ? initial.mode.appendSystemPrompt + '\n\n' + systemPrompt : systemPrompt,
        allowedTools: (initial.mode.allowedTools ? initial.mode.allowedTools.concat(opts.allowedTools) : opts.allowedTools)
            .filter(t => t !== 'ExitPlanMode' && t !== 'exit_plan_mode'),
        disallowedTools: initial.mode.disallowedTools,
        canCallTool: (toolName: string, input: unknown, options: { signal: AbortSignal }) => opts.canCallTool(toolName, input, mode, options),
        executable: opts.jsRuntime ?? 'node',
        abort: opts.signal,
        pathToClaudeCodeExecutable: (() => {
            return resolve(join(projectPath(), 'scripts', 'claude_remote_launcher.cjs'));
        })(),
        settingsPath: opts.hookSettingsPath,
    }

    // Track thinking state
    let thinking = false;
    const updateThinking = (newThinking: boolean) => {
        const prev = thinking;
        logger.info(`[BGTASK-INSTR-7.1][REMOTE-THINKING] sid=${opts.sessionId} prev=${prev} next=${newThinking} ts=${Date.now()}`);
        if (thinking !== newThinking) {
            thinking = newThinking;
            logger.debug(`[claudeRemote] Thinking state changed to: ${thinking}`);
            if (opts.onThinkingChange) { opts.onThinkingChange(thinking); }
        }
    };

    // Push initial message
    let messages = new PushableAsyncIterable<SDKUserMessage>();
    messages.push({
        type: 'user',
        message: {
            role: 'user',
            content: initial.message,
        },
    });

    // Start the loop
    const response = query({
        prompt: messages,
        options: sdkOptions,
    });

    updateThinking(true);
    try {
        logger.debug(`[claudeRemote] Starting to iterate over response`);

        for await (const message of response) {
            logger.debugLargeJson(`[claudeRemote] Message ${message.type}`, message);

            // Handle messages
            opts.onMessage(message);

            // Handle special system messages
            if (message.type === 'system' && message.subtype === 'init') {
                // Start thinking when session initializes
                updateThinking(true);

                const systemInit = message as SDKSystemMessage;

                // Session id is still in memory, wait until session file is written to disk
                // Start a watcher for to detect the session id
                if (systemInit.session_id) {
                    logger.debug(`[claudeRemote] Waiting for session file to be written to disk: ${systemInit.session_id}`);
                    const projectDir = getProjectPath(opts.path);
                    const found = await awaitFileExist(join(projectDir, `${systemInit.session_id}.jsonl`));
                    logger.debug(`[claudeRemote] Session file found: ${systemInit.session_id} ${found}`);
                    opts.onSessionFound(systemInit.session_id);
                }
            }

            // Handle result messages
            if (message.type === 'result') {
                updateThinking(false);
                logger.debug('[claudeRemote] Result received, exiting claudeRemote');

                // Send completion messages
                if (isCompactCommand) {
                    logger.debug('[claudeRemote] Compaction completed');
                    if (opts.onCompletionEvent) {
                        opts.onCompletionEvent('Compaction completed');
                    }
                    isCompactCommand = false;
                }

                // Send ready event
                opts.onReady();

                // Push next message
                const next = await opts.nextMessage();
                if (!next) {
                    messages.end();
                    return;
                }
                mode = next.mode;
                messages.push({ type: 'user', message: { role: 'user', content: next.message } });
            }

            // Handle tool result
            if (message.type === 'user') {
                const msg = message as SDKUserMessage;
                if (msg.message.role === 'user' && Array.isArray(msg.message.content)) {
                    for (let c of msg.message.content) {
                        if (c.type === 'tool_result' && c.tool_use_id && opts.isAborted(c.tool_use_id)) {
                            logger.debug('[claudeRemote] Tool aborted, exiting claudeRemote');
                            return;
                        }
                    }
                }
            }
        }
    } catch (e) {
        if (e instanceof AbortError) {
            logger.debug(`[claudeRemote] Aborted`);
            // Ignore
        } else {
            throw e;
        }
    } finally {
        updateThinking(false);
    }
}