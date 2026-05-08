import * as React from 'react';
import { View, ScrollView } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { CodeView } from '@/components/CodeView';
import { ToolSectionView } from '@/components/tools/ToolSectionView';
import { t } from '@/text';
import { stringifyInspectableValue } from '@/utils/codexToolRendering';

interface SidebarGenericViewProps {
    tool: ToolCall;
}

export const SidebarGenericView = React.memo<SidebarGenericViewProps>(({ tool }) => {
    const hasInput = tool.input && Object.keys(tool.input).length > 0;
    const hasOutput = Object.prototype.hasOwnProperty.call(tool, 'result') && tool.result !== undefined;
    const hasResult = tool.state === 'completed' && hasOutput;
    const hasError = tool.state === 'error' && hasOutput;

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
            {hasInput && (
                <ToolSectionView title={t('toolView.input')}>
                    <CodeView code={stringifyInspectableValue(tool.input)} />
                </ToolSectionView>
            )}
            {hasResult && (
                <ToolSectionView title={t('toolView.output')}>
                    <CodeView code={stringifyInspectableValue(tool.result)} />
                </ToolSectionView>
            )}
            {hasError && (
                <ToolSectionView title={t('toolView.output')}>
                    <CodeView code={stringifyInspectableValue(tool.result)} />
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
