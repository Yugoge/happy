import * as React from 'react';
import { View, ScrollView, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall, Message, ToolCallMessage, ModeSwitchMessage, UserTextMessage } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { useRightSidebar } from '@/stores/rightSidebarStore';
import { ToolView } from '../tools/ToolView';
import { MarkdownView } from '../markdown/MarkdownView';

interface SidebarAgentConversationProps {
    tool: ToolCall;
    messages: Message[];
    metadata: Metadata | null;
    sessionId: string;
}

// Renders a tool-call child with sidebar push navigation
const ChildToolBlock = React.memo<{
    message: ToolCallMessage;
    metadata: Metadata | null;
    sessionId: string;
}>(({ message, metadata, sessionId }) => {
    const push = useRightSidebar((s) => s.push);
    const tool = message.tool;
    const children = message.children;
    const handlePress = React.useCallback(() => {
        push({ tool, messages: children, metadata, sessionId });
    }, [push, tool, children, metadata, sessionId]);

    return (
        <View style={styles.childTool}>
            <View style={styles.iconRow}>
                <View style={styles.messageIcon}>
                    <Ionicons name="construct-outline" size={16} color={styles.eventText.color as string} />
                </View>
                <View style={styles.iconRowContent}>
                    <ToolView
                        tool={tool}
                        metadata={metadata}
                        messages={children}
                        onPress={handlePress}
                    />
                </View>
            </View>
        </View>
    );
});

// Renders an agent-event as subtle gray italic text
const ChildEventBlock = React.memo<{ message: ModeSwitchMessage }>(({ message }) => {
    if (!message.event) return null;
    const label = 'message' in message.event ? message.event.message : message.event.type;
    return (
        <View style={styles.childEvent}>
            <View style={styles.iconRow}>
                <View style={styles.messageIcon}>
                    <Ionicons name="information-circle-outline" size={16} color={styles.eventText.color as string} />
                </View>
                <View style={styles.iconRowContent}>
                    <Text style={styles.eventText}>{label}</Text>
                </View>
            </View>
        </View>
    );
});

// Renders a user-text message with distinct background and person icon
const ChildUserTextBlock = React.memo<{ message: UserTextMessage }>(({ message }) => {
    if (!message.text) return null;
    return (
        <View style={styles.childUserText}>
            <View style={styles.iconRow}>
                <View style={styles.messageIcon}>
                    <Ionicons name="person-outline" size={16} color={styles.eventText.color as string} />
                </View>
                <View style={styles.iconRowContent}>
                    <MarkdownView markdown={message.text} />
                </View>
            </View>
        </View>
    );
});

// Renders an agent thinking block with brain icon and italic styling
const ChildThinkingBlock = React.memo<{ message: Message }>(({ message }) => {
    if (!message.text) return null;
    return (
        <View style={styles.childThinking}>
            <View style={styles.iconRow}>
                <View style={styles.messageIcon}>
                    <Ionicons name="bulb-outline" size={16} color={styles.thinkingText.color as string} />
                </View>
                <View style={styles.iconRowContent}>
                    <Text style={styles.thinkingText}>{message.text}</Text>
                </View>
            </View>
        </View>
    );
});

// Renders a single child message, dispatching to specialized blocks
const ChildMessageBlock = React.memo<{
    message: Message;
    metadata: Metadata | null;
    sessionId: string;
}>(({ message, metadata, sessionId }) => {
    switch (message.kind) {
        case 'agent-text':
            if (!message.text) return null;
            // Show thinking messages with special styling
            if (message.isThinking) {
                return <ChildThinkingBlock message={message} />;
            }
            return (
                <View style={styles.childText}>
                    <View style={styles.iconRow}>
                        <View style={styles.messageIcon}>
                            <Ionicons name="sparkles" size={16} color={styles.eventText.color as string} />
                        </View>
                        <View style={styles.iconRowContent}>
                            <MarkdownView markdown={message.text} />
                        </View>
                    </View>
                </View>
            );
        case 'tool-call':
            if (!message.tool) return null;
            return <ChildToolBlock message={message} metadata={metadata} sessionId={sessionId} />;
        case 'agent-event':
            return <ChildEventBlock message={message} />;
        case 'user-text':
            return <ChildUserTextBlock message={message} />;
        default:
            return null;
    }
});

// Section header with icon and title
const SectionHeader = React.memo<{ icon: keyof typeof Ionicons.glyphMap; title: string }>(({ icon, title }) => (
    <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={14} color={styles.sectionHeaderText.color as string} />
        <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
));

/**
 * Filter out non-last TodoWrite tool calls so only the latest snapshot is shown.
 * All other messages pass through unchanged.
 */
function filterToLatestTodoWrite(messages: Message[]): Message[] {
    let lastTodoIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].kind === 'tool-call' && (messages[i] as ToolCallMessage).tool?.name === 'TodoWrite') {
            lastTodoIdx = i;
            break;
        }
    }
    if (lastTodoIdx === -1) return messages;
    return messages.filter((msg, idx) => {
        if (msg.kind === 'tool-call' && (msg as ToolCallMessage).tool?.name === 'TodoWrite' && idx !== lastTodoIdx) {
            return false;
        }
        return true;
    });
}

export const SidebarAgentConversation = React.memo<SidebarAgentConversationProps>(({ tool, messages, metadata, sessionId }) => {
    const hasResult = tool.state === 'completed' && tool.result && typeof tool.result === 'string' && tool.result.length > 0;
    const promptText = typeof tool.input?.prompt === 'string' ? tool.input.prompt : null;
    const visibleMessages = React.useMemo(() => filterToLatestTodoWrite(messages), [messages]);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
            {promptText && (
                <View style={styles.promptBox}>
                    <SectionHeader icon="chatbubble-outline" title="Prompt" />
                    <MarkdownView markdown={promptText} />
                </View>
            )}
            {visibleMessages.length > 0 && (
                <View style={styles.messagesBox}>
                    {visibleMessages.map((child) => (
                        <ChildMessageBlock
                            key={child.id}
                            message={child}
                            metadata={metadata}
                            sessionId={sessionId}
                        />
                    ))}
                </View>
            )}
            {hasResult && (
                <View style={styles.resultBox}>
                    <Text style={styles.resultLabel}>Result</Text>
                    <MarkdownView markdown={String(tool.result)} />
                </View>
            )}
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    contentContainer: {
        padding: 12,
        gap: 8,
    },
    promptBox: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 12,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
    },
    sectionHeaderText: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    messagesBox: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 12,
        gap: 8,
    },
    childText: {
        paddingHorizontal: 4,
    },
    childTool: {
        // gap handles spacing
    },
    childEvent: {
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    eventText: {
        fontSize: 12,
        fontStyle: 'italic',
        color: theme.colors.textSecondary,
    },
    childUserText: {
        paddingHorizontal: 4,
        paddingVertical: 4,
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
    },
    childThinking: {
        paddingHorizontal: 4,
        paddingVertical: 4,
        opacity: 0.7,
    },
    thinkingText: {
        fontSize: 13,
        fontStyle: 'italic',
        color: theme.colors.textSecondary,
    },
    iconRow: {
        flexDirection: 'row' as const,
        alignItems: 'flex-start' as const,
        gap: 8,
    },
    messageIcon: {
        width: 20,
        height: 20,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        marginTop: 2,
    },
    iconRowContent: {
        flex: 1,
    },
    resultBox: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        padding: 12,
    },
    resultLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        marginBottom: 8,
    },
}));
