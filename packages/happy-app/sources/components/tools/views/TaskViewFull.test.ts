import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractLifecycleResultText } from '@/utils/codexToolRendering';
import type { Message, ToolCall, ToolCallMessage, AgentTextMessage, UserTextMessage, ModeSwitchMessage } from '@/sync/typesMessage';

// Cluster B (items #2 + #6b, task 20260616-172039) — the subagent DETAIL must show
// the FULL subagent conversation on BOTH desktop and mobile, for BOTH Codex and
// Claude subagents, with the final answer single-sourced in the Result section.
//
//   AC-B1 (OBJ-1 order-independent single-sourcing guard): both detail filters
//     (mobile TaskViewFull + desktop SidebarAgentConversation) drop AT MOST ONE
//     child — the LATEST non-thinking direct agent-text child equal (trim()-based)
//     to the lifecycle Result final-summary — under functions.subagent_lifecycle.
//     Never all matches (codex#3 false-positive guard); a whitespace-only summary
//     drops nothing (MIN-4); Claude children never match (lifecycle-gated).
//   AC-B2 (count): the section count reflects VISIBLE child messages, not only
//     tools; the OBJ-1-dropped final-answer child is not counted.
//   AC-B3 (parity both engines): the mobile ChildMessageBlock renders all five
//     child kinds (agent-text + thinking distinction, tool-call, agent-event,
//     user-text) to match the desktop reference; Claude Task detail unchanged.
//
// The view components transitively import react-native / react-native-unistyles /
// expo, which cannot load in this node-env vitest (the same constraint the
// CodexSubagentLifecycleView / CodexPatchView tests document). So these tests
// combine (a) GENUINE behavioral tests of the OBJ-1 guard ALGORITHM exercised over
// a Message[] exactly as the components apply it (the guard's only non-type
// dependency, extractLifecycleResultText, IS importable), with (b) SOURCE-DERIVED,
// revert-sensitive assertions that FAIL if the component parity/guard fix is
// reverted — the project's blessed substitute for a runtime render. Live
// desktop+mobile render on dev.life-ai.app is the user's binding gate.

const VIEWS_DIR = resolve(__dirname);
const taskViewFullSrc = readFileSync(resolve(VIEWS_DIR, 'TaskViewFull.tsx'), 'utf8');
const sidebarSrc = readFileSync(resolve(VIEWS_DIR, '../../sidebar/SidebarAgentConversation.tsx'), 'utf8');

function lifecycleTool(result: any, name = 'functions.subagent_lifecycle', state: ToolCall['state'] = 'completed'): ToolCall {
    return {
        name,
        state,
        input: {},
        createdAt: 0,
        startedAt: 0,
        completedAt: state === 'completed' || state === 'error' ? 1 : null,
        description: null,
        result,
    };
}

function agentText(id: string, text: string, isThinking = false): AgentTextMessage {
    return { kind: 'agent-text', id, localId: null, createdAt: 0, text, isThinking };
}

function userText(id: string, text: string): UserTextMessage {
    return { kind: 'user-text', id, localId: null, createdAt: 0, text };
}

function agentEvent(id: string, message: string): ModeSwitchMessage {
    return { kind: 'agent-event', id, createdAt: 0, event: { type: 'message', message } as any };
}

function toolMsg(id: string, name: string): ToolCallMessage {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 0,
        children: [],
        tool: {
            name,
            state: 'completed',
            input: {},
            createdAt: 0,
            startedAt: 0,
            completedAt: 1,
            description: null,
        },
    };
}

// Reference re-implementation of the module-local dropDuplicateFinalAnswerChild
// guard the two components export. Identical algorithm, exercised over a Message[]
// exactly as the components apply it. The source-derived assertions below prove the
// shipped components contain this same logic (fail on revert).
function dropDuplicateFinalAnswerChild(messages: Message[], tool: ToolCall): Message[] {
    if (tool.name !== 'functions.subagent_lifecycle') return messages;
    if (tool.state !== 'completed' && tool.state !== 'error') return messages;
    const summary = extractLifecycleResultText(tool.result);
    const summaryTrimmed = summary?.trim() ?? '';
    if (summaryTrimmed.length === 0) return messages;
    let dropIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.kind === 'agent-text' && !m.isThinking && m.text.trim() === summaryTrimmed) {
            dropIdx = i;
            break;
        }
    }
    if (dropIdx === -1) return messages;
    return messages.filter((_, i) => i !== dropIdx);
}

describe('AC-B1 OBJ-1 single-sourcing guard (behavioral)', () => {
    const SUMMARY = 'The subagent finished: refactored the parser.';

    it('drops only the LAST non-thinking agent-text child equal to the summary (two duplicates -> one kept)', () => {
        const messages: Message[] = [
            agentText('a1', 'Starting work...'),
            agentText('dup1', SUMMARY),          // legit intermediate line that happens to equal the answer
            toolMsg('t1', 'CodexBash'),
            agentText('dup2', SUMMARY),          // the LATEST duplicate -> dropped
        ];
        const kept = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: SUMMARY }));
        // Exactly one of the two equal lines is dropped (the last); the earlier one stays.
        const equalLines = kept.filter((m) => m.kind === 'agent-text' && m.text === SUMMARY);
        expect(equalLines.length).toBe(1);
        expect(kept.map((m) => m.id)).toEqual(['a1', 'dup1', 't1']);
    });

    it('drops the final-answer child even when it is the only agent-text equal to the summary', () => {
        const messages: Message[] = [
            agentText('intro', 'Working on it'),
            toolMsg('t1', 'Read'),
            agentText('final', SUMMARY),
        ];
        const kept = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: SUMMARY }));
        expect(kept.map((m) => m.id)).toEqual(['intro', 't1']);
    });

    it('uses trim()-based equality on both sides (MIN-4): whitespace differences still match', () => {
        const messages: Message[] = [agentText('final', `  ${SUMMARY}\n`)];
        const kept = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: `${SUMMARY}` }));
        expect(kept.length).toBe(0);
    });

    it('drops NOTHING when the Result summary is whitespace-only/empty (MIN-4 no blank-Result false drop)', () => {
        const messages: Message[] = [agentText('final', '   ')];
        // whitespace-only summary -> extractLifecycleResultText returns the string but trim() is empty -> no Result to single-source
        const keptWhitespace = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: '   ' }));
        expect(keptWhitespace).toEqual(messages);
        // null/absent summary -> nothing dropped
        const keptNull = dropDuplicateFinalAnswerChild([agentText('x', 'anything')], lifecycleTool({}));
        expect(keptNull.length).toBe(1);
    });

    it('never drops a thinking agent-text child even if its text equals the summary', () => {
        const messages: Message[] = [agentText('think', SUMMARY, true), agentText('final', SUMMARY)];
        const kept = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: SUMMARY }));
        // the thinking line stays; only the non-thinking final line is dropped
        expect(kept.map((m) => m.id)).toEqual(['think']);
    });

    it('object result via result.message / result.summary fallbacks also single-sources', () => {
        const messages: Message[] = [agentText('final', SUMMARY)];
        expect(dropDuplicateFinalAnswerChild(messages, lifecycleTool({ message: SUMMARY })).length).toBe(0);
        expect(dropDuplicateFinalAnswerChild(messages, lifecycleTool({ summary: SUMMARY })).length).toBe(0);
        expect(dropDuplicateFinalAnswerChild(messages, lifecycleTool(SUMMARY)).length).toBe(0); // string result
    });

    it('drops NOTHING on a non-terminal (running) lifecycle even if a child equals tool.result (codex F2 — never drop a child whose Result section will not render)', () => {
        const messages: Message[] = [agentText('final', SUMMARY)];
        const kept = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: SUMMARY }, 'functions.subagent_lifecycle', 'running'));
        expect(kept).toEqual(messages);
        // error state IS terminal -> still single-sources
        const keptError = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: SUMMARY }, 'functions.subagent_lifecycle', 'error'));
        expect(keptError.length).toBe(0);
    });
});

describe('AC-B3 parity — guard is lifecycle-gated and never regresses Claude', () => {
    const SUMMARY = 'done';
    it('does NOT match a Claude Task/Agent tool (non-lifecycle name) — list unchanged', () => {
        const messages: Message[] = [agentText('a', SUMMARY), agentText('b', SUMMARY)];
        // Claude Task uses 'Task' / 'Agent', never functions.subagent_lifecycle
        const keptTask = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: SUMMARY }, 'Task'));
        expect(keptTask).toEqual(messages);
        const keptAgent = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: SUMMARY }, 'Agent'));
        expect(keptAgent).toEqual(messages);
    });

    it('preserves a full mixed conversation (text + thinking + user-text + agent-event + tools) minus only the final duplicate', () => {
        const messages: Message[] = [
            userText('u1', 'please refactor'),
            agentText('t1', 'thinking through it', true),
            agentText('m1', 'here is my plan'),
            toolMsg('tool1', 'CodexBash'),
            agentEvent('e1', 'switched mode'),
            agentText('final', SUMMARY),
        ];
        const kept = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: SUMMARY }));
        expect(kept.map((m) => m.id)).toEqual(['u1', 't1', 'm1', 'tool1', 'e1']);
        // all five child KINDS that the detail must render are preserved
        expect(new Set(kept.map((m) => m.kind))).toEqual(
            new Set(['user-text', 'agent-text', 'tool-call', 'agent-event']),
        );
    });
});

describe('AC-B2 visible-count semantics (behavioral)', () => {
    const SUMMARY = 'final answer';
    it('the post-guard child set (which drives the count) excludes the dropped final-answer child', () => {
        const messages: Message[] = [
            agentText('m1', 'intermediate'),
            toolMsg('tool1', 'Read'),
            agentText('final', SUMMARY),
        ];
        const kept = dropDuplicateFinalAnswerChild(messages, lifecycleTool({ final_summary: SUMMARY }));
        // visibleCount = childMessages.length in the component → 2 here (text + tool),
        // NOT 1 (tool-only) and NOT 3 (with the dropped duplicate).
        expect(kept.length).toBe(2);
        const toolOnly = kept.filter((m) => m.kind === 'tool-call').length;
        expect(toolOnly).toBe(1); // proves count != tool-only count
    });
});

describe('AC-B1/AC-B3 source-derived assertions — mobile TaskViewFull (fail if reverted)', () => {
    it('exports the module-local OBJ-1 guard with the trim()-based, last-match-only, lifecycle-gated logic', () => {
        expect(taskViewFullSrc).toMatch(/export function dropDuplicateFinalAnswerChild\(messages: Message\[\], tool: ToolCall\)/);
        // lifecycle-gated (never matches Claude)
        expect(taskViewFullSrc).toMatch(/tool\.name !== 'functions\.subagent_lifecycle'/);
        // terminal-gated (codex F2): never drop a child whose Result will not render
        expect(taskViewFullSrc).toMatch(/tool\.state !== 'completed' && tool\.state !== 'error'/);
        // trim()-based equality on the summary (MIN-4) + whitespace-empty short-circuit
        expect(taskViewFullSrc).toMatch(/extractLifecycleResultText\(tool\.result\)/);
        expect(taskViewFullSrc).toMatch(/summaryTrimmed\.length === 0/);
        // last-match-only: reverse scan + break, drop a single index (never all)
        expect(taskViewFullSrc).toMatch(/for \(let i = messages\.length - 1; i >= 0; i--\)/);
        expect(taskViewFullSrc).toMatch(/m\.kind === 'agent-text' && !m\.isThinking && m\.text\.trim\(\) === summaryTrimmed/);
        expect(taskViewFullSrc).toMatch(/messages\.filter\(\(_, i\) => i !== dropIdx\)/);
    });

    it('applies the guard composed AFTER the control-verb filter inside the childMessages memo', () => {
        expect(taskViewFullSrc).toMatch(
            /childMessages\s*=\s*React\.useMemo\([\s\S]*?dropDuplicateFinalAnswerChild\([\s\S]*?isCodexSubagentControlTool\(m\.tool\.name\)[\s\S]*?tool,/,
        );
    });

    it('mobile ChildMessageBlock renders all five child kinds (parity with the desktop reference)', () => {
        // agent-text with thinking distinction
        expect(taskViewFullSrc).toMatch(/message\.isThinking/);
        expect(taskViewFullSrc).toMatch(/ChildThinkingBlock/);
        // agent-event + user-text blocks (were absent before this cluster)
        expect(taskViewFullSrc).toMatch(/case 'agent-event':/);
        expect(taskViewFullSrc).toMatch(/case 'user-text':/);
        expect(taskViewFullSrc).toMatch(/ChildEventBlock/);
        expect(taskViewFullSrc).toMatch(/ChildUserTextBlock/);
        // tool-call still rendered via ToolView
        expect(taskViewFullSrc).toMatch(/case 'tool-call':/);
    });

    it('the section count reflects visible child messages, not tools only (AC-B2)', () => {
        expect(taskViewFullSrc).toMatch(/visibleCount\s*=\s*childMessages\.length/);
        expect(taskViewFullSrc).toMatch(/\$\{visibleCount\}/);
        // the old tools-only count must no longer drive the header
        expect(taskViewFullSrc).not.toMatch(/\$\{toolCount\}/);
    });
});

describe('AC-B1 source-derived assertions — desktop SidebarAgentConversation (fail if reverted)', () => {
    it('exports the same module-local OBJ-1 guard (lifecycle + terminal gated)', () => {
        expect(sidebarSrc).toMatch(/export function dropDuplicateFinalAnswerChild\(messages: Message\[\], tool: ToolCall\)/);
        expect(sidebarSrc).toMatch(/tool\.name !== 'functions\.subagent_lifecycle'/);
        expect(sidebarSrc).toMatch(/tool\.state !== 'completed' && tool\.state !== 'error'/);
        expect(sidebarSrc).toMatch(/m\.kind === 'agent-text' && !m\.isThinking && m\.text\.trim\(\) === summaryTrimmed/);
    });

    it('passes sessionId + messageId into nested child ToolView for desktop/mobile parity (codex F5)', () => {
        expect(sidebarSrc).toMatch(/<ToolView[\s\S]*?onPress=\{handlePress\}[\s\S]*?sessionId=\{sessionId\}[\s\S]*?messageId=\{message\.id\}/);
    });

    it('applies the guard wrapping filterToLatestTodoWrite(control-filtered) with the tool argument', () => {
        expect(sidebarSrc).toMatch(
            /dropDuplicateFinalAnswerChild\(\s*filterToLatestTodoWrite\([\s\S]*?isCodexSubagentControlTool\(m\.tool\.name\)[\s\S]*?tool,/,
        );
    });

    it('does NOT add a shared guard helper to codexToolRendering.ts (file-disjoint with Cluster C)', () => {
        // the guard is exported from THIS component file, not imported from the C-owned util
        expect(sidebarSrc).not.toMatch(/import[\s\S]*?dropDuplicateFinalAnswerChild[\s\S]*?from '@\/utils\/codexToolRendering'/);
    });
});
