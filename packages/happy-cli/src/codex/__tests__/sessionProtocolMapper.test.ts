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

        expect(started.envelopes).toHaveLength(1);
        const startEvent = started.envelopes[0].ev;
        expect(startEvent.t).toBe('tool-call-start');
        if (startEvent.t !== 'tool-call-start') throw new Error('Expected tool-call-start');
        expect(isCuid(startEvent.call)).toBe(true);
        expect(startEvent.args.sessionSubagent).toBe(startEvent.call);
        expect(started.envelopes[0].subagent).toBeUndefined();
        expect(started.envelopes[0].turn).toBe('wrapper-turn');

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
        const begin = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'collab_agent_call_begin',
                call_id: 'spawn-1',
                tool: 'spawnAgent',
                prompt: 'inspect files',
                receiverThreadIds: ['child-thread'],
            },
            { currentTurnId: 'turn-1' }
        );
        const startEvent = begin.envelopes[0].ev;
        if (startEvent.t !== 'tool-call-start') throw new Error('Expected spawn start');

        const endBeforeFinal = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'collab_agent_call_end', call_id: 'spawn-1', tool: 'spawnAgent', status: 'completed' },
            {
                currentTurnId: begin.currentTurnId,
                startedSubagents: begin.startedSubagents,
                activeSubagents: begin.activeSubagents,
                providerSubagentToSessionSubagent: begin.providerSubagentToSessionSubagent,
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
        let state = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'collab_agent_call_begin',
                call_id: 'spawn-1',
                tool: 'spawnAgent',
                prompt: 'inspect files',
                receiverThreadIds: ['child-thread'],
            },
            { currentTurnId: 'turn-1' }
        );
        const spawnStart = state.envelopes[0].ev;
        if (spawnStart.t !== 'tool-call-start') throw new Error('Expected spawn start');

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

        for (const fixture of childFamilies) {
            const begin = mapCodexMcpMessageToSessionEnvelopes(
                {
                    type: 'collab_agent_call_begin',
                    call_id: `spawn-${fixture.expectedName}`,
                    tool: 'spawnAgent',
                    prompt: 'inspect',
                    receiverThreadIds: ['child-thread'],
                },
                { currentTurnId: 'turn-1' }
            );
            const spawnEvent = begin.envelopes[0].ev;
            if (spawnEvent.t !== 'tool-call-start') throw new Error('Expected spawn start');
            const routed = mapCodexMcpMessageToSessionEnvelopes(
                { ...fixture.message, threadId: 'child-thread', turnId: 'child-turn' },
                {
                    currentTurnId: begin.currentTurnId,
                    startedSubagents: begin.startedSubagents,
                    activeSubagents: begin.activeSubagents,
                    providerSubagentToSessionSubagent: begin.providerSubagentToSessionSubagent,
                }
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
