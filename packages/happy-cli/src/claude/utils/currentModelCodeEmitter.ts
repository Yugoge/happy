/**
 * Cycle 10 M3' — currentModelCode emitter for the normal Claude SDK path.
 *
 * Captures the running model identifier from the SDK `system/init` message
 * and writes it into session metadata via the supplied updater. Mirrors the
 * ACP path's emission semantics in
 * `agent/acp/sessionConfigMetadata.ts:202` so the happy-app's
 * `resolveContextWindow()` helper can pick the correct denominator
 * (200K vs 1M) for the context-remaining indicator on the normal Claude
 * SDK path.
 *
 * The schema field `Metadata.currentModelCode?: string` already exists at
 * `api/types.ts:268` — no new server schema, no Zod change.
 *
 * Implementation note: `ApiSessionClient.updateMetadata()` always emits an
 * update + bumps the metadata version on the server, even if the handler
 * returns the same reference. To avoid wasteful version churn for the
 * common case where `system/init` reports the same model on every restart
 * of a long-running session, we short-circuit before touching
 * `updateMetadata` using a small per-emitter cache
 * (`createCurrentModelCodeEmitter`).
 */

import { SDKMessage, SDKSystemMessage } from "../sdk";
import { Metadata } from "@/api/types";

export type MetadataUpdater = (updater: (metadata: Metadata) => Metadata) => void;

export interface CurrentModelCodeEmitter {
    onMessage(message: SDKMessage): void;
    /** Test hook: reset the per-emitter cache. Production code does not call this. */
    reset(): void;
}

function extractInitModel(message: SDKMessage): string | undefined {
    if (message.type !== 'system') return undefined;
    const sys = message as SDKSystemMessage;
    if (sys.subtype !== 'init') return undefined;
    const model = typeof sys.model === 'string' ? sys.model : undefined;
    if (!model || model.length === 0) return undefined;
    return model;
}

function buildSetCurrentModelCode(model: string) {
    return (metadata: Metadata): Metadata => {
        if (metadata.currentModelCode === model) return metadata;
        return { ...metadata, currentModelCode: model };
    };
}

/**
 * Build a stateful emitter that tracks the most recently emitted model code
 * so it does not invoke `updateMetadata` (and therefore does not bump the
 * server-side metadata version) when the SDK reports an unchanged value.
 */
export function createCurrentModelCodeEmitter(updateMetadata: MetadataUpdater): CurrentModelCodeEmitter {
    let lastEmitted: string | undefined;
    function onMessage(message: SDKMessage): void {
        const model = extractInitModel(message);
        if (!model) return;
        if (lastEmitted === model) return;
        lastEmitted = model;
        updateMetadata(buildSetCurrentModelCode(model));
    }
    function reset(): void {
        lastEmitted = undefined;
    }
    return { onMessage, reset };
}

/**
 * One-shot helper retained for ergonomics in unit tests and as the simplest
 * stateless surface. Production code uses `createCurrentModelCodeEmitter()`
 * to also avoid metadata-version churn on identical re-emits within the same
 * session lifetime.
 */
export function maybeEmitCurrentModelCode(message: SDKMessage, updateMetadata: MetadataUpdater): void {
    const model = extractInitModel(message);
    if (!model) return;
    updateMetadata(buildSetCurrentModelCode(model));
}
