import * as React from 'react';
import { Text, View, StyleSheet, Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

interface CommandViewProps {
    command: string;
    prompt?: string;
    stdout?: string | null;
    stderr?: string | null;
    error?: string | null;
    status?: string | null;
    // Legacy prop for backward compatibility
    output?: string | null;
    maxHeight?: number;
    fullWidth?: boolean;
    hideEmptyOutput?: boolean;
    // When true, the command line wraps within its container instead of overflowing horizontally.
    // Opt-in to preserve existing horizontal-scroll behavior for callers that wrap us in <ScrollView horizontal>.
    wrap?: boolean;
}

export const CommandView = React.memo<CommandViewProps>(({
    command,
    prompt = '$',
    stdout,
    stderr,
    error,
    status,
    output,
    maxHeight,
    fullWidth,
    hideEmptyOutput,
    wrap,
}) => {
    const { theme } = useUnistyles();
    // Use legacy output if new props aren't provided
    const hasNewProps = stdout !== undefined || stderr !== undefined || error !== undefined;

    // Web-only break-all so unbroken paths/tokens wrap mid-character. Native uses default break-on-space.
    const wrapTextStyle = wrap && Platform.OS === 'web' ? ({ wordBreak: 'break-all' } as any) : undefined;

    const styles = StyleSheet.create({
        container: {
            backgroundColor: theme.colors.terminal.background,
            borderRadius: 8,
            overflow: 'hidden',
            padding: 16,
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
        },
        line: {
            alignItems: 'baseline',
            flexDirection: 'row',
            ...(wrap ? { flexWrap: 'wrap' as const } : null),
        },
        promptText: {
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
            fontSize: 14,
            lineHeight: 20,
            color: theme.colors.terminal.prompt,
            fontWeight: '600',
        },
        commandText: {
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
            fontSize: 14,
            color: theme.colors.terminal.command,
            lineHeight: 20,
            ...(wrap ? { flexShrink: 1 } : null),
        },
        stdout: {
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
            fontSize: 13,
            color: theme.colors.terminal.stdout,
            lineHeight: 18,
            marginTop: 8,
        },
        stderr: {
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
            fontSize: 13,
            color: theme.colors.terminal.stderr,
            lineHeight: 18,
            marginTop: 8,
        },
        error: {
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
            fontSize: 13,
            color: theme.colors.terminal.error,
            lineHeight: 18,
            marginTop: 8,
        },
        emptyOutput: {
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
            fontSize: 13,
            color: theme.colors.terminal.emptyOutput,
            lineHeight: 18,
            marginTop: 8,
            fontStyle: 'italic',
        },
        status: {
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
            fontSize: 12,
            color: theme.colors.terminal.emptyOutput,
            lineHeight: 18,
            marginTop: 8,
        },
    });

    return (
        <View style={[
            styles.container, 
            maxHeight ? { maxHeight } : undefined,
            fullWidth ? { width: '100%' } : undefined
        ]}>
            {/* Command Line */}
            <View style={styles.line}>
                <Text style={styles.promptText}>{prompt} </Text>
                <Text style={[styles.commandText, wrapTextStyle]}>{command}</Text>
            </View>

            {hasNewProps ? (
                <>
                    {/* Standard Output */}
                    {stdout && stdout.trim() && (
                        <Text style={[styles.stdout, wrapTextStyle]}>{stdout}</Text>
                    )}

                    {/* Standard Error */}
                    {stderr && stderr.trim() && (
                        <Text style={[styles.stderr, wrapTextStyle]}>{stderr}</Text>
                    )}

                    {/* Error Message */}
                    {error && (
                        <Text style={[styles.error, wrapTextStyle]}>{error}</Text>
                    )}

                    {status && (
                        <Text style={[styles.status, wrapTextStyle]}>{status}</Text>
                    )}

                    {/* Empty output indicator */}
                    {!stdout && !stderr && !error && !status && !hideEmptyOutput && (
                        <Text style={styles.emptyOutput}>[Command completed with no output]</Text>
                    )}
                </>
            ) : (
                /* Legacy output format */
                output && (
                    <Text style={[styles.commandText, wrapTextStyle]}>{'\n---\n' + output}</Text>
                )
            )}
        </View>
    );
});
