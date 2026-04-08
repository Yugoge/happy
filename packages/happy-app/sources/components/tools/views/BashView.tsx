import * as React from 'react';
import { View, Text, Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { knownTools } from '@/components/tools/knownTools';
import { Metadata } from '@/sync/storageTypes';

// Count non-empty lines in text
function countLines(text: string | null | undefined): number {
    if (!text || !text.trim()) return 0;
    return text.split('\n').length;
}

// Truncate text to N lines, removing trailing content
function truncateLines(text: string | null | undefined, max: number): string | null {
    if (!text || !text.trim()) return null;
    const lines = text.split('\n');
    if (lines.length <= max) return text;
    return lines.slice(0, max).join('\n');
}

// Parse bash tool result into structured output
function parseBashResult(state: string, result: any) {
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

const MAX_PREVIEW_LINES = 2;

export const BashView = React.memo((props: { tool: ToolCall, metadata: Metadata | null }) => {
    const { input, result, state } = props.tool;
    const { parsed, unparsed, error } = parseBashResult(state, result);

    const previewStdout = parsed ? truncateLines(parsed.stdout, MAX_PREVIEW_LINES) : truncateLines(unparsed, MAX_PREVIEW_LINES);
    const previewStderr = parsed ? truncateLines(parsed.stderr, MAX_PREVIEW_LINES) : null;

    // Truncate command itself (heredoc/multiline commands can be very long)
    const cmdLines = countLines(input.command);
    const previewCommand = truncateLines(input.command, MAX_PREVIEW_LINES) || input.command;

    // Count total lines across command + all outputs for truncation indicator
    const outputLines = (parsed ? countLines(parsed.stdout) + countLines(parsed.stderr) : countLines(unparsed));
    const totalLines = cmdLines + outputLines;
    const shownLines = Math.min(cmdLines, MAX_PREVIEW_LINES) + Math.min(outputLines, MAX_PREVIEW_LINES);
    const extraLines = Math.max(0, totalLines - shownLines);

    return (
        <View style={styles.container}>
            <View style={styles.commandLine}>
                <Text style={styles.prompt}>$ </Text>
                <Text style={styles.command} numberOfLines={2}>{previewCommand}</Text>
            </View>
            {previewStdout && (
                <Text style={styles.stdout} numberOfLines={MAX_PREVIEW_LINES}>{previewStdout}</Text>
            )}
            {previewStderr && (
                <Text style={styles.stderr} numberOfLines={MAX_PREVIEW_LINES}>{previewStderr}</Text>
            )}
            {error && (
                <Text style={styles.errorText} numberOfLines={MAX_PREVIEW_LINES}>{error}</Text>
            )}
            {extraLines > 0 && (
                <Text style={styles.moreText}>+{extraLines} more lines</Text>
            )}
        </View>
    );
});

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingBottom: 4,
    },
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
        color: theme.colors.text,
        fontWeight: '500',
        flex: 1,
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
    moreText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontStyle: 'italic',
        opacity: 0.7,
        paddingVertical: 4,
        paddingHorizontal: 4,
    },
}));
