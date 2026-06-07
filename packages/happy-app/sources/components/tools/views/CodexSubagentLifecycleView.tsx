import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolCall } from '@/sync/typesMessage';
import { TaskStatusRow, useFilteredTools, FilteredTool } from './TaskView';
import { isCodexSubagentControlTool, readCodexCommand } from '@/utils/codexToolRendering';

// Terminal-type own tools: re-label as `Terminal(cmd: <command>)` to match the
// pixel-locked reference (bug13-claude-agent.png) inline one-liner shape (codex
// F3). Non-terminal own tools keep their existing title untouched.
const TERMINAL_OWN_TOOLS = new Set(['CodexBash', 'Bash', 'execute', 'shell', 'functions.exec_command']);

// AC2 (§5.16): inline overflow limit, mirroring the Claude Task inline path
// (TaskView shows the last 3 child tools + a "+N more tools" overflow line).
const LIFECYCLE_INLINE_VISIBLE_LIMIT = 3;

function formatOwnToolTitle(item: FilteredTool): FilteredTool {
    if (!TERMINAL_OWN_TOOLS.has(item.tool.name)) return item;
    const command = readCodexCommand(item.tool.input);
    if (!command) return item;
    const compact = command.length > 48 ? command.substring(0, 48) + '…' : command;
    return { ...item, title: `Terminal(cmd: ${compact})` };
}

// Cycle 13 — B13 COMPACT inline subagent card (reverses cycles 5-9).
// Renders the synthetic functions.subagent_lifecycle envelope emitted by the
// CLI mapper as a COMPACT inline card: header-only ToolView chrome (the outer
// ToolView header carries the task title/subtitle) plus the subagent's OWN tool
// calls as one-liners (e.g. `Terminal(cmd: ls) ✓`) AND a "+N more tools" overflow
// line (AC2/§5.16 — mirrors the Claude Task inline path). It deliberately does
// NOT render: the "State:" line, the lifecycle control-verb rows (spawn/send/
// wait/close), or the inline final_summary — those are lifecycle plumbing the
// user does not want inline (§5.9/§5.11). Depth (Prompt +
// Tool Calls + Result/final_summary) lives in the sidebar + mobile detail. The 3
// underlying spawn/wait/close cards remain suppressed via the lifecycle
// suppression Map when this envelope is present.

export const CodexSubagentLifecycleView = React.memo<ToolViewProps & { onSubToolPress?: (tool: ToolCall) => void }>(
    ({ tool, metadata, messages, onSubToolPress }) => {
        const filtered = useFilteredTools(messages, metadata);
        // Lifecycle-LOCAL filter: drop the control verbs so only the subagent's
        // OWN tools render inline. Done here (not in the shared hook) to preserve
        // Claude Task/Agent rendering (AC-REG-1).
        const ownTools = React.useMemo(
            () => filtered
                .filter((item) => !isCodexSubagentControlTool(item.tool.name))
                .map(formatOwnToolTitle),
            [filtered],
        );

        // Empty-own-tools fallback (codex finding 2 / AC-B13-3): when only the
        // lifecycle control verbs are threaded (no real child work), render
        // header-only (no empty bordered content area). Real child activity
        // (ownTools > 0) always renders the summary rows below.
        if (ownTools.length === 0) return null;

        // AC2 (§5.16): mirror the Claude Task inline overflow path
        // (TaskView.tsx:41-42) — show the last LIFECYCLE_INLINE_VISIBLE_LIMIT own
        // work-tool rows and a "+N more tools" overflow line for the remainder,
        // instead of the previously-hardcoded zero remainder that suppressed the
        // overflow entirely. TaskStatusRow only renders the overflow line when
        // remainingCount > 0, so a non-positive remainder safely hides it.
        const visibleTools = ownTools.length > LIFECYCLE_INLINE_VISIBLE_LIMIT
            ? ownTools.slice(ownTools.length - LIFECYCLE_INLINE_VISIBLE_LIMIT)
            : ownTools;
        const remainingCount = ownTools.length - LIFECYCLE_INLINE_VISIBLE_LIMIT;

        return (
            <View style={styles.container}>
                <TaskStatusRow
                    visibleTools={visibleTools}
                    remainingCount={remainingCount}
                    onSubToolPress={onSubToolPress}
                />
            </View>
        );
    }
);

const styles = StyleSheet.create(() => ({
    container: {
        paddingBottom: 4,
    },
}));
