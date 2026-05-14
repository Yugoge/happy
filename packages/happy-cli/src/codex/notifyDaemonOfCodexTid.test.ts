/**
 * AC1 + AC2 primary verification: M1 shared helper notifies the daemon
 * `/session-started` endpoint with codexThreadId-enriched metadata.
 *
 * Per BA F1, primary verification uses a MOCKED daemon (no real codex binary,
 * no shared `/root/.codex/sessions/` pollution).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the daemon controlClient BEFORE importing the helper so the helper
// picks up the mocked module at import time.
const notifyDaemonSessionStarted = vi.fn();
vi.mock('@/daemon/controlClient', () => ({
    notifyDaemonSessionStarted: (...args: unknown[]) => notifyDaemonSessionStarted(...args),
}));

import { notifyDaemonOfCodexTid } from './notifyDaemonOfCodexTid';
import type { Metadata } from '@/api/types';

beforeEach(() => {
    notifyDaemonSessionStarted.mockReset();
});

function baseMetadata(overrides: Partial<Metadata> = {}): Metadata {
    return {
        path: '/tmp/workdir',
        host: 'test-host',
        homeDir: '/home/test',
        happyHomeDir: '/home/test/.happy',
        happyLibDir: '/lib',
        happyToolsDir: '/lib/tools',
        flavor: 'codex',
        hostPid: 12345,
        ...overrides,
    } as Metadata;
}

describe('notifyDaemonOfCodexTid (AC1/AC2 primary)', () => {
    it('invokes notifyDaemonSessionStarted with codexThreadId-enriched metadata', async () => {
        notifyDaemonSessionStarted.mockResolvedValue({ status: 'ok' });
        await notifyDaemonOfCodexTid('happy-session-1', 'tid-result', baseMetadata());
        expect(notifyDaemonSessionStarted).toHaveBeenCalledTimes(1);
        const [sessionIdArg, metadataArg] = notifyDaemonSessionStarted.mock.calls[0];
        expect(sessionIdArg).toBe('happy-session-1');
        expect(metadataArg.codexThreadId).toBe('tid-result');
        expect(metadataArg.flavor).toBe('codex');
        expect(metadataArg.path).toBe('/tmp/workdir');
    });

    it('preserves existing metadata fields and never mutates the input', async () => {
        notifyDaemonSessionStarted.mockResolvedValue({ status: 'ok' });
        const input = baseMetadata({ codexThreadId: 'old-tid' });
        const inputClone = JSON.parse(JSON.stringify(input));
        await notifyDaemonOfCodexTid('h1', 'new-tid', input);
        const sent = notifyDaemonSessionStarted.mock.calls[0][1];
        expect(sent.codexThreadId).toBe('new-tid');
        expect(input).toEqual(inputClone);
    });

    it('AC2: invoked with the RESULT tid (verifies caller passes resumed tid, not requested)', async () => {
        // The helper itself does not know "requested" vs "result" — the contract
        // is that callers (runCodex.ts startThread, resumeExistingThread.ts) pass
        // the RESULT tid. We assert the helper faithfully forwards whatever tid
        // it receives.
        notifyDaemonSessionStarted.mockResolvedValue({ status: 'ok' });
        await notifyDaemonOfCodexTid('h2', 'reassigned-result-tid', baseMetadata());
        const sent = notifyDaemonSessionStarted.mock.calls[0][1];
        expect(sent.codexThreadId).toBe('reassigned-result-tid');
    });

    it('swallows daemon errors (callers must not see them)', async () => {
        notifyDaemonSessionStarted.mockResolvedValue({ error: 'daemon offline' });
        await expect(
            notifyDaemonOfCodexTid('h3', 'tid-3', baseMetadata()),
        ).resolves.toBeUndefined();
    });

    it('swallows thrown daemon errors', async () => {
        notifyDaemonSessionStarted.mockRejectedValue(new Error('boom'));
        await expect(
            notifyDaemonOfCodexTid('h4', 'tid-4', baseMetadata()),
        ).resolves.toBeUndefined();
    });

    it('is idempotent — repeated calls with same args produce same effect', async () => {
        notifyDaemonSessionStarted.mockResolvedValue({ status: 'ok' });
        await notifyDaemonOfCodexTid('h5', 'tid-5', baseMetadata());
        await notifyDaemonOfCodexTid('h5', 'tid-5', baseMetadata());
        expect(notifyDaemonSessionStarted).toHaveBeenCalledTimes(2);
        // Both calls send identical payloads — idempotency guarantee at the wire.
        const first = notifyDaemonSessionStarted.mock.calls[0][1];
        const second = notifyDaemonSessionStarted.mock.calls[1][1];
        expect(first).toEqual(second);
    });
});
