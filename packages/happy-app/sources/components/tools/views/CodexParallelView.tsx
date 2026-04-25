import * as React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolStatusIcon } from './TaskView';
import { ToolCall } from '@/sync/typesMessage';
import { t } from '@/text';

// §5.15 Phase D — multi_tool_use.parallel renderer (DORMANT until Codex protocol emits events).
// Mirrors the TaskStatusRow primitive (TaskView.tsx:97-121) but reads parallel
// tool dispatch entries from `tool.input.tool_uses[]`, which is the Codex
// protocol payload shape. When the Codex app-server starts emitting
// multi_tool_use.parallel events, no further app changes are required.
type ToolUse = {
    name?: unknown;
    tool_name?: unknown;
    description?: unknown;
};

function readToolUses(input: unknown): ToolUse[] {
    if (!input || typeof input !== 'object') return [];
    const tu = (input as { tool_uses?: unknown }).tool_uses;
    return Array.isArray(tu) ? (tu as ToolUse[]) : [];
}

function readToolName(use: ToolUse): string {
    if (typeof use.name === 'string' && use.name) return use.name;
    if (typeof use.tool_name === 'string' && use.tool_name) return use.tool_name;
    if (typeof use.description === 'string' && use.description) return use.description;
    return t('tools.names.parallelTool');
}

function rowState(toolState: ToolCall['state']): 'running' | 'completed' | 'error' {
    if (toolState === 'completed') return 'completed';
    if (toolState === 'error') return 'error';
    return 'running';
}

function renderRow(use: ToolUse, index: number, state: 'running' | 'completed' | 'error') {
    return (
        <View key={`parallel-${index}`} style={parallelStyles.row}>
            <Text style={parallelStyles.rowTitle}>{readToolName(use)}</Text>
            <View style={parallelStyles.rowStatus}>
                <ToolStatusIcon state={state} />
            </View>
        </View>
    );
}

function renderBody(uses: ToolUse[], state: 'running' | 'completed' | 'error') {
    if (uses.length === 0) {
        return (
            <Text style={parallelStyles.placeholder}>
                {t('tools.desc.parallelToolCount', { count: 0 })}
            </Text>
        );
    }
    return (
        <View style={parallelStyles.list}>
            {uses.map((use, index) => renderRow(use, index, state))}
        </View>
    );
}

export const CodexParallelView = React.memo<ToolViewProps>(({ tool }) => {
    const uses = readToolUses(tool.input);
    const state = rowState(tool.state);
    return (
        <View style={parallelStyles.container}>
            <Text style={parallelStyles.header}>
                {t('tools.names.parallelTool')}
            </Text>
            {renderBody(uses, state)}
        </View>
    );
});

const parallelStyles = StyleSheet.create((theme) => ({
    container: {
        paddingBottom: 4,
    },
    header: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        paddingVertical: 4,
        paddingLeft: 4,
    },
    placeholder: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
        opacity: 0.7,
        paddingLeft: 4,
        paddingVertical: 4,
    },
    list: {
        flex: 1,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        paddingLeft: 4,
        paddingRight: 2,
    },
    rowTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.textSecondary,
        fontFamily: 'monospace',
        flex: 1,
    },
    rowStatus: {
        marginLeft: 'auto',
        paddingLeft: 8,
    },
}));
