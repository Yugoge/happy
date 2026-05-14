/**
 * AC6 mock-test harness for the recovery-script /list dispatch logic
 * (task 20260513-211054, iteration round 2).
 *
 * BA spec mandated AC6 verification was subagent-feasible. Round 1 deferred
 * it; round 2 closes the gap by exercising the dispatch helper
 * (parseListResponse) against TWO canned /list fixtures:
 *
 *   Branch A: v1 fixture (no schemaVersion field) — simulates a pre-M4
 *             production daemon (default/jade/qijie). MUST capture every
 *             claude UUID and MUST NOT capture any codex tid. This is the F5
 *             production-safety invariant.
 *
 *   Branch B: v2 fixture (schemaVersion=2, flavor discriminator on rows) —
 *             simulates the post-M4 dev daemon. MUST capture claude UUIDs
 *             from non-codex rows AND codex tids from flavor=codex rows.
 *
 * Plus edge cases: empty children array, malformed response, schemaVersion
 * present but value !== 2 (treated as Branch A), codex row in v2 with no
 * bound tid (tidPending), and an end-to-end live HTTP fixture spun up with
 * node:http to prove the helper works against a real wire-format response.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { parseListResponse } from './parseListResponse';

// ─── Branch A: v1 fixture (pre-M4 production daemon) ─────────────────────────
// No schemaVersion field, no flavor field, implicit-claude rows. This is the
// shape currently emitted by default/jade/qijie production daemons.
const V1_FIXTURE = {
    children: [
        {
            startedBy: 'happy directly...',
            happySessionId: 'happy-prod-1',
            claudeSessionId: 'aada10c6-9299-4c45-abc4-91db9c0f935d',
            pid: 1001
        },
        {
            startedBy: 'daemon',
            happySessionId: 'happy-prod-2',
            claudeSessionId: '1433467f-ff14-4292-b5b2-2aac77a808f0',
            pid: 1002
        },
        {
            startedBy: 'daemon',
            happySessionId: 'happy-prod-3',
            claudeSessionId: 'b8a7e421-1234-4abc-9876-fedcba012345',
            pid: 1003
        }
    ]
};

// ─── Branch B: v2 fixture (post-M4 dev daemon) ───────────────────────────────
// schemaVersion=2, flavor field present on all rows, codex rows carry
// codexThreadId, claude rows carry claudeSessionId.
const V2_FIXTURE = {
    schemaVersion: 2,
    children: [
        {
            startedBy: 'happy directly...',
            happySessionId: 'happy-dev-1',
            claudeSessionId: 'cccccccc-9299-4c45-abc4-91db9c0f935d',
            pid: 2001,
            flavor: 'claude',
            cwd: '/dev/shm/dev-workspace/happy-dev'
        },
        {
            startedBy: 'daemon',
            happySessionId: 'happy-dev-2',
            pid: 2002,
            flavor: 'codex',
            codexThreadId: '019d1234-5678-7abc-9def-fedcba012345',
            cwd: '/root/codex-work',
            tidPending: false
        },
        {
            startedBy: 'daemon',
            happySessionId: 'happy-dev-3',
            pid: 2003,
            flavor: 'codex',
            codexThreadId: '019d9876-5432-7fed-cba9-876543210abc',
            cwd: '/root/another-codex',
            tidPending: false
        },
        {
            startedBy: 'daemon',
            happySessionId: 'happy-dev-4',
            claudeSessionId: 'dddddddd-1111-4222-9333-444555666777',
            pid: 2004,
            flavor: 'claude',
            cwd: '/root/another-claude'
        }
    ]
};

describe('parseListResponse Branch A — v1 fixture (pre-M4 production daemon)', () => {
    it('captures every claude UUID unchanged (F5 production-safety)', () => {
        const result = parseListResponse(V1_FIXTURE);
        expect(result.branch).toBe('A');
        expect(result.claudeUuids).toEqual([
            'aada10c6-9299-4c45-abc4-91db9c0f935d',
            '1433467f-ff14-4292-b5b2-2aac77a808f0',
            'b8a7e421-1234-4abc-9876-fedcba012345'
        ]);
    });

    it('captures ZERO codex tids in Branch A', () => {
        const result = parseListResponse(V1_FIXTURE);
        expect(result.codexTids).toEqual([]);
    });

    it('preserves UUID order matching wire-format row order', () => {
        const result = parseListResponse(V1_FIXTURE);
        // Order matters: recovery script writes session_dirs.txt in arrival
        // order so reproducible spawn ordering depends on this.
        expect(result.claudeUuids[0]).toBe('aada10c6-9299-4c45-abc4-91db9c0f935d');
        expect(result.claudeUuids[2]).toBe('b8a7e421-1234-4abc-9876-fedcba012345');
    });
});

describe('parseListResponse Branch B — v2 fixture (post-M4 dev daemon)', () => {
    it('captures claude UUIDs from flavor=claude rows', () => {
        const result = parseListResponse(V2_FIXTURE);
        expect(result.branch).toBe('B');
        expect(result.claudeUuids).toEqual([
            'cccccccc-9299-4c45-abc4-91db9c0f935d',
            'dddddddd-1111-4222-9333-444555666777'
        ]);
    });

    it('captures codex tids from flavor=codex rows', () => {
        const result = parseListResponse(V2_FIXTURE);
        expect(result.codexTids).toEqual([
            '019d1234-5678-7abc-9def-fedcba012345',
            '019d9876-5432-7fed-cba9-876543210abc'
        ]);
    });

    it('does NOT mix codex tids into claudeUuids', () => {
        const result = parseListResponse(V2_FIXTURE);
        for (const tid of result.codexTids) {
            expect(result.claudeUuids).not.toContain(tid);
        }
    });
});

describe('parseListResponse edge cases', () => {
    it('returns empty Branch A result for empty children array', () => {
        const result = parseListResponse({ children: [] });
        expect(result).toEqual({ claudeUuids: [], codexTids: [], branch: 'A' });
    });

    it('returns empty Branch B result for v2 with empty children', () => {
        const result = parseListResponse({ schemaVersion: 2, children: [] });
        expect(result).toEqual({ claudeUuids: [], codexTids: [], branch: 'B' });
    });

    it('falls back to Branch A when schemaVersion is present but not 2', () => {
        // Forward-compat: a future v1 daemon that explicitly emits
        // `schemaVersion: 1` (or any non-2 value) still flows the claude
        // capture path because the dispatch checks `=== 2` strictly.
        const fixture = { schemaVersion: 1, children: V1_FIXTURE.children };
        const result = parseListResponse(fixture);
        expect(result.branch).toBe('A');
        expect(result.claudeUuids).toHaveLength(3);
    });

    it('falls back to Branch A when schemaVersion is null', () => {
        const fixture = { schemaVersion: null, children: V1_FIXTURE.children };
        const result = parseListResponse(fixture);
        expect(result.branch).toBe('A');
        expect(result.claudeUuids).toHaveLength(3);
    });

    it('handles malformed top-level response (non-object) without throwing', () => {
        expect(parseListResponse(null).claudeUuids).toEqual([]);
        expect(parseListResponse(undefined).claudeUuids).toEqual([]);
        expect(parseListResponse('not-json').claudeUuids).toEqual([]);
        expect(parseListResponse(42).claudeUuids).toEqual([]);
    });

    it('handles response without children field', () => {
        const result = parseListResponse({ schemaVersion: 2 });
        expect(result.claudeUuids).toEqual([]);
        expect(result.codexTids).toEqual([]);
    });

    it('handles children that is not an array', () => {
        const result = parseListResponse({ children: 'oops' });
        expect(result.claudeUuids).toEqual([]);
    });

    it('skips non-object rows defensively', () => {
        const fixture = {
            children: [
                null,
                'string-row',
                42,
                { claudeSessionId: 'real-uuid-1', pid: 1 }
            ]
        };
        const result = parseListResponse(fixture);
        expect(result.claudeUuids).toEqual(['real-uuid-1']);
    });

    it('skips codex row with tidPending=true (no codexThreadId yet)', () => {
        const fixture = {
            schemaVersion: 2,
            children: [
                {
                    happySessionId: 'happy-pending',
                    pid: 3001,
                    flavor: 'codex',
                    tidPending: true
                    // No codexThreadId — bind has not happened yet.
                }
            ]
        };
        const result = parseListResponse(fixture);
        expect(result.branch).toBe('B');
        expect(result.codexTids).toEqual([]);
        expect(result.claudeUuids).toEqual([]);
    });

    it('treats unknown flavor in v2 as claude-capture path', () => {
        const fixture = {
            schemaVersion: 2,
            children: [
                {
                    claudeSessionId: 'unknown-flavor-uuid',
                    flavor: 'gemini',
                    pid: 4001
                }
            ]
        };
        const result = parseListResponse(fixture);
        // Branch B path: non-codex flavor → claude capture.
        expect(result.claudeUuids).toEqual(['unknown-flavor-uuid']);
    });

    it('treats flavor-absent row in v2 as claude-capture path', () => {
        const fixture = {
            schemaVersion: 2,
            children: [
                { claudeSessionId: 'flavorless-uuid', pid: 5001 }
            ]
        };
        const result = parseListResponse(fixture);
        expect(result.claudeUuids).toEqual(['flavorless-uuid']);
    });

    it('Branch A defense-in-depth: skips flavor=codex rows even without schemaVersion (codex round-2 #2)', () => {
        // Hardening: a backport/mixed-deploy could theoretically leak a
        // flavor=codex row into a v1-shaped response (no schemaVersion field).
        // Helper must mirror bash patch's flavor-gating and skip such rows
        // from the claude path. F5 unaffected because pre-M4 daemons cannot
        // emit `flavor` — this is purely belt-and-suspenders.
        const fixture = {
            children: [
                {
                    happySessionId: 'mixed-row',
                    claudeSessionId: 'should-be-skipped-uuid',
                    pid: 7001,
                    flavor: 'codex',
                    codexThreadId: '019d-mixed-tid'
                },
                {
                    happySessionId: 'real-claude-row',
                    claudeSessionId: 'real-prod-uuid',
                    pid: 7002
                }
            ]
        };
        const result = parseListResponse(fixture);
        expect(result.branch).toBe('A');
        // The mixed flavor=codex row's claudeSessionId is NOT captured.
        expect(result.claudeUuids).toEqual(['real-prod-uuid']);
        // Branch A NEVER captures codex tids even for flagged-codex rows.
        expect(result.codexTids).toEqual([]);
    });

    it('skips rows with non-string claudeSessionId (defensive)', () => {
        const fixture = {
            children: [
                { claudeSessionId: 12345, pid: 6001 },
                { claudeSessionId: null, pid: 6002 },
                { claudeSessionId: 'valid-uuid', pid: 6003 }
            ]
        };
        const result = parseListResponse(fixture);
        expect(result.claudeUuids).toEqual(['valid-uuid']);
    });
});

// ─── End-to-end: live HTTP fixture matching real daemon wire format ──────────
describe('parseListResponse against live HTTP fixture server', () => {
    let server: Server;
    let baseUrl: string;
    let response: 'v1' | 'v2' = 'v1';

    beforeAll(async () => {
        server = createServer((req, res) => {
            if (req.method !== 'POST' || req.url !== '/list') {
                res.statusCode = 404;
                res.end();
                return;
            }
            const body = response === 'v1' ? V1_FIXTURE : V2_FIXTURE;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(body));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('Branch A: live v1 daemon response preserves all 3 claude UUIDs (F5)', async () => {
        response = 'v1';
        const httpResponse = await fetch(`${baseUrl}/list`, { method: 'POST' });
        const json = await httpResponse.json();
        const parsed = parseListResponse(json);
        expect(parsed.branch).toBe('A');
        expect(parsed.claudeUuids).toHaveLength(3);
        expect(parsed.codexTids).toHaveLength(0);
        // Concrete F5 anchor: the prod claude UUID survives the dispatch.
        expect(parsed.claudeUuids).toContain('aada10c6-9299-4c45-abc4-91db9c0f935d');
    });

    it('Branch B: live v2 daemon response captures both claude UUIDs AND codex tids', async () => {
        response = 'v2';
        const httpResponse = await fetch(`${baseUrl}/list`, { method: 'POST' });
        const json = await httpResponse.json();
        const parsed = parseListResponse(json);
        expect(parsed.branch).toBe('B');
        expect(parsed.claudeUuids).toHaveLength(2);
        expect(parsed.codexTids).toHaveLength(2);
        // Concrete F5 anchor in v2: claude UUIDs are NOT dropped even when
        // codex rows are present alongside.
        expect(parsed.claudeUuids).toContain('cccccccc-9299-4c45-abc4-91db9c0f935d');
        expect(parsed.claudeUuids).toContain('dddddddd-1111-4222-9333-444555666777');
        expect(parsed.codexTids).toContain('019d1234-5678-7abc-9def-fedcba012345');
    });
});
