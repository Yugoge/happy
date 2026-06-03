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
// calls as one-liners (e.g. `Terminal(cmd: ls) ✓`). It deliberately does NOT
// render: the "State:" line, the lifecycle control-verb rows (spawn/send/wait/
// close), a "+N more tool" overflow, or the inline final_summary — those are
// lifecycle plumbing the user does not want inline (§5.9/§5.11). Depth (Prompt +
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

        // Empty-own-tools fallback (codex finding 2 / AC-B13-3): when only control
        // verbs are threaded, render header-only (no empty bordered content area).
        if (ownTools.length === 0) return null;

        return (
            <View style={styles.container}>
                <TaskStatusRow
                    visibleTools={ownTools}
                    remainingCount={0}
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
