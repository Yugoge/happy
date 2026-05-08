import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolCall } from '@/sync/typesMessage';
import { TaskStatusRow, useFilteredTools } from './TaskView';

// Shared inline view for Codex subagent verbs:
//   functions.spawn_agent  -- full TaskStatusRow primitive (mirrors Agent/Task tool)
//   functions.send_input   -- degenerate (inline card via knownTools handles it)
//   functions.wait_agent   -- degenerate
//   functions.resume_agent -- degenerate
//   functions.close_agent  -- degenerate
//
// The right-side detail panel (ToolFullView) handles Description / Input
// Parameters / Output sections automatically for all five verbs. The §5.7
// guard in ToolFullView.tsx (lines 22-29) suppresses raw-command echoes.
//
const SPAWN_AGENT = 'functions.spawn_agent';

export const CodexSubagentView = React.memo<ToolViewProps & { onSubToolPress?: (tool: ToolCall) => void }>(
    ({ tool, metadata, messages, onSubToolPress }) => {
        // Hooks must be called unconditionally (Rules of Hooks).
        const filtered = useFilteredTools(messages, metadata);

        // For spawn_agent, mirror the Agent/Task TaskView structure so the
        // user sees child tool calls produced by the spawned subagent.
        if (tool.name === SPAWN_AGENT) {
            if (filtered.length === 0 && messages.length === 0) {
                return null;
            }

            const visibleTools = filtered.slice(Math.max(0, filtered.length - 3));
            const remainingCount = filtered.length - 3;

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

        // Control-plane verbs (send_input / wait_agent / resume_agent / close_agent)
        // are degenerate: the inline card row from knownTools (icon + name +
        // extractDescription) already conveys the action and target. No inner
        // body required. ToolFullView still renders the standard
        // Description / Input Parameters / Output sections in the sidebar.
        return null;
    }
);

const styles = StyleSheet.create(() => ({
    container: {
        paddingBottom: 4,
    },
}));
