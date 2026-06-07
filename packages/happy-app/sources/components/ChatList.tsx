import * as React from 'react';
import { useSession, useSessionMessages } from "@/sync/storage";
import { ActivityIndicator, FlatList, Platform, View } from 'react-native';
import { useCallback, useEffect, useRef } from 'react';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageView } from './MessageView';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from './ChatFooter';
import { Message, ToolCall } from '@/sync/typesMessage';
import { LifecycleSuppressionContext, buildLifecycleSuppressionMap } from '@/utils/codexToolRendering';
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

    // Save scroll offset on scroll events
    const handleScroll = useCallback((event: any) => {
        const offset = event.nativeEvent.contentOffset.y;
        scrollOffsets.set(props.sessionId, offset);
    }, [props.sessionId]);

    // Offset awaiting (re)application once the inverted list has measured its
    // content. A synchronous scrollToOffset on a freshly-mounted inverted list
    // with maintainVisibleContentPosition does not reliably map back to the same
    // visual anchor, so we re-apply on the next onContentSizeChange (one-shot).
    const pendingRestoreRef = useRef<number | null>(null);

    // A user-initiated drag supersedes any queued restore, so a later streaming
    // content-size change can never yank the list back to the old anchor after
    // the user has deliberately scrolled. Programmatic scrollToOffset does NOT
    // fire onScrollBeginDrag, so the layout-timing re-apply below is unaffected.
    const handleScrollBeginDrag = useCallback(() => {
        pendingRestoreRef.current = null;
    }, []);

    // Restore the saved anchor for this session. Acts only when a saved offset
    // exists (harmless no-op on first visit). queueRetry re-applies once after
    // layout — needed ONLY on the fresh-mount/desktop-remount path where the
    // inverted list is not measured yet. The focus path passes false (list
    // already measured) so no pending value lingers to be re-applied by a later
    // streaming size change. Both triggers restore the identical saved anchor.
    const restoreScroll = useCallback((queueRetry?: boolean) => {
        const savedOffset = scrollOffsets.get(props.sessionId);
        if (savedOffset === undefined) return;
        if (queueRetry) pendingRestoreRef.current = savedOffset;
        flatListRef.current?.scrollToOffset({ offset: savedOffset, animated: false });
    }, [props.sessionId]);

    // Re-apply the pending offset once content is laid out (one-shot per restore).
    // Covers the desktop fresh-mount layout-timing case; streaming size changes
    // are no-ops because pendingRestoreRef is null outside a queued restore.
    const handleContentSizeChange = useCallback(() => {
        const pending = pendingRestoreRef.current;
        if (pending === null) return;
        pendingRestoreRef.current = null;
        flatListRef.current?.scrollToOffset({ offset: pending, animated: false });
    }, []);

    // Desktop in-place detail overlay: opening the detail swaps ChatList out and
    // remounts it on back (SessionMainContent conditional render on
    // detailViewStore.isOpen) with NO navigation focus change, so useFocusEffect
    // never fires there — restoring on mount (with a layout retry) covers it.
    useEffect(() => {
        restoreScroll(true);
    }, [restoreScroll]);

    // Mobile navigation route: returning from the pushed tool-detail screen
    // refocuses this screen; restore the saved anchor on focus regain.
    useFocusEffect(restoreScroll);

    return (
        <LifecycleSuppressionContext.Provider value={lifecycleSuppressionMap}>
            <FlatList
                ref={flatListRef}
                data={props.messages}
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
                onScrollBeginDrag={handleScrollBeginDrag}
                onContentSizeChange={handleContentSizeChange}
                scrollEventThrottle={64}
                ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
                ListFooterComponent={<ListHeader />}
            />
        </LifecycleSuppressionContext.Provider>
    )
});