/**
 * Serialization test for codexMappingDaemon (closes codex-Q1 lost-update finding).
 *
 * Two webhooks for the same session within microseconds (initial pending +
 * tid-bound follow-up) MUST NOT lose either update: the controller serializes
 * mutations on a single promise chain.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createCodexMappingDaemonController } from './codexMappingDaemon';
import { readCodexMapping } from './codexMapping';

let workDir: string;
let mappingFile: string;

beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'happy-codex-mapping-daemon-test-'));
    mappingFile = join(workDir, 'codex-mapping.json');
    await mkdir(workDir, { recursive: true });
});

afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
});

function codexMeta(overrides: Record<string, unknown> = {}): any {
    return {
        path: '/tmp/work',
        host: 'test-host',
        homeDir: '/h',
        happyHomeDir: workDir,
        happyLibDir: '/lib',
        happyToolsDir: '/lib/tools',
        flavor: 'codex',
        hostPid: process.pid,
        ...overrides,
    };
}

async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 50));
}

function fireUpserts(controller: ReturnType<typeof createCodexMappingDaemonController>, count: number): void {
    for (let i = 0; i < count; i++) {
        controller.onWebhook(`session-${i}`, codexMeta({ codexThreadId: `tid-${i}` }));
    }
}

function fireRemoves(controller: ReturnType<typeof createCodexMappingDaemonController>, count: number): void {
    for (let i = 0; i < count; i++) {
        controller.onSessionEnd(`session-${i}`);
    }
}

describe('createCodexMappingDaemonController (Q1 serialization)', () => {
    it('serializes two upserts for same session: final state reflects both, no lost update', async () => {
        const controller = createCodexMappingDaemonController(mappingFile);
        controller.onWebhook('session-1', codexMeta());
        controller.onWebhook('session-1', codexMeta({ codexThreadId: 'tid-result' }));
        await settle();
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(1);
        expect(mapping.entries[0].state).toBe('bound');
        expect(mapping.entries[0].codexThreadId).toBe('tid-result');
    });

    it('serializes upsert + remove: remove always wins when issued after upsert', async () => {
        const controller = createCodexMappingDaemonController(mappingFile);
        controller.onWebhook('session-2', codexMeta({ codexThreadId: 'tid-2' }));
        controller.onSessionEnd('session-2');
        await settle();
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(0);
    });

    it('serializes 10 interleaved upserts/removes across different sessions', async () => {
        const controller = createCodexMappingDaemonController(mappingFile);
        fireUpserts(controller, 10);
        fireRemoves(controller, 5);
        await new Promise(resolve => setTimeout(resolve, 100));
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(5);
        const ids = mapping.entries.map(e => e.happySessionId).sort();
        expect(ids).toEqual(['session-5', 'session-6', 'session-7', 'session-8', 'session-9']);
    });

    it('skips non-codex flavor metadata silently', async () => {
        const controller = createCodexMappingDaemonController(mappingFile);
        controller.onWebhook('claude-1', { ...codexMeta(), flavor: 'claude' });
        await new Promise(resolve => setTimeout(resolve, 30));
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(0);
    });

    it('skips when hostPid is missing', async () => {
        const controller = createCodexMappingDaemonController(mappingFile);
        controller.onWebhook('no-pid', { ...codexMeta(), hostPid: undefined });
        await new Promise(resolve => setTimeout(resolve, 30));
        const mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(0);
    });

    it('runStartupSweep removes dead-pid entries before refreshing cache', async () => {
        const controller1 = createCodexMappingDaemonController(mappingFile);
        controller1.onWebhook('dead-session', codexMeta({ hostPid: 999999, codexThreadId: 'tid-dead' }));
        await new Promise(resolve => setTimeout(resolve, 30));
        let mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(1);
        const controller2 = createCodexMappingDaemonController(mappingFile);
        await controller2.runStartupSweep();
        mapping = await readCodexMapping(mappingFile);
        expect(mapping.entries).toHaveLength(0);
    });

    it('getPendingCodexSessionIds returns pending session IDs after refresh', async () => {
        const controller = createCodexMappingDaemonController(mappingFile);
        controller.onWebhook('pending-1', codexMeta());
        await new Promise(resolve => setTimeout(resolve, 30));
        const pending = controller.getPendingCodexSessionIds();
        expect(pending.has('pending-1')).toBe(true);
    });
});

/**
 * M1' — getMappingStats returns derived entry counts + monotonic sweepRemovedCount.
 *
 * The sweepRemovedCount is per-daemon-process and monotonic (increments on each
 * sweep with removals); entryCount/pendingCount/boundCount are point-in-time
 * derived from a fresh read of codex-mapping.json.
 *
 * NOT a replacement for the bash-side fd-scan fallback counter — see
 * codexMappingDaemon.ts MappingStats TSDoc.
 */
describe('getMappingStats (M1 mapping-health telemetry)', () => {
    it('returns zeros for an empty/missing mapping file', async () => {
        const controller = createCodexMappingDaemonController(mappingFile);
        const stats = await controller.getMappingStats();
        expect(stats.entryCount).toBe(0);
        expect(stats.pendingCount).toBe(0);
        expect(stats.boundCount).toBe(0);
        expect(stats.sweepRemovedCount).toBe(0);
    });

    it('counts entries by state after upserts settle', async () => {
        const controller = createCodexMappingDaemonController(mappingFile);
        controller.onWebhook('bound-1', codexMeta({ codexThreadId: 'tid-bound-1' }));
        controller.onWebhook('bound-2', codexMeta({ codexThreadId: 'tid-bound-2' }));
        controller.onWebhook('pending-1', codexMeta());
        await settle();
        const stats = await controller.getMappingStats();
        expect(stats.entryCount).toBe(3);
        expect(stats.boundCount).toBe(2);
        expect(stats.pendingCount).toBe(1);
    });

    it('sweepRemovedCount accumulates across sweeps (monotonic)', async () => {
        // Seed two dead-pid entries via controller#1, then sweep with controller#2 twice.
        const seeder = createCodexMappingDaemonController(mappingFile);
        seeder.onWebhook('dead-1', codexMeta({ hostPid: 999999, codexThreadId: 'tid-d1' }));
        seeder.onWebhook('dead-2', codexMeta({ hostPid: 999998, codexThreadId: 'tid-d2' }));
        await settle();
        const sweeper = createCodexMappingDaemonController(mappingFile);
        await sweeper.runStartupSweep();
        const after1 = await sweeper.getMappingStats();
        expect(after1.sweepRemovedCount).toBeGreaterThanOrEqual(2);
        // Second sweep with no removals — count holds steady (monotonic, not reset).
        await sweeper.runStartupSweep();
        const after2 = await sweeper.getMappingStats();
        expect(after2.sweepRemovedCount).toBe(after1.sweepRemovedCount);
    });

    it('sweepRemovedCount resets per controller (per-daemon-process)', async () => {
        const c1 = createCodexMappingDaemonController(mappingFile);
        c1.onWebhook('dead-isolated', codexMeta({ hostPid: 999997, codexThreadId: 'tid-x' }));
        await settle();
        const sweep1 = createCodexMappingDaemonController(mappingFile);
        await sweep1.runStartupSweep();
        expect((await sweep1.getMappingStats()).sweepRemovedCount).toBeGreaterThanOrEqual(1);
        // Fresh controller — counter is per-process, starts at 0.
        const sweep2 = createCodexMappingDaemonController(mappingFile);
        expect((await sweep2.getMappingStats()).sweepRemovedCount).toBe(0);
    });
});
