import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';

import { canonicalizeClaudeConfigDir } from './utils/claudeConfigDir';

// notifyDaemonSessionStarted is fired as a side effect inside the updateMetadata
// reducer; mock it so the reducer can run without a live daemon.
vi.mock('@/daemon/controlClient', () => ({
    notifyDaemonSessionStarted: vi.fn(() => Promise.resolve({})),
}));

import { Session } from './session';

function buildSession(updateMetadata: (h: (m: Metadata) => Metadata) => void) {
    const client = {
        sessionId: 'happy-sid',
        keepAlive: vi.fn(),
        updateMetadata: vi.fn(updateMetadata),
    };
    const session = new Session({
        api: {} as any,
        client: client as any,
        path: '/tmp/repo',
        logPath: '/tmp/repo/log',
        sessionId: null,
        mcpServers: {},
        messageQueue: {} as any,
        onModeChange: () => {},
        hookSettingsPath: '/tmp/repo/settings.json',
    });
    return { session, client };
}

const sampleMetadata: Metadata = {
    path: '/tmp/repo',
    host: 'localhost',
    homeDir: '/tmp',
    happyHomeDir: '/tmp/.happy',
    happyLibDir: '/tmp/happy',
    happyToolsDir: '/tmp/happy/tools',
};

describe('Session.onSessionFound atomic binding (M5a / AC10)', () => {
    let savedConfigDir: string | undefined;
    beforeEach(() => { savedConfigDir = process.env.CLAUDE_CONFIG_DIR; });
    afterEach(() => {
        if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
    });

    it('writes both claudeSessionId and canonical currentClaudeConfigDir in ONE updateMetadata call', () => {
        process.env.CLAUDE_CONFIG_DIR = '/root/.happy-dev-a/.claude/';
        let captured: ((m: Metadata) => Metadata) | undefined;
        const { session, client } = buildSession((handler) => { captured = handler; });
        try {
            session.onSessionFound('claude-sid-123');
            expect(client.updateMetadata).toHaveBeenCalledTimes(1);
            expect(captured).toBeDefined();
            const result = captured!(sampleMetadata);
            expect(result).toMatchObject({
                claudeSessionId: 'claude-sid-123',
                currentClaudeConfigDir: canonicalizeClaudeConfigDir('/root/.happy-dev-a/.claude/'),
            });
        } finally {
            session.cleanup();
        }
    });

    it('omits currentClaudeConfigDir when CLAUDE_CONFIG_DIR is unset (single-account no-op)', () => {
        delete process.env.CLAUDE_CONFIG_DIR;
        let captured: ((m: Metadata) => Metadata) | undefined;
        const { session, client } = buildSession((handler) => { captured = handler; });
        try {
            session.onSessionFound('claude-sid-456');
            expect(client.updateMetadata).toHaveBeenCalledTimes(1);
            const result = captured!(sampleMetadata);
            expect(result.claudeSessionId).toBe('claude-sid-456');
            expect(result.currentClaudeConfigDir).toBeUndefined();
        } finally {
            session.cleanup();
        }
    });
});
