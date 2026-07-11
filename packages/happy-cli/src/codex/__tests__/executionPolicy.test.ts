import { describe, expect, it } from 'vitest';
import { resolveCodexExecutionPolicy } from '../executionPolicy';

describe('resolveCodexExecutionPolicy', () => {
    it('forces never + danger-full-access when sandbox is managed by Happy', () => {
        const policy = resolveCodexExecutionPolicy('default', true);

        expect(policy).toEqual({
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });
    });

    it('maps codex default mode to untrusted + workspace-write without managed sandbox', () => {
        const policy = resolveCodexExecutionPolicy('default', false);

        expect(policy).toEqual({
            approvalPolicy: 'untrusted',
            sandbox: 'workspace-write',
        });
    });

    it('maps read-only mode to never + read-only without managed sandbox', () => {
        const policy = resolveCodexExecutionPolicy('read-only', false);

        expect(policy).toEqual({
            approvalPolicy: 'never',
            sandbox: 'read-only',
        });
    });

    it('maps yolo mode to never + danger-full-access without managed sandbox', () => {
        const policy = resolveCodexExecutionPolicy('yolo', false);

        expect(policy).toEqual({
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });
    });

    it('maps bypassPermissions to never + danger-full-access without managed sandbox', () => {
        const policy = resolveCodexExecutionPolicy('bypassPermissions', false);

        expect(policy).toEqual({
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        });
    });

    // AC-C1: collaborationMode='plan' ONLY when permissionMode==='plan'
    it("emits collaborationMode='plan' only in plan mode (unmanaged sandbox)", () => {
        const policy = resolveCodexExecutionPolicy('plan', false);

        expect(policy.collaborationMode).toBe('plan');
        // Must NOT regress the existing plan-mode approval/sandbox mapping.
        expect(policy.approvalPolicy).toBe('untrusted');
        expect(policy.sandbox).toBe('workspace-write');
    });

    it("emits collaborationMode='plan' in plan mode even when sandbox is managed by Happy", () => {
        const policy = resolveCodexExecutionPolicy('plan', true);

        expect(policy).toEqual({
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
            collaborationMode: 'plan',
        });
    });

    it('omits collaborationMode for every non-plan permission mode', () => {
        const nonPlanModes = [
            'default',
            'read-only',
            'safe-yolo',
            'yolo',
            'bypassPermissions',
            'acceptEdits',
        ] as const;

        for (const mode of nonPlanModes) {
            expect(resolveCodexExecutionPolicy(mode, false).collaborationMode).toBeUndefined();
            expect(resolveCodexExecutionPolicy(mode, true).collaborationMode).toBeUndefined();
            // The collaborationMode key must be entirely absent (not present-with-undefined).
            expect('collaborationMode' in resolveCodexExecutionPolicy(mode, false)).toBe(false);
        }
    });
});
