import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolCall } from '@/sync/typesMessage';
import { TaskStatusRow, useFilteredTools } from './TaskView';

// Cycle 6 — D.5 subagent lifecycle merged card.
// Renders the synthetic functions.subagent_lifecycle envelope emitted by the
// CLI mapper. Shows: state-derived subtitle (started/running/ready/completed/
// errored), a TaskStatusRow body listing the spawned subagent's inner tools,
// and the final_summary text on terminal completion. The 3 underlying
// spawn/wait/close cards are suppressed via codexToolRendering.useLifecycleSuppressionMap
// when this envelope is present.
//
// State-derivation policy (architect memo q2):
// - tool.state === 'running' AND args.lifecycle_state === 'started' → 'started'
// - tool.state === 'running' AND siblings show wait card not yet ended → 'running'
//   (the simpler single-card derivation just shows started while running)
// - tool.state === 'completed' → 'completed' (use result.lifecycle_state if present)
// - tool.state === 'error' → 'errored'
//
// final_summary source priority: result.final_summary → fallback to prompt.

function deriveLifecycleLabels(tool: ToolCall): { state: string; finalSummary: string | null } {
    const result = (tool.result ?? {}) as Record<string, unknown>;
    const lifecycleState = typeof result.lifecycle_state === 'string' ? result.lifecycle_state : null;
    const finalSummary = typeof result.final_summary === 'string' ? result.final_summary : null;
    if (lifecycleState) return { state: lifecycleState, finalSummary };
    if (tool.state === 'completed') return { state: 'completed', finalSummary };
    if (tool.state === 'error') return { state: 'errored', finalSummary };
    return { state: 'started', finalSummary };
}

export const CodexSubagentLifecycleView = React.memo<ToolViewProps & { onSubToolPress?: (tool: ToolCall) => void }>(
    ({ tool, metadata, messages, onSubToolPress }) => {
        const filtered = useFilteredTools(messages, metadata);
        const labels = deriveLifecycleLabels(tool);

        const visibleTools = filtered.slice(Math.max(0, filtered.length - 3));
        const remainingCount = filtered.length - 3;

        return (
            <View style={styles.container}>
                <Text style={styles.stateLabel}>{`State: ${labels.state}`}</Text>
                {filtered.length > 0 ? (
                    <TaskStatusRow
                        visibleTools={visibleTools}
                        remainingCount={remainingCount}
                        onSubToolPress={onSubToolPress}
                    />
                ) : null}
                {labels.finalSummary ? (
                    <Text style={styles.finalSummary} numberOfLines={4}>{labels.finalSummary}</Text>
                ) : null}
            </View>
        );
    }
);

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingBottom: 4,
        gap: 4,
    },
    stateLabel: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontFamily: 'monospace',
    },
    finalSummary: {
        fontSize: 13,
        color: theme.colors.text,
        lineHeight: 18,
        marginTop: 4,
    },
}));
