import * as React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { CommandView } from '@/components/CommandView';
import { knownTools } from '@/components/tools/knownTools';
import { Metadata } from '@/sync/storageTypes';

export const BashView = React.memo((props: { tool: ToolCall, metadata: Metadata | null }) => {
    const { input, result, state } = props.tool;

    let parsedResult: { stdout?: string; stderr?: string } | null = null;
    let unparsedOutput: string | null = null;
    let error: string | null = null;
    
    if (state === 'completed' && result) {
        if (typeof result === 'string') {
            // Handle unparsed string result
            unparsedOutput = result;
        } else {
            // Try to parse as structured result
            const parsed = knownTools.Bash.result.safeParse(result);
            if (parsed.success) {
                parsedResult = parsed.data;
            } else {
                // If parsing fails but it's not a string, stringify it
                unparsedOutput = JSON.stringify(result);
            }
        }
    } else if (state === 'error' && typeof result === 'string') {
        error = result;
    }

    // Truncate output to first 2 lines for inline preview
    const truncate = (text: string | null | undefined, lines: number = 2): string | null => {
        if (!text || !text.trim()) return null;
        const allLines = text.split('\n');
        if (allLines.length <= lines) return text;
        return allLines.slice(0, lines).join('\n') + '\n…';
    };

    const previewStdout = parsedResult
        ? truncate(parsedResult.stdout)
        : truncate(unparsedOutput);
    const previewStderr = parsedResult ? truncate(parsedResult.stderr) : null;

    const { theme } = useUnistyles();
    const termBg = theme.colors.terminal.background;

    // Count total output lines for truncation indicator
    const fullOutput = parsedResult?.stdout || parsedResult?.stderr || unparsedOutput || '';
    const totalLines = fullOutput.split('\n').length;
    const shownLines = 2;
    const extraLines = Math.max(0, totalLines - shownLines);
    const isTruncated = extraLines > 0;

    return (
        <View style={{ marginHorizontal: -12, marginTop: -9, marginBottom: -1, backgroundColor: termBg }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                <CommandView
                    command={input.command}
                    stdout={previewStdout}
                    stderr={previewStderr}
                    error={error}
                    hideEmptyOutput
                />
            </ScrollView>
            {isTruncated && (
                <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                    <Text style={{ color: '#888', fontSize: 13, fontStyle: 'italic', opacity: 0.7 }}>
                        +{extraLines} more lines
                    </Text>
                </View>
            )}
        </View>
    );
});