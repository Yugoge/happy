import * as React from 'react';
import { View, ScrollView } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { CodeView } from '@/components/CodeView';
import { ToolSectionView } from '@/components/tools/ToolSectionView';
import { t } from '@/text';

interface SidebarGenericViewProps {
    tool: ToolCall;
}

export const SidebarGenericView = React.memo<SidebarGenericViewProps>(({ tool }) => {
    const hasInput = tool.input && Object.keys(tool.input).length > 0;
    const hasResult = tool.state === 'completed' && tool.result;
    const hasError = tool.state === 'error' && tool.result;

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
            {hasInput && (
                <ToolSectionView title={t('toolView.input')}>
                    <CodeView code={JSON.stringify(tool.input, null, 2)} />
                </ToolSectionView>
            )}
            {hasResult && (
                <ToolSectionView title={t('toolView.output')}>
                    <CodeView
                        code={typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                    />
                </ToolSectionView>
            )}
            {hasError && (
                <ToolSectionView title={t('toolView.output')}>
                    <CodeView
                        code={typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                    />
                </ToolSectionView>
            )}
        </ScrollView>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
    },
    contentContainer: {
        padding: 12,
        gap: 8,
    },
}));
