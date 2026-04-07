import * as React from 'react';
import { Text, View, TouchableOpacity, Pressable, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { getToolViewComponent } from './views/_all';
import { Message, ToolCall } from '@/sync/typesMessage';
import { CodeView } from '../CodeView';
import { ToolSectionView } from './ToolSectionView';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import { ToolError } from './ToolError';
import { knownTools } from '@/components/tools/knownTools';
import { Metadata } from '@/sync/storageTypes';
import { useRouter } from 'expo-router';
import { useRightSidebar } from '@/stores/rightSidebarStore';
import { useDetailView } from '@/stores/detailViewStore';
import { PermissionFooter } from './PermissionFooter';
import { parseToolUseError } from '@/utils/toolErrorParser';
import { formatMCPTitle } from './views/MCPToolView';
import { t } from '@/text';

interface ToolViewProps {
    metadata: Metadata | null;
    tool: ToolCall;
    messages?: Message[];
    onPress?: () => void;
    onContentPress?: (data: { tool: ToolCall; messages: Message[]; metadata: Metadata | null; sessionId: string }) => void;
    sessionId?: string;
    messageId?: string;
}

const SPINNER_SCALE = [{ scaleX: 0.8 }, { scaleY: 0.8 }];

// Builds the press handler for the tool header row.
// On desktop (width >= 901), opens the inline detail view so the sidebar stays visible.
// On mobile, pushes a Stack screen as before.
function useToolPress(deps: {
    onPress?: () => void;
    sessionId?: string;
    messageId?: string;
    isDesktop: boolean;
    openDetail: (id: string) => void;
    router: ReturnType<typeof useRouter>;
}) {
    const { onPress, sessionId, messageId, isDesktop, openDetail, router } = deps;
    return React.useCallback(() => {
        if (onPress) return onPress();
        if (!sessionId || !messageId) return;
        if (isDesktop) return openDetail(messageId);
        router.push(`/session/${sessionId}/message/${messageId}`);
    }, [onPress, sessionId, messageId, isDesktop, openDetail, router]);
}

export const ToolView = React.memo<ToolViewProps>((props) => {
    const { tool, onPress, onContentPress, sessionId, messageId } = props;
    const router = useRouter();
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const isDesktop = width >= 901;
    const openDetail = useDetailView((s) => s.open);

    const handlePress = useToolPress({ onPress, sessionId, messageId, isDesktop, openDetail, router });

    const hasSpecializedView = !!getToolViewComponent(tool.name);

    const handleContentPress = React.useCallback(() => {
        if (onContentPress && sessionId) {
            onContentPress({
                tool,
                messages: props.messages ?? [],
                metadata: props.metadata,
                sessionId,
            });
        }
    }, [onContentPress, tool, props.messages, props.metadata, sessionId]);

    const isPressable = !!(onPress || (sessionId && messageId));
    const knownTool = knownTools[tool.name as keyof typeof knownTools] as any;

    if (knownTool?.hidden) {
        return null;
    }

    const cfg = buildToolConfig(tool, props.metadata, props.messages, knownTool, theme);

    const headerContent = (
        <View style={styles.headerLeft}>
            <View style={styles.iconContainer}>{cfg.icon}</View>
            <View style={styles.titleContainer}>
                <Text style={styles.toolName} numberOfLines={1}>
                    {cfg.toolTitle}
                    {cfg.status ? <Text style={styles.status}>{` ${cfg.status}`}</Text> : null}
                </Text>
                {cfg.description && (
                    <Text style={styles.toolDescription} numberOfLines={1}>
                        {cfg.description}
                    </Text>
                )}
            </View>
            {tool.state === 'running' && (
                <View style={styles.elapsedContainer}>
                    <ElapsedView from={tool.createdAt} />
                </View>
            )}
            {cfg.statusIcon}
        </View>
    );

    return (
        <View style={styles.container}>
            {isPressable ? (
                <TouchableOpacity style={styles.header} onPress={handlePress} activeOpacity={0.8}>
                    {headerContent}
                </TouchableOpacity>
            ) : (
                <View style={styles.header}>{headerContent}</View>
            )}

            {hasSpecializedView && onContentPress ? (
                <Pressable onPress={handleContentPress}>
                    <ToolContent
                        tool={tool}
                        metadata={props.metadata}
                        messages={props.messages}
                        sessionId={sessionId}
                        hideDefaultError={cfg.hideDefaultError}
                        isToolUseError={cfg.isToolUseError}
                    />
                </Pressable>
            ) : !cfg.minimal ? (
                <ToolContent
                    tool={tool}
                    metadata={props.metadata}
                    messages={props.messages}
                    sessionId={sessionId}
                    hideDefaultError={cfg.hideDefaultError}
                    isToolUseError={cfg.isToolUseError}
                />
            ) : null}

            {tool.permission && sessionId && tool.name !== 'AskUserQuestion' && (
                <PermissionFooter
                    permission={tool.permission}
                    sessionId={sessionId}
                    toolName={tool.name}
                    toolInput={tool.input}
                    metadata={props.metadata}
                />
            )}
        </View>
    );
});

// Extracts status and description strings from knownTool extractors
function extractStrings(tool: ToolCall, metadata: Metadata | null, knownTool: any) {
    let status: string | null = null;
    let description: string | null = null;
    if (knownTool && typeof knownTool.extractStatus === 'function') {
        const s = knownTool.extractStatus({ tool, metadata });
        if (typeof s === 'string' && s) status = s;
    }
    if (knownTool && typeof knownTool.extractSubtitle === 'function') {
        const sub = knownTool.extractSubtitle({ tool, metadata });
        if (typeof sub === 'string' && sub) description = sub;
    }
    return { status, description };
}

// Resolves icon element for CodexBash and generic tools
function buildIcon(tool: ToolCall, knownTool: any, fallback: React.ReactNode, textColor: string): React.ReactNode {
    if (tool.name === 'CodexBash' && Array.isArray(tool.input?.parsed_cmd) && tool.input.parsed_cmd.length > 0) {
        const cmd = tool.input.parsed_cmd[0];
        if (cmd.type === 'read') return <Octicons name="eye" size={18} color={textColor} />;
        if (cmd.type === 'write') return <Octicons name="file-diff" size={18} color={textColor} />;
        return <Octicons name="terminal" size={18} color={textColor} />;
    }
    if (knownTool && typeof knownTool.icon === 'function') {
        return knownTool.icon(18, textColor);
    }
    return fallback;
}

// Resolves status indicator icon based on permission, error, and running state
function buildStatusIcon(tool: ToolCall, noStatus: boolean, theme: any): React.ReactNode {
    const isDenied = tool.permission &&
        (tool.permission.status === 'denied' || tool.permission.status === 'canceled');
    const isError = tool.state === 'error' && !!tool.result && parseToolUseError(tool.result).isToolUseError;
    if (isDenied || isError) {
        return <Ionicons name="remove-circle-outline" size={20} color={theme.colors.textSecondary} />;
    }
    if (tool.state === 'running' && !noStatus) {
        return <ActivityIndicator size="small" color={theme.colors.text} style={{ transform: SPINNER_SCALE }} />;
    }
    if (tool.state === 'error') {
        return <Ionicons name="alert-circle-outline" size={20} color={theme.colors.warning} />;
    }
    return null;
}

// Resolves title from knownTool definition
function resolveTitle(tool: ToolCall, metadata: Metadata | null, knownTool: any) {
    if (tool.name.startsWith('mcp__')) {
        return { toolTitle: formatMCPTitle(tool.name), isMcp: true };
    }
    if (knownTool?.title) {
        const title = typeof knownTool.title === 'function'
            ? knownTool.title({ tool, metadata })
            : knownTool.title;
        return { toolTitle: title as string, isMcp: false };
    }
    return { toolTitle: tool.name, isMcp: false };
}

// Resolves display flags (minimal, noStatus, hideDefaultError) from knownTool
function resolveFlags(tool: ToolCall, metadata: Metadata | null, messages: Message[] | undefined, knownTool: any, isMcp: boolean) {
    let minimal = isMcp;
    let noStatus = false;
    let hideDefaultError = false;
    if (knownTool?.minimal !== undefined) {
        minimal = typeof knownTool.minimal === 'function'
            ? knownTool.minimal({ tool, metadata, messages })
            : knownTool.minimal;
    }
    if (typeof knownTool?.noStatus === 'boolean') noStatus = knownTool.noStatus;
    if (typeof knownTool?.hideDefaultError === 'boolean') hideDefaultError = knownTool.hideDefaultError;
    return { minimal, noStatus, hideDefaultError };
}

interface ToolConfig {
    toolTitle: string;
    description: string | null;
    status: string | null;
    minimal: boolean;
    hideDefaultError: boolean;
    isToolUseError: boolean;
    icon: React.ReactNode;
    statusIcon: React.ReactNode;
}

// Assembles complete display config for a tool call
function buildToolConfig(
    tool: ToolCall,
    metadata: Metadata | null,
    messages: Message[] | undefined,
    knownTool: any,
    theme: any,
): ToolConfig {
    const secondaryColor = theme.colors.textSecondary;
    const { status, description } = extractStrings(tool, metadata, knownTool);
    const { toolTitle, isMcp } = resolveTitle(tool, metadata, knownTool);
    let { minimal, noStatus, hideDefaultError } = resolveFlags(tool, metadata, messages, knownTool, isMcp);

    if (!knownTool && metadata?.flavor === 'gemini') minimal = true;

    const mcpIcon: React.ReactNode = <Ionicons name="extension-puzzle-outline" size={18} color={secondaryColor} />;
    const fallbackIcon: React.ReactNode = <Ionicons name="construct-outline" size={18} color={secondaryColor} />;
    const icon = buildIcon(tool, knownTool, isMcp ? mcpIcon : fallbackIcon, theme.colors.text);

    const isToolUseError =
        tool.state === 'error' && !!tool.result && parseToolUseError(tool.result).isToolUseError;
    if (isToolUseError) { hideDefaultError = true; minimal = true; }

    return {
        toolTitle, description, status, minimal, hideDefaultError, isToolUseError,
        icon, statusIcon: buildStatusIcon(tool, noStatus, theme),
    };
}

// Renders the content area below the header
const ToolContent = React.memo<{
    tool: ToolCall;
    metadata: Metadata | null;
    messages?: Message[];
    sessionId?: string;
    hideDefaultError: boolean;
    isToolUseError: boolean;
}>(({ tool, metadata, messages, sessionId, hideDefaultError, isToolUseError }) => {
    const SpecificToolView = getToolViewComponent(tool.name);
    const isDeniedOrCanceled =
        tool.permission &&
        (tool.permission.status === 'denied' || tool.permission.status === 'canceled');

    if (SpecificToolView) {
        return (
            <View style={styles.content}>
                <SpecificToolView tool={tool} metadata={metadata} messages={messages ?? []} sessionId={sessionId} />
                {tool.state === 'error' && tool.result && !isDeniedOrCanceled && !hideDefaultError && (
                    <ToolError message={String(tool.result)} />
                )}
            </View>
        );
    }

    if (tool.state === 'error' && tool.result && !isDeniedOrCanceled && !isToolUseError) {
        return (
            <View style={styles.content}>
                <ToolError message={String(tool.result)} />
            </View>
        );
    }

    return (
        <View style={styles.content}>
            {tool.input && (
                <ToolSectionView title={t('toolView.input')}>
                    <CodeView code={JSON.stringify(tool.input, null, 2)} />
                </ToolSectionView>
            )}
            {tool.state === 'completed' && tool.result && (
                <ToolSectionView title={t('toolView.output')}>
                    <CodeView
                        code={typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                    />
                </ToolSectionView>
            )}
        </View>
    );
});

function ElapsedView(props: { from: number }) {
    const { from } = props;
    const elapsed = useElapsedTime(from);
    return <Text style={styles.elapsedText}>{elapsed.toFixed(1)}s</Text>;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 8,
        marginVertical: 4,
        overflow: 'hidden'
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        backgroundColor: theme.colors.surfaceHighest,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    iconContainer: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleContainer: {
        flex: 1,
    },
    elapsedContainer: {
        marginLeft: 8,
    },
    elapsedText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    },
    toolName: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
    },
    status: {
        fontWeight: '400',
        opacity: 0.3,
        fontSize: 15,
    },
    toolDescription: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    content: {
        paddingHorizontal: 12,
        paddingTop: 8,
        overflow: 'visible',
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
}));
