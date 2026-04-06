import * as React from 'react';
import { View, ScrollView, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall, Message } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { ToolView } from '../tools/ToolView';
import { MarkdownView } from '../markdown/MarkdownView';

interface SidebarAgentConversationProps {
    tool: ToolCall;
    messages: Message[];
    metadata: Metadata | null;
    sessionId: string;
}

// Renders a single child message within the agent conversation
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
            return (
                <View style={styles.childTool}>
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

export const SidebarAgentConversation = React.memo<SidebarAgentConversationProps>(({ tool, messages, metadata, sessionId }) => {
    const hasResult = tool.state === 'completed' && tool.result && typeof tool.result === 'string' && tool.result.length > 0;

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
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
