import * as React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { ToolStatusIcon } from './TaskView';
import { ToolCall } from '@/sync/typesMessage';
import { t } from '@/text';
import { CodeView } from '@/components/CodeView';
import { ToolSectionView } from '@/components/tools/ToolSectionView';
import { extractToolUses, stringifyInspectableValue } from '@/utils/codexToolRendering';

// §5.15 Phase D — multi_tool_use.parallel renderer (DORMANT until Codex protocol emits events).
// Mirrors the TaskStatusRow primitive (TaskView.tsx:97-121) but reads parallel
// tool dispatch entries from `tool.input.tool_uses[]`, which is the Codex
// protocol payload shape. When the Codex app-server starts emitting
// multi_tool_use.parallel events, no further app changes are required.
function rowState(toolState: ToolCall['state']): 'running' | 'completed' | 'error' {
    if (toolState === 'completed') return 'completed';
    if (toolState === 'error') return 'error';
    return 'running';
}

function renderRow(use: { name: string; summary: string | null }, index: number, state: 'running' | 'completed' | 'error') {
    return (
        <View key={`parallel-${index}`} style={parallelStyles.row}>
            <View style={parallelStyles.rowText}>
                <Text style={parallelStyles.rowTitle}>{use.name}</Text>
                {use.summary ? (
                    <Text style={parallelStyles.rowSummary} numberOfLines={2}>{use.summary}</Text>
                ) : null}
            </View>
            <View style={parallelStyles.rowStatus}>
                <ToolStatusIcon state={state} />
            </View>
        </View>
    );
}

function renderBody(uses: { name: string; summary: string | null }[], state: 'running' | 'completed' | 'error') {
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
    const uses = extractToolUses(tool.input);
    const state = rowState(tool.state);
    const hasResult = Object.prototype.hasOwnProperty.call(tool, 'result') && tool.result !== undefined;
    return (
        <View style={parallelStyles.container}>
            <Text style={parallelStyles.header}>
                {t('tools.names.parallelTool')}
            </Text>
            {renderBody(uses, state)}
            {(tool.state === 'completed' || tool.state === 'error') && hasResult ? (
                <ToolSectionView title={t('toolView.output')}>
                    <CodeView code={stringifyInspectableValue(tool.result)} maxHeight={180} />
                </ToolSectionView>
            ) : null}
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
    rowText: {
        flex: 1,
        minWidth: 0,
    },
    rowTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.textSecondary,
        fontFamily: 'monospace',
    },
    rowSummary: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        opacity: 0.75,
        fontFamily: 'monospace',
        marginTop: 2,
    },
    rowStatus: {
        marginLeft: 'auto',
        paddingLeft: 8,
    },
}));
