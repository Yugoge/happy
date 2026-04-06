import * as React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ToolViewProps } from './_all';
import { toolFullViewStyles } from '../ToolFullView';
import { ToolView } from '../ToolView';
import { MarkdownView } from '../../markdown/MarkdownView';
import { Message } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { t } from '@/text';
import { useFilteredTools, TaskStatusRow } from './TaskView';
import { StyleSheet } from 'react-native-unistyles';

export const TaskViewFull = React.memo<ToolViewProps>(({ tool, metadata, messages, sessionId }) => {
    const filtered = useFilteredTools(messages, metadata);
    const visibleTools = filtered.slice(filtered.length - 3);
    const remainingCount = filtered.length - 3;

    return (
        <View>
            {/* Sub-tools section */}
            {messages.length > 0 && (
                <View style={toolFullViewStyles.section}>
                    <View style={toolFullViewStyles.sectionHeader}>
                        <Ionicons name="layers-outline" size={20} color="#5856D6" />
                        <Text style={toolFullViewStyles.sectionTitle}>{t('tools.fullView.subTools')}</Text>
                    </View>
                    <View style={localStyles.childrenBox}>
                        {messages.map((child) => (
                            <ChildMessageBlock
                                key={child.id}
                                message={child}
                                metadata={metadata}
                                sessionId={sessionId}
                            />
                        ))}
                    </View>
                </View>
            )}
        </View>
    );
});

// ChildMessageBlock - renders a single child message
const ChildMessageBlock = React.memo<{
    message: Message;
    metadata: Metadata | null;
    sessionId?: string;
}>(({ message, metadata, sessionId }) => {
    switch (message.kind) {
        case 'agent-text':
            if (!message.text) return null;
            return (
                <View style={localStyles.childText}>
                    <MarkdownView markdown={message.text} />
                </View>
            );
        case 'tool-call':
            if (!message.tool) return null;
            return (
                <View style={localStyles.childTool}>
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

const localStyles = StyleSheet.create((theme) => ({
    childrenBox: {
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
        // no extra margin needed, gap handles it
    },
}));
