import * as React from 'react';
import { Text, View, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall, Message } from '@/sync/typesMessage';
import { CodeView } from '../CodeView';
import { Metadata } from '@/sync/storageTypes';
import { getToolFullViewComponent } from './views/_all';
import { layout } from '../layout';
import { useLocalSetting } from '@/sync/storage';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { stringifyInspectableValue } from '@/utils/codexToolRendering';
import { stringifyToolCommand } from '@/utils/toolCommand';

interface ToolFullViewProps {
    tool: ToolCall;
    metadata?: Metadata | null;
    messages?: Message[];
}

const SPECIALIZED_FULL_PAYLOAD_TOOLS = new Set([
    'CodexBash',
    'CodexPatch',
    'CodexDiff',
    'functions.update_plan',
    'functions.view_image',
    // Wave-2 fix: the real Codex image-generation tool name (functions.image_generation,
    // routed to the inline/full image attachment view in _all.tsx). Without this, the
    // detail page would dump the raw multi-MB base64 data-URI as Output JSON (§5.14#4).
    'functions.image_generation',
    'file',
    'multi_tool_use.parallel',
    // B13 (AC-B13-2): the lifecycle full view (AgentFullView → TaskViewFull) now
    // renders structured Prompt + Tool Calls + Result/final_summary itself, so
    // suppress the raw Input/Output JSON dump that would otherwise duplicate it.
    'functions.subagent_lifecycle',
]);

// Extracted generic sections so ToolFullView stays under line-count limits

function unwrapShellCommand(command: string): string {
    const match = command.match(/^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+([\s\S]+)$/);
    if (!match) return command;
    const inner = match[1].trim();
    if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
    ) {
        return inner.slice(1, -1).trim();
    }
    return inner;
}

function getCommandCandidates(input: ToolCall['input']): string[] {
    const candidates = new Set<string>();
    const add = (value: unknown) => {
        if (typeof value !== 'string') return;
        const trimmed = value.trim();
        if (!trimmed) return;
        candidates.add(trimmed);
        candidates.add(unwrapShellCommand(trimmed));
    };
    add(stringifyToolCommand(input?.command));
    if (Array.isArray(input?.command)) add(input.command.join(' '));
    if (Array.isArray(input?.parsed_cmd)) {
        input.parsed_cmd.forEach((entry: any) => add(entry?.cmd));
    }
    return Array.from(candidates);
}

function ToolDescriptionSection({ tool }: { tool: ToolCall }) {
    // B13 (codex F4): the lifecycle full view (TaskViewFull) renders the prompt in
    // its own Prompt section, and tool.description echoes that prompt — hide the
    // generic Description here to avoid duplicating it on mobile detail.
    if (tool.name === 'functions.subagent_lifecycle') return null;
    // Guard: hide Description when it is empty or echoes a raw command.
    // Codex exec_command populates tool.description from input.description,
    // which is the raw `/bin/bash -lc "..."` string — identical to input.command.
    // Rendering it duplicates Input Parameters; hide in that case (spec §5.7 R1).
    const desc = typeof tool.description === 'string' ? tool.description.trim() : '';
    if (!desc) return null;
    const normalizedDesc = unwrapShellCommand(desc);
    const commandCandidates = getCommandCandidates(tool.input);
    if (commandCandidates.some((candidate) => candidate === desc || candidate === normalizedDesc)) return null;
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Ionicons name="information-circle" size={20} color="#5856D6" />
                <Text style={styles.sectionTitle}>{t('tools.fullView.description')}</Text>
            </View>
            <Text style={styles.description}>{tool.description}</Text>
        </View>
    );
}

function ToolInputSection({ tool }: { tool: ToolCall }) {
    if (!tool.input) return null;
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Ionicons name="log-in" size={20} color="#5856D6" />
                <Text style={styles.sectionTitle}>{t('tools.fullView.inputParams')}</Text>
            </View>
            <CodeView code={JSON.stringify(tool.input, null, 2)} />
        </View>
    );
}

function ToolOutputSection({ tool }: { tool: ToolCall }) {
    const hasResult = Object.prototype.hasOwnProperty.call(tool, 'result');
    if (tool.state !== 'completed' || !hasResult) return null;
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Ionicons name="log-out" size={20} color="#34C759" />
                <Text style={styles.sectionTitle}>{t('tools.fullView.output')}</Text>
            </View>
            <CodeView
                code={stringifyInspectableValue(tool.result)}
            />
        </View>
    );
}

function ToolErrorSection({ tool }: { tool: ToolCall }) {
    const hasResult = Object.prototype.hasOwnProperty.call(tool, 'result');
    if (tool.state !== 'error' || !hasResult) return null;
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Ionicons name="close-circle" size={20} color="#FF3B30" />
                <Text style={styles.sectionTitle}>{t('tools.fullView.error')}</Text>
            </View>
            <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{stringifyInspectableValue(tool.result)}</Text>
            </View>
        </View>
    );
}

function ToolEmptyOutputSection({ tool }: { tool: ToolCall }) {
    const hasResult = Object.prototype.hasOwnProperty.call(tool, 'result');
    if (tool.state !== 'completed' || hasResult) return null;
    return (
        <View style={styles.section}>
            <View style={styles.emptyOutputContainer}>
                <Ionicons name="checkmark-circle-outline" size={48} color="#34C759" />
                <Text style={styles.emptyOutputText}>{t('tools.fullView.completed')}</Text>
                <Text style={styles.emptyOutputSubtext}>{t('tools.fullView.noOutput')}</Text>
            </View>
        </View>
    );
}

function ToolRawJsonSection({ tool, messages }: { tool: ToolCall; messages: Message[] }) {
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Ionicons name="code-slash" size={20} color="#FF9500" />
                <Text style={styles.sectionTitle}>{t('tools.fullView.rawJsonDevMode')}</Text>
            </View>
            <CodeView
                code={JSON.stringify({
                    name: tool.name, state: tool.state, description: tool.description,
                    input: tool.input, result: tool.result, createdAt: tool.createdAt,
                    startedAt: tool.startedAt, completedAt: tool.completedAt,
                    permission: tool.permission, messages
                }, null, 2)}
            />
        </View>
    );
}

export function ToolFullView({ tool, metadata, messages = [] }: ToolFullViewProps) {
    const SpecializedFullView = getToolFullViewComponent(tool.name);
    const specializedOwnsPayload = SPECIALIZED_FULL_PAYLOAD_TOOLS.has(tool.name);
    const screenWidth = useWindowDimensions().width;
    const devModeEnabled = (useLocalSetting('devModeEnabled') || __DEV__);

    return (
        <ScrollView style={[styles.container, { paddingHorizontal: screenWidth > 700 ? 16 : 0 }]}>
            <View style={styles.contentWrapper}>
                <ToolDescriptionSection tool={tool} />
                {(!SpecializedFullView || !specializedOwnsPayload) && <ToolInputSection tool={tool} />}
                {SpecializedFullView ? (
                    <SpecializedFullView tool={tool} metadata={metadata || null} messages={messages} />
                ) : null}
                {(!SpecializedFullView || !specializedOwnsPayload) && <ToolOutputSection tool={tool} />}
                {(!SpecializedFullView || !specializedOwnsPayload) && <ToolErrorSection tool={tool} />}
                {!SpecializedFullView && <ToolEmptyOutputSection tool={tool} />}
                {devModeEnabled && <ToolRawJsonSection tool={tool} messages={messages} />}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
        paddingTop: 12,
    },
    contentWrapper: {
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        width: '100%',
    },
    section: {
        marginBottom: 28,
        paddingHorizontal: 4,
    },
    sectionFullWidth: {
        marginBottom: 28,
        paddingHorizontal: 0,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 8,
    },
    sectionTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.text,
    },
    description: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    toolId: {
        fontSize: 12,
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
        color: theme.colors.textSecondary,
    },
    errorContainer: {
        backgroundColor: theme.colors.box.error.background,
        borderRadius: 8,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.colors.box.error.border,
    },
    errorText: {
        fontSize: 14,
        color: theme.colors.box.error.text,
        lineHeight: 20,
    },
    emptyOutputContainer: {
        alignItems: 'center',
        paddingVertical: 48,
        gap: 12,
    },
    emptyOutputText: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    emptyOutputSubtext: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
}));

// Export styles for use in specialized views
export const toolFullViewStyles = styles;
