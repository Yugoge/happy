import * as React from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Octicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { CommandView } from '@/components/CommandView';
import { Metadata } from '@/sync/storageTypes';
import { resolvePath } from '@/utils/pathUtils';
import { buildTerminalRenderData } from '@/utils/codexToolRendering';
import { t } from '@/text';

interface CodexBashViewProps {
    tool: ToolCall;
    metadata: Metadata | null;
}

// Parity with BashView.tsx: cap inline output preview at 2 lines
const MAX_PREVIEW_LINES = 2;

export const CodexBashView = React.memo<CodexBashViewProps>(({ tool, metadata }) => {
    const { theme } = useUnistyles();
    const { input, result, state } = tool;

    // Parse the input structure
    const command = input?.command;
    const parsedCmd = input?.parsed_cmd;

    // Determine the type of operation from parsed_cmd
    let operationType: 'read' | 'write' | 'bash' | 'unknown' = 'unknown';
    let fileName: string | null = null;
    let commandStr: string | null = null;

    if (parsedCmd && Array.isArray(parsedCmd) && parsedCmd.length > 0) {
        const firstCmd = parsedCmd[0];
        operationType = firstCmd.type || 'unknown';
        fileName = firstCmd.name || null;
        commandStr = firstCmd.cmd || null;
    }

    // Read branch — eye icon + readingFile label, horizontally scrollable
    if (operationType === 'read' && fileName) {
        const resolvedPath = resolvePath(fileName, metadata);
        return (
            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.container}>
                <View style={styles.iconRow}>
                    <Octicons name="eye" size={18} color={theme.colors.textSecondary} />
                    <Text style={styles.operationText}>{t('tools.desc.readingFile', { file: resolvedPath })}</Text>
                </View>
            </ScrollView>
        );
    }

    // Write branch — terminal icon + writingFile label, horizontally scrollable
    if (operationType === 'write' && fileName) {
        const resolvedPath = resolvePath(fileName, metadata);
        return (
            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.container}>
                <View style={styles.iconRow}>
                    <Octicons name="terminal" size={18} color={theme.colors.textSecondary} />
                    <Text style={styles.operationText}>{t('tools.desc.writingFile', { file: resolvedPath })}</Text>
                </View>
            </ScrollView>
        );
    }

    // Bash / unknown branch — flat BashView-style render (no dark wrapper, B03 fix)
    const terminal = buildTerminalRenderData(
        { ...input, command, parsed_cmd: parsedCmd, cmd: commandStr },
        state,
        result,
        MAX_PREVIEW_LINES,
    );

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={true}
            style={styles.container}
        >
            <View>
                <View style={styles.commandLine}>
                    <Text style={styles.prompt}>$ </Text>
                    <Text style={styles.command}>{terminal.command}</Text>
                </View>
                {terminal.stdout && <Text style={styles.stdout}>{terminal.stdout}</Text>}
                {terminal.stderr && <Text style={styles.stderr}>{terminal.stderr}</Text>}
                {terminal.error && <Text style={styles.errorText}>{terminal.error}</Text>}
                {terminal.statusLine && <Text style={styles.statusText}>{terminal.statusLine}</Text>}
                {terminal.extraLines > 0 && (
                    <Text style={styles.moreText}>+{terminal.extraLines} more lines</Text>
                )}
            </View>
        </ScrollView>
    );
});

export const CodexBashViewFull = React.memo<CodexBashViewProps>(({ tool }) => {
    const terminal = buildTerminalRenderData(tool.input, tool.state, tool.result);
    return (
        <View style={styles.fullContainer}>
            <CommandView
                command={terminal.command}
                stdout={terminal.stdout}
                stderr={terminal.stderr}
                error={terminal.error}
                status={terminal.statusLine}
                fullWidth
                wrap
            />
        </View>
    );
});

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingBottom: 4,
    },
    // Flat BashView-style command line (no dark background wrapper, B03)
    commandLine: {
        flexDirection: 'row',
        alignItems: 'baseline',
        paddingVertical: 4,
        paddingHorizontal: 4,
    },
    prompt: {
        fontFamily: MONO_FONT,
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        fontWeight: '600',
    },
    command: {
        fontFamily: MONO_FONT,
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        fontWeight: '500',
    },
    stdout: {
        fontFamily: MONO_FONT,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    stderr: {
        fontFamily: MONO_FONT,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.warning,
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    errorText: {
        fontFamily: MONO_FONT,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textDestructive,
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    statusText: {
        fontFamily: MONO_FONT,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    iconRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 4,
        paddingHorizontal: 4,
    },
    operationText: {
        fontSize: 14,
        color: theme.colors.text,
        fontWeight: '500',
    },
    moreText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
        opacity: 0.7,
        paddingVertical: 4,
        paddingHorizontal: 4,
    },
    fullContainer: {
        paddingBottom: 24,
    },
}));
