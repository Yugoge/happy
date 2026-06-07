import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCodexSubagentControlTool } from '@/utils/codexToolRendering';
import type { Message, ToolCall, ToolCallMessage } from '@/sync/typesMessage';

// AC2 [BLOCKER] — Codex subagent lifecycle rendering parity (spec §5.16):
//   1. INLINE  (CodexSubagentLifecycleView): own work-tool summary rows + a
//      "+N more tools" overflow line (no longer remainingCount={0}).
//   2. DETAIL  (TaskViewFull, reached via AgentFullView): the "Sub-tools" list
//      drops the lifecycle control verbs (spawn/send_input/wait/close) and never
//      duplicates the final_summary already shown under Result.
//   3. SIDEBAR (SidebarAgentConversation): the Agent "Tool Calls" list likewise
//      drops the control verbs and never duplicates the Result.
//   4. RELOAD/REPLAY: the merged card reconstructs identically from a replayed
//      rollout (render layer is a pure function of the threaded children).
//
// The view components transitively import react-native / react-native-unistyles /
// expo, which cannot load in this node-env vitest (the same constraint the
// codexToolRendering AC4/AC1/AC7 tests document). So these tests combine
// (a) GENUINE behavioral tests of the importable pure control-verb predicate that
// drives the filter plus the exact inline-overflow algorithm the component now
// implements, with (b) SOURCE-DERIVED assertions that FAIL if the component fix is
// reverted — the project's blessed substitute for a runtime render.

const VIEWS_DIR = resolve(__dirname);
const lifecycleSrc = readFileSync(resolve(VIEWS_DIR, 'CodexSubagentLifecycleView.tsx'), 'utf8');
const taskViewFullSrc = readFileSync(resolve(VIEWS_DIR, 'TaskViewFull.tsx'), 'utf8');
const sidebarSrc = readFileSync(resolve(VIEWS_DIR, '../../sidebar/SidebarAgentConversation.tsx'), 'utf8');

function toolMsg(
    id: string,
    name: string,
    opts: { result?: any; state?: ToolCall['state'] } = {},
): ToolCallMessage {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 0,
        children: [],
        tool: {
            name,
            state: opts.state ?? 'completed',
            input: {},
            createdAt: 0,
            startedAt: 0,
            completedAt: 1,
            description: null,
            result: opts.result,
        },
    };
}

// The lifecycle-LOCAL control-verb filter the detail + sidebar surfaces now apply.
// Identical predicate to the components (isCodexSubagentControlTool), exercised
// over a Message[] exactly as the components filter it.
function filterControlVerbs(messages: Message[]): Message[] {
    return messages.filter(
        (m) => !(m.kind === 'tool-call' && isCodexSubagentControlTool((m as ToolCallMessage).tool.name)),
    );
}

// The inline overflow algorithm the component implements (mirror of the Claude
// Task inline path, TaskView.tsx:41-42). Pinned here as a contract; the
// source-derived assertions below prove the component uses this same shape.
const VISIBLE_LIMIT = 3;
function inlineOverflow<T>(ownTools: T[]): { visibleTools: T[]; remainingCount: number } {
    const visibleTools = ownTools.length > VISIBLE_LIMIT
        ? ownTools.slice(ownTools.length - VISIBLE_LIMIT)
        : ownTools;
    return { visibleTools, remainingCount: ownTools.length - VISIBLE_LIMIT };
}

describe('AC2 control-verb predicate (behavioral)', () => {
    it('identifies all lifecycle control verbs (prefixed + bare) and rejects real work-tools', () => {
        for (const verb of [
            'functions.spawn_agent', 'functions.send_input', 'functions.wait_agent',
            'functions.resume_agent', 'functions.close_agent',
            'spawn_agent', 'send_input', 'wait_agent', 'close_agent',
        ]) {
            expect(isCodexSubagentControlTool(verb)).toBe(true);
        }
        for (const work of [
            'CodexBash', 'Bash', 'Read', 'Edit', 'functions.exec_command',
            'functions.view_image', 'mcp__playwright__browser_take_screenshot',
        ]) {
            expect(isCodexSubagentControlTool(work)).toBe(false);
        }
    });
});

describe('AC2 detail/sidebar control-verb suppression + no-duplicate-result (behavioral)', () => {
    // A merged lifecycle card's reconstructed children as the producer threads
    // them: the 4 control verbs interleaved with the subagent's OWN work-tools.
    // Only wait/close carry the lifecycle final_summary (the duplication source).
    const FINAL_SUMMARY = 'Subagent finished: refactored the parser';
    const replayedChildren: Message[] = [
        toolMsg('m-spawn', 'functions.spawn_agent'),
        toolMsg('m-bash1', 'CodexBash'),
        toolMsg('m-send', 'functions.send_input'),
        toolMsg('m-read', 'Read'),
        toolMsg('m-bash2', 'CodexBash'),
        toolMsg('m-bash3', 'CodexBash'),
        toolMsg('m-wait', 'functions.wait_agent', { result: { final_summary: FINAL_SUMMARY } }),
        toolMsg('m-close', 'functions.close_agent', { result: { final_summary: FINAL_SUMMARY } }),
    ];

    it('keeps only the subagent OWN work-tools (control verbs removed) in the detail/sidebar list', () => {
        const kept = filterControlVerbs(replayedChildren) as ToolCallMessage[];
        expect(kept.map((m) => m.tool.name)).toEqual(['CodexBash', 'Read', 'CodexBash', 'CodexBash']);
        expect(kept.some((m) => isCodexSubagentControlTool(m.tool.name))).toBe(false);
    });

    it('removes the control verbs that echo final_summary, so the Result section is not duplicated', () => {
        const kept = filterControlVerbs(replayedChildren) as ToolCallMessage[];
        // wait/close were the only children carrying the final_summary and are
        // control verbs → after filtering NO surviving child echoes it, leaving
        // the single dedicated Result section as the only place it appears.
        const summaryEchoes = kept.filter((m) => m.tool.result?.final_summary === FINAL_SUMMARY);
        expect(summaryEchoes.length).toBe(0);
    });

    it('does NOT regress Claude Task/Agent children (no codex control-verb names → list unchanged)', () => {
        const claudeChildren: Message[] = [
            toolMsg('c1', 'Bash'), toolMsg('c2', 'Read'), toolMsg('c3', 'Edit'), toolMsg('c4', 'TodoWrite'),
        ];
        expect(filterControlVerbs(claudeChildren)).toEqual(claudeChildren);
    });
});

describe('AC2 inline overflow algorithm (Claude Task parity)', () => {
    it('shows the last 3 own tools + a positive "+N more tools" remainder when children exceed the limit', () => {
        const own = ['a', 'b', 'c', 'd', 'e']; // 5 own work-tools
        const { visibleTools, remainingCount } = inlineOverflow(own);
        expect(visibleTools).toEqual(['c', 'd', 'e']);
        expect(remainingCount).toBe(2); // "+2 more tools"
    });

    it('shows all tools and hides the overflow (remainder <= 0) when at or under the limit', () => {
        expect(inlineOverflow(['a', 'b', 'c']).remainingCount).toBe(0);
        expect(inlineOverflow(['a']).remainingCount).toBeLessThanOrEqual(0);
        expect(inlineOverflow(['a', 'b', 'c']).visibleTools).toEqual(['a', 'b', 'c']);
    });
});

describe('AC2 reload/replay reconstruction (render layer is a pure function of threaded children)', () => {
    // The render layer holds no cross-stream state: given the SAME threaded
    // children, the first-stream merged card and the post-reload (replayed)
    // merged card partition identically. This guards exactly the runCodex.ts
    // non-persistence failure mode AT THE RENDER LAYER — provided the producer
    // threads the same children (see the producer-dependency note in the report).
    const FINAL_SUMMARY = 'done';
    function buildChildren(): Message[] {
        return [
            toolMsg('s', 'functions.spawn_agent'),
            toolMsg('b1', 'CodexBash'),
            toolMsg('r', 'Read'),
            toolMsg('b2', 'CodexBash'),
            toolMsg('b3', 'CodexBash'),
            toolMsg('w', 'functions.wait_agent', { result: { final_summary: FINAL_SUMMARY } }),
            toolMsg('c', 'functions.close_agent', { result: { final_summary: FINAL_SUMMARY } }),
        ];
    }

    it('reconstructs the same own-tool rows, the same "+N more tools" overflow, and suppressed control verbs after reload', () => {
        const firstStream = filterControlVerbs(buildChildren()) as ToolCallMessage[];
        const afterReload = filterControlVerbs(buildChildren()) as ToolCallMessage[];

        const firstNames = firstStream.map((m) => m.tool.name);
        const reloadNames = afterReload.map((m) => m.tool.name);
        expect(reloadNames).toEqual(firstNames); // identical reconstruction
        expect(reloadNames).toEqual(['CodexBash', 'Read', 'CodexBash', 'CodexBash']);

        // 4 own tools → inline shows last 3 + "+1 more tools", on first stream AND reload.
        const firstOverflow = inlineOverflow(firstNames);
        const reloadOverflow = inlineOverflow(reloadNames);
        expect(reloadOverflow).toEqual(firstOverflow);
        expect(reloadOverflow.remainingCount).toBe(1);
        expect(reloadOverflow.visibleTools).toEqual(['Read', 'CodexBash', 'CodexBash']);

        // No surviving child echoes the final_summary on reload (no duplicate Result).
        expect(afterReload.some((m) => m.tool.result?.final_summary === FINAL_SUMMARY)).toBe(false);
    });
});

describe('AC2 source-derived assertions (fail if the component fix is reverted)', () => {
    it('CodexSubagentLifecycleView computes remainingCount via the Claude-parity slice (no longer hardcoded 0)', () => {
        expect(lifecycleSrc).not.toMatch(/remainingCount=\{0\}/);
        expect(lifecycleSrc).toMatch(/LIFECYCLE_INLINE_VISIBLE_LIMIT\s*=\s*3/);
        expect(lifecycleSrc).toMatch(/remainingCount\s*=\s*ownTools\.length\s*-\s*LIFECYCLE_INLINE_VISIBLE_LIMIT/);
        expect(lifecycleSrc).toMatch(/ownTools\.slice\(/);
        // pre-existing guard preserved: control verbs are still filtered into ownTools.
        expect(lifecycleSrc).toMatch(/isCodexSubagentControlTool/);
    });

    it('TaskViewFull filters the control verbs out of the Sub-tools child list (count + list + empty-guard)', () => {
        // The exact control-verb filter predicate is present (fails on revert).
        expect(taskViewFullSrc).toMatch(
            /childMessages\s*=\s*React\.useMemo\([\s\S]*?isCodexSubagentControlTool\(m\.tool\.name\)[\s\S]*?\[messages\]/,
        );
        // childMessages (NOT raw messages) drives the count, the list, and the empty-guard.
        expect(taskViewFullSrc).toMatch(/useFilteredTools\(childMessages/);
        expect(taskViewFullSrc).toMatch(/<ChildMessageList messages=\{childMessages\}/);
        expect(taskViewFullSrc).toMatch(/childMessages\.length\s*>\s*0/);
        expect(taskViewFullSrc).toMatch(/childMessages\.length\s*===\s*0/);
        // the raw, unfiltered messages array is no longer fed straight to the list/gates.
        expect(taskViewFullSrc).not.toMatch(/<ChildMessageList messages=\{messages\}/);
        expect(taskViewFullSrc).not.toMatch(/useFilteredTools\(messages,/);
        // Result still comes from the single lifecycle envelope (rendered once).
        expect(taskViewFullSrc).toMatch(/extractLifecycleResultText\(tool\.result\)/);
    });

    it('SidebarAgentConversation composes the control-verb filter INSIDE filterToLatestTodoWrite', () => {
        // Precise + revert-sensitive: isCodexSubagentControlTool(m.tool.name) must
        // appear as a .filter predicate nested inside the filterToLatestTodoWrite
        // call (a bare `.filter(` would otherwise false-pass on the pre-existing
        // filterToLatestTodoWrite body — codex review issue #1).
        expect(sidebarSrc).toMatch(
            /filterToLatestTodoWrite\(\s*messages\.filter\([\s\S]*?isCodexSubagentControlTool\(m\.tool\.name\)[\s\S]*?\)\s*,?\s*\)/,
        );
        // Result still comes from the single lifecycle envelope (rendered once).
        expect(sidebarSrc).toMatch(/extractLifecycleResultText\(tool\.result\)/);
    });
});
