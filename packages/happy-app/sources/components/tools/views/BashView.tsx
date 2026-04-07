import * as React from 'react';
import { View } from 'react-native';
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

    // Truncate output to first 3 lines for inline preview
    const truncate = (text: string | null | undefined, lines: number = 3): string | null => {
        if (!text || !text.trim()) return null;
        const allLines = text.split('\n');
        if (allLines.length <= lines) return text;
        return allLines.slice(0, lines).join('\n') + '\n…';
    };

    const previewStdout = parsedResult
        ? truncate(parsedResult.stdout)
        : truncate(unparsedOutput);
    const previewStderr = parsedResult ? truncate(parsedResult.stderr) : null;

    return (
        <View style={{ maxHeight: 80, overflow: 'hidden' }}>
            <CommandView
                command={input.command}
                stdout={previewStdout}
                stderr={previewStderr}
                error={error}
                hideEmptyOutput
            />
        </View>
    );
});