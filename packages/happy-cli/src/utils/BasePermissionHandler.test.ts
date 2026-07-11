import { describe, expect, it } from 'vitest';
import { BasePermissionHandler, type PermissionResult } from './BasePermissionHandler';
import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentState } from '@/api/types';

/**
 * Concrete subclass exposing a test-only helper to register a pending request
 * (the base class keeps pendingRequests protected; only a subclass can seed it).
 */
class TestPermissionHandler extends BasePermissionHandler {
    protected getLogPrefix(): string {
        return '[Test]';
    }

    awaitRequest(id: string, toolName: string, input: unknown): Promise<PermissionResult> {
        this.addPendingRequestToState(id, toolName, input);
        return new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject, toolName, input });
        });
    }
}

function makeMockSession() {
    let agentState: AgentState = {};
    const handlers = new Map<string, (params: any) => any>();
    const session = {
        rpcHandlerManager: {
            registerHandler: (name: string, handler: (params: any) => any) => {
                handlers.set(name, handler);
            },
        },
        updateAgentState: (updater: (s: AgentState) => AgentState) => {
            agentState = updater(agentState);
        },
    } as unknown as ApiSessionClient;
    return { session, handlers, getState: () => agentState };
}

describe('BasePermissionHandler — interactive answer persistence', () => {
    it('persists interactive answers into completedRequests on the permission RPC', async () => {
        const { session, handlers, getState } = makeMockSession();
        const handler = new TestPermissionHandler(session);

        const resultPromise = handler.awaitRequest('item-1', 'functions.request_user_input', { questions: [] });
        const permission = handlers.get('permission')!;
        await permission({ id: 'item-1', approved: true, decision: 'approved', answers: { q1: 'Blue', q2: 'Large' } });

        // The pending promise resolves with the relayed answers (producer reply path).
        const result = await resultPromise;
        expect(result.answers).toEqual({ q1: 'Blue', q2: 'Large' });

        // The fix: the answers are ALSO persisted into completedRequests so the
        // answered card survives reload / a second client (app reads completed.answers).
        const completed = getState().completedRequests?.['item-1'];
        expect(completed?.answers).toEqual({ q1: 'Blue', q2: 'Large' });
        expect(completed?.status).toBe('approved');
        // And the pending request is cleared.
        expect(getState().requests?.['item-1']).toBeUndefined();
    });

    it('omits answers for a normal approve (additive — no leak on non-interactive tools)', async () => {
        const { session, handlers, getState } = makeMockSession();
        const handler = new TestPermissionHandler(session);

        const resultPromise = handler.awaitRequest('tool-1', 'Bash', { cmd: 'ls' });
        await handlers.get('permission')!({ id: 'tool-1', approved: true, decision: 'approved' });
        await resultPromise;

        const completed = getState().completedRequests?.['tool-1'];
        expect(completed).toBeDefined();
        expect('answers' in (completed as object)).toBe(false);
    });

    it('does not relay answers on a denied decision', async () => {
        const { session, handlers, getState } = makeMockSession();
        const handler = new TestPermissionHandler(session);

        const resultPromise = handler.awaitRequest('item-2', 'functions.request_user_input', { questions: [] });
        // A denied response carrying stray answers must NOT relay or persist them.
        await handlers.get('permission')!({ id: 'item-2', approved: false, decision: 'denied', answers: { q1: 'Leaked' } });
        const result = await resultPromise;

        expect(result.answers).toBeUndefined();
        const completed = getState().completedRequests?.['item-2'];
        expect(completed?.status).toBe('denied');
        expect('answers' in (completed as object)).toBe(false);
    });
});
