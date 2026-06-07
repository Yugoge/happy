// AC4 (R4, spec-20260520-051938 §5.13): a live image generation must render its
// generated image INLINE in its own result card in Happy (not only via a later
// view_image card).
//
// Root cause (BA/QA + codex 0.130 type verification, dev-20260606-162217):
// the Codex producer emits image_generation_call / image_generation_end in its
// on-disk rollout, with the generated image as a RAW base64 string under `result`
// (captured tier-1 shape: {type:'image_generation_call', id, status, revised_prompt,
// result:<base64 PNG>}). The previously-registered project names
// `mcp__image_gen__imagegen` / `image_gen.imagegen` are GUESSES and appear ZERO
// times as the emitted family. The app-server (codex 0.130) surfaces the SAME tool
// as an item/* notification whose generated ThreadItem variant is
//   { "type": "imageGeneration", id: string, status: string,
//     revisedPrompt: string | null, result: string, savedPath?: AbsolutePathBuf }
// (verified against `codex app-server generate-ts .../v2/ThreadItem.ts`). The
// app-server had NO handler for the imageGeneration item family, so it fell through
// the broad item/* swallow (codexAppServerClient `return method.startsWith('item/')`)
// — no tool-call envelope was ever produced and no inline image rendered.
//
// Additionally, `result` is RAW base64 (not a path/uri) — the existing image
// preview extraction (sessionProtocolMapper buildImageToolResult, IMAGE_BASE64_KEYS)
// does NOT treat `result` as base64, so without explicit normalization the image
// would not surface as a `data:` preview_uri (codex finding 6).
//
// This test asserts the deterministic legs of the producer→renderer path:
//   (1) the app-server handles item/started + item/completed for item.type
//       'imageGeneration' and forwards image_generation_begin / image_generation_end
//       carrying {call_id, status, revisedPrompt, result, savedPath} (under the REAL
//       emitted family, not the guess),
//   (2) the mapper emits a tool-call-start / tool-call-end envelope under a stable
//       registered name (functions.image_generation), normalizing the base64 `result`
//       into a `data:image/png;base64,<...>` preview_uri so CodexAttachmentView
//       renders the image inline,
//   (3) the app registry (knownTools.tsx + view registry _all.tsx) resolves that
//       real name to the image attachment renderer — registry-derived from SOURCE,
//       which FAILS if the registration/route is reverted (the view-registry modules
//       transitively import react-native and cannot load in node-env vitest, the
//       project's blessed substitute for a runtime lookup).
// The final live render is the FINAL_LIVE_GATE (user-observed), not unit-testable.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapCodexMcpMessageToSessionEnvelopes } from './utils/sessionProtocolMapper';

const {
    mockExecSync,
    mockInitializeSandbox,
    mockWrapForMcpTransport,
    mockSpawn,
} = vi.hoisted(() => ({
    mockExecSync: vi.fn(),
    mockInitializeSandbox: vi.fn(),
    mockWrapForMcpTransport: vi.fn(),
    mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
    execSync: mockExecSync,
    spawn: mockSpawn,
}));

vi.mock('@/sandbox/manager', () => ({
    initializeSandbox: mockInitializeSandbox,
    wrapForMcpTransport: mockWrapForMcpTransport,
}));

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../package.json', () => ({
    default: { version: '0.0.1-test' },
}));

type MockRpcMessage = { id?: number; method?: string; params?: any };

function pushJsonLine(stdout: NodeJS.ReadableStream & { push: (chunk: string) => void }, payload: unknown) {
    stdout.push(JSON.stringify(payload) + '\n');
}

function createMockProcess(opts?: {
    pid?: number;
    onRequest?: (msg: MockRpcMessage, stdout: NodeJS.ReadableStream & { push: (chunk: string) => void }) => void;
}) {
    const { Readable, Writable } = require('stream');
    const stdin = new Writable({ write: (_: any, __: any, cb: () => void) => cb() });
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const proc = Object.assign(new (require('events').EventEmitter)(), {
        stdin,
        stdout,
        stderr,
        pid: opts?.pid ?? 12345,
        kill: vi.fn(),
    });
    const origWrite = stdin.write.bind(stdin);
    stdin.write = (data: any, ...args: any[]) => {
        try {
            const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
            if (msg.method === 'initialize' && msg.id != null) {
                setTimeout(() => {
                    pushJsonLine(stdout, { id: msg.id, result: { userAgent: 'test' } });
                }, 5);
            }
            opts?.onRequest?.(msg, stdout);
        } catch {}
        return origWrite(data, ...args);
    };
    return proc;
}

// Real captured tier-1 image-generation shape (~/.codex/sessions/2026/06).
// result is a RAW base64 PNG string (truncated here to a valid, recognizable
// base64 prefix — the producer never path-ifies it).
const RESULT_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAABOYAAATmCAIAAAAKnjl9';
const REVISED_PROMPT = "A simple square test image for UI rendering verification: white background, blue rounded rectangle.";
const IMAGE_GEN_ITEM = {
    type: 'imageGeneration',
    id: 'ig_0fe128d8854bd3d5',
    status: 'completed',
    revisedPrompt: REVISED_PROMPT,
    result: RESULT_BASE64,
    savedPath: '/tmp/generated/happy-test.png',
};

beforeEach(() => {
    vi.clearAllMocks();
    // isAppServerAvailable() shells out to `codex --version`; satisfy it so
    // connect() proceeds (mirrors the AC3 web-search test).
    mockExecSync.mockReturnValue('codex-cli 0.130.0');
});

afterAll(() => {
    vi.restoreAllMocks();
});

describe('AC4 image generation producer emission (app-server imageGeneration item handler)', () => {
    it('handles item/started + item/completed for item.type imageGeneration and forwards image_generation_begin/end with {call_id, status, revisedPrompt, result}', async () => {
        const proc = createMockProcess({
            pid: 4400,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-ig', path: '/tmp/thread-ig' },
                                model: 'gpt-test', modelProvider: 'openai', cwd: '/tmp/project',
                                approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' }, reasoningEffort: null,
                            },
                        });
                    }, 0);
                }
                if (msg.method === 'turn/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: { turn: { id: 'turn-ig', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: { threadId: 'thread-ig', turn: { id: 'turn-ig', items: [], status: 'inProgress', error: null } },
                        });
                        // Real Codex 0.130 app-server family: item.type 'imageGeneration'
                        // { id, status, revisedPrompt, result:<base64>, savedPath? }.
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: { threadId: 'thread-ig', turnId: 'turn-ig', item: { ...IMAGE_GEN_ITEM, status: 'generating' } },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: { threadId: 'thread-ig', turnId: 'turn-ig', item: IMAGE_GEN_ITEM },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-ig', turnId: 'turn-ig',
                                item: { type: 'agentMessage', id: 'final-ig', text: 'done', phase: 'final_answer' },
                            },
                        });
                    }, 0);
                }
            },
        });
        mockSpawn.mockImplementation(() => proc);

        const { CodexAppServerClient } = await import('./codexAppServerClient');
        const client = new CodexAppServerClient();
        const events: Array<Record<string, unknown>> = [];
        client.setEventHandler((msg) => { events.push(msg as Record<string, unknown>); });

        await client.connect();
        await client.startThread({ model: 'gpt-test', cwd: '/tmp/project', approvalPolicy: 'never', sandbox: 'danger-full-access' });
        await expect(client.sendTurnAndWait('image gen forwarding')).resolves.toEqual({ aborted: false });

        const begin = events.find((e) => e.type === 'image_generation_begin' && e.callId === 'ig_0fe128d8854bd3d5');
        const end = events.find((e) => e.type === 'image_generation_end' && e.callId === 'ig_0fe128d8854bd3d5');
        // The imageGeneration family is no longer swallowed by the broad item/* catch-all.
        expect(begin).toBeDefined();
        expect(end).toBeDefined();
        expect((end as Record<string, unknown>).result).toBe(RESULT_BASE64);
        expect((end as Record<string, unknown>).revisedPrompt).toBe(REVISED_PROMPT);
        expect((end as Record<string, unknown>).savedPath).toBe('/tmp/generated/happy-test.png');

        await client.disconnect();
    });
});

describe('AC4 mapper emits an image-generation tool-call envelope under the real name + normalizes base64 result (mapper→renderer path)', () => {
    it('maps image_generation_begin to a tool-call-start under functions.image_generation (NOT the guessed mcp__image_gen__imagegen)', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'image_generation_begin', call_id: 'ig_m1', status: 'generating', revisedPrompt: REVISED_PROMPT },
            { currentTurnId: 'turn-ig-m1' },
        );

        const startEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-start');
        expect(startEnvelope).toBeDefined();
        const ev = startEnvelope!.ev;
        if (ev.t !== 'tool-call-start') throw new Error('Expected tool-call-start');
        // REAL registered name — explicitly NOT the guessed mcp__image_gen__imagegen.
        expect(ev.name).toBe('functions.image_generation');
        expect(ev.name).not.toBe('mcp__image_gen__imagegen');
        expect(ev.name).not.toBe('image_gen.imagegen');
        expect(ev.call).toBe('ig_m1');
    });

    it('maps image_generation_end to a tool-call-end whose result carries the base64 normalized to a data:image/png;base64 preview_uri (codex finding 6)', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'image_generation_end', call_id: 'ig_m1', status: 'completed', revisedPrompt: REVISED_PROMPT, result: RESULT_BASE64 },
            { currentTurnId: 'turn-ig-m1' },
        );
        const endEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-end');
        expect(endEnvelope).toBeDefined();
        const ev = endEnvelope!.ev;
        if (ev.t !== 'tool-call-end') throw new Error('Expected tool-call-end');
        expect(ev.call).toBe('ig_m1');
        // The raw base64 result must be normalized into a browser-loadable data: URI
        // carried on the tool-call-end `result` record (buildImageToolResult →
        // extractAttachmentSummary resultRecord.preview_uri → CodexAttachmentView)
        // so the image renders inline. Existing extraction never treats `result` as base64.
        const res = ev.result as Record<string, unknown> | undefined;
        const previewUri = (res?.preview_uri ?? res?.previewUri) as string | undefined;
        expect(typeof previewUri).toBe('string');
        expect(previewUri).toBe(`data:image/png;base64,${RESULT_BASE64}`);
    });

    it('does not double-prefix a result that already arrives as a data: URI', () => {
        const dataUri = `data:image/png;base64,${RESULT_BASE64}`;
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'image_generation_end', call_id: 'ig_m2', status: 'completed', result: dataUri },
            { currentTurnId: 'turn-ig-m2' },
        );
        const endEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-end');
        const ev = endEnvelope!.ev;
        if (ev.t !== 'tool-call-end') throw new Error('Expected tool-call-end');
        const res = ev.result as Record<string, unknown> | undefined;
        const previewUri = (res?.preview_uri ?? res?.previewUri) as string | undefined;
        expect(previewUri).toBe(dataUri);
    });

    it('drops the raw base64 result key once normalized so it is not carried alongside preview_uri (codex finding 6 — avoid duplicating the multi-MB payload on the result record)', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'image_generation_end', call_id: 'ig_m3', status: 'completed', result: RESULT_BASE64, savedPath: '/tmp/generated/happy-test.png' },
            { currentTurnId: 'turn-ig-m3' },
        );
        const endEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-end');
        const ev = endEnvelope!.ev;
        if (ev.t !== 'tool-call-end') throw new Error('Expected tool-call-end');
        // The browser-loadable preview_uri is preserved (image still renders inline)...
        const res = ev.result as Record<string, unknown> | undefined;
        expect((res?.preview_uri ?? res?.previewUri)).toBe(`data:image/png;base64,${RESULT_BASE64}`);
        // ...but the RAW `result` base64 is no longer ALSO carried on the result
        // record next to preview_uri (it would otherwise be the megabyte payload twice).
        expect(res?.result).toBeUndefined();
    });

    it('falls back to savedPath when a completion carries no base64 result (codex finding 1)', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'image_generation_end', call_id: 'ig_m4', status: 'completed', result: '', savedPath: '/tmp/generated/happy-test.png' },
            { currentTurnId: 'turn-ig-m4' },
        );
        const endEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-end');
        const ev = endEnvelope!.ev;
        if (ev.t !== 'tool-call-end') throw new Error('Expected tool-call-end');
        const res = ev.result as Record<string, unknown> | undefined;
        // The on-disk path is threaded so buildImageToolResult can build a path-based
        // preview (or a path-scoped preview_unavailable_reason) instead of silently
        // dropping the image entirely.
        expect(res?.path).toBe('/tmp/generated/happy-test.png');
    });
});

describe('AC4 app registry resolves the real image-generation name (registry-derived from SOURCE)', () => {
    // The view-registry / knownTools modules transitively import react-native/expo
    // and cannot load in this node-env vitest, so we derive the registration/route
    // from SOURCE — it FAILS if the registration is reverted, exactly like a runtime
    // lookup would (the project's blessed substitute, mirrors the AC3 web-search test).
    const KNOWN_TOOLS_SRC = readFileSync(
        resolve(__dirname, '../../../happy-app/sources/components/tools/knownTools.tsx'),
        'utf8',
    );
    const VIEW_REGISTRY_SRC = readFileSync(
        resolve(__dirname, '../../../happy-app/sources/components/tools/views/_all.tsx'),
        'utf8',
    );

    it('registers the REAL emitted name functions.image_generation as a known tool with minimal:false (so the inline image renders, not short-circuited)', () => {
        const entry = new RegExp(`'functions\\.image_generation':\\s*\\{[\\s\\S]*?minimal:\\s*(true|false)`).exec(KNOWN_TOOLS_SRC);
        expect(entry).toBeTruthy();
        // minimal:false so shouldRenderToolContent does NOT short-circuit and the
        // generated image renders inline (mirrors the mcp__image_gen__imagegen entry).
        expect(entry![1]).toBe('false');
    });

    it('routes functions.image_generation to CodexAttachmentView in BOTH the inline and full view registries', () => {
        expect(/'functions\.image_generation':\s*CodexAttachmentView/.test(VIEW_REGISTRY_SRC)).toBe(true);
        // It must appear in both registry objects (inline toolViewRegistry + toolFullViewRegistry).
        const occurrences = VIEW_REGISTRY_SRC.match(/'functions\.image_generation':\s*CodexAttachmentView/g) ?? [];
        expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
});
