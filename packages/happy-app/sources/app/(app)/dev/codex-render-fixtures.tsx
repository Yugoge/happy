import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { MessageView } from '@/components/MessageView';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { RightSidebar } from '@/components/RightSidebar';
import { ToolFullView } from '@/components/tools/ToolFullView';
import { ToolView } from '@/components/tools/ToolView';
import { useRightSidebar } from '@/stores/rightSidebarStore';
import type { Message } from '@/sync/typesMessage';
import type { CodexRenderFixture } from './codex-render-fixtures-data';
import {
    CODEX_RENDER_FIXTURE_SESSION_ID,
    codexRenderFixtures,
} from './codex-render-fixtures-data';

const messageById = new Map(codexRenderFixtures.map((fixture) => [fixture.message.id, fixture.message]));

function DetailSurface({ fixture }: { fixture: CodexRenderFixture }) {
    if (fixture.tool) {
        return <ToolFullView tool={fixture.tool} metadata={null} messages={[]} />;
    }
    if (fixture.message.kind === 'agent-text') {
        return <MarkdownView markdown={fixture.message.text} />;
    }
    return null;
}

function ActionButton(props: { label: string; testID: string; onPress: () => void; icon: keyof typeof Ionicons.glyphMap }) {
    return (
        <Pressable testID={props.testID} style={styles.actionButton} onPress={props.onPress}>
            <Ionicons name={props.icon} size={16} color="#007AFF" />
            <Text style={styles.actionText}>{props.label}</Text>
        </Pressable>
    );
}

function FixtureCard(props: {
    fixture: CodexRenderFixture;
    selected: boolean;
    onSelectDetail: () => void;
    onOpenSidebar: () => void;
}) {
    const { fixture } = props;
    return (
        <View testID={`codex-fixture-${fixture.id}`} style={styles.fixtureCard}>
            <View style={styles.fixtureHeader}>
                <Text style={styles.matrixRow}>{fixture.matrixRow}</Text>
                <Text style={styles.fixtureTitle}>{fixture.title}</Text>
                <Text style={styles.fixtureDescription}>{fixture.description}</Text>
                <Text style={styles.matrixDetails}>
                    User: {fixture.matrix.userToolToken} · Renderer: {fixture.matrix.rendererToolKey} · Inline: {fixture.matrix.inlinePreview} · Raw: {fixture.matrix.rawJson} · State: {fixture.matrix.state} · {fixture.matrix.classification}
                </Text>
            </View>
            <View style={styles.inlineSurface} testID={`codex-fixture-inline-${fixture.id}`}>
                {fixture.tool ? (
                    <ToolView
                        tool={fixture.tool}
                        metadata={null}
                        messages={[]}
                        sessionId={CODEX_RENDER_FIXTURE_SESSION_ID}
                        onPress={props.onSelectDetail}
                        onContentPress={(data) => {
                            useRightSidebar.getState().open(data);
                        }}
                    />
                ) : (
                    <MessageView
                        message={fixture.message}
                        metadata={null}
                        sessionId={CODEX_RENDER_FIXTURE_SESSION_ID}
                        getMessageById={(id: string): Message | null => messageById.get(id) ?? null}
                    />
                )}
            </View>
            <View style={styles.actions}>
                <ActionButton
                    label={props.selected ? 'Detail open' : 'Open detail'}
                    testID={`codex-fixture-open-detail-${fixture.id}`}
                    icon="expand-outline"
                    onPress={props.onSelectDetail}
                />
                {fixture.tool ? (
                    <ActionButton
                        label="Open sidebar"
                        testID={`codex-fixture-open-sidebar-${fixture.id}`}
                        icon="albums-outline"
                        onPress={props.onOpenSidebar}
                    />
                ) : null}
            </View>
        </View>
    );
}

export default React.memo(function CodexRenderFixturesScreen() {
    const [selectedId, setSelectedId] = React.useState(codexRenderFixtures[0].id);
    const openSidebar = useRightSidebar((state) => state.open);
    const closeSidebar = useRightSidebar((state) => state.close);
    const selectedFixture = codexRenderFixtures.find((fixture) => fixture.id === selectedId)
        ?? codexRenderFixtures[0];

    React.useEffect(() => closeSidebar, [closeSidebar]);

    return (
        <View style={styles.root}>
            <Stack.Screen options={{ headerTitle: 'Codex Render Fixtures' }} />
            <ScrollView style={styles.main} contentContainerStyle={styles.content}>
                <View style={styles.intro} testID="codex-render-fixtures-route">
                    <Text style={styles.pageTitle}>Codex Rendering Fixture Matrix</Text>
                    <Text style={styles.pageDescription}>
                        Dev-only deterministic samples for QA. Inline cards use the same ToolView and
                        MessageView components as sessions; detail uses ToolFullView; sidebar uses the
                        same RightSidebar content renderer.
                    </Text>
                    <Text style={styles.routeHint}>
                        Route: /dev/codex-render-fixtures
                    </Text>
                </View>

                {codexRenderFixtures.map((fixture) => (
                    <FixtureCard
                        key={fixture.id}
                        fixture={fixture}
                        selected={fixture.id === selectedFixture.id}
                        onSelectDetail={() => setSelectedId(fixture.id)}
                        onOpenSidebar={() => {
                            if (fixture.tool) {
                                openSidebar({
                                    tool: fixture.tool,
                                    messages: [],
                                    metadata: null,
                                    sessionId: CODEX_RENDER_FIXTURE_SESSION_ID,
                                });
                            }
                        }}
                    />
                ))}

                <View
                    testID={`codex-fixture-detail-${selectedFixture.id}`}
                    style={styles.detailSurface}
                >
                    <Text style={styles.detailTitle}>Detail surface: {selectedFixture.title}</Text>
                    <DetailSurface fixture={selectedFixture} />
                </View>
            </ScrollView>
            <RightSidebar />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: theme.colors.surface,
    },
    main: {
        flex: 1,
    },
    content: {
        padding: 16,
        gap: 16,
    },
    intro: {
        gap: 8,
        padding: 16,
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHigh,
    },
    pageTitle: {
        fontSize: 24,
        fontWeight: '700',
        color: theme.colors.text,
    },
    pageDescription: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    routeHint: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        fontFamily: 'monospace',
    },
    fixtureCard: {
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHigh,
        overflow: 'hidden',
    },
    fixtureHeader: {
        gap: 4,
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    matrixRow: {
        fontSize: 11,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        color: theme.colors.textSecondary,
    },
    fixtureTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: theme.colors.text,
    },
    fixtureDescription: {
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    matrixDetails: {
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.textSecondary,
        fontFamily: 'monospace',
    },
    inlineSurface: {
        paddingHorizontal: 8,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        padding: 12,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
        backgroundColor: theme.colors.surfaceHighest,
    },
    actionText: {
        color: '#007AFF',
        fontSize: 13,
        fontWeight: '600',
    },
    detailSurface: {
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHigh,
        padding: 12,
        marginBottom: 32,
        overflow: 'hidden',
    },
    detailTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: theme.colors.text,
        marginBottom: 12,
    },
}));
