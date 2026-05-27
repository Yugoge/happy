import * as React from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import type { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { extractAttachmentSummary } from '@/utils/codexToolRendering';
import { t } from '@/text';

const attachmentPreviewStyle = {
    width: '100%' as const,
    maxWidth: 720,
    height: 260,
    borderRadius: 8,
    marginVertical: 8,
};

export const CodexAttachmentView = React.memo<ToolViewProps>(({ tool }) => {
    const attachment = extractAttachmentSummary(tool.input, tool.result);
    const hasResult = tool.result !== undefined && tool.result !== null;
    return (
        <ToolSectionView>
            <View style={attachmentStyles.card}>
                <Ionicons name="image-outline" size={20} style={attachmentStyles.icon} />
                <View style={attachmentStyles.body}>
                    <Text style={attachmentStyles.title} numberOfLines={1} ellipsizeMode="middle">
                        {attachment.label}
                    </Text>
                    {attachment.previewUri ? (
                        <Image
                            source={{ uri: attachment.previewUri }}
                            style={attachmentPreviewStyle}
                            contentFit="contain"
                        />
                    ) : hasResult ? <Text style={attachmentStyles.meta}>
                        {attachment.previewUnavailableReason ?? t('tools.attachment.staleAdvisory')}
                    </Text> : null}
                    {attachment.path ? <Text style={attachmentStyles.meta}>{attachment.path}</Text> : null}
                    {attachment.dimensions ? <Text style={attachmentStyles.meta}>{attachment.dimensions}</Text> : null}
                    {attachment.size ? <Text style={attachmentStyles.meta}>{attachment.size}</Text> : null}
                </View>
            </View>
        </ToolSectionView>
    );
});

const attachmentStyles = StyleSheet.create((theme) => ({
    card: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 4,
        marginBottom: 8,
    },
    icon: {
        color: theme.colors.textSecondary,
        marginTop: 1,
    },
    body: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: '600',
    },
    meta: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 18,
    },
}));
