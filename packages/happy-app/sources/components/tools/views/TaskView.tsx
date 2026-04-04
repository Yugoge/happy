import * as React from 'react';
import { ToolViewProps } from './_all';
import { Text, View, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { knownTools } from '../../tools/knownTools';
import { Ionicons } from '@expo/vector-icons';
import { Message, ToolCall } from '@/sync/typesMessage';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { MarkdownView } from '../../markdown/MarkdownView';
import { ToolView } from '../ToolView';
import { Metadata } from '@/sync/storageTypes';
import { t } from '@/text';

interface FilteredTool {
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

export const TaskView = React.memo<ToolViewProps>(({ tool, metadata, messages, sessionId }) => {
    const [expanded, setExpanded] = React.useState(false);
    const toggle = React.useCallback(() => setExpanded(v => !v), []);

    const filtered = useFilteredTools(messages, metadata);

    if (filtered.length === 0 && messages.length === 0) {
        return null;
    }

    const visibleTools = filtered.slice(filtered.length - 3);
    const remainingCount = filtered.length - 3;
    const hasChildren = messages.length > 0;

    return (
        <View style={taskStyles.container}>
            {/* Compact status row - tool status icons + expand chevron, no duplicate header */}
            <TaskStatusRow
                visibleTools={visibleTools}
                remainingCount={remainingCount}
                expanded={expanded}
                hasChildren={hasChildren}
                onToggle={toggle}
            />

            {/* Expanded children - full message rendering */}
            {expanded && hasChildren && (
                <View style={taskStyles.childrenContainer}>
                    {messages.map((child) => (
                        <ChildMessageBlock
                            key={child.id}
                            message={child}
                            metadata={metadata}
                            sessionId={sessionId}
                        />
                    ))}
                </View>
            )}
        </View>
    );
});

// Extracts tool-call messages for the status row
function useFilteredTools(messages: Message[], metadata: Metadata | null): FilteredTool[] {
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

// Compact status row: shows tool names + status icons + expand chevron.
// Intentionally NOT styled as a header — the outer ToolView header is the single header.
const TaskStatusRow = React.memo<{
    visibleTools: FilteredTool[];
    remainingCount: number;
    expanded: boolean;
    hasChildren: boolean;
    onToggle: () => void;
}>(({ visibleTools, remainingCount, expanded, hasChildren, onToggle }) => {
    const { theme } = useUnistyles();

    const content = (
        <View style={taskStyles.statusRowContent}>
            <View style={taskStyles.toolsList}>
                {visibleTools.map((item, index) => (
                    <View key={`${item.tool.name}-${index}`} style={taskStyles.toolItem}>
                        <Text style={taskStyles.toolTitle}>{item.title}</Text>
                        <View style={taskStyles.statusContainer}>
                            <ToolStatusIcon state={item.state} />
                        </View>
                    </View>
                ))}
                {remainingCount > 0 && (
                    <View style={taskStyles.moreToolsItem}>
                        <Text style={taskStyles.moreToolsText}>
                            {t('tools.taskView.moreTools', { count: remainingCount })}
                        </Text>
                    </View>
                )}
            </View>
            {hasChildren && (
                <View style={taskStyles.chevronContainer}>
                    <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                </View>
            )}
        </View>
    );

    if (!hasChildren) {
        return <View style={taskStyles.statusRowWrapper}>{content}</View>;
    }

    return (
        <TouchableOpacity
            style={taskStyles.statusRowWrapper}
            onPress={onToggle}
            activeOpacity={0.7}
        >
            {content}
        </TouchableOpacity>
    );
});

// Status icon for a single tool in the status row
function ToolStatusIcon({ state }: { state: 'running' | 'completed' | 'error' }) {
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

// Renders a single child message inside the expanded section
const ChildMessageBlock = React.memo<{
    message: Message;
    metadata: Metadata | null;
    sessionId?: string;
}>(({ message, metadata, sessionId }) => {
    switch (message.kind) {
        case 'agent-text':
            if (!message.text) return null;
            return (
                <View style={taskStyles.childText}>
                    <MarkdownView markdown={message.text} />
                </View>
            );
        case 'tool-call':
            if (!message.tool) return null;
            return (
                <View style={taskStyles.childTool}>
                    <ToolView
                        tool={message.tool}
                        metadata={metadata}
                        messages={message.children}
                        sessionId={sessionId}
                        messageId={message.id}
                    />
                </View>
            );
        default:
            return null;
    }
});

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
    chevronContainer: {
        paddingTop: 6,
        paddingLeft: 8,
        paddingRight: 4,
    },
    childrenContainer: {
        marginTop: 4,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    childText: {
        paddingHorizontal: 4,
        marginBottom: 8,
    },
    childTool: {
        marginBottom: 4,
    },
}));
