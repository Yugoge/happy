import * as React from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
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

// B05: flatten the inner attachment card. The previous double-nest was the
// duplicate icon + TITLE ROW stacked under the ToolView header — that row is
// gone. We render the preview thumbnail (when present) + a single compact
// filename caption + secondary meta (dimensions/size) + the stale-advisory
// fallback. The caption is a plain muted line (NOT an icon+title row), so it is
// not the double-nest; it also recovers the filename on header-less surfaces
// (desktop sidebar via SidebarContentRenderer, where there is no ToolView
// header subtitle to carry the path — codex F4).
export const CodexAttachmentView = React.memo<ToolViewProps>(({ tool }) => {
    const attachment = extractAttachmentSummary(tool.input, tool.result);
    const hasResult = tool.result !== undefined && tool.result !== null;
    const caption = attachment.path
        ? (attachment.path.split('/').filter(Boolean).pop() ?? attachment.path)
        : (attachment.label && attachment.label !== 'Attachment' ? attachment.label : null);
    const meta = [attachment.dimensions, attachment.size].filter(Boolean) as string[];
    const showFallback = !attachment.previewUri && hasResult;
    if (!attachment.previewUri && !showFallback && !caption && meta.length === 0) {
        return null;
    }
    return (
        <ToolSectionView>
            <View style={attachmentStyles.body}>
                {attachment.previewUri ? (
                    <Image
                        source={{ uri: attachment.previewUri }}
                        style={attachmentPreviewStyle}
                        contentFit="contain"
                    />
                ) : showFallback ? (
                    <Text style={attachmentStyles.meta}>
                        {attachment.previewUnavailableReason ?? t('tools.attachment.staleAdvisory')}
                    </Text>
                ) : null}
                {caption ? (
                    <Text style={attachmentStyles.caption} numberOfLines={1}>{caption}</Text>
                ) : null}
                {meta.map((line) => (
                    <Text key={line} style={attachmentStyles.meta}>{line}</Text>
                ))}
            </View>
        </ToolSectionView>
    );
});

const attachmentStyles = StyleSheet.create((theme) => ({
    body: {
        minWidth: 0,
    },
    caption: {
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 18,
    },
    meta: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 18,
    },
}));
