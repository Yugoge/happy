import * as React from 'react';
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { Text } from "react-native";
import { useMessage, useSession, useSessionMessages } from "@/sync/storage";
import { sync } from '@/sync/sync';
import { Deferred } from "@/components/Deferred";
import { ToolFullView } from '@/components/tools/ToolFullView';
import { ToolHeader } from '@/components/tools/ToolHeader';
import { ToolStatusIndicator } from '@/components/tools/ToolStatusIndicator';
import { Message } from '@/sync/typesMessage';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { navigateToSession } from '@/hooks/useNavigateToSession';

const stylesheet = StyleSheet.create((theme) => ({
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullViewContainer: {
        flex: 1,
        padding: 16,
    },
    messageText: {
        color: theme.colors.text,
        fontSize: 16,
        lineHeight: 24,
        ...Typography.default(),
    },
}));

function ToolScreenHeader(props: { message: Message; theme: ReturnType<typeof useUnistyles>['theme'] }) {
    const { message, theme } = props;
    if (message.kind !== 'tool-call' || !message.tool) {
        return null;
    }
    return (
        <Stack.Screen
            options={{
                headerTitle: () => <ToolHeader tool={message.tool} />,
                headerRight: () => <ToolStatusIndicator tool={message.tool} />,
                headerStyle: { backgroundColor: theme.colors.header.background },
                headerTintColor: theme.colors.header.tint,
                headerShadowVisible: false,
            }}
        />
    );
}

function LoadingView() {
    const { theme } = useUnistyles();
    return (
        <View style={stylesheet.loadingContainer}>
            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        </View>
    );
}

export default React.memo(() => {
    const { id: sessionId, messageId } = useLocalSearchParams<{ id: string; messageId: string }>();
    const router = useRouter();
    const session = useSession(sessionId!);
    const { isLoaded: messagesLoaded } = useSessionMessages(sessionId!);
    const message = useMessage(sessionId!, messageId!);
    const { theme } = useUnistyles();

    React.useEffect(() => {
        if (sessionId) {
            sync.onSessionVisible(sessionId);
        }
    }, [sessionId]);

    // Navigate to parent session if message doesn't exist after messages are loaded.
    // Use navigateToSession() instead of router.back() because on web, router.back() relies
    // on browser history which may not contain the parent session when the user arrived via
    // sidebar navigation (router.navigate with dangerouslySingular, not router.push).
    // Root cause: commits 7f178466 / c6c99ee4.
    React.useEffect(() => {
        if (messagesLoaded && !message) {
            navigateToSession(router, sessionId!);
        }
    }, [messagesLoaded, message, router, sessionId]);

    if (!session || !messagesLoaded || !message) {
        return <LoadingView />;
    }

    return (
        <>
            <ToolScreenHeader message={message} theme={theme} />
            <Deferred>
                <FullView message={message} />
            </Deferred>
        </>
    );
});

function FullView(props: { message: Message }) {
    const styles = stylesheet;

    if (props.message.kind === 'tool-call') {
        return <ToolFullView tool={props.message.tool} messages={props.message.children} />
    }
    if (props.message.kind === 'agent-text') {
        return (
            <View style={styles.fullViewContainer}>
                <Text style={styles.messageText}>{props.message.text}</Text>
            </View>
        )
    }
    if (props.message.kind === 'user-text') {
        return (
            <View style={styles.fullViewContainer}>
                <Text style={styles.messageText}>{props.message.text}</Text>
            </View>
        )
    }
    return null;
}
