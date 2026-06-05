import * as React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ToolViewProps } from './_all';
import { toolFullViewStyles } from '../ToolFullView';
import { ToolView } from '../ToolView';
import { MarkdownView } from '../../markdown/MarkdownView';
import { Message } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { t } from '@/text';
import { useFilteredTools } from './TaskView';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useLocalSearchParams } from 'expo-router';
import { extractLifecycleResultText, extractLifecycleStatusFallback } from '@/utils/codexToolRendering';

// Renders the list of child messages inside the bordered box
const ChildMessageList = React.memo<{
    messages: Message[];
    metadata: Metadata | null;
    sessionId: string;
}>(({ messages, metadata, sessionId }) => (
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
));

export const TaskViewFull = React.memo<ToolViewProps>(({ tool, metadata, messages }) => {
    const filtered = useFilteredTools(messages, metadata);
    const [expanded, setExpanded] = React.useState(false);
    const toggle = React.useCallback(() => setExpanded(v => !v), []);
    const { theme } = useUnistyles();
    const { id: routeSessionId } = useLocalSearchParams<{ id: string }>();
    const toolCount = filtered.length;

    // B13 (AC-B13-2): the lifecycle mobile detail must show Prompt + Tool Calls +
    // Result. Once functions.subagent_lifecycle is in SPECIALIZED_FULL_PAYLOAD_TOOLS
    // the raw Input/Output sections are suppressed, so the prompt and the OBJECT
    // result.final_summary must be rendered here or they are lost (codex finding 4).
    // Gated to the lifecycle envelope ONLY: spawn_agent / functions.spawn_agent also
    // reach AgentFullView but still render their raw Input/Output, so showing Prompt/
    // Result for them would duplicate (codex F6).
    const isLifecycle = tool.name === 'functions.subagent_lifecycle';
    const promptText = isLifecycle && typeof tool.input?.prompt === 'string' && tool.input.prompt.length > 0
        ? tool.input.prompt : null;
    // ITEM 2 (AC-ITEM2-1/2): relax from completed-only to a TERMINAL gate
    // (completed||error) so an errored lifecycle's final_summary still renders.
    // The reducer only sets tool.result on a terminal result, so a still-running
    // lifecycle has no result and shows no stale summary (AC-REG-1).
    const isTerminal = tool.state === 'completed' || tool.state === 'error';
    const resultText = isLifecycle && isTerminal
        ? extractLifecycleResultText(tool.result) : null;
    // ITEM 2 (AC-ITEM2-3): an errored lifecycle with NO final_summary would be a
    // blank dead-end (ToolErrorSection is suppressed for the lifecycle envelope).
    // Surface a narrow status/lifecycle_state fallback in that case only — never
    // on the success/with-summary path (does not re-expose the raw JSON dump).
    const statusFallbackText = isLifecycle && tool.state === 'error' && !resultText
        ? extractLifecycleStatusFallback(tool.result) : null;

    if (messages.length === 0 && !promptText && !resultText && !statusFallbackText) return null;

    return (
        <>
            {promptText && (
                <View style={toolFullViewStyles.section}>
                    <View style={toolFullViewStyles.sectionHeader}>
                        <Ionicons name="chatbubble-outline" size={20} color="#5856D6" />
                        <Text style={toolFullViewStyles.sectionTitle}>Prompt</Text>
                    </View>
                    <MarkdownView markdown={promptText} />
                </View>
            )}
            {messages.length > 0 && (
                <View style={toolFullViewStyles.section}>
                    <TouchableOpacity onPress={toggle} activeOpacity={0.7}>
                        <View style={toolFullViewStyles.sectionHeader}>
                            <Ionicons name="layers-outline" size={20} color="#5856D6" />
                            <Text style={toolFullViewStyles.sectionTitle}>
                                {t('tools.fullView.subTools')}{toolCount > 0 ? ` (${toolCount})` : ''}
                            </Text>
                            <Ionicons
                                name={expanded ? 'chevron-up' : 'chevron-down'}
                                size={18}
                                color={theme.colors.textSecondary}
                                style={{ marginLeft: 'auto' }}
                            />
                        </View>
                    </TouchableOpacity>
                    {expanded && (
                        <ChildMessageList messages={messages} metadata={metadata} sessionId={routeSessionId} />
                    )}
                </View>
            )}
            {resultText && (
                <View style={toolFullViewStyles.section}>
                    <View style={toolFullViewStyles.sectionHeader}>
                        <Ionicons name="checkmark-done-outline" size={20} color="#34C759" />
                        <Text style={toolFullViewStyles.sectionTitle}>Result</Text>
                    </View>
                    <MarkdownView markdown={resultText} />
                </View>
            )}
            {statusFallbackText && (
                <View style={toolFullViewStyles.section}>
                    <View style={toolFullViewStyles.sectionHeader}>
                        <Ionicons name="close-circle" size={20} color="#FF3B30" />
                        <Text style={toolFullViewStyles.sectionTitle}>Result</Text>
                    </View>
                    <Text style={localStyles.statusFallbackText}>{statusFallbackText}</Text>
                </View>
            )}
        </>
    );
});

// ChildMessageBlock - renders a single child message
const ChildMessageBlock = React.memo<{
    message: Message;
    metadata: Metadata | null;
    sessionId: string;
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
    statusFallbackText: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
}));
