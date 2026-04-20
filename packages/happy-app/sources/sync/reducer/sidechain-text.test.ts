import { createReducer, reducer } from './reducer';
import { expect, it, describe } from 'vitest';

describe('sidechain text via sessionSubagent', () => {
    it('should render non-echo subagent text as agent-text child', () => {
        const state = createReducer();
        const result = reducer(state, [
            {
                id: 'agent-parent-msg',
                localId: null,
                createdAt: 1000,
                role: 'agent',
                isSidechain: false,
                content: [{
                    type: 'tool-call',
                    id: 'tool-agent-parent',
                    name: 'Agent',
                    input: {
                        description: 'Find README files',
                        prompt: 'Find README files',
                        sessionSubagent: 'session-subagent-1',
                    },
                    description: 'Find README files',
                    uuid: 'agent-parent-uuid',
                    parentUUID: null
                }]
            },
            // Prompt echo - should be suppressed
            {
                id: 'agent-prompt-echo',
                localId: null,
                createdAt: 1100,
                role: 'agent',
                isSidechain: true,
                content: [{
                    type: 'text',
                    text: 'Find README files',
                    uuid: 'agent-prompt-uuid',
                    parentUUID: 'session-subagent-1'
                }]
            },
            // Tool call
            {
                id: 'agent-child-tool',
                localId: null,
                createdAt: 1200,
                role: 'agent',
                isSidechain: true,
                content: [{
                    type: 'tool-call',
                    id: 'tool-bash-child',
                    name: 'Bash',
                    input: { command: 'find . -name README.md' },
                    description: null,
                    uuid: 'agent-child-tool-uuid',
                    parentUUID: 'session-subagent-1'
                }]
            },
            // Subagent final output text - NOT the echo
            {
                id: 'agent-output-text',
                localId: null,
                createdAt: 1400,
                role: 'agent',
                isSidechain: true,
                content: [{
                    type: 'text',
                    text: 'I found 3 README files.',
                    uuid: 'agent-output-uuid',
                    parentUUID: 'session-subagent-1'
                }]
            }
        ]);

        const root = result.messages[0];
        expect(result.messages).toHaveLength(1);
        expect(root.kind).toBe('tool-call');
        if (root.kind === 'tool-call') {
            // Should have 2 children: tool-call (Bash) and agent-text output
            expect(root.children).toHaveLength(2);
            const textChild = root.children.find((c: any) => c.kind === 'agent-text');
            expect(textChild).toBeDefined();
            if (textChild && textChild.kind === 'agent-text') {
                expect(textChild.text).toBe('I found 3 README files.');
            }
        }
    });
});
