import * as React from 'react';
import { ToolViewProps } from './_all';
import { Text, View, ActivityIndicator, Platform, TouchableOpacity } from 'react-native';
import { knownTools } from '../../tools/knownTools';
import { Message, ToolCall } from '@/sync/typesMessage';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Metadata } from '@/sync/storageTypes';
import { t } from '@/text';

export interface FilteredTool {
    tool: ToolCall;
    title: string;
    state: 'running' | 'completed' | 'error';
}

// Extract title for a single tool-call message
function extractToolTitle(m: Message, metadata: Metadata | null): string {
    if (m.kind !== 'tool-call') return m.kind;
    const knownTool = knownTools[m.tool.name as keyof typeof knownTools] as any;
    if (!knownTool) return m.tool.name;
    if ('extractDescription' in knownTool && typeof knownTool.extractDescription === 'function') {
        return knownTool.extractDescription({ tool: m.tool, metadata });
    }
    if (knownTool.title) {
        return typeof knownTool.title === 'function'
            ? knownTool.title({ tool: m.tool, metadata })
            : knownTool.title;
    }
    return m.tool.name;
}

// Inline view: renders nothing — sub-tool details are in the right sidebar now.
// The ToolView header (title + status icon) is sufficient for the main chat.
export const TaskView = React.memo<ToolViewProps & { onSubToolPress?: (tool: ToolCall) => void }>(
    () => null
);

// Extracts tool-call messages for the status row
export function useFilteredTools(messages: Message[], metadata: Metadata | null): FilteredTool[] {
    return React.useMemo(() => {
        const result: FilteredTool[] = [];
        for (const m of messages) {
            if (m.kind !== 'tool-call') continue;
            const state = m.tool.state;
            if (state !== 'running' && state !== 'completed' && state !== 'error') continue;
            result.push({ tool: m.tool, title: extractToolTitle(m, metadata), state });
        }
        return result;
    }, [messages, metadata]);
}

// Single tool item in the status row, optionally pressable
function ToolItemRow({ item, index, onSubToolPress }: {
    item: FilteredTool;
    index: number;
    onSubToolPress?: (tool: ToolCall) => void;
}) {
    const content = (
        <>
            <Text style={taskStyles.toolTitle}>{item.title}</Text>
            <View style={taskStyles.statusContainer}>
                <ToolStatusIcon state={item.state} />
            </View>
        </>
    );
    if (onSubToolPress) {
        return (
            <TouchableOpacity key={`${item.tool.name}-${index}`} style={taskStyles.toolItem}
                onPress={() => onSubToolPress(item.tool)} activeOpacity={0.7}>
                {content}
            </TouchableOpacity>
        );
    }
    return <View key={`${item.tool.name}-${index}`} style={taskStyles.toolItem}>{content}</View>;
}

// Compact status row: shows tool names + status icons.
// Intentionally NOT styled as a header — the outer ToolView header is the single header.
export const TaskStatusRow = React.memo<{
    visibleTools: FilteredTool[];
    remainingCount: number;
    onSubToolPress?: (tool: ToolCall) => void;
}>(({ visibleTools, remainingCount, onSubToolPress }) => {
    return (
        <View style={taskStyles.statusRowWrapper}>
            <View style={taskStyles.statusRowContent}>
                <View style={taskStyles.toolsList}>
                    {visibleTools.map((item, index) => (
                        <ToolItemRow key={`${item.tool.name}-${index}`}
                            item={item} index={index} onSubToolPress={onSubToolPress} />
                    ))}
                    {remainingCount > 0 && (
                        <View style={taskStyles.moreToolsItem}>
                            <Text style={taskStyles.moreToolsText}>
                                {t('tools.taskView.moreTools', { count: remainingCount })}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
});

// Status icon for a single tool in the status row
export function ToolStatusIcon({ state }: { state: 'running' | 'completed' | 'error' }) {
    const { theme } = useUnistyles();
    switch (state) {
        case 'running':
            return <ActivityIndicator size={Platform.OS === 'ios' ? "small" : 14 as any} color={theme.colors.warning} />;
        case 'completed':
            return <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />;
        case 'error':
            return <Ionicons name="close-circle" size={16} color={theme.colors.textDestructive} />;
    }
}

const taskStyles = StyleSheet.create((theme) => ({
    container: {
        paddingBottom: 4,
    },
    statusRowWrapper: {
        paddingVertical: 4,
    },
    statusRowContent: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    toolsList: {
        flex: 1,
    },
    toolItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        paddingLeft: 4,
        paddingRight: 2,
    },
    toolTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.textSecondary,
        fontFamily: 'monospace',
        flex: 1,
    },
    statusContainer: {
        marginLeft: 'auto',
        paddingLeft: 8,
    },
    moreToolsItem: {
        paddingVertical: 4,
        paddingHorizontal: 4,
    },
    moreToolsText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
        opacity: 0.7,
    },
}));
