import { describe, expect, it } from 'vitest';
import { parseMessageAsEvent } from './messageToEvent';
import { NormalizedMessage } from '../typesRaw';

function agentText(text: string, opts?: { isSidechain?: boolean }): NormalizedMessage {
    return {
        id: 'm1',
        localId: null,
        createdAt: 1,
        isSidechain: opts?.isSidechain ?? false,
        role: 'agent',
        content: [
            { type: 'text', text, uuid: 'u1', parentUUID: null },
        ],
    };
}

function userText(text: string): NormalizedMessage {
    return {
        id: 'm2',
        localId: null,
        createdAt: 1,
        isSidechain: false,
        role: 'user',
        content: { type: 'text', text },
    };
}

describe('parseMessageAsEvent — resumed Codex thread legacy fallback (AC-D3/AC-D4)', () => {
    it('converts legacy "Resumed Codex thread <id>" agent text to an event message', () => {
        const event = parseMessageAsEvent(agentText('Resumed Codex thread 019ccca2-1a77-7481-9873-de72f3464372'));
        expect(event).toEqual({
            type: 'message',
            message: 'Resumed Codex thread 019ccca2-1a77-7481-9873-de72f3464372',
        });
    });

    it('matches a non-UUID, non-space suffix (regex is \\S+, not UUID-only)', () => {
        const event = parseMessageAsEvent(agentText('Resumed Codex thread abc'));
        expect(event).toEqual({ type: 'message', message: 'Resumed Codex thread abc' });
    });

    it('does not match a multi-word / failure-style suffix (regex not broadened)', () => {
        expect(parseMessageAsEvent(agentText('Resumed Codex thread abc def'))).toBeNull();
        expect(parseMessageAsEvent(agentText('Failed to resume Codex thread abc: thread not found'))).toBeNull();
        expect(parseMessageAsEvent(agentText('Resumed Codex thread'))).toBeNull();
    });

    it('does not match the pattern in a user message (agent-only)', () => {
        expect(parseMessageAsEvent(userText('Resumed Codex thread abc'))).toBeNull();
    });

    it('does not match the pattern in a sidechain agent message (sidechain skipped upstream)', () => {
        expect(parseMessageAsEvent(agentText('Resumed Codex thread abc', { isSidechain: true }))).toBeNull();
    });

    it('does not regress the usage-limit interceptor', () => {
        const event = parseMessageAsEvent(agentText('Claude AI usage limit reached|1700000000'));
        expect(event).toEqual({ type: 'limit-reached', endsAt: 1700000000 });
    });
});
