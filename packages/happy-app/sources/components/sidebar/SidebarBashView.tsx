import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { knownTools } from '@/components/tools/knownTools';
import { CommandView } from '@/components/CommandView';

interface SidebarBashViewProps {
    tool: ToolCall;
}

export const SidebarBashView = React.memo<SidebarBashViewProps>(({ tool }) => {
    const { input, result, state } = tool;

    // Parse the result following the same pattern as BashViewFull
    let parsedResult: { stdout?: string; stderr?: string } | null = null;
    let unparsedOutput: string | null = null;
    let error: string | null = null;

    if (state === 'completed' && result) {
        if (typeof result === 'string') {
            unparsedOutput = result;
        } else {
            const parsed = knownTools.Bash.result.safeParse(result);
            if (parsed.success) {
                parsedResult = parsed.data;
            } else {
                unparsedOutput = JSON.stringify(result);
            }
        }
    } else if (state === 'error' && typeof result === 'string') {
        error = result;
    }

    // Extract command string from various tool input formats
    const command = typeof input?.command === 'string'
        ? input.command
        : Array.isArray(input?.command)
            ? input.command.join(' ')
            : '';

    return (
        <View style={styles.container}>
            <CommandView
                command={command}
                stdout={parsedResult?.stdout || unparsedOutput}
                stderr={parsedResult?.stderr}
                error={error}
                fullWidth
                wrap
            />
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
        paddingTop: 12,
    },
}));
