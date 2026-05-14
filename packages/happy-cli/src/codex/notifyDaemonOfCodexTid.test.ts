/**
 * AC1 + AC2 primary verification: M1 shared helper notifies the daemon
 * `/session-started` endpoint with codexThreadId-enriched metadata.
 *
 * Per BA F1, primary verification uses a MOCKED daemon (no real codex binary,
 * no shared `/root/.codex/sessions/` pollution).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the daemon controlClient BEFORE importing the helper so the helper
// picks up the mocked module at import time.
const notifyDaemonSessionStarted = vi.fn();
vi.mock('@/daemon/controlClient', () => ({
    notifyDaemonSessionStarted: (...args: unknown[]) => notifyDaemonSessionStarted(...args),
}));

import { notifyDaemonOfCodexTid } from './notifyDaemonOfCodexTid';
import type { Metadata } from '@/api/types';

// M2' — restore process.title after each test so suites running later (e.g.,
// resumeExistingThread.test.ts which calls the real helper through a mocked
// controlClient) don't inherit leaked state from this suite.
let originalProcessTitle: string;

beforeEach(() => {
    notifyDaemonSessionStarted.mockReset();
    originalProcessTitle = process.title;
});

afterEach(() => {
    process.title = originalProcessTitle;
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

/**
 * M2' — process.title parity tests.
 *
 * Codex round-1 verdict: use tid.slice(-8) (random/sequence TAIL of UUIDv7),
 * NOT tid.slice(0,8) which would collide on the millisecond-timestamp prefix.
 *
 * AC3: helper sets process.title to `happy-codex:<last 8 chars of tid>` and
 * propagates regardless of daemon-notify outcome (best-effort).
 */
describe('notifyDaemonOfCodexTid process.title (M2)', () => {
    it("sets process.title to 'happy-codex:<last 8 chars of tid>'", async () => {
        notifyDaemonSessionStarted.mockResolvedValue({ status: 'ok' });
        const tid = '0192abcd-AAAA-BBBB-CCCC-DDDDEEEEFFFF';
        await notifyDaemonOfCodexTid('h-title-1', tid, baseMetadata());
        expect(process.title).toBe('happy-codex:EEEEFFFF');
    });

    it('AC3: uses TAIL slice (-8), NOT prefix slice(0,8)', async () => {
        notifyDaemonSessionStarted.mockResolvedValue({ status: 'ok' });
        const tid = '0192abcd-AAAA-BBBB-CCCC-DDDDEEEEFFFF';
        await notifyDaemonOfCodexTid('h-title-2', tid, baseMetadata());
        // Negative assertion: must NOT be the first 8 chars (which would be
        // millisecond-timestamp-heavy and collision-prone).
        expect(process.title).not.toBe('happy-codex:0192abcd');
        expect(process.title).toBe('happy-codex:EEEEFFFF');
    });

    it('sets title even when daemon notify returns an error', async () => {
        notifyDaemonSessionStarted.mockResolvedValue({ error: 'daemon offline' });
        await notifyDaemonOfCodexTid('h-title-3', 'abcdef0123456789', baseMetadata());
        expect(process.title).toBe('happy-codex:23456789');
    });

    it('sets title even when daemon notify throws', async () => {
        notifyDaemonSessionStarted.mockRejectedValue(new Error('boom'));
        await notifyDaemonOfCodexTid('h-title-4', 'abcdef0123456789', baseMetadata());
        expect(process.title).toBe('happy-codex:23456789');
    });

    it('handles short tids (slice(-8) on <8 chars yields whole string)', async () => {
        notifyDaemonSessionStarted.mockResolvedValue({ status: 'ok' });
        await notifyDaemonOfCodexTid('h-title-5', 'short', baseMetadata());
        // String#slice(-8) on a 5-char string returns the whole string.
        expect(process.title).toBe('happy-codex:short');
    });
});
