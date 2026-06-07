// AC3 (R3, spec-20260520-051938 §5.13): a live web search must render a visible
// tool-call card in Happy.
//
// Root cause (BA/QA + codex 0.130 type verification, dev-20260606-162217):
// the Codex producer emits web_search_call / web_search_end in its on-disk
// rollout (web_search_call as a response_item {type,status,action}; web_search_end
// as an event_msg {call_id,query,action}). The app-server (codex 0.130) surfaces
// the SAME tool as an item/* notification whose generated ThreadItem variant is
//   { "type": "webSearch", id: string, query: string, action: WebSearchAction|null }
// (verified against `codex app-server generate-ts .../v2/ThreadItem.ts`). The
// previously-registered project name `web.search_query` is a GUESS and appears
// ZERO times as an emitted name. The app-server had NO handler for the webSearch
// item family, so it fell through the broad item/* swallow (codexAppServerClient
// :660 `return method.startsWith('item/')`) — no tool-call envelope was ever
// produced and no card rendered.
//
// WebSearchAction (codex 0.130, generated ts-rs type — snake_case discriminants,
// verified against WebSearchAction.ts) is one of:
//   { type:'search',       query, queries } |
//   { type:'open_page',    url } |
//   { type:'find_in_page', url, pattern } |
//   { type:'other' }
//
// This test asserts the deterministic legs of the producer→renderer path:
//   (1) the app-server handles item/started + item/completed for item.type
//       'webSearch' and forwards web_search_begin / web_search_end carrying
//       {call_id, query, action} (under the REAL emitted family, not the guess),
//   (2) the mapper emits a tool-call-start / tool-call-end envelope under a stable
//       registered name (functions.web_search) carrying the query/action,
//   (3) the app registry (knownTools.tsx) resolves that real name to a renderer
//       (header chip minimum carrying the query) — registry-derived from SOURCE,
//       which FAILS if the registration is reverted (the view-registry modules
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

// Real captured tier-1 web-search action shapes (~/.codex/sessions/2026/06).
// search: the dominant shape (576 hits); openPage / findInPage are the others.
const SEARCH_ACTION = {
    type: 'search',
    query: 'docker compose up SERVICE dependencies recreate containers',
    queries: [
        'docker compose up SERVICE dependencies recreate containers',
        'github docker compose up service dependencies --always-recreate-deps',
    ],
};
const OPEN_PAGE_ACTION = { type: 'open_page', url: 'https://docs.docker.com/reference/cli/docker/compose/up/' };

beforeEach(() => {
    vi.clearAllMocks();
    // isAppServerAvailable() shells out to `codex --version`; satisfy it so
    // connect() proceeds (mirrors codexAppServerClient.test.ts / AC1 test).
    mockExecSync.mockReturnValue('codex-cli 0.130.0');
});

afterAll(() => {
    vi.restoreAllMocks();
});

describe('AC3 web search producer emission (app-server webSearch item handler)', () => {
    it('handles item/started + item/completed for item.type webSearch and forwards web_search_begin/end with {call_id, query, action}', async () => {
        const proc = createMockProcess({
            pid: 4300,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-ws', path: '/tmp/thread-ws' },
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
                            result: { turn: { id: 'turn-ws', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: { threadId: 'thread-ws', turn: { id: 'turn-ws', items: [], status: 'inProgress', error: null } },
                        });
                        // Real Codex 0.130 app-server family: item.type 'webSearch'
                        // { id, query, action: WebSearchAction|null }.
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-ws', turnId: 'turn-ws',
                                item: { type: 'webSearch', id: 'ws_0731f96a', query: SEARCH_ACTION.query, action: SEARCH_ACTION },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-ws', turnId: 'turn-ws',
                                item: { type: 'webSearch', id: 'ws_0731f96a', query: SEARCH_ACTION.query, action: SEARCH_ACTION },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-ws', turnId: 'turn-ws',
                                item: { type: 'agentMessage', id: 'final-ws', text: 'done', phase: 'final_answer' },
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
        await expect(client.sendTurnAndWait('web search forwarding')).resolves.toEqual({ aborted: false });

        const begin = events.find((e) => e.type === 'web_search_begin' && e.callId === 'ws_0731f96a');
        const end = events.find((e) => e.type === 'web_search_end' && e.callId === 'ws_0731f96a');
        // The webSearch family is no longer swallowed by the broad item/* catch-all.
        expect(begin).toBeDefined();
        expect(end).toBeDefined();
        expect((begin as Record<string, unknown>).query).toBe(SEARCH_ACTION.query);
        expect((begin as Record<string, unknown>).action).toEqual(SEARCH_ACTION);
        expect((end as Record<string, unknown>).query).toBe(SEARCH_ACTION.query);

        await client.disconnect();
    });

    it('preserves the openPage action shape (url) for a non-search web search', async () => {
        const proc = createMockProcess({
            pid: 4301,
            onRequest: (msg, stdout) => {
                if (msg.method === 'thread/start' && msg.id != null) {
                    setTimeout(() => {
                        pushJsonLine(stdout, {
                            id: msg.id,
                            result: {
                                thread: { id: 'thread-ws2', path: '/tmp/thread-ws2' },
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
                            result: { turn: { id: 'turn-ws2', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'turn/started',
                            params: { threadId: 'thread-ws2', turn: { id: 'turn-ws2', items: [], status: 'inProgress', error: null } },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/started',
                            params: {
                                threadId: 'thread-ws2', turnId: 'turn-ws2',
                                item: { type: 'webSearch', id: 'ws_openpage', query: OPEN_PAGE_ACTION.url, action: OPEN_PAGE_ACTION },
                            },
                        });
                        pushJsonLine(stdout, {
                            method: 'item/completed',
                            params: {
                                threadId: 'thread-ws2', turnId: 'turn-ws2',
                                item: { type: 'agentMessage', id: 'final-ws2', text: 'done', phase: 'final_answer' },
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
        await expect(client.sendTurnAndWait('web search openPage')).resolves.toEqual({ aborted: false });

        const begin = events.find((e) => e.type === 'web_search_begin' && e.callId === 'ws_openpage');
        expect(begin).toBeDefined();
        expect((begin as Record<string, unknown>).action).toEqual(OPEN_PAGE_ACTION);
        expect((begin as Record<string, unknown>).query).toBe(OPEN_PAGE_ACTION.url);

        await client.disconnect();
    });
});

describe('AC3 mapper emits a web-search tool-call envelope under the real name (mapper→renderer path)', () => {
    it('maps web_search_begin to a tool-call-start under functions.web_search carrying query + action (NOT the guessed web.search_query)', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'web_search_begin', call_id: 'ws_m1', query: SEARCH_ACTION.query, action: SEARCH_ACTION },
            { currentTurnId: 'turn-ws-m1' },
        );

        const startEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-start');
        expect(startEnvelope).toBeDefined();
        const ev = startEnvelope!.ev;
        if (ev.t !== 'tool-call-start') throw new Error('Expected tool-call-start');
        // REAL registered name — explicitly NOT the guessed web.search_query.
        expect(ev.name).toBe('functions.web_search');
        expect(ev.name).not.toBe('web.search_query');
        expect(ev.call).toBe('ws_m1');
        expect(ev.args.query).toBe(SEARCH_ACTION.query);
        expect(ev.args.action).toEqual(SEARCH_ACTION);
    });

    it('maps web_search_end to a matching tool-call-end on the same call_id', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'web_search_end', call_id: 'ws_m1', query: SEARCH_ACTION.query, action: SEARCH_ACTION },
            { currentTurnId: 'turn-ws-m1' },
        );
        const endEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-end');
        expect(endEnvelope).toBeDefined();
        const ev = endEnvelope!.ev;
        if (ev.t !== 'tool-call-end') throw new Error('Expected tool-call-end');
        expect(ev.call).toBe('ws_m1');
    });
});

describe('AC3 app registry resolves the real web-search name (registry-derived from knownTools SOURCE)', () => {
    // The view-registry / knownTools modules transitively import react-native/expo
    // and cannot load in this node-env vitest, so we derive the registration from
    // the registry SOURCE — it FAILS if the registration is reverted, exactly like
    // a runtime lookup would (the project's blessed substitute, mirrors the AC4
    // image_gen registry-derived test in codexToolRendering.test.ts).
    const KNOWN_TOOLS_SRC = readFileSync(
        resolve(__dirname, '../../../happy-app/sources/components/tools/knownTools.tsx'),
        'utf8',
    );

    it('registers the REAL emitted name functions.web_search as a known tool (header chip minimum)', () => {
        const entry = new RegExp(`'functions\\.web_search':\\s*\\{[\\s\\S]*?minimal:\\s*(true|false)`).exec(KNOWN_TOOLS_SRC);
        // The real name must be registered so the chip renders (not swallowed).
        expect(entry).toBeTruthy();
        // Header chip minimum: minimal:true (header-only chip — AC3 "header chip minimum").
        expect(entry![1]).toBe('true');
    });

    it('the real-name entry surfaces the query in its description (carries query/url)', () => {
        // The entry block must reference input.query so the chip description shows
        // the search query/url (AC3 "carrying the query/url").
        const block = /'functions\.web_search':\s*\{([\s\S]*?)\n {4}\}/.exec(KNOWN_TOOLS_SRC)?.[1] ?? '';
        expect(block).toContain('query');
    });

    it('the real-name entry registers extractSubtitle (the STANDALONE card subtitle path, not only extractDescription)', () => {
        // ToolView/ToolHeader read extractSubtitle (NOT extractDescription) for the
        // standalone inline card subtitle; extractDescription only feeds nested
        // TaskView child rows. Without extractSubtitle the standalone web-search card
        // shows only the title and DROPS the query/url, failing AC3 "carrying the
        // query/url". This assertion FAILS if extractSubtitle is reverted (codex
        // finding 1) — exactly the regression that would silently break the card.
        const block = /'functions\.web_search':\s*\{([\s\S]*?)\n {4}\}/.exec(KNOWN_TOOLS_SRC)?.[1] ?? '';
        expect(block).toContain('extractSubtitle');
    });

    it('routes the visible text through resolveWebSearchQuery (action.query/queries/url/pattern fallback chain)', () => {
        // The entry must use the centralized fallback so a search action whose
        // top-level query is empty still surfaces action.query / action.queries[0]
        // / action.url / action.pattern (codex finding 3). FAILS if the helper or
        // its richer fallback is reverted to a url-only check.
        expect(KNOWN_TOOLS_SRC).toContain('function resolveWebSearchQuery');
        const helper = /function resolveWebSearchQuery[\s\S]*?\n\}/.exec(KNOWN_TOOLS_SRC)?.[0] ?? '';
        expect(helper).toContain('action?.query');
        expect(helper).toContain('queries');
        expect(helper).toContain('action?.url');
        const block = /'functions\.web_search':\s*\{([\s\S]*?)\n {4}\}/.exec(KNOWN_TOOLS_SRC)?.[1] ?? '';
        expect(block).toContain('resolveWebSearchQuery');
    });

    it('accepts a null action in the input schema (live shape is WebSearchAction|null — codex finding 2)', () => {
        // The live ThreadItem shape allows action:null; the zod schema must not
        // reject it. FAILS if the schema reverts to a non-nullable object.
        const block = /'functions\.web_search':\s*\{([\s\S]*?)\n {4}\}/.exec(KNOWN_TOOLS_SRC)?.[1] ?? '';
        expect(/action:\s*z\.object\(\{\}\)\.passthrough\(\)\.nullable\(\)/.test(block)).toBe(true);
    });
});

describe('AC3 mapper tolerates null action + empty query (live WebSearchAction|null shape)', () => {
    it('maps a web_search_begin with action:null to a tool-call-start without throwing', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'web_search_begin', call_id: 'ws_null', query: 'cats', action: null },
            { currentTurnId: 'turn-ws-null' },
        );
        const startEnvelope = result.envelopes.find((env) => env.ev.t === 'tool-call-start');
        expect(startEnvelope).toBeDefined();
        const ev = startEnvelope!.ev;
        if (ev.t !== 'tool-call-start') throw new Error('Expected tool-call-start');
        expect(ev.name).toBe('functions.web_search');
        expect(ev.args.query).toBe('cats');
        expect(ev.args.action).toBeNull();
    });
});
