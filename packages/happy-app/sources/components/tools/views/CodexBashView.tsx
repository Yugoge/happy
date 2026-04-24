import * as React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Octicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { knownTools } from '@/components/tools/knownTools';
import { CommandView } from '@/components/CommandView';
import { Metadata } from '@/sync/storageTypes';
import { resolvePath } from '@/utils/pathUtils';
import { stringifyToolCommand } from '@/utils/toolCommand';
import { t } from '@/text';

interface CodexBashViewProps {
    tool: ToolCall;
    metadata: Metadata | null;
}

// Parity with BashView.tsx: cap inline output preview at 2 lines
const MAX_PREVIEW_LINES = 2;

function countLines(text: string | null | undefined): number {
    if (!text || !text.trim()) return 0;
    return text.split('\n').length;
}

function truncateLines(text: string | null | undefined, max: number): string | null {
    if (!text || !text.trim()) return null;
    const lines = text.split('\n');
    if (lines.length <= max) return text;
    return lines.slice(0, max).join('\n');
}

// Mirror BashView.tsx parseBashResult — reuses knownTools.Bash.result schema
function parseCodexBashResult(state: string, result: any) {
    let parsed: { stdout?: string; stderr?: string } | null = null;
    let unparsed: string | null = null;
    let error: string | null = null;

    if (state === 'completed' && result) {
        if (typeof result === 'string') {
            unparsed = result;
        } else {
            const r = knownTools.Bash.result.safeParse(result);
            parsed = r.success ? r.data : null;
            if (!parsed) unparsed = JSON.stringify(result);
        }
    } else if (state === 'error' && typeof result === 'string') {
        error = result;
    }
    return { parsed, unparsed, error };
}

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

    // Write branch — file-diff icon + writingFile label, horizontally scrollable
    if (operationType === 'write' && fileName) {
        const resolvedPath = resolvePath(fileName, metadata);
        return (
            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.container}>
                <View style={styles.iconRow}>
                    <Octicons name="file-diff" size={18} color={theme.colors.textSecondary} />
                    <Text style={styles.operationText}>{t('tools.desc.writingFile', { file: resolvedPath })}</Text>
                </View>
            </ScrollView>
        );
    }

    // Bash / unknown branch — ScrollView horizontal + CommandView with parsed result
    const commandDisplay = commandStr || stringifyToolCommand(command) || '';
    const { parsed, unparsed, error } = parseCodexBashResult(state, result);

    const previewStdout = parsed
        ? truncateLines(parsed.stdout, MAX_PREVIEW_LINES)
        : truncateLines(unparsed, MAX_PREVIEW_LINES);
    const previewStderr = parsed ? truncateLines(parsed.stderr, MAX_PREVIEW_LINES) : null;

    // +N more lines indicator (parity with BashView.tsx)
    const outputLines = parsed
        ? countLines(parsed.stdout) + countLines(parsed.stderr)
        : countLines(unparsed);
    const shownOutputLines = parsed
        ? Math.min(countLines(parsed.stdout), MAX_PREVIEW_LINES) + Math.min(countLines(parsed.stderr), MAX_PREVIEW_LINES)
        : Math.min(countLines(unparsed), MAX_PREVIEW_LINES);
    const extraLines = Math.max(0, outputLines - shownOutputLines);

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={true}
            style={styles.container}
            contentContainerStyle={styles.scrollContent}
        >
            <View style={styles.commandWrapper}>
                <CommandView
                    command={commandDisplay}
                    stdout={previewStdout}
                    stderr={previewStderr}
                    error={error}
                    hideEmptyOutput
                />
                {extraLines > 0 && (
                    <Text style={styles.moreText}>+{extraLines} more lines</Text>
                )}
            </View>
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingBottom: 4,
    },
    scrollContent: {
        flexGrow: 1,
    },
    commandWrapper: {
        flex: 1,
        minWidth: '100%' as any,
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
}));
