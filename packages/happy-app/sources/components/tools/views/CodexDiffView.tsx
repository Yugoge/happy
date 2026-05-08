import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { ToolSectionView } from '../ToolSectionView';
import { ToolDiffView } from '@/components/tools/ToolDiffView';
import { Metadata } from '@/sync/storageTypes';
import { useSetting } from '@/sync/storage';
import { t } from '@/text';
import { parseUnifiedDiff } from '@/utils/codexUnifiedDiff';

interface CodexDiffViewProps {
    tool: ToolCall;
    metadata: Metadata | null;
}

export const CodexDiffView = React.memo<CodexDiffViewProps>(({ tool, metadata }) => {
    const { input } = tool;
    let fileName: string | undefined;
    if (input?.unified_diff && typeof input.unified_diff === 'string') {
        fileName = parseUnifiedDiff(input.unified_diff).fileName;
    }
    return (
        <ToolSectionView>
            <View style={styles.summaryRow}>
                <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">
                    {fileName || t('tools.names.viewDiff')}
                </Text>
                <Text style={styles.summaryBadge}>{t('tools.desc.showingDiff')}</Text>
            </View>
        </ToolSectionView>
    );
});

export const CodexDiffViewFull = React.memo<CodexDiffViewProps>(({ tool, metadata }) => {
    const showLineNumbersInToolViews = useSetting('showLineNumbersInToolViews');
    const { input } = tool;

    // Parse the unified diff
    let oldText = '';
    let newText = '';
    let fileName: string | undefined;

    if (input?.unified_diff && typeof input.unified_diff === 'string') {
        const parsed = parseUnifiedDiff(input.unified_diff);
        oldText = parsed.oldText;
        newText = parsed.newText;
        fileName = parsed.fileName;
    }

    // If we have a filename, show it as a header
    const fileHeader = fileName ? (
        <View style={styles.fileHeader}>
            <Text style={styles.fileName}>{fileName}</Text>
        </View>
    ) : null;

    return (
        <>
            {fileHeader}
            <ToolSectionView fullWidth>
                <ToolDiffView 
                    oldText={oldText} 
                    newText={newText} 
                    showLineNumbers={showLineNumbersInToolViews}
                    showPlusMinusSymbols={showLineNumbersInToolViews}
                />
            </ToolSectionView>
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    fileHeader: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: theme.colors.surfaceHigh,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    fileName: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontFamily: 'monospace',
        flex: 1,
        minWidth: 0,
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 4,
        paddingVertical: 4,
    },
    summaryBadge: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
}));
