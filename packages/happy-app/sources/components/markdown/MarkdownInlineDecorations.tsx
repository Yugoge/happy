// Cycle 8 (#9, #11): factored-out subcomponents that keep MarkdownView.tsx
// under the 800-line budget. Hosts the new interactive renderers introduced
// this cycle:
//
//   - RenderInteractiveSpan: chip-style span (abbr tooltip, footnote-ref body)
//   - RenderDetailsBlock: <details><summary>...</summary>body</details>
//   - MarkdownDefsContext: per-message defs (footnotes/linkDefs) for cells
//
// Component logic is self-contained (no MarkdownView-internal state); style
// consumed via the MarkdownView style sheet passed in as the `style` prop bag.

import * as React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Text } from '../StyledText';
import { Modal } from '@/modal';
import { t } from '@/text';
import type { LinkDef, MarkdownBlock, MarkdownSpan } from './parseMarkdown';

export type MarkdownDefs = {
    footnotes: Map<string, MarkdownSpan[]>,
    linkDefs: Map<string, LinkDef>,
};

export const MarkdownDefsContext = React.createContext<MarkdownDefs>({
    footnotes: new Map(), linkDefs: new Map(),
});

// abbr/footnote-ref chip span. `style` is the shared StyleSheet object so
// span.styles[] maps to existing keys (mark/sub/sup/abbr/footnote-ref).
export function RenderInteractiveSpan(props: {
    span: MarkdownSpan, baseStyle: any, selectable: boolean, index: number, style: any,
}) {
    const defs = React.useContext(MarkdownDefsContext);
    const onPress = React.useCallback(() => {
        if (props.span.tooltip) {
            Modal.alert(props.span.text, props.span.tooltip, [{ text: t('common.ok'), style: 'cancel' }]);
            return;
        }
        if (props.span.footnoteLabel) {
            const body = defs.footnotes.get(props.span.footnoteLabel);
            const text = body ? body.map(s => s.text).join('') : props.span.footnoteLabel;
            Modal.alert(t('markdown.footnoteTitle', { label: props.span.footnoteLabel }), text, [{ text: t('common.ok'), style: 'cancel' }]);
        }
    }, [props.span.tooltip, props.span.footnoteLabel, props.span.text, defs.footnotes]);
    const styleKeys = props.span.styles.map(s => props.style[s]);
    return (
        <Text key={props.index} selectable={props.selectable} onPress={onPress}
            style={[props.baseStyle, styleKeys]}>
            {props.span.text}
        </Text>
    );
}

type DetailsBlockProps = {
    open: boolean,
    summary: MarkdownSpan[],
    content: MarkdownBlock[],
    selectable: boolean,
    onLinkPress: (url: string) => void,
    onOptionPress?: (option: { title: string }) => void,
    renderBlock: (block: MarkdownBlock, index: number, total: number, selectable: boolean,
        handleLinkPress: (url: string) => void,
        onOptionPress?: (option: { title: string }) => void) => React.ReactNode,
    renderSpans: (spans: MarkdownSpan[], baseStyle: any, selectable: boolean,
        onLinkPress: (url: string) => void) => React.ReactNode,
    style: any,
};

function DetailsSummary(props: DetailsBlockProps & { open: boolean, toggle: () => void }) {
    return (
        <Pressable onPress={props.toggle} accessibilityRole={Platform.OS === 'web' ? ('button' as any) : undefined}>
            <Text selectable={false} style={[props.style.text, props.style.detailsSummary]}>
                <Text style={props.style.detailsCaret}>{props.open ? '▼ ' : '▶ '}</Text>
                {props.renderSpans(props.summary, props.style.text, props.selectable, props.onLinkPress)}
            </Text>
        </Pressable>
    );
}

// Cycle 8 (#9): collapsible <details> block. Tapping summary toggles open
// state. Initial open mirrors parsed block.open (HTML5 `open` attribute).
export function RenderDetailsBlock(props: DetailsBlockProps) {
    const [open, setOpen] = React.useState(props.open);
    const toggle = React.useCallback(() => setOpen(o => !o), []);
    return (
        <View style={props.style.detailsBlock}>
            <DetailsSummary {...props} open={open} toggle={toggle} />
            {open && (
                <View style={props.style.detailsBody}>
                    {props.content.map((block, index) =>
                        props.renderBlock(block, index, props.content.length, props.selectable, props.onLinkPress, props.onOptionPress))}
                </View>
            )}
        </View>
    );
}

// Cycle 12 (B06): GFM footnote region. The footnotes Map (label -> body spans)
// is parsed in parseMarkdownBlock and threaded via MarkdownDefsContext, but no
// region was ever emitted after the block list. This renders a divider + one
// numbered entry per footnote (in Map insertion order = appearance order) with
// a backref glyph, mirroring Claude Code's GFM footnote rendering. Renders
// nothing when the Map is empty (most messages). Tokens reused: horizontalRule
// divider, style.text body face, footnote-ref color for the marker/backref.
// Extracted here (not MarkdownView.tsx) to keep that file under its 800-line budget.
export function RenderFootnoteRegion(props: {
    footnotes: Map<string, MarkdownSpan[]>,
    selectable: boolean,
    onLinkPress: (url: string) => void,
    renderSpans: (spans: MarkdownSpan[], baseStyle: any, selectable: boolean,
        onLinkPress: (url: string) => void) => React.ReactNode,
    style: any,
}) {
    if (!props.footnotes || props.footnotes.size === 0) {
        return null;
    }
    const entries = Array.from(props.footnotes.entries());
    return (
        <View style={props.style.footnoteRegion} accessibilityRole={Platform.OS === 'web' ? ('list' as any) : undefined}>
            <View style={props.style.horizontalRule} />
            {entries.map(([label, body]) => (
                <View key={label} style={props.style.footnoteEntry}
                    accessibilityRole={Platform.OS === 'web' ? ('listitem' as any) : undefined}>
                    {/* Marker = the footnote label itself (e.g. "1.", "note.") so it corresponds
                        exactly to what the inline ref chip displays (parseMarkdownSpans renders the
                        raw label as the ref text), independent of Map iteration order. */}
                    <Text selectable={false} style={[props.style.text, props.style.footnoteEntryMarker]}>{`${label}. `}</Text>
                    <Text selectable={props.selectable} style={[props.style.text, props.style.footnoteEntryBody]}>
                        {props.renderSpans(body, [props.style.text, props.style.footnoteEntryBody], props.selectable, props.onLinkPress)}
                        <Text style={props.style.footnoteBackref}
                            accessibilityLabel={t('markdown.footnoteTitle', { label })}>{' ↩'}</Text>
                    </Text>
                </View>
            ))}
        </View>
    );
}
