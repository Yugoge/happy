/**
 * AC4 tests: /list responds with schemaVersion=2 and ADDITIVE optional fields.
 * Hidden consumers (destructuring `{ happySessionId, pid, startedBy }`) continue
 * to work because the new fields are optional and additive.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { startDaemonControlServer, CONTROL_LIST_SCHEMA_VERSION } from './controlServer';
import type { TrackedSession } from './types';

describe('startDaemonControlServer /list (AC4 v2 additive schema)', () => {
    let stop: () => Promise<void>;
    let port: number;
    let trackedSessions: TrackedSession[];
    let pending: Set<string>;

    beforeEach(async () => {
        trackedSessions = [];
        pending = new Set();
        const server = await startDaemonControlServer({
            getChildren: () => trackedSessions,
            getPendingCodexSessionIds: () => pending,
            stopSession: () => true,
            spawnSession: async () => ({ type: 'error', errorMessage: 'noop' }),
            requestShutdown: () => undefined,
            onHappySessionWebhook: () => undefined,
        });
        port = server.port;
        stop = server.stop;
    });

    afterEach(async () => {
        await stop();
    });

    async function callList(): Promise<any> {
        const response = await fetch(`http://127.0.0.1:${port}/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        return await response.json();
    }

    it('exposes schemaVersion=2 at response root', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            happySessionId: 'h-claude-1',
            happySessionMetadataFromLocalWebhook: {
                path: '/tmp', host: 'x', homeDir: '/h', happyHomeDir: '/h/.happy',
                happyLibDir: '/lib', happyToolsDir: '/lib/tools', flavor: 'claude',
                claudeSessionId: 'cl-uuid-1', hostPid: 1,
            } as any,
            pid: 1,
        });
        const body = await callList();
        expect(body.schemaVersion).toBe(CONTROL_LIST_SCHEMA_VERSION);
    });

    it('emits claude row with flavor=claude and claudeSessionId preserved', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            happySessionId: 'h-claude-2',
            happySessionMetadataFromLocalWebhook: {
                path: '/tmp', host: 'x', homeDir: '/h', happyHomeDir: '/h/.happy',
                happyLibDir: '/lib', happyToolsDir: '/lib/tools', flavor: 'claude',
                claudeSessionId: 'cl-uuid-2', hostPid: 2,
            } as any,
            pid: 2,
        });
        const body = await callList();
        const row = body.children.find((c: any) => c.happySessionId === 'h-claude-2');
        expect(row.flavor).toBe('claude');
        expect(row.claudeSessionId).toBe('cl-uuid-2');
        expect(row.codexThreadId).toBeUndefined();
        expect(row.tidPending).toBeUndefined();
    });

    it('emits codex row with flavor=codex + codexThreadId when bound', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            happySessionId: 'h-codex-1',
            happySessionMetadataFromLocalWebhook: {
                path: '/tmp/work', host: 'x', homeDir: '/h', happyHomeDir: '/h/.happy',
                happyLibDir: '/lib', happyToolsDir: '/lib/tools', flavor: 'codex',
                codexThreadId: '019d-tid-1', hostPid: 3,
            } as any,
            pid: 3,
        });
        const body = await callList();
        const row = body.children.find((c: any) => c.happySessionId === 'h-codex-1');
        expect(row.flavor).toBe('codex');
        expect(row.codexThreadId).toBe('019d-tid-1');
        expect(row.cwd).toBe('/tmp/work');
        expect(row.tidPending).toBe(false);
    });

    it('marks codex row tidPending=true when codexThreadId is absent', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            happySessionId: 'h-codex-pending',
            happySessionMetadataFromLocalWebhook: {
                path: '/tmp/work', host: 'x', homeDir: '/h', happyHomeDir: '/h/.happy',
                happyLibDir: '/lib', happyToolsDir: '/lib/tools', flavor: 'codex', hostPid: 4,
            } as any,
            pid: 4,
        });
        const body = await callList();
        const row = body.children.find((c: any) => c.happySessionId === 'h-codex-pending');
        expect(row.tidPending).toBe(true);
        expect(row.codexThreadId).toBeUndefined();
    });

    it('marks codex row tidPending=true when mapping-file pending set includes id', async () => {
        pending.add('h-codex-mapped-pending');
        trackedSessions.push({
            startedBy: 'daemon',
            happySessionId: 'h-codex-mapped-pending',
            happySessionMetadataFromLocalWebhook: {
                path: '/tmp', host: 'x', homeDir: '/h', happyHomeDir: '/h/.happy',
                happyLibDir: '/lib', happyToolsDir: '/lib/tools', flavor: 'codex',
                codexThreadId: 'some-tid', hostPid: 5,
            } as any,
            pid: 5,
        });
        const body = await callList();
        const row = body.children.find((c: any) => c.happySessionId === 'h-codex-mapped-pending');
        expect(row.tidPending).toBe(true);
    });

    it('hidden consumer destructure { happySessionId, pid, startedBy } still works (additive backward compat)', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            happySessionId: 'h-additive',
            happySessionMetadataFromLocalWebhook: {
                path: '/tmp', host: 'x', homeDir: '/h', happyHomeDir: '/h/.happy',
                happyLibDir: '/lib', happyToolsDir: '/lib/tools', flavor: 'claude',
                claudeSessionId: 'cl-add', hostPid: 6,
            } as any,
            pid: 6,
        });
        const body = await callList();
        const sessions = body.children.map((c: any) => ({
            happySessionId: c.happySessionId,
            pid: c.pid,
            startedBy: c.startedBy,
        }));
        expect(sessions.find((s: any) => s.happySessionId === 'h-additive')).toEqual({
            happySessionId: 'h-additive',
            pid: 6,
            startedBy: 'daemon',
        });
    });

    it('maps unknown flavor values to "unknown" (defensive)', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            happySessionId: 'h-unknown',
            happySessionMetadataFromLocalWebhook: {
                path: '/tmp', host: 'x', homeDir: '/h', happyHomeDir: '/h/.happy',
                happyLibDir: '/lib', happyToolsDir: '/lib/tools', flavor: 'futurething', hostPid: 7,
            } as any,
            pid: 7,
        });
        const body = await callList();
        const row = body.children.find((c: any) => c.happySessionId === 'h-unknown');
        expect(row.flavor).toBe('unknown');
    });

    it('omits flavor when metadata has no flavor (treated as implicit claude by consumers)', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            happySessionId: 'h-no-flavor',
            happySessionMetadataFromLocalWebhook: {
                path: '/tmp', host: 'x', homeDir: '/h', happyHomeDir: '/h/.happy',
                happyLibDir: '/lib', happyToolsDir: '/lib/tools', hostPid: 8,
            } as any,
            pid: 8,
        });
        const body = await callList();
        const row = body.children.find((c: any) => c.happySessionId === 'h-no-flavor');
        expect(row.flavor).toBeUndefined();
    });
});
