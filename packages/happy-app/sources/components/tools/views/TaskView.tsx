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

export const TaskView = React.memo<ToolViewProps>(({ tool, metadata, messages, sessionId }) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const toggle = React.useCallback(() => setExpanded(v => !v), []);

    const filtered = useFilteredTools(messages, metadata);

    if (filtered.length === 0 && messages.length === 0) {
        return null;
    }

    const visibleTools = filtered.slice(filtered.length - 3);
    const remainingCount = filtered.length - 3;

    return (
        <View style={taskStyles.container}>
            {/* Summary header - always visible */}
            <TaskSummary
                visibleTools={visibleTools}
                remainingCount={remainingCount}
                expanded={expanded}
                hasChildren={messages.length > 0}
                onToggle={toggle}
            />

            {/* Expanded children - full message rendering */}
            {expanded && messages.length > 0 && (
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

// Extracts tool-call messages for the summary row
function useFilteredTools(messages: Message[], metadata: Metadata | null): FilteredTool[] {
    return React.useMemo(() => {
        const result: FilteredTool[] = [];
        for (const m of messages) {
            if (m.kind !== 'tool-call') continue;
            const knownTool = knownTools[m.tool.name as keyof typeof knownTools] as any;
            let title = m.tool.name;
            if (knownTool) {
                if ('extractDescription' in knownTool && typeof knownTool.extractDescription === 'function') {
                    title = knownTool.extractDescription({ tool: m.tool, metadata });
                } else if (knownTool.title) {
                    title = typeof knownTool.title === 'function'
                        ? knownTool.title({ tool: m.tool, metadata })
                        : knownTool.title;
                }
            }
            if (m.tool.state === 'running' || m.tool.state === 'completed' || m.tool.state === 'error') {
                result.push({ tool: m.tool, title, state: m.tool.state });
            }
        }
        return result;
    }, [messages, metadata]);
}

// Summary header with tool status icons and expand/collapse chevron
const TaskSummary = React.memo<{
    visibleTools: FilteredTool[];
    remainingCount: number;
    expanded: boolean;
    hasChildren: boolean;
    onToggle: () => void;
}>(({ visibleTools, remainingCount, expanded, hasChildren, onToggle }) => {
    const { theme } = useUnistyles();

    const content = (
        <View style={taskStyles.summaryContent}>
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
        return <View style={taskStyles.summaryWrapper}>{content}</View>;
    }

    return (
        <TouchableOpacity
            style={taskStyles.summaryWrapper}
            onPress={onToggle}
            activeOpacity={0.7}
        >
            {content}
        </TouchableOpacity>
    );
});

// Status icon for a single tool in the summary
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
    summaryWrapper: {
        paddingVertical: 4,
    },
    summaryContent: {
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
