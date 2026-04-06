import * as React from 'react';
import { View, ScrollView, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall, Message, ToolCallMessage, ModeSwitchMessage, UserTextMessage } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { useRightSidebar, SidebarData } from '@/stores/rightSidebarStore';
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
    const handleContentPress = React.useCallback((data: SidebarData) => {
        push(data);
    }, [push]);

    return (
        <View style={styles.childTool}>
            <ToolView
                tool={tool}
                metadata={metadata}
                messages={children}
                onPress={handlePress}
                onContentPress={handleContentPress}
            />
        </View>
    );
});

// Renders an agent-event as subtle gray italic text
const ChildEventBlock = React.memo<{ message: ModeSwitchMessage }>(({ message }) => {
    if (!message.event) return null;
    const label = 'message' in message.event ? message.event.message : message.event.type;
    return (
        <View style={styles.childEvent}>
            <Text style={styles.eventText}>{label}</Text>
        </View>
    );
});

// Renders a user-text message with distinct background
const ChildUserTextBlock = React.memo<{ message: UserTextMessage }>(({ message }) => {
    if (!message.text) return null;
    return (
        <View style={styles.childUserText}>
            <MarkdownView markdown={message.text} />
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
            return (
                <View style={styles.childText}>
                    <MarkdownView markdown={message.text} />
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

export const SidebarAgentConversation = React.memo<SidebarAgentConversationProps>(({ tool, messages, metadata, sessionId }) => {
    const hasResult = tool.state === 'completed' && tool.result && typeof tool.result === 'string' && tool.result.length > 0;
    const promptText = typeof tool.input?.prompt === 'string' ? tool.input.prompt : null;

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
            {promptText && (
                <View style={styles.promptBox}>
                    <SectionHeader icon="chatbubble-outline" title="Prompt" />
                    <MarkdownView markdown={promptText} />
                </View>
            )}
            {messages.length > 0 && (
                <View style={styles.messagesBox}>
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
        backgroundColor: theme.colors.backgroundTertiary,
        borderRadius: 8,
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
