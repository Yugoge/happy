/**
 * Tests for Cycle 10 M3' — currentModelCode emission on the normal
 * Claude SDK path.
 */

import { describe, it, expect } from 'vitest';
import { maybeEmitCurrentModelCode, createCurrentModelCodeEmitter, MetadataUpdater } from './currentModelCodeEmitter';
import { SDKMessage } from '../sdk';
import { Metadata } from '@/api/types';

function makeUpdater(initial: Metadata): { snapshot: () => Metadata; updater: MetadataUpdater; calls: number } {
    let current: Metadata = { ...initial };
    let calls = 0;
    const updater: MetadataUpdater = (fn) => {
        calls += 1;
        current = fn(current);
    };
    return {
        snapshot: () => current,
        updater,
        get calls() { return calls; },
    } as any;
}

const baseMetadata: Metadata = {
    path: '/tmp/work',
    host: 'test-host',
    homeDir: '/root',
    happyHomeDir: '/root/.happy',
    happyLibDir: '/root/lib',
    happyToolsDir: '/root/lib/tools',
};

describe('maybeEmitCurrentModelCode (Cycle 10 M3\')', () => {
    it('writes currentModelCode when system/init carries a model field', () => {
        const harness = makeUpdater(baseMetadata);
        const msg: SDKMessage = {
            type: 'system',
            subtype: 'init',
            model: 'claude-sonnet-4.5',
            session_id: 'abc',
        } as any;
        maybeEmitCurrentModelCode(msg, harness.updater);
        expect(harness.snapshot().currentModelCode).toBe('claude-sonnet-4.5');
    });

    it('writes 1M-marker model code so app-side resolveContextWindow detects 1M', () => {
        const harness = makeUpdater(baseMetadata);
        const msg: SDKMessage = {
            type: 'system',
            subtype: 'init',
            model: 'claude-opus-4-7-1m',
        } as any;
        maybeEmitCurrentModelCode(msg, harness.updater);
        expect(harness.snapshot().currentModelCode).toBe('claude-opus-4-7-1m');
    });

    it('ignores system messages with non-init subtype', () => {
        const harness = makeUpdater(baseMetadata);
        const msg: SDKMessage = {
            type: 'system',
            subtype: 'something-else',
            model: 'claude-sonnet',
        } as any;
        maybeEmitCurrentModelCode(msg, harness.updater);
        expect(harness.snapshot().currentModelCode).toBeUndefined();
    });

    it('ignores non-system messages entirely', () => {
        const harness = makeUpdater(baseMetadata);
        const msg: SDKMessage = {
            type: 'assistant',
            message: { role: 'assistant', content: [] },
        } as any;
        maybeEmitCurrentModelCode(msg, harness.updater);
        expect(harness.snapshot().currentModelCode).toBeUndefined();
    });

    it('ignores system/init when model is missing or empty', () => {
        const harness = makeUpdater(baseMetadata);
        maybeEmitCurrentModelCode({ type: 'system', subtype: 'init' } as any, harness.updater);
        maybeEmitCurrentModelCode({ type: 'system', subtype: 'init', model: '' } as any, harness.updater);
        expect(harness.snapshot().currentModelCode).toBeUndefined();
    });

    it('preserves other metadata fields on update (immutable spread)', () => {
        const harness = makeUpdater({ ...baseMetadata, machineId: 'mac-xyz', flavor: 'claude' });
        const msg: SDKMessage = {
            type: 'system',
            subtype: 'init',
            model: 'claude-sonnet',
        } as any;
        maybeEmitCurrentModelCode(msg, harness.updater);
        const snap = harness.snapshot();
        expect(snap.currentModelCode).toBe('claude-sonnet');
        expect(snap.machineId).toBe('mac-xyz');
        expect(snap.flavor).toBe('claude');
        expect(snap.path).toBe('/tmp/work');
    });

    it('is idempotent — does not invoke updater when value unchanged', () => {
        const harness = makeUpdater({ ...baseMetadata, currentModelCode: 'claude-sonnet' });
        const msg: SDKMessage = {
            type: 'system',
            subtype: 'init',
            model: 'claude-sonnet',
        } as any;
        // First call: same value
        maybeEmitCurrentModelCode(msg, harness.updater);
        // The updater is called once but the returned object is === current.
        expect(harness.snapshot().currentModelCode).toBe('claude-sonnet');
    });

    it('overwrites when SDK reports a different model code (e.g., model swap)', () => {
        const harness = makeUpdater({ ...baseMetadata, currentModelCode: 'claude-sonnet' });
        maybeEmitCurrentModelCode(
            { type: 'system', subtype: 'init', model: 'claude-opus-4-7-1m' } as any,
            harness.updater,
        );
        expect(harness.snapshot().currentModelCode).toBe('claude-opus-4-7-1m');
    });
});

describe('createCurrentModelCodeEmitter (Cycle 10 M3\' — version-churn cache)', () => {
    function makeStatefulHarness(initial: Metadata) {
        let current: Metadata = { ...initial };
        let calls = 0;
        const updater: MetadataUpdater = (fn) => {
            calls += 1;
            current = fn(current);
        };
        return {
            snapshot: () => current,
            updater,
            calls: () => calls,
        };
    }

    it('emits exactly once for repeated identical system/init model values', () => {
        const harness = makeStatefulHarness(baseMetadata);
        const emitter = createCurrentModelCodeEmitter(harness.updater);
        const msg: SDKMessage = { type: 'system', subtype: 'init', model: 'claude-sonnet' } as any;
        emitter.onMessage(msg);
        emitter.onMessage(msg);
        emitter.onMessage(msg);
        expect(harness.calls()).toBe(1);
        expect(harness.snapshot().currentModelCode).toBe('claude-sonnet');
    });

    it('re-emits when the model code changes mid-session (model swap)', () => {
        const harness = makeStatefulHarness(baseMetadata);
        const emitter = createCurrentModelCodeEmitter(harness.updater);
        emitter.onMessage({ type: 'system', subtype: 'init', model: 'claude-sonnet' } as any);
        emitter.onMessage({ type: 'system', subtype: 'init', model: 'claude-opus-4-7-1m' } as any);
        expect(harness.calls()).toBe(2);
        expect(harness.snapshot().currentModelCode).toBe('claude-opus-4-7-1m');
    });

    it('reset() clears the cache so the next emit fires again', () => {
        const harness = makeStatefulHarness(baseMetadata);
        const emitter = createCurrentModelCodeEmitter(harness.updater);
        emitter.onMessage({ type: 'system', subtype: 'init', model: 'claude-sonnet' } as any);
        emitter.reset();
        emitter.onMessage({ type: 'system', subtype: 'init', model: 'claude-sonnet' } as any);
        expect(harness.calls()).toBe(2);
    });

    it('ignores non-system / non-init / empty model messages without bumping cache', () => {
        const harness = makeStatefulHarness(baseMetadata);
        const emitter = createCurrentModelCodeEmitter(harness.updater);
        emitter.onMessage({ type: 'assistant', message: { role: 'assistant', content: [] } } as any);
        emitter.onMessage({ type: 'system', subtype: 'something-else', model: 'x' } as any);
        emitter.onMessage({ type: 'system', subtype: 'init' } as any);
        emitter.onMessage({ type: 'system', subtype: 'init', model: '' } as any);
        expect(harness.calls()).toBe(0);
        expect(harness.snapshot().currentModelCode).toBeUndefined();
    });
});
