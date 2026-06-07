import * as React from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
import type { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { extractAttachmentSummary } from '@/utils/codexToolRendering';
import { t } from '@/text';

// R5/§5.14#1 (AC5): adaptive sizing. The previous fixed 720×260 box forced every
// image into one oversized container regardless of its real dimensions. We now let
// the inline preview ADAPT to the image's own dimensions: when the natural W×H is
// known we contain-fit it inside a 360×360 cap (so a small 32×32 image stays small
// and a tall image is not given a wide box with whitespace), driving height via the
// real aspectRatio. When dimensions are unknown we still set a concrete aspectRatio
// (square fallback) so the box always establishes layout — a concrete aspectRatio
// (not a fixed height, and not an undefined-height no-op spread) keeps the container
// from collapsing on native while never forcing the old oversized box (codex review #1/#2).
const PREVIEW_MAX_WIDTH = 360;
const PREVIEW_MAX_HEIGHT = 360;
const FALLBACK_ASPECT_RATIO = 1; // square — used only when natural dimensions are unknown

function parseDimensions(dimensions: string | null): { width: number; height: number } | null {
    if (!dimensions) return null;
    const m = dimensions.match(/^(\d+)\s*[×x]\s*(\d+)$/);
    if (!m) return null;
    const width = Number(m[1]);
    const height = Number(m[2]);
    return width > 0 && height > 0 ? { width, height } : null;
}

const adaptivePreviewStyle = (dims: { width: number; height: number } | null) => {
    if (dims) {
        // Contain-fit the natural size inside the cap; never upscale past natural.
        const scale = Math.min(1, PREVIEW_MAX_WIDTH / dims.width, PREVIEW_MAX_HEIGHT / dims.height);
        return {
            width: '100%' as const,
            maxWidth: Math.round(dims.width * scale),
            aspectRatio: dims.width / dims.height,
            borderRadius: 8,
            marginVertical: 8,
            alignSelf: 'flex-start' as const,
        };
    }
    // Unknown dimensions: a concrete square aspectRatio establishes layout (no
    // collapse) without an oversized fixed box.
    return {
        width: '100%' as const,
        maxWidth: PREVIEW_MAX_WIDTH,
        aspectRatio: FALLBACK_ASPECT_RATIO,
        borderRadius: 8,
        marginVertical: 8,
        alignSelf: 'flex-start' as const,
    };
};

// B05: flatten the inner attachment card (the duplicate icon+TITLE row is gone).
// R5/§5.14#2 (AC5): the MAIN inline card (rendered under a ToolView header that
// already carries the path in its subtitle) shows NO path/dimension/byte metadata
// — just the preview thumbnail. The compact filename CAPTION is preserved as the
// only filename affordance on HEADER-LESS surfaces (desktop sidebar via
// SidebarContentRenderer, where there is no ToolView header subtitle to carry the
// path — codex F4, pre_existing_guard removal_authorized:false). The `headerless`
// prop lets a header-less call site keep the caption while a headered call site can
// suppress it; it defaults to caption-on so a call site that does not pass it never
// loses the guarded header-less affordance.
export const CodexAttachmentView = React.memo<ToolViewProps & { headerless?: boolean }>(({ tool, headerless = true }) => {
    const attachment = extractAttachmentSummary(tool.input, tool.result);
    const hasResult = tool.result !== undefined && tool.result !== null;
    const caption = attachment.path
        ? (attachment.path.split(/[\\/]/).filter(Boolean).pop() ?? attachment.path)
        : (attachment.label && attachment.label !== 'Attachment' ? attachment.label : null);
    // §5.14#2: dimensions/size meta is removed from the inline card entirely.
    const showCaption = headerless && Boolean(caption);
    const showFallback = !attachment.previewUri && hasResult;
    if (!attachment.previewUri && !showFallback && !showCaption) {
        return null;
    }
    return (
        <ToolSectionView>
            <View style={attachmentStyles.body}>
                {attachment.previewUri ? (
                    <Image
                        source={{ uri: attachment.previewUri }}
                        style={adaptivePreviewStyle(parseDimensions(attachment.dimensions))}
                        contentFit="contain"
                    />
                ) : showFallback ? (
                    <Text style={attachmentStyles.meta}>
                        {attachment.previewUnavailableReason ?? t('tools.attachment.staleAdvisory')}
                    </Text>
                ) : null}
                {showCaption ? (
                    <Text style={attachmentStyles.caption} numberOfLines={1}>{caption}</Text>
                ) : null}
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
