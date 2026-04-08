import * as React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { CommandView } from '@/components/CommandView';
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <CommandView
                    command={previewCommand}
                    stdout={previewStdout}
                    stderr={previewStderr}
                    error={error}
                    hideEmptyOutput
                />
            </ScrollView>
            {extraLines > 0 && (
                <View style={styles.moreContainer}>
                    <Text style={styles.moreText}>+{extraLines} more lines</Text>
                </View>
            )}
        </View>
    );
});

// Negative margins compensate for ToolView content area padding (12px horizontal, 8px top, 1px border)
// so the terminal block fills edge-to-edge inside the tool card
const styles = StyleSheet.create((theme) => ({
    container: {
        marginHorizontal: -12,
        marginTop: -9,
        marginBottom: -1,
        backgroundColor: theme.colors.terminal.background,
        borderBottomLeftRadius: 11,
        borderBottomRightRadius: 11,
        overflow: 'hidden',
    },
    moreContainer: {
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    moreText: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        fontStyle: 'italic',
        opacity: 0.7,
    },
}));
