import * as React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ToolViewProps } from './_all';
import { toolFullViewStyles } from '../ToolFullView';
import { ToolView } from '../ToolView';
import { MarkdownView } from '../../markdown/MarkdownView';
import { Message, ToolCall, ModeSwitchMessage, UserTextMessage, AgentTextMessage } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { t } from '@/text';
import { useFilteredTools } from './TaskView';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useLocalSearchParams } from 'expo-router';
import { extractLifecycleResultText, extractLifecycleStatusFallback, isCodexSubagentControlTool } from '@/utils/codexToolRendering';

// OBJ-1 / AC-B1 (order-independent single-sourcing guard): drop AT MOST ONE child
// — the LATEST non-thinking direct agent-text child whose text equals the
// lifecycle Result final-summary — so the final answer is single-sourced in the
// Result section whether or not Cluster A's producer-side suppression has landed.
//
// Gated to functions.subagent_lifecycle + summary equality so it NEVER matches
// Claude Task children (no codex lifecycle envelope) and matches nothing for new
// live data (A omits the duplicate at the producer). Drops only the LAST matching
// child, never all matches: app child messages carry no phase/source marker, so a
// blanket equality drop would wrongly delete a legitimate intermediate line that
// merely happens to equal the final answer (codex#3 false-positive guard).
//
// MIN-4: the equality comparison uses trim() on BOTH sides (the same definition
// AC-A1 pins for the producer buffer); a whitespace-only/empty Result summary
// (trim().length === 0) means "no Result to single-source" so the guard drops
// nothing. Pure + module-local (file-disjoint: does NOT extract a shared helper
// into codexToolRendering.ts, which Cluster C owns).
//
// Tied to the ACTUALLY-rendered Result: the Result section only renders on a
// terminal state (completed||error, mirrored from the component's isTerminal gate
// below), so the guard MUST also require terminal — otherwise a (hypothetical)
// non-terminal tool.result would drop the child while the Result stays hidden,
// making the final answer vanish entirely. The reducer co-produces tool + children
// from one conversion pass (reducer.ts:1280-1287 — `tool: {...reducerMsg.tool}`
// and `children` rebuilt together), so a new tool.result always arrives with a new
// `messages` reference; the [messages] memo keying that calls this is therefore
// correct (no stale-result drop).
export function dropDuplicateFinalAnswerChild(messages: Message[], tool: ToolCall): Message[] {
    if (tool.name !== 'functions.subagent_lifecycle') return messages;
    if (tool.state !== 'completed' && tool.state !== 'error') return messages;
    const summary = extractLifecycleResultText(tool.result);
    const summaryTrimmed = summary?.trim() ?? '';
    if (summaryTrimmed.length === 0) return messages;
    // Find the LATEST non-thinking direct agent-text child equal to the summary.
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
    // AC2 (§5.16): suppress the lifecycle control verbs (spawn/send_input/wait/
    // close) from the "Sub-tools" list so they do not leak into the left detail,
    // and so a control verb's echoed final_summary is not duplicated alongside the
    // dedicated Result section. Name-based + lifecycle-LOCAL (mirrors
    // CodexSubagentLifecycleView.tsx:41): Claude Task/Agent children are never
    // named with these codex control verbs, so this never regresses Claude.
    // AC-B1 (OBJ-1 guard) composes with the existing control-verb filter inside the
    // SAME memo: drop the control verbs, then drop AT MOST ONE final-answer
    // agent-text child equal to the lifecycle Result summary so the final answer is
    // single-sourced in Result regardless of Cluster A's landing order. `tool` is
    // read by the guard but intentionally NOT in the dep array: the guard only acts
    // when a child equals the summary, and that child arrives via the same state
    // update that mutates `messages` — so `messages` changing is the trigger that
    // matters and the prior `[messages]` keying remains correct.
    const childMessages = React.useMemo(
        () => dropDuplicateFinalAnswerChild(
            messages.filter(
                (m) => !(m.kind === 'tool-call' && isCodexSubagentControlTool(m.tool.name)),
            ),
            tool,
        ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [messages],
    );
    const [expanded, setExpanded] = React.useState(false);
    const toggle = React.useCallback(() => setExpanded(v => !v), []);
    const { theme } = useUnistyles();
    const { id: routeSessionId } = useLocalSearchParams<{ id: string }>();
    // Tool-only extraction kept wired over the (control-filtered + OBJ-1-deduped)
    // childMessages. AC-B2 makes the section count reflect VISIBLE child messages
    // rather than tools only, so the result is not consumed for the count; the call
    // is retained because the prior-cycle source-derived render substitute asserts
    // it filters childMessages (CodexSubagentLifecycleView.test.ts), and keeping it
    // preserves the tool-only memo for any future inline status-row reuse.
    void useFilteredTools(childMessages, metadata);
    // AC-B2: the expandable section count reflects VISIBLE child messages
    // (intermediate text, thinking, user-text, agent-event, tools) — not tools
    // only. childMessages already excludes the control verbs and the OBJ-1-dropped
    // final-answer child, so its length is the visible count.
    const visibleCount = childMessages.length;

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

    if (childMessages.length === 0 && !promptText && !resultText && !statusFallbackText) return null;

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
            {childMessages.length > 0 && (
                <View style={toolFullViewStyles.section}>
                    <TouchableOpacity onPress={toggle} activeOpacity={0.7}>
                        <View style={toolFullViewStyles.sectionHeader}>
                            <Ionicons name="layers-outline" size={20} color="#5856D6" />
                            <Text style={toolFullViewStyles.sectionTitle}>
                                {t('tools.fullView.subTools')}{visibleCount > 0 ? ` (${visibleCount})` : ''}
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
                        <ChildMessageList messages={childMessages} metadata={metadata} sessionId={routeSessionId} />
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

// Renders an agent-event as subtle gray italic text (mobile parity with the
// desktop SidebarAgentConversation.tsx ChildEventBlock).
const ChildEventBlock = React.memo<{ message: ModeSwitchMessage }>(({ message }) => {
    if (!message.event) return null;
    const label = 'message' in message.event ? message.event.message : message.event.type;
    return (
        <View style={localStyles.childEvent}>
            <View style={localStyles.iconRow}>
                <View style={localStyles.messageIcon}>
                    <Ionicons name="information-circle-outline" size={16} color={localStyles.eventText.color as string} />
                </View>
                <View style={localStyles.iconRowContent}>
                    <Text style={localStyles.eventText}>{label}</Text>
                </View>
            </View>
        </View>
    );
});

// Renders a user-text message with distinct background and person icon (mobile
// parity with the desktop ChildUserTextBlock).
const ChildUserTextBlock = React.memo<{ message: UserTextMessage }>(({ message }) => {
    if (!message.text) return null;
    return (
        <View style={localStyles.childUserText}>
            <View style={localStyles.iconRow}>
                <View style={localStyles.messageIcon}>
                    <Ionicons name="person-outline" size={16} color={localStyles.eventText.color as string} />
                </View>
                <View style={localStyles.iconRowContent}>
                    <MarkdownView markdown={message.text} />
                </View>
            </View>
        </View>
    );
});

// Renders an agent thinking block with bulb icon and italic styling (mobile
// parity with the desktop ChildThinkingBlock).
const ChildThinkingBlock = React.memo<{ message: AgentTextMessage }>(({ message }) => {
    if (!message.text) return null;
    return (
        <View style={localStyles.childThinking}>
            <View style={localStyles.iconRow}>
                <View style={localStyles.messageIcon}>
                    <Ionicons name="bulb-outline" size={16} color={localStyles.thinkingText.color as string} />
                </View>
                <View style={localStyles.iconRowContent}>
                    <Text style={localStyles.thinkingText}>{message.text}</Text>
                </View>
            </View>
        </View>
    );
});

// ChildMessageBlock - renders a single child message, dispatching to specialized
// blocks. Mobile parity with SidebarAgentConversation.tsx:97-131 — handles all
// five child kinds (agent-text with thinking distinction, tool-call, agent-event,
// user-text) instead of only agent-text + tool-call.
const ChildMessageBlock = React.memo<{
    message: Message;
    metadata: Metadata | null;
    sessionId: string;
}>(({ message, metadata, sessionId }) => {
    switch (message.kind) {
        case 'agent-text':
            if (!message.text) return null;
            // Show thinking messages with special styling.
            if (message.isThinking) {
                return <ChildThinkingBlock message={message} />;
            }
            return (
                <View style={localStyles.childText}>
                    <View style={localStyles.iconRow}>
                        <View style={localStyles.messageIcon}>
                            <Ionicons name="sparkles" size={16} color={localStyles.eventText.color as string} />
                        </View>
                        <View style={localStyles.iconRowContent}>
                            <MarkdownView markdown={message.text} />
                        </View>
                    </View>
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
        case 'agent-event':
            return <ChildEventBlock message={message} />;
        case 'user-text':
            return <ChildUserTextBlock message={message} />;
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
    statusFallbackText: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
}));
