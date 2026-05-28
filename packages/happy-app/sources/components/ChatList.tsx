import * as React from 'react';
import { useSession, useSessionMessages } from "@/sync/storage";
import { ActivityIndicator, FlatList, Platform, View } from 'react-native';
import { useCallback, useRef } from 'react';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageView } from './MessageView';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from './ChatFooter';
import { Message, ToolCall } from '@/sync/typesMessage';
import { LifecycleSuppressionContext, CODEX_LIFECYCLE_TOOL, SYNTHETIC_LIFECYCLE_ID_PREFIX, buildLifecycleSuppressionMap } from '@/utils/codexToolRendering';
import type { ToolCallMessage } from '@/sync/typesMessage';
import { useFocusEffect } from 'expo-router';

export const ChatList = React.memo((props: {
    session: Session;
    onContentPress?: (data: { tool: ToolCall; messages: Message[]; metadata: Metadata | null; sessionId: string }) => void;
}) => {
    const { messages } = useSessionMessages(props.session.id);
    return (
        <ChatListInternal
            metadata={props.session.metadata}
            sessionId={props.session.id}
            messages={messages}
            onContentPress={props.onContentPress}
        />
    )
});

const ListHeader = React.memo(() => {
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    return <View style={{ flexDirection: 'row', alignItems: 'center', height: headerHeight + safeArea.top + 32 }} />;
});

const ListFooter = React.memo((props: { sessionId: string }) => {
    const session = useSession(props.sessionId)!;
    return (
        <ChatFooter controlledByUser={session.agentState?.controlledByUser || false} />
    )
});

// Per-session scroll offset map shared across renders (module-level, not per-instance).
// Keyed by sessionId so each session restores its own position.
const scrollOffsets = new Map<string, number>();

const ChatListInternal = React.memo((props: {
    metadata: Metadata | null,
    sessionId: string,
    messages: Message[],
    onContentPress?: (data: { tool: ToolCall; messages: Message[]; metadata: Metadata | null; sessionId: string }) => void;
}) => {
    const flatListRef = useRef<FlatList>(null);
    const keyExtractor = useCallback((item: any) => item.id, []);
    const renderItem = useCallback(({ item }: { item: any }) => (
        <MessageView message={item} metadata={props.metadata} sessionId={props.sessionId} onContentPress={props.onContentPress} />
    ), [props.metadata, props.sessionId, props.onContentPress]);
    // Cycle 6 — D.5: derive sessionSubagent → lifecycle-message-id Map once
    // per messages[] reference change. Per-renderItem lookup is O(1).
    const lifecycleSuppressionMap = React.useMemo(
        () => buildLifecycleSuppressionMap(props.messages),
        [props.messages],
    );

    // Cycle 5 (task 20260527-082212): for A2 replay sessions that have no real
    // functions.subagent_lifecycle envelope, the suppression map was seeded with
    // a synthetic ID ("lifecycle:<ssn>"). Build a synthetic ToolCallMessage for
    // each such entry so the merged lifecycle card actually renders.
    const syntheticLifecycleMessages = React.useMemo((): ToolCallMessage[] => {
        const now = Date.now();
        const result: ToolCallMessage[] = [];
        for (const [sessionSubagent, lifecycleId] of lifecycleSuppressionMap) {
            if (!lifecycleId.startsWith(SYNTHETIC_LIFECYCLE_ID_PREFIX)) continue;
            result.push({
                kind: 'tool-call',
                id: lifecycleId,
                localId: null,
                createdAt: now,
                tool: {
                    name: CODEX_LIFECYCLE_TOOL,
                    state: 'completed',
                    input: { sessionSubagent, prompt: '', lifecycle_state: 'completed' },
                    createdAt: now,
                    startedAt: null,
                    completedAt: null,
                    description: null,
                },
                children: [],
            });
        }
        return result;
    }, [lifecycleSuppressionMap]);

    // Combine synthetic lifecycle messages (prepended) with real messages.
    // Do NOT mutate props.messages (ReadonlyArray).
    const flatListData = React.useMemo(
        () => syntheticLifecycleMessages.length > 0
            ? ([...syntheticLifecycleMessages, ...props.messages] as Message[])
            : props.messages,
        [syntheticLifecycleMessages, props.messages],
    );

    // Save scroll offset on scroll events
    const handleScroll = useCallback((event: any) => {
        const offset = event.nativeEvent.contentOffset.y;
        scrollOffsets.set(props.sessionId, offset);
    }, [props.sessionId]);

    // Restore scroll offset when returning from tool-detail page.
    // useFocusEffect fires on every focus, but we only restore when a saved
    // offset exists — harmless no-op on first focus or session switch.
    useFocusEffect(
        useCallback(() => {
            const savedOffset = scrollOffsets.get(props.sessionId);
            if (savedOffset !== undefined && flatListRef.current) {
                flatListRef.current.scrollToOffset({ offset: savedOffset, animated: false });
            }
        }, [props.sessionId])
    );

    return (
        <LifecycleSuppressionContext.Provider value={lifecycleSuppressionMap}>
            <FlatList
                ref={flatListRef}
                data={flatListData}
                inverted={true}
                keyExtractor={keyExtractor}
                maintainVisibleContentPosition={{
                    minIndexForVisible: 0,
                    autoscrollToTopThreshold: 10,
                }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
                renderItem={renderItem}
                onScroll={handleScroll}
                scrollEventThrottle={64}
                ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
                ListFooterComponent={<ListHeader />}
            />
        </LifecycleSuppressionContext.Provider>
    )
});