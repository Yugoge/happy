import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { CommandView } from '@/components/CommandView';
import { buildTerminalRenderData } from '@/utils/codexToolRendering';

interface SidebarBashViewProps {
    tool: ToolCall;
}

export const SidebarBashView = React.memo<SidebarBashViewProps>(({ tool }) => {
    const { input, result, state } = tool;
    const terminal = buildTerminalRenderData(input, state, result);

    return (
        <View style={styles.container}>
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

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
        paddingTop: 12,
    },
}));
