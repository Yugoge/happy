/**
 * Codex Permission Handler
 *
 * Handles tool permission requests and responses for Codex sessions.
 * Extends BasePermissionHandler with Codex-specific configuration.
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import {
    BasePermissionHandler,
    PermissionResult,
    PendingRequest
} from '@/utils/BasePermissionHandler';
import type { ToolRequestUserInputQuestion } from '@/codex/codexAppServerTypes';

// Re-export types for backwards compatibility
export type { PermissionResult, PendingRequest };

/** Tool name the app uses to render the interactive request_user_input card. */
export const REQUEST_USER_INPUT_TOOL = 'functions.request_user_input';

/**
 * Codex-specific permission handler.
 */
export class CodexPermissionHandler extends BasePermissionHandler {
    constructor(session: ApiSessionClient) {
        super(session);
    }

    protected getLogPrefix(): string {
        return '[Codex]';
    }

    /**
     * Handle a tool permission request
     * @param toolCallId - The unique ID of the tool call
     * @param toolName - The name of the tool being called
     * @param input - The input parameters for the tool
     * @returns Promise resolving to permission result
     */
    async handleToolCall(
        toolCallId: string,
        toolName: string,
        input: unknown
    ): Promise<PermissionResult> {
        return new Promise<PermissionResult>((resolve, reject) => {
            // Store the pending request
            this.pendingRequests.set(toolCallId, {
                resolve,
                reject,
                toolName,
                input
            });

            // Update agent state with pending request
            this.addPendingRequestToState(toolCallId, toolName, input);

            logger.debug(`${this.getLogPrefix()} Permission request sent for tool: ${toolName} (${toolCallId})`);
        });
    }

    /**
     * Surface a codex request_user_input question as an interactive answer card.
     *
     * Registers a pending request keyed by the codex itemId (so the app's
     * tool.permission.id round-trips back here) under the functions.request_user_input
     * tool, advertises the askUserQuestionAnswersInPermission capability so the app
     * renders the interactive form instead of a bare approve/deny, and resolves with
     * the answers the user submits over the existing 'permission' RPC.
     *
     * @returns the answersRecord (qid -> selected label(s)) the user submitted, or
     *          null if the request was denied/aborted/reset without answers.
     */
    async handleRequestUserInput(
        itemId: string,
        questions: ToolRequestUserInputQuestion[],
    ): Promise<Record<string, string> | null> {
        const input = { questions };
        const result = await new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(itemId, {
                resolve,
                reject,
                toolName: REQUEST_USER_INPUT_TOOL,
                input,
            });
            // Fast path: emit questions via message stream (ACP tool-call) so the card appears
            // without waiting for AsyncLock + emitWithAck RTT in updateAgentState.
            this.session.sendAgentMessage('codex', {
                type: 'tool-call',
                callId: itemId,
                id: itemId,
                name: REQUEST_USER_INPUT_TOOL,
                input,
            });
            // Merged single updateAgentState: advertises capability + registers request
            // in one RTT instead of two sequential network calls.
            this.session.updateAgentState((currentState) => {
                const currentCaps = currentState.capabilities;
                return {
                    ...currentState,
                    capabilities: {
                        ...(currentCaps && typeof currentCaps === 'object' ? currentCaps : {}),
                        askUserQuestionAnswersInPermission: true,
                    },
                    requests: {
                        ...currentState.requests,
                        [itemId]: {
                            tool: REQUEST_USER_INPUT_TOOL,
                            arguments: input,
                            createdAt: Date.now()
                        }
                    }
                };
            });
            logger.debug(`${this.getLogPrefix()} request_user_input registered (${itemId}, ${questions.length} question(s))`);
        });

        // Only relay answers for an approved/answered decision. A denied or
        // aborted request must NOT leak stale answers back to codex.
        if (result.decision !== 'approved' && result.decision !== 'approved_for_session') {
            return null;
        }
        return result.answers ?? null;
    }

    /**
     * Advertise the askUserQuestionAnswersInPermission capability (the SAME flag
     * Claude sets) so the app renders the interactive answer form. Idempotent.
     */
    private advertiseAnswersCapability(): void {
        this.session.updateAgentState((currentState) => {
            const currentCaps = currentState.capabilities;
            if (currentCaps && currentCaps.askUserQuestionAnswersInPermission === true) {
                return currentState;
            }
            return {
                ...currentState,
                capabilities: {
                    ...(currentCaps && typeof currentCaps === 'object' ? currentCaps : {}),
                    askUserQuestionAnswersInPermission: true,
                },
            };
        });
    }
}