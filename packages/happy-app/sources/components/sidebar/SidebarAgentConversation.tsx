import * as React from 'react';
import { View, ScrollView, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall, Message, ToolCallMessage, ModeSwitchMessage, UserTextMessage, AgentTextMessage } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { useRightSidebar } from '@/stores/rightSidebarStore';
import { ToolView } from '../tools/ToolView';
import { MarkdownView } from '../markdown/MarkdownView';
import { extractLifecycleResultText, extractLifecycleStatusFallback, isCodexSubagentControlTool } from '@/utils/codexToolRendering';

// OBJ-1 / AC-B1 (order-independent single-sourcing guard, desktop counterpart of
// the mobile TaskViewFull guard): drop AT MOST ONE child — the LATEST non-thinking
// direct agent-text child whose text equals the lifecycle Result final-summary —
// so the final answer is single-sourced in the Result section whether or not
// Cluster A's producer-side suppression has landed.
//
// Gated to functions.subagent_lifecycle + summary equality: NEVER matches Claude
// Agent children (no codex lifecycle envelope) and matches nothing for new live
// data (A omits the duplicate at the producer). Drops only the LAST matching
// child, never all matches — app child messages carry no phase/source marker, so a
// blanket equality drop would wrongly delete a legitimate intermediate line equal
// to the final answer (codex#3 false-positive guard). MIN-4: trim()-based equality
// on both sides (same definition AC-A1 pins for the producer); a whitespace-only
// summary means "no Result to single-source" so the guard drops nothing. Pure +
// module-local (file-disjoint: no shared helper added to Cluster C's
// codexToolRendering.ts).
//
// Tied to the ACTUALLY-rendered Result: the Result section only renders on a
// terminal state (completed||error, mirrored from isTerminal below), so the guard
// also requires terminal — otherwise a non-terminal tool.result would drop the
// child while Result stays hidden, vanishing the final answer. The reducer
// co-produces tool + children in one pass (reducer.ts:1280-1287), so a new
// tool.result always arrives with a new `messages` reference; the [messages] memo
// keying is therefore correct (no stale-result drop).
export function dropDuplicateFinalAnswerChild(messages: Message[], tool: ToolCall): Message[] {
    if (tool.name !== 'functions.subagent_lifecycle') return messages;
    if (tool.state !== 'completed' && tool.state !== 'error') return messages;
    const summary = extractLifecycleResultText(tool.result);
    const summaryTrimmed = summary?.trim() ?? '';
    if (summaryTrimmed.length === 0) return messages;
    let dropIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.kind === 'agent-text' && !m.isThinking && m.text.trim() === summaryTrimmed) {
            dropIdx = i;
            break;
        }
    }
    if (dropIdx === -1) return messages;
    return messages.filter((_, i) => i !== dropIdx);
}

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
            <ToolView
                tool={tool}
                metadata={metadata}
                messages={children}
                onPress={handlePress}
                sessionId={sessionId}
                messageId={message.id}
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
const ChildThinkingBlock = React.memo<{ message: AgentTextMessage }>(({ message }) => {
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
    // B13 (AC-B13-2): the lifecycle result is an OBJECT (result.final_summary),
    // not a string — extract it so the Result section is not dropped by the
    // string-only gate (codex finding 3). Falls back to a plain string result
    // for Claude Task/Agent (unchanged).
    // ITEM 2 (AC-ITEM2-1): relax from completed-only to a TERMINAL gate
    // (completed||error) so an errored lifecycle's final_summary still renders in
    // the sidebar. The reducer only sets tool.result on a terminal result, so a
    // still-running lifecycle has no result and shows no stale summary (AC-REG-1).
    const isTerminal = tool.state === 'completed' || tool.state === 'error';
    const resultText = isTerminal ? extractLifecycleResultText(tool.result) : null;
    // ITEM 2 (AC-ITEM2-3): an errored lifecycle with NO final_summary would leave
    // the sidebar Result section blank (the desktop counterpart of the mobile
    // dead-end). Surface a narrow status/lifecycle_state fallback in that case
    // only — gated to the lifecycle envelope + error + no resultText.
    const isLifecycle = tool.name === 'functions.subagent_lifecycle';
    const statusFallbackText = isLifecycle && tool.state === 'error' && !resultText
        ? extractLifecycleStatusFallback(tool.result) : null;
    const promptText = typeof tool.input?.prompt === 'string' ? tool.input.prompt : null;
    // AC2 (§5.16): drop the lifecycle control verbs (spawn/send_input/wait/close)
    // from the Agent sidebar's Tool Calls list so they do not leak, and so a
    // control verb's echoed summary is not duplicated alongside the Result
    // section. Name-based + lifecycle-LOCAL (mirrors CodexSubagentLifecycleView.tsx:41):
    // Claude Agent children are never named with these codex control verbs, so
    // Claude rendering is unaffected. Composed with the existing latest-TodoWrite filter.
    // AC-B1 (OBJ-1 guard): after the control-verb filter + latest-TodoWrite filter,
    // drop AT MOST ONE final-answer agent-text child equal to the lifecycle Result
    // summary so the final answer is single-sourced in Result regardless of Cluster
    // A's landing order. `tool` is read by the guard but intentionally not in the
    // dep array (the guard only acts when a child equals the summary, and that child
    // arrives via the same update that mutates `messages`), preserving the prior
    // `[messages]` keying.
    const visibleMessages = React.useMemo(
        () => dropDuplicateFinalAnswerChild(
            filterToLatestTodoWrite(
                messages.filter(
                    (m) => !(m.kind === 'tool-call' && isCodexSubagentControlTool(m.tool.name)),
                ),
            ),
            tool,
        ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [messages],
    );

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
                    <SectionHeader icon="construct-outline" title="Tool Calls" />
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
            {resultText && (
                <View style={styles.resultBox}>
                    <SectionHeader icon="checkmark-done-outline" title="Result" />
                    <MarkdownView markdown={resultText} />
                </View>
            )}
            {statusFallbackText && (
                <View style={styles.resultBox}>
                    <SectionHeader icon="close-circle" title="Result" />
                    <Text style={styles.statusFallbackText}>{statusFallbackText}</Text>
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
    statusFallbackText: {
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
}));
