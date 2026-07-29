// Cycle 8 (spec-20260506-203844 §5.3.D.5): all collab_agent_call_* fixtures cross-validated
// against /tmp/codex-src/codex-rs/app-server-protocol/src/protocol/event_mapping.rs:
//   - CollabAgentSpawnBegin   :75-86  (receiver_thread_ids: Vec::new(), agents_states: HashMap::new())
//   - CollabAgentSpawnEnd     :94-132 (receiver_thread_ids: vec![id] + agents_states when new_thread_id is Some)
//   - CollabAgentInteraction* :133-180 (sendInput; carries receiverThreadId at begin)
//   - CollabWaiting*          :181-240 (wait; carries receiverThreadIds at begin)
//   - CollabClose*            :241-end (closeAgent; carries receiverThreadId at begin)
// Cycle-7 systemic lesson: phantom shapes (spawn-begin with non-empty receiverThreadIds) masked
// the production gap. Every spawn-begin fixture below uses receiverThreadIds: []; every spawn-end
// fixture (completed case) uses single-element receiverThreadIds + matching agentsStates key.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createId, isCuid } from '@paralleldrive/cuid2';
import {
    mapCodexMcpMessageToSessionEnvelopes,
    mapCodexProcessorMessageToSessionEnvelopes,
} from '../utils/sessionProtocolMapper';

describe('mapCodexMcpMessageToSessionEnvelopes', () => {
    it('starts and ends turns for task lifecycle events', () => {
        const started = mapCodexMcpMessageToSessionEnvelopes({ type: 'task_started' }, { currentTurnId: null });

        expect(started.envelopes).toHaveLength(1);
        expect(started.envelopes[0].ev.t).toBe('turn-start');
        expect(started.envelopes[0].turn).toBe(started.currentTurnId);
        expect(started.envelopes[0].turn).not.toBe(started.envelopes[0].id);

        const ended = mapCodexMcpMessageToSessionEnvelopes({ type: 'task_complete' }, { currentTurnId: started.currentTurnId });
        expect(ended.envelopes).toHaveLength(1);
        expect(ended.envelopes[0].ev.t).toBe('turn-end');
        if (ended.envelopes[0].ev.t === 'turn-end') {
            expect(ended.envelopes[0].ev.status).toBe('completed');
        }
        expect(ended.envelopes[0].turn).toBe(started.currentTurnId);
        expect(ended.currentTurnId).toBeNull();
    });

    it('maps abort lifecycle with cancelled turn-end status', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'turn_aborted' },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].ev).toEqual({
            t: 'turn-end',
            status: 'cancelled',
        });
        expect(result.currentTurnId).toBeNull();
    });

    it('maps agent text messages with turn context', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'hello' },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].turn).toBe('turn-1');
        expect(result.envelopes[0].ev).toEqual({ t: 'text', text: 'hello' });
    });

    it('maps only learned receiver thread ids to subagent sidechains', () => {
        // Cycle 8 note: this cycle-2 routing test exercises the future-Codex-variant code path
        // where spawn-begin populates receiverThreadIds at begin time. Mapper supports both shapes:
        // begin-with-rcv (this test) AND begin-empty + end-with-rcv (real Codex per
        // event_mapping.rs:75-86 and :104-114 — see the D.5 describe block and the
        // production-shape end-to-end case below).
        const started = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'collab_agent_call_begin',
                call_id: 'collab-1',
                tool: 'spawnAgent',
                prompt: 'inspect auth',
                threadId: 'root-thread',
                turnId: 'wrapper-turn',
                receiverThreadIds: ['child-thread'],
            },
            { currentTurnId: 'turn-1' }
        );

        // Cycle 7 (M1/M1.a/M1.c): collab_agent_call_begin (spawnAgent) emits TWO envelopes,
        // lifecycle FIRST (ordering invariant M1.c — ssn registered before the child links to it),
        // then the spawn_agent tool-call-start emitted as a recursion-safe sidechain CHILD:
        //   - envelopes[0] = functions.subagent_lifecycle (top-level, args.sessionSubagent = ssn)
        //   - envelopes[1] = functions.spawn_agent CHILD (subagent = ssn; ev.call = provider call_id,
        //                    NOT ssn (M1.a); args has NO sessionSubagent (M1.b))
        expect(started.envelopes).toHaveLength(2);
        const lifecycleEvent = started.envelopes[0].ev;
        expect(lifecycleEvent.t).toBe('tool-call-start');
        if (lifecycleEvent.t !== 'tool-call-start') throw new Error('Expected lifecycle tool-call-start');
        expect(lifecycleEvent.name).toBe('functions.subagent_lifecycle');
        const ssn = lifecycleEvent.args.sessionSubagent as string;
        expect(isCuid(ssn)).toBe(true);
        expect(lifecycleEvent.call).toBe(`lifecycle:${ssn}`);
        expect(lifecycleEvent.args.lifecycle_state).toBe('started');
        expect(started.envelopes[0].subagent).toBeUndefined(); // lifecycle stays TOP-LEVEL
        expect(started.envelopes[0].turn).toBe('wrapper-turn');

        const startEvent = started.envelopes[1].ev;
        expect(startEvent.t).toBe('tool-call-start');
        if (startEvent.t !== 'tool-call-start') throw new Error('Expected tool-call-start');
        expect(startEvent.name).toBe('functions.spawn_agent');
        // M1.a: child ev.call is the provider call_id, NOT ssn.
        expect(startEvent.call).toBe('collab-1');
        expect(startEvent.call).not.toBe(ssn);
        // M1.b: child args must NOT include sessionSubagent.
        expect(startEvent.args.sessionSubagent).toBeUndefined();
        // M1: child is a sidechain of the lifecycle (subagent = ssn).
        expect(started.envelopes[1].subagent).toBe(ssn);

        const child = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'agent_message',
                message: 'child final',
                phase: 'final_answer',
                threadId: 'child-thread',
                turnId: 'child-turn',
            },
            {
                currentTurnId: started.currentTurnId,
                startedSubagents: started.startedSubagents,
                activeSubagents: started.activeSubagents,
                providerSubagentToSessionSubagent: started.providerSubagentToSessionSubagent,
                subagentLifecycles: started.subagentLifecycles,
            }
        );

        expect(child.currentTurnId).toBe('turn-1');
        // #1 / OBJ-5 (AC-A1): the subagent FINAL answer is single-sourced in the lifecycle Result, so the
        // visible child {t:'text'} envelope is now OMITTED when a lifecycle entry exists (this spawn created
        // one). The sequence drops the 'text' that used to appear between 'start' and 'stop'. The summary is
        // instead buffered onto the lifecycle entry (asserted below) and surfaced by flush/close as Result.
        expect(child.envelopes.map((envelope) => envelope.ev.t)).toEqual([
            'start',
            'stop',
            'tool-call-end',
        ]);
        // The omitted final-answer text is buffered onto the lifecycle entry with authoritative provenance.
        expect(child.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('child final');
        expect(child.subagentLifecycles.get(ssn)?.bufferedFinalSummarySource).toBe('final_answer');
        expect(child.envelopes.some((envelope) => envelope.ev.t === 'turn-end')).toBe(false);

        const endAfterFinal = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_end', call_id: 'collab-1', tool: 'spawnAgent', status: 'completed' },
            {
                currentTurnId: child.currentTurnId,
                startedSubagents: child.startedSubagents,
                activeSubagents: child.activeSubagents,
                providerSubagentToSessionSubagent: child.providerSubagentToSessionSubagent,
                subagentLifecycles: child.subagentLifecycles,
            }
        );
        // Cycle 7 (M1): spawn-end is now the recursion-safe CHILD end (call = provider call_id 'collab-1',
        // subagent = ssn), NOT a top-level end keyed by ssn.
        expect(endAfterFinal.envelopes).toHaveLength(1);
        expect(endAfterFinal.envelopes[0].ev).toMatchObject({
            t: 'tool-call-end',
            call: 'collab-1',
        });
        expect(endAfterFinal.envelopes[0].subagent).toBe(ssn);

        const root = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'root text', threadId: 'root-thread', turnId: 'root-turn' },
            {
                currentTurnId: endAfterFinal.currentTurnId,
                startedSubagents: endAfterFinal.startedSubagents,
                activeSubagents: endAfterFinal.activeSubagents,
                providerSubagentToSessionSubagent: endAfterFinal.providerSubagentToSessionSubagent,
            }
        );
        expect(root.envelopes).toHaveLength(1);
        expect(root.envelopes[0].subagent).toBeUndefined();
        expect(root.envelopes[0].turn).toBe('root-turn');
    });

    it('emits stop for active subagents before turn-end', () => {
        const subagent = createId();
        const activeSubagents = new Set<string>([subagent]);
        const startedSubagents = new Set<string>([subagent]);
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'task_complete' },
            { currentTurnId: 'turn-1', activeSubagents, startedSubagents }
        );

        expect(result.envelopes).toHaveLength(2);
        expect(result.envelopes[0]).toMatchObject({
            subagent,
            ev: { t: 'stop' },
        });
        expect(result.envelopes[1].ev).toEqual({
            t: 'turn-end',
            status: 'completed',
        });
    });

    it('maps exec command begin to tool-call-start', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'exec_command_begin',
                call_id: 'call-1',
                command: 'ls -la',
                cwd: '/tmp',
            },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        const envelope = result.envelopes[0];
        expect(envelope.ev.t).toBe('tool-call-start');
        if (envelope.ev.t === 'tool-call-start') {
            expect(envelope.ev.call).toBe('call-1');
            expect(envelope.ev.name).toBe('CodexBash');
            expect(envelope.ev.title).toContain('Run `ls -la`');
            expect(envelope.ev.args).toEqual({ command: 'ls -la', cwd: '/tmp' });
        }
    });

    it('preserves exec command end output, status, and exit metadata', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'exec_command_end',
                call_id: 'call-1',
                output: 'stdout text',
                stderr: 'stderr text',
                exit_code: 2,
                status: 'failed',
                duration_ms: 25,
            },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        const ev = result.envelopes[0].ev;
        expect(ev.t).toBe('tool-call-end');
        if (ev.t === 'tool-call-end') {
            expect(ev.result).toEqual({
                output: 'stdout text',
                stdout: 'stdout text',
                stderr: 'stderr text',
                exit_code: 2,
                status: 'failed',
                duration_ms: 25,
                cwd: null,
                command: null,
                empty_output: false,
                source: 'codex.exec_command_end',
            });
            expect(JSON.parse(ev.output ?? '{}')).toMatchObject({ output: 'stdout text', status: 'failed' });
        }

        const declined = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'exec_command_end',
                call_id: 'call-declined',
                output: '',
                stderr: 'Command declined by policy',
                status: 'declined',
            },
            { currentTurnId: 'turn-1' }
        );
        const declinedEvent = declined.envelopes[0].ev;
        expect(declinedEvent.t).toBe('tool-call-end');
        if (declinedEvent.t === 'tool-call-end') {
            expect(declinedEvent.result).toMatchObject({
                status: 'declined',
                stderr: 'Command declined by policy',
            });
        }
    });

    it('keeps spawn-agent parent result displayable across collab end ordering', () => {
        // Cycle 8: spawn-begin shape per event_mapping.rs:75-86 (empty receiverThreadIds);
        // spawn-end shape per event_mapping.rs:104-114 (Some branch — single receiverThreadId).
        const begin = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'collab_agent_call_begin',
                call_id: 'spawn-1',
                tool: 'spawnAgent',
                prompt: 'inspect files',
                receiverThreadIds: [],
                agentsStates: {},
            },
            { currentTurnId: 'turn-1' }
        );
        // Cycle 7 (M1): envelopes[0] is now the lifecycle; the spawn card is the CHILD at envelopes[1]
        // (call = provider call_id 'spawn-1').
        const startEvent = begin.envelopes[1].ev;
        if (startEvent.t !== 'tool-call-start') throw new Error('Expected spawn start');
        expect(startEvent.call).toBe('spawn-1');

        const endBeforeFinal = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'collab_agent_call_end',
                call_id: 'spawn-1',
                tool: 'spawnAgent',
                status: 'completed',
                receiverThreadIds: ['child-thread'],
                agentsStates: { 'child-thread': { status: 'running', message: null } },
            },
            {
                currentTurnId: begin.currentTurnId,
                startedSubagents: begin.startedSubagents,
                activeSubagents: begin.activeSubagents,
                providerSubagentToSessionSubagent: begin.providerSubagentToSessionSubagent,
                subagentLifecycles: begin.subagentLifecycles,
            }
        );
        // Cycle 7 (M1): spawn-end is the recursion-safe CHILD end (call = 'spawn-1', subagent = ssn).
        expect(endBeforeFinal.envelopes).toHaveLength(1);
        expect(endBeforeFinal.envelopes[0].ev).toMatchObject({
            t: 'tool-call-end',
            call: startEvent.call,
        });

        const finalAfterEnd = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'agent_message',
                message: 'final answer text',
                phase: 'final_answer',
                threadId: 'child-thread',
            },
            {
                currentTurnId: endBeforeFinal.currentTurnId,
                startedSubagents: endBeforeFinal.startedSubagents,
                activeSubagents: endBeforeFinal.activeSubagents,
                providerSubagentToSessionSubagent: endBeforeFinal.providerSubagentToSessionSubagent,
            }
        );
        // The final_answer parent-result end is keyed by ssn (the owner-thread result card), unchanged.
        const parentResult = finalAfterEnd.envelopes.find((envelope) => envelope.ev.t === 'tool-call-end');
        expect(parentResult?.ev).toMatchObject({
            t: 'tool-call-end',
            output: 'final answer text',
        });
    });

    it('ends each collab control with the same visible call id that it started', () => {
        // Cycle 8: spawn-begin shape per event_mapping.rs:75-86 (empty receiverThreadIds).
        let state = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'collab_agent_call_begin',
                call_id: 'spawn-1',
                tool: 'spawnAgent',
                prompt: 'inspect files',
                receiverThreadIds: [],
                agentsStates: {},
            },
            { currentTurnId: 'turn-1' }
        );
        // Cycle 7 (M1): envelopes[0] is the lifecycle; the spawn card child is envelopes[1] (call 'spawn-1').
        const spawnStart = state.envelopes[1].ev;
        if (spawnStart.t !== 'tool-call-start') throw new Error('Expected spawn start');
        expect(spawnStart.call).toBe('spawn-1');
        // Cycle 8: spawn-end binds receiverThreadId per event_mapping.rs:104-114 (Some branch).
        // The original spawn-end at the bottom of this test is re-emitted with same call_id;
        // mapper's binding logic is idempotent on the existing call_id->ssn entry.
        state = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'collab_agent_call_end',
                call_id: 'spawn-1',
                tool: 'spawnAgent',
                status: 'completed',
                receiverThreadIds: ['child-thread'],
                agentsStates: { 'child-thread': { status: 'running', message: null } },
            },
            state
        );

        for (const fixture of [
            { tool: 'wait', call: 'wait-1' },
            { tool: 'closeAgent', call: 'close-1' },
        ]) {
            state = mapCodexMcpMessageToSessionEnvelopes(
                {
                    type: 'collab_agent_call_begin',
                    call_id: fixture.call,
                    tool: fixture.tool,
                    receiverThreadIds: ['child-thread'],
                },
                state
            );
            const start = state.envelopes[0].ev;
            expect(start).toMatchObject({ t: 'tool-call-start', call: fixture.call });

            state = mapCodexMcpMessageToSessionEnvelopes(
                {
                    type: 'collab_agent_call_end',
                    call_id: fixture.call,
                    tool: fixture.tool,
                    status: 'completed',
                },
                state
            );
            expect(state.envelopes[0].ev).toMatchObject({ t: 'tool-call-end', call: fixture.call });
        }

        state = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_end', call_id: 'spawn-1', tool: 'spawnAgent', status: 'completed' },
            state
        );
        expect(state.envelopes[0].ev).toMatchObject({ t: 'tool-call-end', call: spawnStart.call });
    });

    it('routes child transcript item families through learned receiver thread ids', () => {
        const childFamilies = [
            {
                message: { type: 'exec_command_begin', call_id: 'cmd-1', command: 'pwd' },
                expectedName: 'CodexBash',
            },
            {
                message: { type: 'patch_apply_begin', call_id: 'patch-1', changes: { 'a.ts': {} } },
                expectedName: 'CodexPatch',
            },
            {
                message: { type: 'dynamic_tool_call_begin', call_id: 'dyn-1', namespace: 'functions', tool: 'search', arguments: { q: 'x' } },
                expectedName: 'functions.search',
            },
            {
                message: { type: 'mcp_tool_call_begin', call_id: 'mcp-1', server: 'fs', tool: 'read', arguments: { path: 'a.ts' } },
                expectedName: 'mcp__fs__read',
            },
            {
                message: { type: 'plan_update_begin', call_id: 'plan-1', text: 'Inspect' },
                expectedName: 'functions.update_plan',
            },
            {
                message: { type: 'image_view_begin', call_id: 'image-1', path: '/tmp/a.png' },
                expectedName: 'functions.view_image',
            },
        ];

        // Cycle 8: spawn-begin shape per event_mapping.rs:75-86 (empty rcv); spawn-end :104-114
        // binds receiverThreadId so child agent_message routing finds the same ssn.
        for (const fixture of childFamilies) {
            const begin = mapCodexMcpMessageToSessionEnvelopes(
                { type: 'collab_agent_call_begin', call_id: `spawn-${fixture.expectedName}`, tool: 'spawnAgent', prompt: 'inspect', receiverThreadIds: [], agentsStates: {} },
                { currentTurnId: 'turn-1' }
            );
            // Cycle 7 (M1): envelopes[0] is the lifecycle; spawn card child is envelopes[1].
            const lifecycleStart = begin.envelopes[0].ev;
            if (lifecycleStart.t !== 'tool-call-start') throw new Error('Expected lifecycle start');
            const ssn = lifecycleStart.args.sessionSubagent as string;
            const spawnEvent = begin.envelopes[1].ev;
            if (spawnEvent.t !== 'tool-call-start') throw new Error('Expected spawn start');
            const ended = mapCodexMcpMessageToSessionEnvelopes(
                { type: 'collab_agent_call_end', call_id: `spawn-${fixture.expectedName}`, tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child-thread'], agentsStates: { 'child-thread': { status: 'running', message: null } } },
                begin
            );
            const routed = mapCodexMcpMessageToSessionEnvelopes(
                { ...fixture.message, threadId: 'child-thread', turnId: 'child-turn' },
                { currentTurnId: ended.currentTurnId, startedSubagents: ended.startedSubagents, activeSubagents: ended.activeSubagents, providerSubagentToSessionSubagent: ended.providerSubagentToSessionSubagent }
            );

            // Cycle 7 (M1): child transcript items route to the lifecycle's ssn (child-thread bound to
            // ssn at spawn-end), not to the spawn card's provider call_id.
            const toolStart = routed.envelopes.find((envelope) => envelope.ev.t === 'tool-call-start');
            expect(toolStart?.subagent).toBe(ssn);
            expect(toolStart?.turn).toBe('child-turn');
            if (toolStart?.ev.t === 'tool-call-start') {
                expect(toolStart.ev.name).toBe(fixture.expectedName);
            }
        }
    });

    it('preserves non-terminal end payloads for matrix fixture classes', () => {
        const cases = [
            {
                message: { type: 'patch_apply_end', call_id: 'patch-1', status: 'completed' },
                expected: { status: 'completed' },
            },
            {
                message: { type: 'plan_update_end', call_id: 'plan-1', text: '1. Inspect\n2. Fix' },
                expected: { text: '1. Inspect\n2. Fix' },
            },
            {
                message: { type: 'mcp_tool_call_end', call_id: 'mcp-1', server: 'resources', tool: 'read', status: 'completed' },
                expected: { server: 'resources', tool: 'read', status: 'completed' },
            },
            {
                message: { type: 'image_view_end', call_id: 'image-1', path: '/tmp/render-fixtures/plot.png' },
                expected: { path: '/tmp/render-fixtures/plot.png' },
            },
        ];

        for (const fixture of cases) {
            const result = mapCodexMcpMessageToSessionEnvelopes(fixture.message, { currentTurnId: 'turn-1' });
            const ev = result.envelopes[0].ev;
            expect(ev.t).toBe('tool-call-end');
            if (ev.t === 'tool-call-end') {
                expect(JSON.parse(ev.output ?? '{}')).toEqual(fixture.expected);
            }
        }
    });

    it('embeds readable screenshot paths as browser-loadable image previews', () => {
        const dir = mkdtempSync(join(tmpdir(), 'happy-image-preview-'));
        const imagePath = join(dir, 'screenshot.png');
        writeFileSync(imagePath, Buffer.from('iVBORw0KGgo=', 'base64'));

        try {
            const result = mapCodexMcpMessageToSessionEnvelopes(
                {
                    type: 'mcp_tool_call_end',
                    call_id: 'shot-1',
                    server: 'playwright',
                    tool: 'browser_take_screenshot',
                    path: imagePath,
                },
                { currentTurnId: 'turn-1' }
            );
            const ev = result.envelopes[0].ev;
            expect(ev.t).toBe('tool-call-end');
            if (ev.t === 'tool-call-end') {
                expect(ev.result).toMatchObject({ path: imagePath, size: 8 });
                expect((ev.result as any).preview_uri).toMatch(/^data:image\/png;base64,/);
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // PRODUCER fix: mcp__playwright__browser_take_screenshot — synthesize preview_uri from the SAVED
    // file (markdown link / input filename resolved against the session cwd), ignoring the corrupt
    // inline base64 (Codex output-bounding U+2026 elision); keep preview_unavailable_reason on failure.
    describe('playwright browser_take_screenshot file-based preview', () => {
        const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        // A doubly-encoded JSON text wrapper whose inline base64 has been elided with a U+2026 ellipsis —
        // exactly the corrupted shape Codex delivers. Must never be used as the preview.
        const CORRUPT_INLINE = `iVBORw0KGgoAAAANSUhEUgAAA…`;

        it('uses the markdown-link file (relative, resolved against sessionCwd) and ignores corrupt inline base64', () => {
            const dir = mkdtempSync(join(tmpdir(), 'happy-shot-link-'));
            const relName = 'wave1-happy-session-desktop.png';
            writeFileSync(join(dir, relName), PNG_BYTES);
            try {
                const result = mapCodexMcpMessageToSessionEnvelopes(
                    {
                        type: 'mcp_tool_call_end',
                        call_id: 'shot-link',
                        server: 'playwright',
                        tool: 'browser_take_screenshot',
                        // The result text carries the saved-file markdown link AND the corrupt inline base64.
                        content: `### Result\n- [Screenshot of viewport](${relName})\n\ndata:image/png;base64,${CORRUPT_INLINE}`,
                        contentItems: [{ type: 'image', data: CORRUPT_INLINE, mimeType: 'image/png' }],
                    },
                    { currentTurnId: 'turn-1', sessionCwd: dir }
                );
                const ev = result.envelopes[0].ev;
                expect(ev.t).toBe('tool-call-end');
                if (ev.t === 'tool-call-end') {
                    const r = ev.result as any;
                    expect(r.path).toBe(relName);
                    expect(r.size).toBe(PNG_BYTES.length);
                    // preview synthesized from the real file bytes — NOT the corrupt inline ellipsis base64.
                    expect(r.preview_uri).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
                    expect(r.preview_uri).not.toContain('…');
                    expect(r.preview_unavailable_reason).toBeUndefined();
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('reaches the markdown link in the REAL LIVE doubly-encoded result shape and ignores corrupt inline base64', () => {
            // The exact live result shape: result.content[0].text is a JSON STRING whose parse yields
            // { content: [ { type:'text', text:'### Result\n- [Screenshot of viewport](<rel>)' },
            //              { type:'image', data:'<corrupt…base64>', mimeType:'image/png' } ] }.
            // The markdown link lives at content[0].text -> JSON.parse -> .content[0].text — collectResultText
            // must recurse into content[] AND unwrap the doubly-encoded JSON-string wrapper to find it.
            const dir = mkdtempSync(join(tmpdir(), 'happy-shot-live-'));
            const relName = 'wave1-happy-session-desktop.png';
            writeFileSync(join(dir, relName), PNG_BYTES);
            try {
                const innerWrapper = JSON.stringify({
                    content: [
                        { type: 'text', text: `### Result\n- [Screenshot of viewport](${relName}) saved.` },
                        { type: 'image', data: CORRUPT_INLINE, mimeType: 'image/png' },
                    ],
                });
                const result = mapCodexMcpMessageToSessionEnvelopes(
                    {
                        type: 'mcp_tool_call_end',
                        call_id: 'shot-live',
                        server: 'playwright',
                        tool: 'browser_take_screenshot',
                        // Top-level MCP envelope: content[0].text is the doubly-encoded JSON string wrapper.
                        content: [{ type: 'text', text: innerWrapper }],
                        structuredContent: null,
                        _meta: null,
                        preview_unavailable_reason: 'inline image elided by output bounding',
                    },
                    { currentTurnId: 'turn-1', sessionCwd: dir }
                );
                const ev = result.envelopes[0].ev;
                expect(ev.t).toBe('tool-call-end');
                if (ev.t === 'tool-call-end') {
                    const r = ev.result as any;
                    expect(r.path).toBe(relName);
                    expect(r.size).toBe(PNG_BYTES.length);
                    // Synthesized from the real file bytes — the corrupt inline ellipsis base64 is never used.
                    expect(r.preview_uri).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
                    expect(r.preview_uri).not.toContain('…');
                    expect(r.preview_unavailable_reason).toBeUndefined();
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('resolves a screenshot filename containing spaces and inner parens from the markdown link', () => {
            const dir = mkdtempSync(join(tmpdir(), 'happy-shot-spaces-'));
            const relName = 'wave1 happy session (desktop).png';
            writeFileSync(join(dir, relName), PNG_BYTES);
            try {
                const result = mapCodexMcpMessageToSessionEnvelopes(
                    {
                        type: 'mcp_tool_call_end',
                        call_id: 'shot-spaces',
                        server: 'playwright',
                        tool: 'browser_take_screenshot',
                        // Spaces AND inner parens in the link target; corrupt inline base64 also present.
                        content: `### Result\n- [Screenshot of viewport](${relName})\n\ndata:image/png;base64,${CORRUPT_INLINE}`,
                    },
                    { currentTurnId: 'turn-1', sessionCwd: dir }
                );
                const ev = result.envelopes[0].ev;
                expect(ev.t).toBe('tool-call-end');
                if (ev.t === 'tool-call-end') {
                    const r = ev.result as any;
                    expect(r.path).toBe(relName);
                    expect(r.preview_uri).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
                    expect(r.preview_unavailable_reason).toBeUndefined();
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('percent-decodes a screenshot link target to the on-disk filename', () => {
            const dir = mkdtempSync(join(tmpdir(), 'happy-shot-pct-'));
            const onDisk = 'shot 1.png';
            writeFileSync(join(dir, onDisk), PNG_BYTES);
            try {
                const result = mapCodexMcpMessageToSessionEnvelopes(
                    {
                        type: 'mcp_tool_call_end',
                        call_id: 'shot-pct',
                        server: 'playwright',
                        tool: 'browser_take_screenshot',
                        content: `- [Screenshot of viewport](shot%201.png)`,
                    },
                    { currentTurnId: 'turn-1', sessionCwd: dir }
                );
                const ev = result.envelopes[0].ev;
                expect(ev.t).toBe('tool-call-end');
                if (ev.t === 'tool-call-end') {
                    const r = ev.result as any;
                    expect(r.path).toBe(onDisk);
                    expect(r.preview_uri).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
                    expect(r.preview_unavailable_reason).toBeUndefined();
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('resolves a file:// URL on a DIRECT path field to the absolute filesystem path', () => {
            const dir = mkdtempSync(join(tmpdir(), 'happy-shot-fileurl-'));
            const abs = join(dir, 'direct-shot.png');
            writeFileSync(abs, PNG_BYTES);
            try {
                const result = mapCodexMcpMessageToSessionEnvelopes(
                    {
                        type: 'mcp_tool_call_end',
                        call_id: 'shot-fileurl',
                        server: 'playwright',
                        tool: 'browser_take_screenshot',
                        // No markdown link, no filename input — only a direct file:// path field.
                        path: `file://${abs}`,
                    },
                    { currentTurnId: 'turn-1' }
                );
                const ev = result.envelopes[0].ev;
                expect(ev.t).toBe('tool-call-end');
                if (ev.t === 'tool-call-end') {
                    const r = ev.result as any;
                    expect(r.preview_uri).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
                    expect(r.preview_unavailable_reason).toBeUndefined();
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('falls back to the tool input filename when no markdown link is present', () => {
            const dir = mkdtempSync(join(tmpdir(), 'happy-shot-filename-'));
            const relName = 'shot-from-input.png';
            writeFileSync(join(dir, relName), PNG_BYTES);
            try {
                const result = mapCodexMcpMessageToSessionEnvelopes(
                    {
                        type: 'mcp_tool_call_end',
                        call_id: 'shot-fn',
                        server: 'playwright',
                        tool: 'browser_take_screenshot',
                        arguments: { filename: relName },
                        // No usable file link in the text — only the corrupt inline payload.
                        content: `Captured. data:image/png;base64,${CORRUPT_INLINE}`,
                    },
                    { currentTurnId: 'turn-1', sessionCwd: dir }
                );
                const ev = result.envelopes[0].ev;
                expect(ev.t).toBe('tool-call-end');
                if (ev.t === 'tool-call-end') {
                    const r = ev.result as any;
                    expect(r.path).toBe(relName);
                    expect(r.preview_uri).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
                    expect(r.preview_unavailable_reason).toBeUndefined();
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('keeps preview_unavailable_reason when the saved screenshot file is missing', () => {
            const dir = mkdtempSync(join(tmpdir(), 'happy-shot-missing-'));
            try {
                const result = mapCodexMcpMessageToSessionEnvelopes(
                    {
                        type: 'mcp_tool_call_end',
                        call_id: 'shot-missing',
                        server: 'playwright',
                        tool: 'browser_take_screenshot',
                        content: `- [Screenshot of viewport](does-not-exist.png)\n\ndata:image/png;base64,${CORRUPT_INLINE}`,
                    },
                    { currentTurnId: 'turn-1', sessionCwd: dir }
                );
                const ev = result.envelopes[0].ev;
                expect(ev.t).toBe('tool-call-end');
                if (ev.t === 'tool-call-end') {
                    const r = ev.result as any;
                    expect(r.preview_unavailable_reason).toBe('image file unavailable');
                    expect(r.preview_uri).toBeUndefined();
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    it('derives image previews from MCP image data and path-like string outputs', () => {
        const imageData = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'mcp_tool_call_end',
                call_id: 'imagegen-1',
                server: 'image_gen',
                tool: 'imagegen',
                contentItems: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }],
            },
            { currentTurnId: 'turn-1' }
        );
        const dataEvent = imageData.envelopes[0].ev;
        expect(dataEvent.t).toBe('tool-call-end');
        if (dataEvent.t === 'tool-call-end') {
            expect((dataEvent.result as any).preview_uri).toBe('data:image/png;base64,YWJj');
        }

        const dir = mkdtempSync(join(tmpdir(), 'happy-image-uri-preview-'));
        const imagePath = join(dir, 'generated.png');
        writeFileSync(imagePath, Buffer.from('iVBORw0KGgo=', 'base64'));
        try {
            for (const value of [
                `file://${imagePath}`,
                imagePath,
                `### Result\n- [Screenshot of viewport](${imagePath})`,
                `Generated images are saved as ${imagePath} by default.`,
            ]) {
                const pathResult = mapCodexMcpMessageToSessionEnvelopes(
                    {
                        type: 'dynamic_tool_call_end',
                        call_id: 'image-1',
                        namespace: 'image_gen',
                        tool: 'imagegen',
                        output: value,
                    },
                    { currentTurnId: 'turn-1' }
                );
                const ev = pathResult.envelopes[0].ev;
                expect(ev.t).toBe('tool-call-end');
                if (ev.t === 'tool-call-end') {
                    expect(ev.result).toMatchObject({ path: imagePath });
                    expect((ev.result as any).preview_uri).toMatch(/^data:image\/png;base64,/);
                }
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('uses id as fallback call id and preserves structured plan starts', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'plan_update_begin',
                id: 'plan-item-1',
                text: 'Inspect payload',
                plan: [{ step: 'Inspect payload', status: 'in_progress' }],
            },
            { currentTurnId: 'turn-1' }
        );

        const ev = result.envelopes[0].ev;
        expect(ev.t).toBe('tool-call-start');
        if (ev.t === 'tool-call-start') {
            expect(ev.call).toBe('plan-item-1');
            expect(ev.args.plan).toEqual([{ step: 'Inspect payload', status: 'in_progress' }]);
        }
    });

    it('skips token_count messages', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'token_count', total_tokens: 10 },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(0);
        expect(result.currentTurnId).toBe('turn-1');
    });
});

describe('mapCodexProcessorMessageToSessionEnvelopes', () => {
    it('maps reasoning tool lifecycle to start/text/end session events', () => {
        const startEvents = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'tool-call',
            callId: 'reasoning-1',
            name: 'CodexReasoning',
            input: { title: 'Plan changes' },
            id: 'legacy-id-1',
        }, { currentTurnId: 'turn-1' });

        expect(startEvents).toHaveLength(1);
        expect(startEvents[0].ev.t).toBe('tool-call-start');

        const endEvents = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'tool-call-result',
            callId: 'reasoning-1',
            output: { content: 'Step 1, Step 2', status: 'completed' },
            id: 'legacy-id-2',
        }, { currentTurnId: 'turn-1' });

        expect(endEvents).toHaveLength(2);
        expect(endEvents[0].ev.t).toBe('text');
        if (endEvents[0].ev.t === 'text') {
            expect(endEvents[0].ev.thinking).toBe(true);
        }
        expect(endEvents[1].ev).toEqual({
            t: 'tool-call-end',
            call: 'reasoning-1',
            output: JSON.stringify({ output: { content: 'Step 1, Step 2', status: 'completed' } }),
        });
    });

    it('maps reasoning text to thinking text event', () => {
        const events = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'reasoning',
            message: 'Working through options',
            id: 'legacy-id-3',
        }, { currentTurnId: 'turn-1' });

        expect(events).toHaveLength(1);
        expect(events[0].ev).toEqual({
            t: 'text',
            text: 'Working through options',
            thinking: true,
        });
    });
});

// Cycle 6 — D.5 subagent lifecycle merge state-machine tests.
// These tests lock the synthetic functions.subagent_lifecycle envelope
// behavior across the four edge cases enumerated in the architect memo q3.
// Cycle 8 (Path A+) shape (event_mapping.rs:75-86 + :104-114): spawnState fires real
// spawn-begin (empty rcv) AND spawn-end (populated rcv) to bind receiverThreadId.
describe('mapCodexMcpMessageToSessionEnvelopes — D.5 subagent lifecycle merge', () => {
    // Cycle 9 (NO-regression): these collab/multi-target specs exercise the REPLAY rendering path, so the
    // threaded state must carry replay:true (the live caller leaves it unset — see liveStep below). The
    // CodexMapperResult omits `replay`, so step() must re-inject it across each hop, exactly mirroring the
    // real replay caller (rolloutHistoryReplay.ts), which re-sets replay:true on every mapper rebuild.
    function spawnState(callId: string, threadId: string, prompt: string, prior?: any) {
        const begin = mapCodexMcpMessageToSessionEnvelopes({ type: 'collab_agent_call_begin', call_id: callId, tool: 'spawnAgent', prompt, receiverThreadIds: [], agentsStates: {} }, prior ?? { currentTurnId: 'turn-1', replay: true });
        mapCodexMcpMessageToSessionEnvelopes({ type: 'collab_agent_call_end', call_id: callId, tool: 'spawnAgent', status: 'completed', receiverThreadIds: [threadId], agentsStates: { [threadId]: { status: 'running', message: null } } }, { ...begin, replay: true });
        return { ...begin, replay: true };
    }
    function step(message: any, prior: any) { return { ...mapCodexMcpMessageToSessionEnvelopes(message, prior), replay: prior?.replay }; }
    // Cycle 7 (M1): the lifecycle envelope is the only one carrying args.sessionSubagent — the spawn
    // card is now a recursion-safe CHILD whose args omit sessionSubagent (M1.b). Extract ssn from the
    // lifecycle tool-call-start (found by name), not by envelope index.
    function lifecycleEnvOf(result: any) {
        return result.envelopes.find((e: any) => e.ev.t === 'tool-call-start' && e.ev.name === 'functions.subagent_lifecycle');
    }
    function ssnOf(result: any): string {
        return (lifecycleEnvOf(result)!.ev as any).args.sessionSubagent as string;
    }

    it('case a: spawn-wait-close — wait buffers final_summary via real agentsStates path; close emits terminal inheriting buffered summary', () => {
        const begin = spawnState('spawn-1', 'child-A', 'inspect alpha');
        const lifecycle0 = lifecycleEnvOf(begin)!.ev;
        if (lifecycle0.t !== 'tool-call-start') throw new Error('Expected lifecycle start');
        expect(lifecycle0.name).toBe('functions.subagent_lifecycle');
        const sessionSubagent = lifecycle0.args.sessionSubagent as string;
        expect(lifecycle0.call).toBe(`lifecycle:${sessionSubagent}`);
        expect(lifecycle0.args.lifecycle_state).toBe('started');

        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-1', tool: 'wait', receiverThreadIds: ['child-A'] }, begin);
        // wait_begin does NOT emit lifecycle envelope — only spawn does
        expect(waitBegin.envelopes.filter(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle')).toHaveLength(0);

        // Cycle 7 §5.3.D.5: wait_agent end carries real-protocol agentsStates per
        // /tmp/codex-ts-v0.125.0/v2/CollabAgentState.ts; mapper buffers the message.
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-1', tool: 'wait', status: 'completed',
            receiverThreadIds: ['child-A'],
            agentsStates: { 'child-A': { status: 'completed', message: 'all good' } },
        }, waitBegin);
        expect(waitEnd.envelopes.filter(e => e.ev.t === 'tool-call-end')).toHaveLength(1); // only the wait end, not lifecycle end
        // Buffered summary is set on the lifecycle entry — not yet emitted.
        expect(waitEnd.subagentLifecycles.get(sessionSubagent)?.bufferedFinalSummary).toBe('all good');

        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-1', tool: 'closeAgent', receiverThreadIds: ['child-A'] }, waitEnd);
        // close_agent end does NOT carry final_summary directly — terminal inherits buffered.
        const closeEnd = step({ type: 'collab_agent_call_end', call_id: 'close-1', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['child-A'] }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${sessionSubagent}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ status: 'completed', final_summary: 'all good', lifecycle_state: 'completed' });
        }
        expect(closeEnd.subagentLifecycles.get(sessionSubagent)?.state).toBe('completed');
    });

    // Cycle 7 §5.3.D.5 AC4: close-only fallback (no wait fired) — close_agent end
    // carries agentsStates directly, mapper reads it as fallback to buffered.
    it('case a-2 (AC4): close-only path with agentsStates on close inherits via fallback', () => {
        const begin = spawnState('spawn-1b', 'child-A2', 'inspect alpha-2');
        const sessionSubagent = ssnOf(begin);
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-1b', tool: 'closeAgent', receiverThreadIds: ['child-A2'] }, begin);
        const closeEnd = step({
            type: 'collab_agent_call_end', call_id: 'close-1b', tool: 'closeAgent', status: 'completed',
            receiverThreadIds: ['child-A2'],
            agentsStates: { 'child-A2': { status: 'completed', message: 'close-time summary' } },
        }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${sessionSubagent}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ status: 'completed', final_summary: 'close-time summary', lifecycle_state: 'completed' });
        }
    });

    // Cycle 9 (A2-M1/M2 — overturns the Cycle-7 S1 first-wins collapse): a multi-target wait renders
    // EACH awaited target distinctly (one tool-call-start/end pair per begin target with a stable
    // synthetic call id `${call}#${index}:${tid}`), NOT a single collapsed parent picking the first
    // thread's message. Both targets carry their OWN extracted status (AC-A2-3).
    it('case a-3 (A2): multi-target wait renders each target distinctly with its own status (no first-wins collapse)', () => {
        const begin = spawnState('spawn-1c', 'child-X', 'inspect multi');
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-1c', tool: 'wait', receiverThreadIds: ['child-X', 'child-Y'] }, begin);
        // Two distinct per-target begin envelopes with stable synthetic call ids.
        const beginStarts = waitBegin.envelopes.filter(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.wait_agent');
        expect(beginStarts.map(e => (e.ev as any).call).sort()).toEqual(['wait-1c#0:child-X', 'wait-1c#1:child-Y']);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-1c', tool: 'wait', status: 'completed',
            receiverThreadIds: ['child-X', 'child-Y'],
            agentsStates: {
                'child-X': { status: 'completed', message: 'x done' },
                'child-Y': { status: 'errored', message: 'y failed' },
            },
        }, waitBegin);
        // Two distinct per-target end envelopes — neither dropped, neither borrowing the other's status.
        const endCalls = waitEnd.envelopes.filter(e => e.ev.t === 'tool-call-end').map(e => (e.ev as any).call).sort();
        expect(endCalls).toEqual(['wait-1c#0:child-X', 'wait-1c#1:child-Y']);
        const endX = waitEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === 'wait-1c#0:child-X');
        const endY = waitEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === 'wait-1c#1:child-Y');
        expect(JSON.stringify((endX!.ev as any).output ?? (endX!.ev as any).result)).toContain('x done');
        expect(JSON.stringify((endY!.ev as any).output ?? (endY!.ev as any).result)).toContain('y failed');
        // Per-target rendering does NOT collapse into a single buffered first-target summary.
        return;
    });

    // AC-A2-1: per-target enumeration is driven by the BEGIN target array, NOT the output status{} map.
    // 3 begin targets -> 3 per-target begin/end pairs, even if the output status{} map has FEWER keys.
    it('AC-A2-1: 3-target wait renders exactly 3 per-target pairs from the begin array (not the status map)', () => {
        const begin = spawnState('spawn-a2-1', 'tgt-1', 'multi');
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-a2-1', tool: 'wait', receiverThreadIds: ['tgt-1', 'tgt-2', 'tgt-3'] }, begin);
        const beginStarts = waitBegin.envelopes.filter(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.wait_agent');
        // Exactly 3 begins (== begin-arg count), every synthetic id registered.
        expect(beginStarts.map(e => (e.ev as any).call)).toEqual(['wait-a2-1#0:tgt-1', 'wait-a2-1#1:tgt-2', 'wait-a2-1#2:tgt-3']);
        // Output status{} map carries only ONE key — the rendered-target count must still equal begin-arg count (3).
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-a2-1', tool: 'wait',
            receiverThreadIds: ['tgt-1', 'tgt-2', 'tgt-3'],
            status: { 'tgt-1': { completed: true } },
        }, waitBegin);
        const endCalls = waitEnd.envelopes.filter(e => e.ev.t === 'tool-call-end').map(e => (e.ev as any).call);
        expect(endCalls).toEqual(['wait-a2-1#0:tgt-1', 'wait-a2-1#1:tgt-2', 'wait-a2-1#2:tgt-3']);
        expect(endCalls).toHaveLength(3);
    });

    // AC-A2-2: partial-status (dominant 242/245 shape) — 3 begin targets, output status for ONLY 1.
    // ALL 3 render; the 2 absent-status targets get an explicit `unreported` marker, NEVER a borrowed status.
    it('AC-A2-2: partial-status 3-target wait — all 3 render; absent targets get unreported, not a borrowed status', () => {
        const begin = spawnState('spawn-a2-2', 'p-1', 'partial');
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-a2-2', tool: 'wait', receiverThreadIds: ['p-1', 'p-2', 'p-3'] }, begin);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-a2-2', tool: 'wait',
            receiverThreadIds: ['p-1', 'p-2', 'p-3'],
            // Only p-1 reported (the wait returned when one target resolved).
            status: { 'p-1': { completed: true, message: 'p1 finished' } },
        }, waitBegin);
        const ends = waitEnd.envelopes.filter(e => e.ev.t === 'tool-call-end');
        expect(ends.map(e => (e.ev as any).call)).toEqual(['wait-a2-2#0:p-1', 'wait-a2-2#1:p-2', 'wait-a2-2#2:p-3']);
        const end1 = JSON.stringify((ends[0].ev as any).output ?? (ends[0].ev as any).result ?? {});
        const end2 = JSON.stringify((ends[1].ev as any).output ?? (ends[1].ev as any).result ?? {});
        const end3 = JSON.stringify((ends[2].ev as any).output ?? (ends[2].ev as any).result ?? {});
        // Reported target carries its own status.
        expect(end1).toContain('p1 finished');
        // Absent targets carry an explicit unreported marker — and NOT the reported target's status.
        expect(end2).toContain('unreported');
        expect(end3).toContain('unreported');
        expect(end2).not.toContain('p1 finished');
        expect(end3).not.toContain('p1 finished');
    });

    // AC-A2-4 (no regression): a SINGLE-target wait keeps the prior first-wins buffered-summary behavior
    // (the multi-target per-target path only triggers for length >= 2).
    it('AC-A2-4: single-target wait is unchanged (buffers final_summary, no synthetic per-target ids)', () => {
        const begin = spawnState('spawn-a2-4', 'solo', 'single');
        const sessionSubagent = ssnOf(begin);
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-a2-4', tool: 'wait', receiverThreadIds: ['solo'] }, begin);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-a2-4', tool: 'wait', status: 'completed',
            receiverThreadIds: ['solo'],
            agentsStates: { 'solo': { status: 'completed', message: 'solo summary' } },
        }, waitBegin);
        // No synthetic per-target ids for a single target.
        expect(waitEnd.envelopes.filter(e => (e.ev as any).call?.includes('#'))).toHaveLength(0);
        // Prior buffered-summary behavior intact.
        expect(waitEnd.subagentLifecycles.get(sessionSubagent)?.bufferedFinalSummary).toBe('solo summary');
    });

    // Cycle 9 (NO-regression): the per-target multi-target fan-out is REPLAY-ONLY. On the LIVE path
    // (runCodex.ts — state.replay UNSET) mapCodexMcpMessageToSessionEnvelopes is shared, but a multi-target
    // wait_agent MUST collapse to baseline single begin/end (firstReceiverThreadId), NOT emit N per-target
    // synthetic starts whose matching ends never fire (the N-1 dangling-starts regression). This test feeds
    // a 2-target wait begin+end with replay UNSET and asserts: NO synthetic per-target ids, exactly one
    // collapsed begin, and every emitted tool-call-start has a matching tool-call-end (no dangling starts).
    it('AC-NOREG: LIVE multi-target wait (replay unset) collapses to baseline single begin/end — no per-target synthetic starts, no dangling starts', () => {
        // Live caller never sets replay; build a live spawn lifecycle so the wait resolves a real ssn.
        const liveBegin = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_begin', call_id: 'live-spawn', tool: 'spawnAgent', prompt: 'p', receiverThreadIds: [], agentsStates: {} },
            { currentTurnId: 'turn-live' }
        );
        const liveSpawned = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_end', call_id: 'live-spawn', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['L-1'], agentsStates: { 'L-1': { status: 'running', message: null } } },
            liveBegin
        );
        // Multi-target wait BEGIN on the live path (replay still unset throughout).
        const waitBegin = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_begin', call_id: 'live-wait', tool: 'wait', receiverThreadIds: ['L-1', 'L-2'] },
            liveSpawned
        );
        const waitEnd = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_end', call_id: 'live-wait', tool: 'wait', status: 'completed', receiverThreadIds: ['L-1', 'L-2'], agentsStates: { 'L-1': { status: 'completed', message: 'done' } } },
            waitBegin
        );
        const all = [...waitBegin.envelopes, ...waitEnd.envelopes];
        // No synthetic per-target call ids on the live path (those are the replay-only fan-out).
        expect(all.filter(e => (e.ev as any).call?.includes('#'))).toHaveLength(0);
        // Exactly ONE collapsed wait_agent begin (baseline firstReceiverThreadId collapse).
        const waitStarts = waitBegin.envelopes.filter(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.wait_agent');
        expect(waitStarts).toHaveLength(1);
        // Every emitted tool-call-start has a matching tool-call-end — zero dangling starts.
        const startCalls = all.filter(e => e.ev.t === 'tool-call-start').map(e => (e.ev as any).call);
        const endCalls = new Set(all.filter(e => e.ev.t === 'tool-call-end').map(e => (e.ev as any).call));
        const dangling = startCalls.filter(c => !endCalls.has(c));
        expect(dangling).toEqual([]);
    });

    // Codex finding #3 (Cycle-7 parity): a multi-target wait still buffers each target's final-summary
    // message on its lifecycle entry, so a later close_agent terminal inherits it even when the close
    // itself carries no agentsStates.
    it('AC-A2 (parity): multi-target wait buffers per-target summary; later close inherits it', () => {
        // Two separate spawns -> two distinct lifecycle ssn.
        const beginA = spawnState('spawn-pa', 'ta', 'a');
        const ssnA = ssnOf(beginA);
        const beginB = spawnState('spawn-pb', 'tb', 'b', beginA);
        const ssnB = ssnOf(beginB);
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-pp', tool: 'wait', receiverThreadIds: ['ta', 'tb'] }, beginB);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-pp', tool: 'wait',
            receiverThreadIds: ['ta', 'tb'],
            status: { 'ta': { completed: true, message: 'A summary' }, 'tb': { completed: true, message: 'B summary' } },
        }, waitBegin);
        // Each target's summary buffered on its OWN lifecycle entry.
        expect(waitEnd.subagentLifecycles.get(ssnA)?.bufferedFinalSummary).toBe('A summary');
        expect(waitEnd.subagentLifecycles.get(ssnB)?.bufferedFinalSummary).toBe('B summary');
        // close_agent on target A (no agentsStates) inherits the buffered summary.
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-pa', tool: 'closeAgent', receiverThreadIds: ['ta'] }, waitEnd);
        const closeEnd = step({ type: 'collab_agent_call_end', call_id: 'close-pa', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['ta'] }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssnA}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect((lifecycleEnd.ev.result as any).final_summary).toBe('A summary');
        }
    });

    // Cycle 7 §5.3.D.5 AC5: empty/missing agentsStates — terminal still emits without final_summary.
    it('case a-4: missing agentsStates — terminal emits without final_summary (graceful degradation)', () => {
        const begin = spawnState('spawn-1d', 'child-A4', 'no agentsStates');
        const sessionSubagent = ssnOf(begin);
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-1d', tool: 'closeAgent', receiverThreadIds: ['child-A4'] }, begin);
        const closeEnd = step({ type: 'collab_agent_call_end', call_id: 'close-1d', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['child-A4'] }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${sessionSubagent}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ status: 'completed', lifecycle_state: 'completed' });
            expect((lifecycleEnd.ev.result as Record<string, unknown>).final_summary).toBeUndefined();
        }
    });

    // Cycle 7 §5.3.D.5: errored status from agentsStates — terminal goes to errored state.
    it('case a-5: errored status — terminal goes to errored, summary still inherits', () => {
        const begin = spawnState('spawn-1e', 'child-A5', 'will fail');
        const sessionSubagent = ssnOf(begin);
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-1e', tool: 'wait', receiverThreadIds: ['child-A5'] }, begin);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-1e', tool: 'wait', status: 'completed',
            receiverThreadIds: ['child-A5'],
            agentsStates: { 'child-A5': { status: 'errored', message: 'subtask failed' } },
        }, waitBegin);
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-1e', tool: 'closeAgent', receiverThreadIds: ['child-A5'] }, waitEnd);
        const closeEnd = step({ type: 'collab_agent_call_end', call_id: 'close-1e', tool: 'closeAgent', status: 'failed', receiverThreadIds: ['child-A5'] }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${sessionSubagent}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ status: 'failed', final_summary: 'subtask failed', lifecycle_state: 'errored' });
        }
    });

    it('case b: spawn-no-wait-close emits lifecycle started then completed (skipping running/ready)', () => {
        const begin = spawnState('spawn-2', 'child-B', 'quick task');
        const sessionSubagent = ssnOf(begin);
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-2', tool: 'closeAgent', receiverThreadIds: ['child-B'] }, begin);
        const closeEnd = step({ type: 'collab_agent_call_end', call_id: 'close-2', tool: 'closeAgent', status: 'completed' }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${sessionSubagent}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ lifecycle_state: 'completed' });
        }
    });

    it('case c: spawn followed by turn_aborted emits lifecycle terminal errored with status cancelled', () => {
        const begin = spawnState('spawn-3', 'child-C', 'will be aborted');
        const sessionSubagent = ssnOf(begin);
        const aborted = step({ type: 'turn_aborted' }, begin);
        const lifecycleEnd = aborted.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${sessionSubagent}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ status: 'cancelled', lifecycle_state: 'errored' });
        }
        // task_started after the aborted turn must clear the lifecycle map
        const restarted = step({ type: 'task_started' }, aborted);
        expect(restarted.subagentLifecycles.size).toBe(0);
    });

    it('case d: two parallel subagents emit two disjoint lifecycle envelopes', () => {
        const beginA = spawnState('spawn-A', 'child-X', 'task A');
        const sessionA = ssnOf(beginA);
        const beginB = spawnState('spawn-B', 'child-Y', 'task B', beginA);
        // beginB.envelopes contains B's spawn + B's lifecycle. Only B is in this step's envelopes.
        const lifecycleB = beginB.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle');
        expect(lifecycleB).toBeDefined();
        const sessionB = (lifecycleB!.ev as any).args.sessionSubagent as string;
        expect(sessionA).not.toBe(sessionB);

        // Map state holds both
        expect(beginB.subagentLifecycles.size).toBe(2);
        expect(beginB.subagentLifecycles.get(sessionA)?.state).toBe('started');
        expect(beginB.subagentLifecycles.get(sessionB)?.state).toBe('started');

        // Close A then B in interleaved order
        const closeABegin = step({ type: 'collab_agent_call_begin', call_id: 'close-A', tool: 'closeAgent', receiverThreadIds: ['child-X'] }, beginB);
        const closeAEnd = step({ type: 'collab_agent_call_end', call_id: 'close-A', tool: 'closeAgent', status: 'completed' }, closeABegin);
        expect(closeAEnd.subagentLifecycles.get(sessionA)?.state).toBe('completed');
        expect(closeAEnd.subagentLifecycles.get(sessionB)?.state).toBe('started');

        const closeBBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-B', tool: 'closeAgent', receiverThreadIds: ['child-Y'] }, closeAEnd);
        const closeBEnd = step({ type: 'collab_agent_call_end', call_id: 'close-B', tool: 'closeAgent', status: 'completed' }, closeBBegin);
        expect(closeBEnd.subagentLifecycles.get(sessionB)?.state).toBe('completed');
    });

    // Cycle 8 AC3 (spec-20260506-203844 cycle 8): production-shape end-to-end. Drives the full
    // real-Codex sequence WITHOUT going through the spawnState helper, so the assertions verify
    // the exact arm-by-arm shape expected from /tmp/codex-src/codex-rs/app-server-protocol/src/protocol/event_mapping.rs:
    //   spawn-begin :75-86  (receiverThreadIds: [], agentsStates: {})
    //   spawn-end   :104-114 (receiverThreadIds: [child], agentsStates: { child: state })
    //   wait-end    :205-240 (agentsStates: { child: { status: 'finished', message: 'final answer text' } })
    //   close-end   :260-end (status: 'completed', receiverThreadIds: [child], agentsStates: { child: state })
    // Asserts the lifecycle terminal envelope's final_summary lands correctly. This test is the
    // cycle-8 systemic guardrail proving the cycle-7 close-NO production gap is closed: the
    // lifecycle Map entry MUST be created at spawn-begin time even though receiverThreadIds: [].
    it('AC3: production-shape spawn-begin (empty rcv) → spawn-end → wait-end → close-end emits final_summary', () => {
        // 1. spawn-begin with EMPTY receiverThreadIds (real Codex shape per event_mapping.rs:75-86).
        const spawnBegin = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_begin', call_id: 'spawn-prod', tool: 'spawnAgent', prompt: 'inspect production code', receiverThreadIds: [], agentsStates: {} },
            { currentTurnId: 'turn-prod' }
        );
        // AC1: lifecycle Map entry created at spawn-begin even though receiverThreadIds is empty.
        expect(spawnBegin.subagentLifecycles.size).toBe(1);
        const lifecycleStart = spawnBegin.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle');
        expect(lifecycleStart).toBeDefined();
        const ssn = (lifecycleStart!.ev as any).args.sessionSubagent as string;
        expect(spawnBegin.subagentLifecycles.get(ssn)?.state).toBe('started');

        // 2. spawn-end with single receiverThreadId per event_mapping.rs:104-114 (Some branch).
        // AC2: receiverThreadId binds to the same ssn (no double-fire).
        const spawnEnd = step(
            { type: 'collab_agent_call_end', call_id: 'spawn-prod', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child-prod'], agentsStates: { 'child-prod': { status: 'running', message: null } } },
            spawnBegin
        );
        expect(spawnEnd.providerSubagentToSessionSubagent.get('child-prod')).toBe(ssn);
        expect(spawnEnd.subagentLifecycles.size).toBe(1);

        // 3. wait-begin (event_mapping.rs:181-204) carries receiverThreadIds at begin.
        const waitBegin = step(
            { type: 'collab_agent_call_begin', call_id: 'wait-prod', tool: 'wait', receiverThreadIds: ['child-prod'] },
            spawnEnd
        );
        // 4. wait-end (event_mapping.rs:205-240) carries agentsStates with finished + message.
        const waitEnd = step(
            { type: 'collab_agent_call_end', call_id: 'wait-prod', tool: 'wait', status: 'completed', receiverThreadIds: ['child-prod'], agentsStates: { 'child-prod': { status: 'finished', message: 'final answer text' } } },
            waitBegin
        );
        expect(waitEnd.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('final answer text');

        // 5. close-begin (event_mapping.rs:241-258) + close-end (:260-end).
        const closeBegin = step(
            { type: 'collab_agent_call_begin', call_id: 'close-prod', tool: 'closeAgent', receiverThreadIds: ['child-prod'] },
            waitEnd
        );
        const closeEnd = step(
            { type: 'collab_agent_call_end', call_id: 'close-prod', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['child-prod'], agentsStates: { 'child-prod': { status: 'finished', message: 'final answer text' } } },
            closeBegin
        );
        // AC3: lifecycle terminal envelope emits with final_summary populated.
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssn}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ status: 'completed', final_summary: 'final answer text', lifecycle_state: 'completed' });
        }
        expect(closeEnd.subagentLifecycles.get(ssn)?.state).toBe('completed');
    });

    // Bug fix (live-confirmed via React-fiber inspection on dev): a subagent that completes WITHOUT an
    // explicit close_agent (spawn → wait → work tool → final agent_message, NO close_agent) is terminated
    // by the end-of-turn flush path. Before the fix flushOpenLifecycles emitted a bare
    // { status, lifecycle_state } result with NO final_summary — the subagent's actual final answer arrived
    // as an agent_message and was only rendered as child agent-text, never stored on the lifecycle — so the
    // app's "Result" section never appeared for these subagents. This replays the EXACT failing sequence and
    // asserts the flush-emitted functions.subagent_lifecycle terminal carries final_summary == the answer.
    it('AC-flush-summary: no-close subagent — final agent_message answer buffers onto lifecycle and flush emits final_summary', () => {
        // 1. spawn-begin (empty rcv) + 2. spawn-end (binds child-flush -> ssn). spawnState mirrors the
        //    real two-arm production shape per event_mapping.rs:75-86 / :104-114.
        const begin = spawnState('spawn-flush', 'child-flush', 'inspect with no close');
        const ssn = ssnOf(begin);
        expect(begin.subagentLifecycles.get(ssn)?.state).toBe('started');

        // 3. wait-begin + wait-end whose agentsStates has NO usable message (message: null) — so the
        //    bufferedFinalSummary is NOT populated by the wait path (the failing precondition).
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-flush', tool: 'wait', receiverThreadIds: ['child-flush'] }, begin);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-flush', tool: 'wait', status: 'completed',
            receiverThreadIds: ['child-flush'],
            agentsStates: { 'child-flush': { status: 'running', message: null } },
        }, waitBegin);
        // Precondition: wait did NOT buffer a usable summary (message was null).
        expect(waitEnd.subagentLifecycles.get(ssn)?.bufferedFinalSummary == null).toBe(true);

        // 4. a work tool executed by the subagent (exec_command begin/end carrying the child threadId).
        const execBegin = step({ type: 'exec_command_begin', call_id: 'exec-flush', command: ['ls', '-la'], threadId: 'child-flush' }, waitEnd);
        const execEnd = step({ type: 'exec_command_end', call_id: 'exec-flush', exit_code: 0, stdout: 'files', threadId: 'child-flush' }, execBegin);

        // 5. the subagent's FINAL ANSWER arrives as an agent_message (phase final_answer) carrying the
        //    child threadId so resolveSessionSubagent maps it to ssn. The handler must buffer the text.
        const finalMsg = step({ type: 'agent_message', message: 'the subagent final answer', phase: 'final_answer', threadId: 'child-flush' }, execEnd);
        expect(finalMsg.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('the subagent final answer');

        // 6. task_complete triggers flushOpenLifecycles — NO close_agent ever fired. The flush-emitted
        //    lifecycle terminal MUST carry final_summary equal to the agent_message answer text.
        const done = step({ type: 'task_complete' }, finalMsg);
        const lifecycleEnd = done.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssn}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ status: 'completed', final_summary: 'the subagent final answer', lifecycle_state: 'completed' });
        }
    });

    // No-regression companion: when a no-close subagent NEVER produced a usable final answer (no
    // final_answer agent_message, wait message null), the flush terminal must still emit WITHOUT a
    // final_summary key — mirroring emitLifecycleEnd's conditional inclusion (graceful degradation).
    it('AC-flush-summary (no-reg): flush without any buffered summary omits final_summary', () => {
        const begin = spawnState('spawn-flush-2', 'child-flush-2', 'no answer task');
        const ssn = ssnOf(begin);
        const done = step({ type: 'task_complete' }, begin);
        const lifecycleEnd = done.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssn}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ status: 'completed', lifecycle_state: 'completed' });
            expect((lifecycleEnd.ev.result as Record<string, unknown>).final_summary).toBeUndefined();
        }
    });

    // No-regression: the explicit close_agent path still attaches final_summary (the wait-buffered summary
    // is inherited by the close terminal — exactly the case-a behavior, re-asserted here against this fix).
    it('AC-flush-summary (no-reg): close_agent path still carries final_summary (no regression)', () => {
        const begin = spawnState('spawn-flush-3', 'child-flush-3', 'closes explicitly');
        const ssn = ssnOf(begin);
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-flush-3', tool: 'wait', receiverThreadIds: ['child-flush-3'] }, begin);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-flush-3', tool: 'wait', status: 'completed',
            receiverThreadIds: ['child-flush-3'],
            agentsStates: { 'child-flush-3': { status: 'completed', message: 'closed summary' } },
        }, waitBegin);
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-flush-3', tool: 'closeAgent', receiverThreadIds: ['child-flush-3'] }, waitEnd);
        const closeEnd = step({ type: 'collab_agent_call_end', call_id: 'close-flush-3', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['child-flush-3'] }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssn}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ status: 'completed', final_summary: 'closed summary', lifecycle_state: 'completed' });
        }
    });

    // Cycle 6 AC-C6-1 (S1): non-spawn verb with no receiverThreadId resolves sessionSubagent
    // from the single active lifecycle in the map (M1 fallback path).
    it('S1 (AC-C6-1): send_input with no receiverThreadId carries sessionSubagent via single-active-lifecycle fallback', () => {
        // spawn_agent begin → creates one active lifecycle (state: 'started')
        const begin = spawnState('spawn-s1', 'child-S1', 'single active lifecycle test');
        const lifecycleStart = begin.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle');
        const ssn = (lifecycleStart!.ev as any).args.sessionSubagent as string;
        expect(begin.subagentLifecycles.get(ssn)?.state).toBe('started');

        // send_input with NO receiverThreadId — M1 fallback must resolve sessionSubagent
        const sendInput = step({
            type: 'collab_agent_call_begin',
            call_id: 'send-input-1',
            tool: 'sendInput',
            prompt: 'continue',
            receiverThreadIds: [],  // absent / empty
        }, begin);

        const sendStartEv = sendInput.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.send_input');
        expect(sendStartEv).toBeDefined();
        if (sendStartEv && sendStartEv.ev.t === 'tool-call-start') {
            // Cycle 7 (M1/M1.a/M1.b): the single-active fallback STILL resolves ssn, but send_input is now
            // a recursion-safe sidechain CHILD of the lifecycle: subagent = ssn, ev.call = provider call_id
            // ('send-input-1', NOT ssn), and args MUST NOT carry sessionSubagent.
            expect(sendStartEv.subagent).toBe(ssn);
            expect(sendStartEv.ev.call).toBe('send-input-1');
            expect(sendStartEv.ev.call).not.toBe(ssn);
            expect(sendStartEv.ev.args.sessionSubagent).toBeUndefined();
        }
        // AC-C6-1: providerSubagentToSessionSubagent must register for call-end matching (state-level resolution unchanged)
        expect(sendInput.providerSubagentToSessionSubagent.get('call:send-input-1')).toBe(ssn);
    });

    // Cycle 6 AC-C6-1b (S3): when two or more active lifecycles exist and receiverThreadId is absent,
    // sessionSubagent stays undefined — no wrong attribution to either lifecycle.
    it('S3 (AC-C6-1b): parallel subagents guard — sessionSubagent undefined when 2+ active and no receiverThreadId', () => {
        // Spawn two active subagents
        const beginA = spawnState('spawn-s3a', 'child-S3A', 'parallel task A');
        const beginB = spawnState('spawn-s3b', 'child-S3B', 'parallel task B', beginA);
        expect(beginB.subagentLifecycles.size).toBe(2);

        // Non-spawn verb with NO receiverThreadId — guard must leave sessionSubagent undefined
        const sendInput = step({
            type: 'collab_agent_call_begin',
            call_id: 'send-input-parallel',
            tool: 'sendInput',
            prompt: 'ambiguous',
            receiverThreadIds: [],  // absent — cannot disambiguate
        }, beginB);

        const sendStartEv = sendInput.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.send_input');
        expect(sendStartEv).toBeDefined();
        if (sendStartEv && sendStartEv.ev.t === 'tool-call-start') {
            // AC-C6-1b: sessionSubagent must NOT be set (no wrong attribution)
            expect(sendStartEv.ev.args.sessionSubagent).toBeUndefined();
        }
        // AC-C6-1b: no state pollution in providerSubagentToSessionSubagent
        expect(sendInput.providerSubagentToSessionSubagent.get('call:send-input-parallel')).toBeUndefined();
    });

    // AC-C6-3: rollout-replay (A2) path emits a real lifecycle envelope for spawnAgent.
    // rolloutHistoryReplay.ts routes collab lifecycle verbs through collab_agent_call_begin so
    // the mapper's spawn_agent handler fires emitLifecycleStart. This test verifies the resulting
    // envelope has the correct shape: name === 'functions.subagent_lifecycle', call starts with
    // 'lifecycle:', args.sessionSubagent populated.
    it('AC-C6-3: collab_agent_call_begin (spawn_agent) via replay path emits functions.subagent_lifecycle envelope', () => {
        // Simulate what rolloutHistoryReplay.ts mapFunctionCall() now produces for a spawnAgent record.
        const spawnBegin = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'collab_agent_call_begin',
                call_id: 'replay-spawn-1',
                tool: 'spawnAgent',
                prompt: 'do some work',
                receiverThreadIds: [],
                agentsStates: {},
            },
            { currentTurnId: 'turn-replay' }
        );

        // AC-C6-3 assertion 1: a lifecycle envelope must be emitted (name === LIFECYCLE_ENVELOPE_NAME).
        const lifecycleEnv = spawnBegin.envelopes.find(
            (e) => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle'
        );
        expect(lifecycleEnv).toBeDefined();
        if (!lifecycleEnv || lifecycleEnv.ev.t !== 'tool-call-start') throw new Error('Expected lifecycle tool-call-start');

        // AC-C6-3 assertion 2: call ID must NOT start with 'lifecycle:' at the envelope level —
        // wait, the convention is call === `lifecycle:${ssn}`. QA clarifies: the reducer normalizes
        // `lifecycle:<ssn>` to a navigable ID (NOT starting with 'lifecycle:'). The CLI-side assertion
        // verifiable here is: (a) call STARTS WITH 'lifecycle:' (mapper convention), (b) args.sessionSubagent
        // is the bare ssn (the part after 'lifecycle:'), (c) sessionSubagent IS a cuid2 (navigable).
        const lcCall = lifecycleEnv.ev.call;
        expect(lcCall.startsWith('lifecycle:')).toBe(true);
        const ssn = lifecycleEnv.ev.args.sessionSubagent as string;
        expect(ssn).toBeTruthy();
        expect(lcCall).toBe(`lifecycle:${ssn}`);
        // ssn must be a valid cuid2 (the reducer strips 'lifecycle:' prefix to produce a navigable ID).
        expect(isCuid(ssn)).toBe(true);

        // AC-C6-3 assertion 3: args.sessionSubagent populated, lifecycle_state is 'started'.
        expect(lifecycleEnv.ev.args.lifecycle_state).toBe('started');

        // AC-C6-3 assertion 4: subagentLifecycles map has the entry (mapper state is set).
        expect(spawnBegin.subagentLifecycles.get(ssn)?.state).toBe('started');
        expect(spawnBegin.subagentLifecycles.get(ssn)?.prompt).toBe('do some work');
    });

    // ================================================================================
    // Cycle 8 (M5/M6) — orphan-end suppression + invariant postcondition, mapper-level.
    // ================================================================================

    function stepC8(message: any, prior: any) { return mapCodexMcpMessageToSessionEnvelopes(message, prior); }

    // AC-C8-5 (M5, RC-3): a TRUE orphan control-verb END (no matching BEGIN emitted this turn, ssn
    // unresolvable) is suppressed — no scattered top-level tool-call-end card.
    it('AC-C8-5: orphan close_agent END with no emitted BEGIN is suppressed (no scattered card)', () => {
        const started = stepC8({ type: 'task_started', turn_id: 'turn-c8-5' }, { currentTurnId: null, emittedCollabBeginCallIds: new Set<string>() });
        // A close_agent END arrives with NO prior begin and no resolvable receiver thread (true orphan).
        const orphanEnd = stepC8({ type: 'collab_agent_call_end', call_id: 'orphan-close-1', tool: 'closeAgent', status: 'completed', receiverThreadIds: [] }, started);
        // No tool-call-end envelope emitted (the orphan card is suppressed).
        expect(orphanEnd.envelopes.filter(e => e.ev.t === 'tool-call-end')).toHaveLength(0);
    });

    // AC-C8-5 anti-over-suppression: a control-verb END whose BEGIN WAS emitted and whose ssn resolves
    // is NOT suppressed (protects the A2 control-verb-children behavior).
    it('AC-C8-5: a legitimate END (begin emitted + ssn resolves) is NOT suppressed', () => {
        const started = stepC8({ type: 'task_started', turn_id: 'turn-c8-5b' }, { currentTurnId: null, emittedCollabBeginCallIds: new Set<string>() });
        // Spawn so a lifecycle exists; bind a receiver thread.
        const spawnBegin = stepC8({ type: 'collab_agent_call_begin', call_id: 'spawn-c8-5b', tool: 'spawnAgent', prompt: 'work', receiverThreadIds: [], agentsStates: {} }, started);
        const spawnEnd = stepC8({ type: 'collab_agent_call_end', call_id: 'spawn-c8-5b', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child-5b'], agentsStates: { 'child-5b': { status: 'running', message: null } } }, spawnBegin);
        // A wait BEGIN is emitted, then its END — the END must NOT be suppressed.
        const waitBegin = stepC8({ type: 'collab_agent_call_begin', call_id: 'wait-c8-5b', tool: 'wait', receiverThreadIds: ['child-5b'] }, spawnEnd);
        const waitEnd = stepC8({ type: 'collab_agent_call_end', call_id: 'wait-c8-5b', tool: 'wait', status: 'completed', receiverThreadIds: ['child-5b'] }, waitBegin);
        // The wait END tool-call-end IS emitted (begin was emitted for wait-c8-5b).
        expect(waitEnd.envelopes.filter(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === 'wait-c8-5b')).toHaveLength(1);
    });

    // AC-C8-6 (mode b): out-of-order control-verb records before their lifecycle do not throw.
    it('AC-C8-6: control-verb end before any lifecycle does not crash (mode b)', () => {
        const started = stepC8({ type: 'task_started', turn_id: 'turn-c8-6' }, { currentTurnId: null, emittedCollabBeginCallIds: new Set<string>() });
        // A wait END arrives before any spawn/lifecycle. Must not throw; emits no scattered card.
        expect(() => stepC8({ type: 'collab_agent_call_end', call_id: 'ooo-wait', tool: 'wait', status: 'completed', receiverThreadIds: [] }, started)).not.toThrow();
        const res = stepC8({ type: 'collab_agent_call_end', call_id: 'ooo-wait', tool: 'wait', status: 'completed', receiverThreadIds: [] }, started);
        expect(res.envelopes.filter(e => e.ev.t === 'tool-call-end')).toHaveLength(0);
    });

    // AC-C8-8 (M6 postcondition / INV-1+INV-2): a control-verb child START with subagent===ssn carries
    // ev.call === provider call_id (never ssn) and args WITHOUT sessionSubagent.
    it('AC-C8-8: control-verb child start preserves INV-1 (call !== ssn) and INV-2 (no sessionSubagent in args)', () => {
        const started = stepC8({ type: 'task_started', turn_id: 'turn-c8-8' }, { currentTurnId: null, emittedCollabBeginCallIds: new Set<string>() });
        const spawnBegin = stepC8({ type: 'collab_agent_call_begin', call_id: 'spawn-c8-8', tool: 'spawnAgent', prompt: 'work', receiverThreadIds: [], agentsStates: {} }, started);
        const ssn = (spawnBegin.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle')!.ev as any).args.sessionSubagent as string;
        // The spawn control-verb child start (functions.spawn_agent) attaches to ssn.
        const child = spawnBegin.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.spawn_agent');
        expect(child).toBeDefined();
        expect((child as any).subagent).toBe(ssn);
        expect((child as any).ev.call).not.toBe(ssn);                 // INV-1
        expect((child as any).ev.args.sessionSubagent).toBeUndefined(); // INV-2
    });

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // #1 / OBJ-5 (AC-A1) — duplicate final-answer suppression + source-tagged buffer precedence.
    // ─────────────────────────────────────────────────────────────────────────────────────────────
    function agentMessage(message: any, prior: any, opts?: { phase?: string }) {
        return step({ type: 'agent_message', message, phase: opts?.phase, threadId: 'child-A', turnId: 'child-turn' }, prior);
    }

    it('AC-A1 (case 1): subagent final_answer with lifecycle emits NO child text duplicate, buffers final_summary; intermediate still emits text', () => {
        // Bind child-A to the spawn ssn so agent_message resolves to the subagent.
        const begin = spawnState('spawn-a1-1', 'child-A', 'inspect alpha');
        const ssn = ssnOf(begin);
        // Intermediate (non-final) subagent message STILL emits a visible text envelope.
        const inter = agentMessage('working on it', begin);
        expect(inter.envelopes.filter(e => e.ev.t === 'text')).toHaveLength(1);
        // final_answer with a lifecycle entry → NO child text duplicate (omission), but buffered for Result.
        const fin = agentMessage('the final answer', inter, { phase: 'final_answer' });
        expect(fin.envelopes.filter(e => e.ev.t === 'text')).toHaveLength(0);
        // No NEW session-protocol envelope shape introduced (codex#4): only known kinds present.
        for (const e of fin.envelopes) {
            expect(['text', 'tool-call-start', 'tool-call-end', 'start', 'stop', 'turn-start', 'turn-end']).toContain(e.ev.t);
        }
        expect(fin.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('the final answer');
        expect(fin.subagentLifecycles.get(ssn)?.bufferedFinalSummarySource).toBe('final_answer');
    });

    it('AC-A1 (case 2): final_answer buffered THEN later intermediate text → buffer still equals the final_answer', () => {
        const begin = spawnState('spawn-a1-2', 'child-A', 'inspect beta');
        const ssn = ssnOf(begin);
        const fin = agentMessage('AUTHORITATIVE final', begin, { phase: 'final_answer' });
        expect(fin.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('AUTHORITATIVE final');
        // A later non-final intermediate message must NOT clobber the authoritative final_answer.
        const later = agentMessage('stray late chatter', fin);
        expect(later.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('AUTHORITATIVE final');
        expect(later.subagentLifecycles.get(ssn)?.bufferedFinalSummarySource).toBe('final_answer');
        // The intermediate text still renders (only finals are suppressed).
        expect(later.envelopes.filter(e => e.ev.t === 'text')).toHaveLength(1);
    });

    it('AC-A1 (case 3): intermediate-only + flush WITHOUT final_answer → NO Result section (no false summary from intermediate)', () => {
        const begin = spawnState('spawn-a1-3', 'child-A', 'inspect gamma');
        const ssn = ssnOf(begin);
        // Only intermediate chatter, no final_answer, no authoritative agentsStates.message.
        const inter = agentMessage('intermediate chatter', begin);
        expect(inter.subagentLifecycles.get(ssn)?.bufferedFinalSummarySource).toBe('intermediate');
        const done = step({ type: 'task_complete' }, inter);
        const lifecycleEnd = done.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssn}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            // Intermediate chatter must NOT surface as a Result final_summary.
            expect((lifecycleEnd.ev.result as Record<string, unknown>).final_summary).toBeUndefined();
        }
    });

    it('AC-A1 (case 4): a wait_agent end with message:null after a real final_answer was buffered → the real final_answer is NOT erased', () => {
        const begin = spawnState('spawn-a1-4', 'child-A', 'inspect delta');
        const ssn = ssnOf(begin);
        const fin = agentMessage('REAL final answer', begin, { phase: 'final_answer' });
        expect(fin.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('REAL final answer');
        // A later wait_agent end with message:null must NOT erase the buffered authoritative summary.
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-a1-4', tool: 'wait', receiverThreadIds: ['child-A'] }, fin);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-a1-4', tool: 'wait', status: 'completed',
            receiverThreadIds: ['child-A'], agentsStates: { 'child-A': { status: 'completed', message: null } },
        }, waitBegin);
        expect(waitEnd.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('REAL final answer');
        expect(waitEnd.subagentLifecycles.get(ssn)?.bufferedFinalSummarySource).toBe('final_answer');
    });

    it('AC-A1 (case 5, MIN-4): whitespace-only final_answer → no buffer, no Result section', () => {
        const begin = spawnState('spawn-a1-5', 'child-A', 'inspect epsilon');
        const ssn = ssnOf(begin);
        const fin = agentMessage('   ', begin, { phase: 'final_answer' });
        // Whitespace-only final answer (trim().length===0) does NOT populate the buffer.
        expect(fin.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBeUndefined();
        // It is still suppressed as a child text (final_answer + lifecycle) — no duplicate, no Result.
        expect(fin.envelopes.filter(e => e.ev.t === 'text')).toHaveLength(0);
        const done = step({ type: 'task_complete' }, fin);
        const lifecycleEnd = done.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssn}`);
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect((lifecycleEnd.ev.result as Record<string, unknown>).final_summary).toBeUndefined();
        }
    });

    it('AC-A1 (case 6, MIN-4): whitespace-only agentsStates.message does NOT populate or erase the authoritative summary', () => {
        const begin = spawnState('spawn-a1-6', 'child-A', 'inspect zeta');
        const ssn = ssnOf(begin);
        const fin = agentMessage('the kept answer', begin, { phase: 'final_answer' });
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-a1-6', tool: 'wait', receiverThreadIds: ['child-A'] }, fin);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-a1-6', tool: 'wait', status: 'completed',
            receiverThreadIds: ['child-A'], agentsStates: { 'child-A': { status: 'completed', message: '   ' } },
        }, waitBegin);
        // Whitespace agentsStates.message neither populates nor erases the authoritative final_answer.
        expect(waitEnd.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('the kept answer');
        expect(waitEnd.subagentLifecycles.get(ssn)?.bufferedFinalSummarySource).toBe('final_answer');
    });

    it('AC-A1 (codex#1): close_agent must NOT surface intermediate chatter as final_summary; a close-time agentsStates.message wins over an intermediate buffer', () => {
        const begin = spawnState('spawn-a1-7', 'child-A', 'inspect eta');
        const ssn = ssnOf(begin);
        // Only intermediate chatter buffered (provenance 'intermediate', NOT authoritative).
        const inter = agentMessage('intermediate progress note', begin);
        expect(inter.subagentLifecycles.get(ssn)?.bufferedFinalSummarySource).toBe('intermediate');
        // close_agent carries a real agentsStates.message — it must WIN over the intermediate buffer.
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-a1-7', tool: 'closeAgent', receiverThreadIds: ['child-A'] }, inter);
        const closeEnd = step({
            type: 'collab_agent_call_end', call_id: 'close-a1-7', tool: 'closeAgent', status: 'completed',
            receiverThreadIds: ['child-A'], agentsStates: { 'child-A': { status: 'completed', message: 'the authoritative close summary' } },
        }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssn}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            // The intermediate chatter must NOT be the Result; the close agentsStates.message is.
            expect(lifecycleEnd.ev.result).toMatchObject({ final_summary: 'the authoritative close summary' });
        }
    });

    it('AC-A1 (codex#1, no-close-message): close_agent with NO agentsStates.message + only an intermediate buffer → NO Result final_summary', () => {
        const begin = spawnState('spawn-a1-8', 'child-A', 'inspect theta');
        const ssn = ssnOf(begin);
        const inter = agentMessage('just intermediate text', begin);
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-a1-8', tool: 'closeAgent', receiverThreadIds: ['child-A'] }, inter);
        const closeEnd = step({ type: 'collab_agent_call_end', call_id: 'close-a1-8', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['child-A'] }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssn}`);
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            // An intermediate buffer is NOT authoritative — close emits no final_summary.
            expect((lifecycleEnd.ev.result as Record<string, unknown>).final_summary).toBeUndefined();
        }
    });

    it('AC-A1 (no-lifecycle): a final_answer with NO lifecycle entry is NOT suppressed (preserve text, no data loss)', () => {
        // No spawn → no lifecycle entry → the subagent agent_message text must still emit (no suppression).
        const res = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'orphan final', phase: 'final_answer' },
            { currentTurnId: 'turn-orphan' }
        );
        expect(res.envelopes.filter(e => e.ev.t === 'text')).toHaveLength(1);
    });

    it('AC-A1 (iter-2 BUG 1): a real final_answer is NOT overwritten by a LATER wait agentsStates.message that differs (the real answer survives in the Result)', () => {
        // The final-answer child text was OMITTED (#1 suppression), so the buffer is the ONLY carrier of the
        // real answer. A later wait with a DIVERGENT non-empty agentsStates.message must NOT clobber it, or
        // the real answer would be rendered nowhere.
        const begin = spawnState('spawn-bug1', 'child-A', 'inspect iota');
        const ssn = ssnOf(begin);
        const fin = agentMessage('THE REAL FINAL ANSWER', begin, { phase: 'final_answer' });
        expect(fin.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('THE REAL FINAL ANSWER');
        expect(fin.subagentLifecycles.get(ssn)?.bufferedFinalSummarySource).toBe('final_answer');
        // A later wait_agent end carries a DIFFERENT non-empty agentsStates.message — must NOT overwrite.
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-bug1', tool: 'wait', receiverThreadIds: ['child-A'] }, fin);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-bug1', tool: 'wait', status: 'completed',
            receiverThreadIds: ['child-A'], agentsStates: { 'child-A': { status: 'completed', message: 'a divergent wait status line' } },
        }, waitBegin);
        // The authoritative final_answer is preserved (provenance unchanged), NOT the wait message.
        expect(waitEnd.subagentLifecycles.get(ssn)?.bufferedFinalSummary).toBe('THE REAL FINAL ANSWER');
        expect(waitEnd.subagentLifecycles.get(ssn)?.bufferedFinalSummarySource).toBe('final_answer');
        // And the terminal Result (close) inherits the real final_answer, not the divergent wait message.
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-bug1', tool: 'closeAgent', receiverThreadIds: ['child-A'] }, waitEnd);
        const closeEnd = step({ type: 'collab_agent_call_end', call_id: 'close-bug1', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['child-A'] }, closeBegin);
        const lifecycleEnd = closeEnd.envelopes.find(e => e.ev.t === 'tool-call-end' && (e.ev as any).call === `lifecycle:${ssn}`);
        expect(lifecycleEnd).toBeDefined();
        if (lifecycleEnd && lifecycleEnd.ev.t === 'tool-call-end') {
            expect(lifecycleEnd.ev.result).toMatchObject({ final_summary: 'THE REAL FINAL ANSWER' });
        }
    });

    it('AC-A1 (iter-2 BUG 2): a final_answer arriving AFTER the lifecycle terminal is rendered as a child text (NOT suppressed into the void)', () => {
        // Terminate the lifecycle via close_agent (emitLifecycleEnd marks the entry completed). A LATE
        // final_answer then arrives: suppressing its child text would render it nowhere (flushOpenLifecycles
        // skips terminal entries), so for a terminal entry the child text MUST be emitted.
        const begin = spawnState('spawn-bug2', 'child-A', 'inspect kappa');
        const ssn = ssnOf(begin);
        // close_agent terminates the lifecycle (no final answer yet).
        const closeBegin = step({ type: 'collab_agent_call_begin', call_id: 'close-bug2', tool: 'closeAgent', receiverThreadIds: ['child-A'] }, begin);
        const closeEnd = step({ type: 'collab_agent_call_end', call_id: 'close-bug2', tool: 'closeAgent', status: 'completed', receiverThreadIds: ['child-A'] }, closeBegin);
        expect(['completed', 'errored']).toContain(closeEnd.subagentLifecycles.get(ssn)?.state);
        // A LATE final_answer arrives after the terminal — it must render as a visible child text envelope.
        const lateFinal = agentMessage('the late final answer', closeEnd, { phase: 'final_answer' });
        const texts = lateFinal.envelopes.filter(e => e.ev.t === 'text');
        expect(texts).toHaveLength(1);
        expect((texts[0].ev as any).text).toBe('the late final answer');
    });

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // Item A #6a (AC-A1/AC-A2) — live no-nickname spawn emits a NULL agentNickname so the app title
    // fallback resolves the prompt first-line; a real provider nickname still wins.
    // ─────────────────────────────────────────────────────────────────────────────────────────────
    it('AC-A1 (T1, LIVE-shape): a live spawn WITHOUT agentNickname yields args.agentNickname == null (NOT a synthesized "Subagent N", NOT the prompt) so the app prompt-first-line title fallback applies', () => {
        // The LIVE collab_agent_call_begin carries no agentNickname (codex 0.130 collabAgentToolCall has no
        // nickname field). The producer MUST NOT synthesize a generic 'Subagent N' label — a synthesized label
        // pre-empts the app title fallback chain (agentNickname -> prompt first-line -> 'Subagent'). Returning
        // null lets the app render the truncated first line of the subagent's own prompt.
        const res = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_begin', call_id: 'live-spawn-1', tool: 'spawnAgent', prompt: 'a very long raw prompt that must NOT become the card title', receiverThreadIds: [], agentsStates: {} },
            { currentTurnId: 'turn-live' }
        );
        const lifecycle = res.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle');
        expect(lifecycle).toBeDefined();
        const nickname = (lifecycle!.ev as any).args.agentNickname;
        expect(nickname).toBeNull();
        // The lifecycle ENTRY likewise stores null (no synthesized label) so a later promote/render is clean.
        const ssn = (lifecycle!.ev as any).args.sessionSubagent as string;
        expect(res.subagentLifecycles.get(ssn)?.agentNickname).toBeNull();
    });

    it('AC-A3 (T2, real wins via live message.agentNickname): a spawn WITH a real provider nickname keeps that nickname', () => {
        const res = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_begin', call_id: 'live-spawn-2', tool: 'spawnAgent', prompt: 'inspect', agentNickname: 'Architect', receiverThreadIds: [], agentsStates: {} },
            { currentTurnId: 'turn-live' }
        );
        const lifecycle = res.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle');
        expect((lifecycle!.ev as any).args.agentNickname).toBe('Architect');
    });

    it('AC-A2 (real wins via replay spawn-end OUTPUT nickname): an empty-rcv spawn (begin agentNickname=null) whose END carries a real nickname promotes it onto the lifecycle (real provider nickname wins)', () => {
        // Real Codex stores the spawn nickname in the function_call_output, forwarded onto the spawn-END as
        // message.agentNickname. The lifecycle is created at begin with a NULL nickname (no synthesized label,
        // AC-A1); the END must promote the real nickname so the real provider nickname wins (AC-A2).
        const begin = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_begin', call_id: 'replay-spawn-3', tool: 'spawnAgent', prompt: 'inspect', receiverThreadIds: [], agentsStates: {} },
            { currentTurnId: 'turn-replay' }
        );
        const ssn = ssnOf(begin);
        expect(begin.subagentLifecycles.get(ssn)?.agentNickname).toBeNull(); // null at begin (no synthesized label)
        const end = step({ type: 'collab_agent_call_end', call_id: 'replay-spawn-3', tool: 'spawnAgent', status: 'completed', agentNickname: 'Reviewer', receiverThreadIds: ['child-rep-3'], agentsStates: { 'child-rep-3': { status: 'running', message: null } } }, begin);
        expect(end.subagentLifecycles.get(ssn)?.agentNickname).toBe('Reviewer'); // real provider nickname wins
    });

    it('AC-A1 (T3): two sequential live spawns WITHOUT nicknames → both agentNickname null (no synthesized ordinals; app falls back to each prompt first-line)', () => {
        const begin1 = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_begin', call_id: 'live-spawn-4a', tool: 'spawnAgent', prompt: 'first', receiverThreadIds: [], agentsStates: {} },
            { currentTurnId: 'turn-seq' }
        );
        const n1 = (begin1.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle')!.ev as any).args.agentNickname;
        const begin2 = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_begin', call_id: 'live-spawn-4b', tool: 'spawnAgent', prompt: 'second', receiverThreadIds: [], agentsStates: {} },
            { currentTurnId: 'turn-seq', startedSubagents: begin1.startedSubagents, activeSubagents: begin1.activeSubagents, providerSubagentToSessionSubagent: begin1.providerSubagentToSessionSubagent, subagentLifecycles: begin1.subagentLifecycles }
        );
        const n2 = (begin2.envelopes.find(e => e.ev.t === 'tool-call-start' && (e.ev as any).name === 'functions.subagent_lifecycle')!.ev as any).args.agentNickname;
        expect(n1).toBeNull();
        expect(n2).toBeNull();
    });

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // #3 / OBJ-7 (AC-A5 LIVE) — live mcp screenshot begin filename reaches the args-less end.
    // ─────────────────────────────────────────────────────────────────────────────────────────────
    it('AC-A5 (LIVE begin→end): a live mcp_tool_call_begin with arguments.filename (relative) + an args-less mcp_tool_call_end WITHOUT a markdown link resolves the saved file via the threaded begin args', () => {
        const dir = mkdtempSync(join(tmpdir(), 'happy-live-shot-'));
        const relName = 'live-screenshot.png';
        const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        writeFileSync(join(dir, relName), PNG);
        try {
            // 1. LIVE begin carries arguments.filename; persisted in the threaded toolArgsByCallId map.
            const begin = mapCodexMcpMessageToSessionEnvelopes(
                { type: 'mcp_tool_call_begin', call_id: 'live-shot-1', server: 'playwright', tool: 'browser_take_screenshot', arguments: { filename: relName } },
                { currentTurnId: 'turn-live-shot', sessionCwd: dir }
            );
            // 2. LIVE end carries NO arguments and NO markdown link — the threaded begin args supply filename.
            const end = mapCodexMcpMessageToSessionEnvelopes(
                { type: 'mcp_tool_call_end', call_id: 'live-shot-1', server: 'playwright', tool: 'browser_take_screenshot', content: 'Captured.' },
                { currentTurnId: 'turn-live-shot', sessionCwd: dir, toolArgsByCallId: begin.toolArgsByCallId }
            );
            const ev = end.envelopes[0].ev;
            expect(ev.t).toBe('tool-call-end');
            if (ev.t === 'tool-call-end') {
                const r = ev.result as any;
                expect(r.path).toBe(relName);
                expect(r.preview_uri).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
                expect(r.preview_unavailable_reason).toBeUndefined();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('AC-A5 (codex#3, live byte-equality): a NON-screenshot live mcp end with a prior begin is byte-equal to the no-begin baseline (begin args are NOT merged for non-screenshot tools)', () => {
        const endMsg = { type: 'mcp_tool_call_end', call_id: 'mcp-nonshot', server: 'github', tool: 'list_issues', output: 'issue list text' } as const;
        // Baseline: the SAME end with NO prior begin args (no toolArgsByCallId threaded).
        const baseline = mapCodexMcpMessageToSessionEnvelopes({ ...endMsg }, { currentTurnId: 'turn-be' });
        // With a prior begin carrying args for this call_id: the live merge MUST be a no-op for non-screenshot
        // tools (the begin-arg merge is gated to the Playwright screenshot tool — codex#3 regression guard).
        const begin = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'mcp_tool_call_begin', call_id: 'mcp-nonshot', server: 'github', tool: 'list_issues', arguments: { repo: 'acme/widgets' } },
            { currentTurnId: 'turn-be' }
        );
        const end = mapCodexMcpMessageToSessionEnvelopes({ ...endMsg }, { currentTurnId: 'turn-be', toolArgsByCallId: begin.toolArgsByCallId });
        const ev = end.envelopes[0].ev;
        const baseEv = baseline.envelopes[0].ev;
        expect(ev.t).toBe('tool-call-end');
        if (ev.t === 'tool-call-end' && baseEv.t === 'tool-call-end') {
            // Byte-equal to the no-begin baseline: the merged repo arg never leaks into the output.
            expect(ev.output).toBe(baseEv.output);
            expect(ev.output).not.toContain('acme/widgets');
        }
    });
});

describe('mapCodexMcpMessageToSessionEnvelopes — Codex 0.144.4 sub-agent activity', () => {
    function step(message: Record<string, unknown>, prior: any) {
        return mapCodexMcpMessageToSessionEnvelopes(message, prior);
    }

    const agentThreadId = '019fa2e7-3fca-7100-a0e9-2c7812b9ac23';
    const agentPath = '/root/agent_render_live';

    it('does not fabricate a lifecycle for malformed or unknown activity', () => {
        const malformed = step({
            type: 'sub_agent_activity',
            event_id: 'bad-activity',
            kind: 'unknown',
            agent_thread_id: agentThreadId,
            agent_path: agentPath,
        }, { currentTurnId: 'turn-malformed', emittedCollabBeginCallIds: new Set<string>() });
        expect(malformed.envelopes).toHaveLength(0);
        expect(malformed.subagentLifecycles.size).toBe(0);
        expect(malformed.providerSubagentToSessionSubagent.size).toBe(0);
    });

    it('rejects reverse activity targeting the root while preserving root and child tool ownership', () => {
        const rootThreadId = '019fa399-e3b1-7622-afb0-01ea400ae19c';
        const childThreadId = '019fa39a-3f7d-78a2-b842-af361d12122d';
        const reverse = step({
            type: 'sub_agent_activity',
            event_id: 'child-send-message',
            kind: 'interacted',
            agent_thread_id: rootThreadId,
            agent_path: '/root',
        }, {
            currentTurnId: 'root-turn',
            rootThreadId,
            emittedCollabBeginCallIds: new Set<string>(),
        });

        expect(reverse.envelopes).toHaveLength(0);
        expect(reverse.subagentLifecycles.size).toBe(0);
        expect(reverse.providerSubagentToSessionSubagent.size).toBe(0);
        expect(reverse.emittedCollabBeginCallIds?.has('activity:child-send-message')).toBe(false);

        const rootTool = step({
            type: 'exec_command_begin',
            call_id: 'root-exec',
            command: ['pwd'],
            threadId: rootThreadId,
            turnId: 'root-turn',
        }, { ...reverse, rootThreadId });
        const rootExec = rootTool.envelopes.find(
            (envelope) => envelope.ev.t === 'tool-call-start' && envelope.ev.call === 'root-exec',
        );
        expect(rootExec).toBeDefined();
        expect(rootExec?.subagent).toBeUndefined();

        const childActivity = step({
            type: 'sub_agent_activity',
            event_id: 'spawn-child',
            kind: 'started',
            agent_thread_id: childThreadId,
            agent_path: '/root/restart_root_cause',
        }, {
            ...rootTool,
            rootThreadId,
            emittedCollabBeginCallIds: rootTool.emittedCollabBeginCallIds ?? new Set<string>(),
        });
        const sessionSubagent = childActivity.providerSubagentToSessionSubagent.get(childThreadId);
        expect(sessionSubagent).toBeDefined();
        expect(childActivity.envelopes.filter(
            (envelope) => envelope.ev.t === 'tool-call-start'
                && envelope.ev.name === 'functions.subagent_lifecycle',
        )).toHaveLength(1);
        expect(childActivity.envelopes.some(
            (envelope) => envelope.ev.t === 'tool-call-start'
                && envelope.ev.name === 'functions.subagent_lifecycle'
                && (envelope.ev.args.agentNickname === 'root'
                    || envelope.ev.args.sessionSubagent === rootThreadId),
        )).toBe(false);

        const childTool = step({
            type: 'exec_command_begin',
            call_id: 'child-exec',
            command: ['rg', 'restart'],
            threadId: childThreadId,
            turnId: 'child-turn',
        }, { ...childActivity, rootThreadId });
        const childExec = childTool.envelopes.find(
            (envelope) => envelope.ev.t === 'tool-call-start' && envelope.ev.call === 'child-exec',
        );
        expect(childExec).toBeDefined();
        expect(childExec?.subagent).toBe(sessionSubagent);

        const completed = step({ type: 'task_complete', turn_id: 'root-turn' }, childTool);
        expect(completed.envelopes.filter((envelope) => envelope.ev.t === 'turn-end')).toHaveLength(1);
        expect(completed.envelopes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                ev: expect.objectContaining({
                    t: 'tool-call-end',
                    call: `lifecycle:${sessionSubagent}`,
                    result: expect.objectContaining({
                        status: 'completed',
                        lifecycle_state: 'completed',
                    }),
                }),
            }),
        ]));
    });

    it('uses agent_thread_id as the durable parent while event_id only deduplicates operations', () => {
        const started = step({
            type: 'sub_agent_activity',
            event_id: 'call_ypdbzxxoWfNA6VPRyS4fmxyj',
            kind: 'started',
            agent_thread_id: agentThreadId,
            agent_path: agentPath,
        }, { currentTurnId: 'turn-activity', emittedCollabBeginCallIds: new Set<string>() });

        const lifecycleStarts = started.envelopes.filter(
            (envelope) => envelope.ev.t === 'tool-call-start'
                && envelope.ev.name === 'functions.subagent_lifecycle',
        );
        expect(lifecycleStarts).toHaveLength(1);
        const sessionSubagent = (lifecycleStarts[0].ev as any).args.sessionSubagent as string;
        expect((lifecycleStarts[0].ev as any).args).toMatchObject({
            agentNickname: 'agent_render_live',
        });
        expect(isCuid(sessionSubagent)).toBe(true);
        expect(started.providerSubagentToSessionSubagent.get(agentThreadId)).toBe(sessionSubagent);

        const duplicate = step({
            type: 'sub_agent_activity',
            event_id: 'call_ypdbzxxoWfNA6VPRyS4fmxyj',
            kind: 'started',
            agent_thread_id: agentThreadId,
            agent_path: agentPath,
        }, started);
        expect(duplicate.envelopes).toHaveLength(0);

        const interacted = step({
            type: 'sub_agent_activity',
            event_id: 'call_ZSASUqJS1JTbg8qucYlAb8ex',
            kind: 'interacted',
            agent_thread_id: agentThreadId,
            agent_path: agentPath,
        }, duplicate);
        expect(interacted.subagentLifecycles.size).toBe(1);
        expect(interacted.subagentLifecycles.get(sessionSubagent)?.state).toBe('running');
        expect(interacted.envelopes.filter(
            (envelope) => envelope.ev.t === 'tool-call-start'
                && envelope.ev.name === 'functions.subagent_lifecycle',
        )).toHaveLength(0);
    });

    it('binds reordered activity and spawn records to one parent and reactivates after interruption', () => {
        const activity = step({
            type: 'sub_agent_activity',
            event_id: 'call_N18zShy9cYsugcWJhr5aZGdR',
            kind: 'started',
            agent_thread_id: agentThreadId,
            agent_path: agentPath,
        }, { currentTurnId: 'turn-reordered', emittedCollabBeginCallIds: new Set<string>() });
        const sessionSubagent = activity.providerSubagentToSessionSubagent.get(agentThreadId)!;

        const spawn = step({
            type: 'collab_agent_call_begin',
            call_id: 'call_N18zShy9cYsugcWJhr5aZGdR',
            tool: 'spawnAgent',
            prompt: 'inspect current protocol',
            receiverThreadIds: [],
            agentsStates: {},
        }, activity);
        expect(spawn.subagentLifecycles.size).toBe(1);
        expect(spawn.envelopes.filter(
            (envelope) => envelope.ev.t === 'tool-call-start'
                && envelope.ev.name === 'functions.subagent_lifecycle',
        )).toHaveLength(0);

        const interrupted = step({
            type: 'sub_agent_activity',
            event_id: 'call_1shwlYIfQqEF5ADZjWPtCNK9',
            kind: 'interrupted',
            agent_thread_id: agentThreadId,
            agent_path: agentPath,
        }, spawn);
        expect(interrupted.subagentLifecycles.get(sessionSubagent)?.state).toBe('errored');
        expect(interrupted.envelopes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                ev: expect.objectContaining({
                    t: 'tool-call-end',
                    call: `lifecycle:${sessionSubagent}`,
                    result: expect.objectContaining({ status: 'interrupted', lifecycle_state: 'errored' }),
                }),
            }),
        ]));

        const reactivated = step({
            type: 'sub_agent_activity',
            event_id: 'call_Nf3sn5ypJ28o6aFalcvELTSr',
            kind: 'interacted',
            agent_thread_id: agentThreadId,
            agent_path: agentPath,
        }, interrupted);
        expect(reactivated.subagentLifecycles.size).toBe(1);
        expect(reactivated.subagentLifecycles.get(sessionSubagent)?.state).toBe('running');
        expect(reactivated.envelopes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                ev: expect.objectContaining({
                    t: 'tool-call-start',
                    call: `lifecycle:${sessionSubagent}`,
                    name: 'functions.subagent_lifecycle',
                }),
            }),
        ]));
    });

    it('applies the deterministic targetless-wait policy for zero, one, and multiple active parents', () => {
        const zeroBegin = step({
            type: 'collab_agent_call_begin',
            call_id: 'wait-zero',
            tool: 'wait',
            receiverThreadIds: [],
            agentsStates: {},
        }, { currentTurnId: 'turn-zero', emittedCollabBeginCallIds: new Set<string>() });
        const zeroEnd = step({
            type: 'collab_agent_call_end',
            call_id: 'wait-zero',
            tool: 'wait',
            status: 'completed',
            receiverThreadIds: [],
            agentsStates: {},
        }, zeroBegin);
        expect(zeroBegin.envelopes.filter((envelope) => envelope.subagent === undefined)).toHaveLength(1);
        expect(zeroEnd.envelopes.filter((envelope) => envelope.subagent === undefined)).toHaveLength(1);

        const one = step({
            type: 'sub_agent_activity',
            event_id: 'spawn-one',
            kind: 'started',
            agent_thread_id: 'thread-one',
            agent_path: '/root/qa_single_lifecycle',
        }, { currentTurnId: 'turn-one', emittedCollabBeginCallIds: new Set<string>() });
        const oneSsn = one.providerSubagentToSessionSubagent.get('thread-one')!;
        const oneBegin = step({
            type: 'collab_agent_call_begin',
            call_id: 'wait-one',
            tool: 'wait',
            receiverThreadIds: [],
            agentsStates: {},
        }, one);
        const oneEnd = step({
            type: 'collab_agent_call_end',
            call_id: 'wait-one',
            tool: 'wait',
            status: 'completed',
            receiverThreadIds: [],
            agentsStates: {},
        }, oneBegin);
        expect(oneBegin.envelopes.filter((envelope) => envelope.subagent === oneSsn)).toHaveLength(1);
        expect(oneBegin.envelopes.filter((envelope) => envelope.subagent === undefined)).toHaveLength(0);
        expect(oneEnd.envelopes.filter((envelope) => envelope.subagent === oneSsn)).toHaveLength(1);

        const first = step({
            type: 'sub_agent_activity',
            event_id: 'spawn-a',
            kind: 'started',
            agent_thread_id: 'thread-a',
            agent_path: '/root/qa_parallel_a',
        }, { currentTurnId: 'turn-many', emittedCollabBeginCallIds: new Set<string>() });
        const second = step({
            type: 'sub_agent_activity',
            event_id: 'spawn-b',
            kind: 'started',
            agent_thread_id: 'thread-b',
            agent_path: '/root/qa_parallel_b',
        }, first);
        const manyBegin = step({
            type: 'collab_agent_call_begin',
            call_id: 'wait-many',
            tool: 'wait',
            receiverThreadIds: [],
            agentsStates: {},
        }, second);
        const manyEnd = step({
            type: 'collab_agent_call_end',
            call_id: 'wait-many',
            tool: 'wait',
            status: 'completed',
            receiverThreadIds: [],
            agentsStates: {},
        }, manyBegin);
        expect(manyBegin.subagentLifecycles.size).toBe(2);
        expect(manyBegin.envelopes.filter((envelope) => envelope.subagent === undefined)).toHaveLength(1);
        expect(manyEnd.envelopes.filter((envelope) => envelope.subagent === undefined)).toHaveLength(1);
    });
});

// Item 2 (spec-20260607-124814): an unavailable functions.request_user_input must be
// producer-normalized into an error-shaped tool-call-end the EXISTING app reducer
// (typesRaw.isSessionToolEndError) recognizes, so the failure card + detail page render.
describe('request_user_input unavailable normalization (Item 2)', () => {
    function endEnvelope(message: Record<string, unknown>) {
        const result = mapCodexMcpMessageToSessionEnvelopes(message, { currentTurnId: 'turn-1' });
        const env = result.envelopes.find((e) => e.ev.t === 'tool-call-end');
        if (!env || env.ev.t !== 'tool-call-end') throw new Error('expected tool-call-end');
        return env.ev;
    }

    // AC1: the Default-mode unavailable output (tier_3 in-repo shape) normalizes to the
    // error shape — status:'failed' AND success:false AND a non-empty mode-anchored error.
    it('AC1: normalizes the unavailable-in-Default-mode result to status:failed + success:false + error', () => {
        const ev = endEnvelope({
            type: 'dynamic_tool_call_end',
            call_id: 'rui-1',
            namespace: 'functions',
            tool: 'request_user_input',
            status: 'completed',
            output: 'request_user_input is unavailable in Default mode',
        });
        const parsed = JSON.parse(ev.output ?? '{}');
        expect(parsed).toMatchObject({ status: 'failed', success: false });
        expect(parsed.error).toMatch(/unavailable|only available/i);
        expect(parsed.error.length).toBeGreaterThan(0);
    });

    // AC1 (robustness): the message may carry the reason in an error field (now forwarded
    // by codexAppServerClient.pickToolReasonFields) rather than output text.
    it('AC1: normalizes when the reason arrives in the error field (Plan-mode phrasing)', () => {
        const ev = endEnvelope({
            type: 'dynamic_tool_call_end',
            call_id: 'rui-2',
            namespace: 'functions',
            tool: 'request_user_input',
            status: 'completed',
            error: '<tool_use_error>request_user_input is only available in Plan mode</tool_use_error>',
        });
        const parsed = JSON.parse(ev.output ?? '{}');
        expect(parsed).toMatchObject({ status: 'failed', success: false });
        // The <tool_use_error> wrapper is stripped from the normalized reason.
        expect(parsed.error).toBe('request_user_input is only available in Plan mode');
        expect(parsed.error).not.toContain('<tool_use_error>');
    });

    // AC2: a NORMAL completed answer (no unavailable/mode signal) is NOT normalized —
    // status stays completed-equivalent and no error-shape is injected (no false positive).
    it('AC2: a normal completed answer is not normalized (no error shape injected)', () => {
        const ev = endEnvelope({
            type: 'dynamic_tool_call_end',
            call_id: 'rui-3',
            namespace: 'functions',
            tool: 'request_user_input',
            status: 'completed',
            output: 'I am unavailable tomorrow but free on Friday',
        });
        const parsed = JSON.parse(ev.output ?? '{}');
        expect(parsed.status).not.toBe('failed');
        expect(parsed.success).not.toBe(false);
        expect(parsed.error).toBeUndefined();
        // The bare answer (mode word present but NOT mode-anchored) is preserved verbatim.
        expect(parsed.output).toBe('I am unavailable tomorrow but free on Friday');
    });

    // AC3: a DIFFERENT dynamic tool with an unavailable-shaped payload is byte-identical to
    // the pre-fix mapping (scope is strictly request_user_input).
    it('AC3: other dynamic tools are byte-equivalent (no normalization applied)', () => {
        const message = {
            type: 'dynamic_tool_call_end',
            call_id: 'other-1',
            namespace: 'functions',
            tool: 'search',
            status: 'completed',
            output: 'request_user_input is unavailable in Default mode',
        };
        const ev = endEnvelope(message);
        // Pre-fix mapping for a non-request_user_input dynamic tool: buildToolEndOutput
        // collapses to the bare output string when it is the sole non-omitted key... but
        // status is also present, so it stays a JSON object WITHOUT error-shape injection.
        const parsed = JSON.parse(ev.output ?? '{}');
        expect(parsed.status).toBe('completed');
        expect(parsed.success).toBeUndefined();
        expect(parsed.error).toBeUndefined();
        expect(parsed.output).toBe('request_user_input is unavailable in Default mode');
    });

    // codex review F1 (scope guard): a NON-request_user_input dynamic tool carrying a top-level
    // error/message/reason/stderr must NOT be normalized to an error shape by the mapper — only
    // the producer's request_user_input normalization may inject status/success/error. (The
    // codexAppServerClient pickToolReasonFields gate keeps such fields off the wire for other
    // tools too, but the mapper itself is the last line of defense for the shipped envelope.)
    it('F1: a non-request dynamic tool with a top-level error field is NOT normalized to error shape', () => {
        const ev = endEnvelope({
            type: 'dynamic_tool_call_end',
            call_id: 'other-2',
            namespace: 'functions',
            tool: 'search',
            status: 'completed',
            error: 'request_user_input is unavailable in Default mode',
            output: 'results',
        });
        const parsed = JSON.parse(ev.output ?? '{}');
        // The mapper passes the tool's own fields through verbatim; it does NOT inject
        // success:false or rewrite status (that is request_user_input-exclusive).
        expect(parsed.status).toBe('completed');
        expect(parsed.success).toBeUndefined();
        // The tool's pre-existing error field (if any) is preserved as-is, NOT a normalizer
        // injection — and crucially status stays 'completed' so it is NOT a forced failure.
        expect(parsed.output).toBe('results');
    });

    // AC3 (begin-namespace defaulting): the end event may carry namespace:null while begin
    // defaulted to 'functions'. The normalizer must still fire for request_user_input.
    it('AC3/scope: fires for tool=request_user_input with namespace null', () => {
        const ev = endEnvelope({
            type: 'dynamic_tool_call_end',
            call_id: 'rui-4',
            namespace: null,
            tool: 'request_user_input',
            status: 'completed',
            output: 'request_user_input is unavailable in Default mode',
        });
        const parsed = JSON.parse(ev.output ?? '{}');
        expect(parsed).toMatchObject({ status: 'failed', success: false });
    });

    // codex review F3: the unavailable text may arrive in a STRING top-level `content` field
    // (parity with app-side detection). A string content is scanned; an array content is not.
    it('F3: normalizes when the reason arrives in a string content field', () => {
        const ev = endEnvelope({
            type: 'dynamic_tool_call_end',
            call_id: 'rui-5',
            namespace: 'functions',
            tool: 'request_user_input',
            status: 'completed',
            content: 'request_user_input is unavailable in Default mode',
        });
        const parsed = JSON.parse(ev.output ?? '{}');
        expect(parsed).toMatchObject({ status: 'failed', success: false });
        expect(parsed.error).toMatch(/unavailable/i);
    });

    // codex review F4: a legitimate answer that names the tool AND a bare availability word but
    // is NOT the tool-availability grammar must NOT be marked failed (no false positive).
    it('F4: a user answer mentioning the tool + a bare availability word is NOT normalized', () => {
        const ev = endEnvelope({
            type: 'dynamic_tool_call_end',
            call_id: 'rui-6',
            namespace: 'functions',
            tool: 'request_user_input',
            status: 'completed',
            output: 'For request_user_input, I am unavailable tomorrow but free Friday',
        });
        const parsed = JSON.parse(ev.output ?? '{}');
        expect(parsed.status).not.toBe('failed');
        expect(parsed.error).toBeUndefined();
        expect(parsed.output).toBe('For request_user_input, I am unavailable tomorrow but free Friday');
    });
});
