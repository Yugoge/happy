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

        // Cycle 6: collab_agent_call_begin (spawnAgent) emits TWO envelopes —
        // the original spawn_agent tool-call-start AND a synthetic
        // functions.subagent_lifecycle tool-call-start keyed by sessionSubagent.
        expect(started.envelopes).toHaveLength(2);
        const startEvent = started.envelopes[0].ev;
        expect(startEvent.t).toBe('tool-call-start');
        if (startEvent.t !== 'tool-call-start') throw new Error('Expected tool-call-start');
        expect(isCuid(startEvent.call)).toBe(true);
        expect(startEvent.args.sessionSubagent).toBe(startEvent.call);
        expect(started.envelopes[0].subagent).toBeUndefined();
        expect(started.envelopes[0].turn).toBe('wrapper-turn');
        const lifecycleEvent = started.envelopes[1].ev;
        expect(lifecycleEvent.t).toBe('tool-call-start');
        if (lifecycleEvent.t !== 'tool-call-start') throw new Error('Expected lifecycle tool-call-start');
        expect(lifecycleEvent.name).toBe('functions.subagent_lifecycle');
        expect(lifecycleEvent.call).toBe(`lifecycle:${startEvent.call}`);
        expect(lifecycleEvent.args.sessionSubagent).toBe(startEvent.call);
        expect(lifecycleEvent.args.lifecycle_state).toBe('started');

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
        expect(child.envelopes.map((envelope) => envelope.ev.t)).toEqual([
            'start',
            'text',
            'stop',
            'tool-call-end',
        ]);
        expect(child.envelopes[1].subagent).toBe(startEvent.call);
        expect(child.envelopes[1].turn).toBe('child-turn');
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
        expect(endAfterFinal.envelopes).toHaveLength(1);
        expect(endAfterFinal.envelopes[0].ev).toMatchObject({
            t: 'tool-call-end',
            call: startEvent.call,
        });

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
        const startEvent = begin.envelopes[0].ev;
        if (startEvent.t !== 'tool-call-start') throw new Error('Expected spawn start');

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
        const parentResult = finalAfterEnd.envelopes.find((envelope) => envelope.ev.t === 'tool-call-end');
        expect(parentResult?.ev).toEqual({
            t: 'tool-call-end',
            call: startEvent.call,
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
        const spawnStart = state.envelopes[0].ev;
        if (spawnStart.t !== 'tool-call-start') throw new Error('Expected spawn start');
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
            const spawnEvent = begin.envelopes[0].ev;
            if (spawnEvent.t !== 'tool-call-start') throw new Error('Expected spawn start');
            const ended = mapCodexMcpMessageToSessionEnvelopes(
                { type: 'collab_agent_call_end', call_id: `spawn-${fixture.expectedName}`, tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child-thread'], agentsStates: { 'child-thread': { status: 'running', message: null } } },
                begin
            );
            const routed = mapCodexMcpMessageToSessionEnvelopes(
                { ...fixture.message, threadId: 'child-thread', turnId: 'child-turn' },
                { currentTurnId: ended.currentTurnId, startedSubagents: ended.startedSubagents, activeSubagents: ended.activeSubagents, providerSubagentToSessionSubagent: ended.providerSubagentToSessionSubagent }
            );

            const toolStart = routed.envelopes.find((envelope) => envelope.ev.t === 'tool-call-start');
            expect(toolStart?.subagent).toBe(spawnEvent.call);
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
    function spawnState(callId: string, threadId: string, prompt: string, prior?: any) {
        const begin = mapCodexMcpMessageToSessionEnvelopes({ type: 'collab_agent_call_begin', call_id: callId, tool: 'spawnAgent', prompt, receiverThreadIds: [], agentsStates: {} }, prior ?? { currentTurnId: 'turn-1' });
        mapCodexMcpMessageToSessionEnvelopes({ type: 'collab_agent_call_end', call_id: callId, tool: 'spawnAgent', status: 'completed', receiverThreadIds: [threadId], agentsStates: { [threadId]: { status: 'running', message: null } } }, begin);
        return begin;
    }
    function step(message: any, prior: any) { return mapCodexMcpMessageToSessionEnvelopes(message, prior); }

    it('case a: spawn-wait-close — wait buffers final_summary via real agentsStates path; close emits terminal inheriting buffered summary', () => {
        const begin = spawnState('spawn-1', 'child-A', 'inspect alpha');
        const lifecycle0 = begin.envelopes[1].ev;
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
        const sessionSubagent = (begin.envelopes[1].ev as any).args.sessionSubagent as string;
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

    // Cycle 7 §5.3.D.5 S1: multi-receiver-thread case — first thread's message wins
    // (mirrors Codex first_agent_state precedent at multi_agents.rs:537-550).
    it('case a-3 (S1): multi-receiver-thread wait picks the first thread\'s agentsStates message', () => {
        const begin = spawnState('spawn-1c', 'child-X', 'inspect multi');
        const sessionSubagent = (begin.envelopes[1].ev as any).args.sessionSubagent as string;
        const waitBegin = step({ type: 'collab_agent_call_begin', call_id: 'wait-1c', tool: 'wait', receiverThreadIds: ['child-X', 'child-Y'] }, begin);
        const waitEnd = step({
            type: 'collab_agent_call_end', call_id: 'wait-1c', tool: 'wait', status: 'completed',
            receiverThreadIds: ['child-X', 'child-Y'],
            agentsStates: {
                'child-X': { status: 'completed', message: 'first wins' },
                'child-Y': { status: 'completed', message: 'second loses' },
            },
        }, waitBegin);
        expect(waitEnd.subagentLifecycles.get(sessionSubagent)?.bufferedFinalSummary).toBe('first wins');
    });

    // Cycle 7 §5.3.D.5 AC5: empty/missing agentsStates — terminal still emits without final_summary.
    it('case a-4: missing agentsStates — terminal emits without final_summary (graceful degradation)', () => {
        const begin = spawnState('spawn-1d', 'child-A4', 'no agentsStates');
        const sessionSubagent = (begin.envelopes[1].ev as any).args.sessionSubagent as string;
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
        const sessionSubagent = (begin.envelopes[1].ev as any).args.sessionSubagent as string;
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
        const sessionSubagent = (begin.envelopes[1].ev as any).args.sessionSubagent as string;
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
        const sessionSubagent = (begin.envelopes[1].ev as any).args.sessionSubagent as string;
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
        const sessionA = (beginA.envelopes[1].ev as any).args.sessionSubagent as string;
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
            // AC-C6-1: sessionSubagent must be present in args
            expect(sendStartEv.ev.args.sessionSubagent).toBe(ssn);
        }
        // AC-C6-1: providerSubagentToSessionSubagent must register for call-end matching
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
});
