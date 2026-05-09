import * as React from 'react';
import { useSession, useSessionMessages } from "@/sync/storage";
import { ActivityIndicator, FlatList, Platform, View } from 'react-native';
import { useCallback } from 'react';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageView } from './MessageView';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from './ChatFooter';
import { Message, ToolCall } from '@/sync/typesMessage';
import { LifecycleSuppressionContext, buildLifecycleSuppressionMap } from '@/utils/codexToolRendering';

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

const ChatListInternal = React.memo((props: {
    metadata: Metadata | null,
    sessionId: string,
    messages: Message[],
    onContentPress?: (data: { tool: ToolCall; messages: Message[]; metadata: Metadata | null; sessionId: string }) => void;
}) => {
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
    return (
        <LifecycleSuppressionContext.Provider value={lifecycleSuppressionMap}>
            <FlatList
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
                ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
                ListFooterComponent={<ListHeader />}
            />
        </LifecycleSuppressionContext.Provider>
    )
});