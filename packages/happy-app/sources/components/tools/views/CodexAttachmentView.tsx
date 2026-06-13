import * as React from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
import type { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { extractAttachmentSummary } from '@/utils/codexToolRendering';
import { t } from '@/text';

// R5/§5.14#1 (AC5): adaptive sizing. The previous fixed 720×260 box forced every
// image into one oversized container regardless of its real dimensions. The inline
// preview ADAPTS to the image's own aspect ratio, driving height via the real
// aspectRatio.
//
// whitespace fix (2026-06): the image must FILL the full card content width at its
// true aspect ratio — no right-side whitespace, no oversized empty body. The earlier
// design capped width at 360px (via a no-upscale contain-fit clamp) and pinned the image
// to the left with a flex-start anchor, leaving dead whitespace on the right of the card.
// We now drive `width: '100%'` so the image tracks the card's content width on desktop
// AND a 390px mobile viewport, with the natural aspectRatio governing height. There is NO
// horizontal cap and NO left anchor — the only guard is a max-HEIGHT ceiling for
// extreme-tall ratios, which clamps the rendered height (with width still 100%) and
// therefore can never reintroduce horizontal whitespace.
//
// spec-20260607-124814 Item 3+4 (L4): producer dimensions are KNOWN only when the
// payload carries explicit width/height. Browser screenshots and generated images
// carry NO such fields (only a base64/data-uri preview), so the prior square fallback
// was their TERMINAL value — wide images letterboxed inside a square (oversized body +
// whitespace), inconsistent with view_image. We now capture the actually-loaded
// natural size via expo-image onLoad (event.source.width/height) and prefer it over the
// square fallback, so the unknown-dimensions path resolves to the true ratio at runtime.
// The square fallback survives ONLY as a pre-load transient (no collapse on native
// before the first onLoad fires).
const PREVIEW_MAX_HEIGHT = 480; // ceiling for extreme-tall ratios; clamps HEIGHT only — width stays 100%, so no horizontal whitespace
const FALLBACK_ASPECT_RATIO = 1; // square — pre-load transient ONLY (producer dims absent AND natural size not yet loaded)

function parseDimensions(dimensions: string | null): { width: number; height: number } | null {
    if (!dimensions) return null;
    const m = dimensions.match(/^(\d+)\s*[×x]\s*(\d+)$/);
    if (!m) return null;
    const width = Number(m[1]);
    const height = Number(m[2]);
    return width > 0 && height > 0 ? { width, height } : null;
}

// Pure aspect-ratio resolver (node-env unit-testable). Returns w/h for a valid loaded
// natural size, or null for a degenerate (zero/NaN/negative) onLoad payload so the
// caller retains the prior aspect instead of dividing by an invalid size (C1 guard).
export function aspectRatioFromSize(size: { width: number; height: number } | null): number | null {
    if (!size) return null;
    const { width, height } = size;
    if (!(width > 0) || !(height > 0)) return null;
    return width / height;
}

const adaptivePreviewStyle = (dims: { width: number; height: number } | null) => {
    // Always FILL the card content width (`width: '100%'`) — no horizontal cap, no
    // left anchor — so a wide image leaves no right-side whitespace and tracks the card
    // width responsively on desktop AND a 390px mobile viewport. The natural aspectRatio
    // governs height; the only ceiling is maxHeight (HEIGHT-only) for extreme-tall ratios,
    // which can never reintroduce horizontal whitespace because the width stays 100%.
    if (dims) {
        return {
            width: '100%' as const,
            aspectRatio: dims.width / dims.height,
            maxHeight: PREVIEW_MAX_HEIGHT,
            borderRadius: 8,
            marginVertical: 8,
        };
    }
    // Neither producer dims NOR a loaded natural size yet: a concrete square
    // aspectRatio establishes layout (no collapse) as a pre-load transient only —
    // onLoad replaces it with the true ratio as soon as the image reports its size.
    return {
        width: '100%' as const,
        aspectRatio: FALLBACK_ASPECT_RATIO,
        maxHeight: PREVIEW_MAX_HEIGHT,
        borderRadius: 8,
        marginVertical: 8,
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
    // L4: the actually-loaded image natural size, captured via expo-image onLoad. It is
    // the only source of truth for the aspect ratio when the producer omits width/height
    // (screenshots, generated images). The captured size is BOUND to the uri it was
    // measured from, so a re-used component never applies a stale ratio AND a fast
    // (cached/data-uri) onLoad is not clobbered by a passive reset effect — we simply
    // ignore any size whose uri no longer matches the current preview (codex F1).
    const [loaded, setLoaded] = React.useState<{ uri: string; width: number; height: number } | null>(null);
    const producerDims = parseDimensions(attachment.dimensions);
    const naturalSize = loaded && loaded.uri === attachment.previewUri
        ? { width: loaded.width, height: loaded.height }
        : null;
    const resolvedDims = producerDims ?? naturalSize;
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
                        style={adaptivePreviewStyle(resolvedDims)}
                        contentFit="contain"
                        onLoad={(e) => {
                            // Only adopt the loaded natural size when producer dims are
                            // absent; a valid (>0) size replaces the square transient.
                            // aspectRatioFromSize returns null for degenerate payloads
                            // (zero/NaN/negative), so we keep the prior aspect (C1 guard).
                            // Bind the size to the uri it was measured from so a stale
                            // size is never applied to a different preview (codex F1).
                            if (producerDims) return;
                            const { width, height } = e.source;
                            const uri = attachment.previewUri;
                            if (uri && aspectRatioFromSize({ width, height }) !== null) {
                                setLoaded({ uri, width, height });
                            }
                        }}
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
