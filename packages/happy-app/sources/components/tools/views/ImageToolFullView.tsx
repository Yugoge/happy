import * as React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import type { ToolViewProps } from './_all';
import { toolFullViewStyles } from '../ToolFullView';
import { CodeView } from '../../CodeView';
import { t } from '@/text';
import { buildImageToolOutput, sanitizedInputJson, sanitizeImageToolText } from './imageToolDetail';

// Wave-1 Item 1 (spec-20260607-124814 §2): the tool DETAIL page for the image tools
// (view_image / screenshot / image_generation, + the `file` attachment and legacy
// image-gen aliases) must look like Claude Code's tool detail — Description → Input
// Parameters (JSON) → Output (structured text: path / dimensions / type) — and must
// NEVER render the image/preview or leak raw base64. Predecessor cycles routed both
// detail surfaces to CodexAttachmentView (the image renderer), conflating the inline
// card with the detail page. This component is the text-only detail substitute reached
// from BOTH detail surfaces (mobile toolFullViewRegistry + desktop SidebarContentRenderer).
// All pure logic (the IMAGE_DETAIL_TOOLS set, the recursive base64 sanitizer, and the
// allowlisted {path,dimensions,type} output builder) lives in the RN-free sidecar
// imageToolDetail.ts so it is unit-testable in the node-env Vitest.

function OutputRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={localStyles.outputRow}>
            <Text style={localStyles.outputLabel}>{label}</Text>
            <Text style={localStyles.outputValue} selectable>{value}</Text>
        </View>
    );
}

export const ImageToolFullView = React.memo<ToolViewProps>(({ tool }) => {
    const hasResult = Object.prototype.hasOwnProperty.call(tool, 'result')
        && tool.result !== undefined && tool.result !== null;
    const output = React.useMemo(
        () => buildImageToolOutput(tool.input, tool.result),
        [tool.input, tool.result],
    );
    const inputJson = React.useMemo(
        () => sanitizedInputJson(tool.input, t('tools.fullView.redactedBinary')),
        [tool.input],
    );
    // codex finding 1: the description is rendered verbatim and bypasses the input
    // sanitizer — redact any data:image data-URI it may carry so it never leaks base64.
    const description = React.useMemo(() => {
        const raw = typeof tool.description === 'string' ? tool.description.trim() : '';
        return raw ? sanitizeImageToolText(raw, t('tools.fullView.redactedBinary')) : '';
    }, [tool.description]);

    return (
        <>
            {description ? (
                <View style={toolFullViewStyles.section}>
                    <View style={toolFullViewStyles.sectionHeader}>
                        <Ionicons name="information-circle" size={20} color="#5856D6" />
                        <Text style={toolFullViewStyles.sectionTitle}>{t('tools.fullView.description')}</Text>
                    </View>
                    <Text style={localStyles.description}>{description}</Text>
                </View>
            ) : null}

            {tool.input ? (
                <View style={toolFullViewStyles.section}>
                    <View style={toolFullViewStyles.sectionHeader}>
                        <Ionicons name="log-in" size={20} color="#5856D6" />
                        <Text style={toolFullViewStyles.sectionTitle}>{t('tools.fullView.inputParams')}</Text>
                    </View>
                    <CodeView code={inputJson} />
                </View>
            ) : null}

            {hasResult ? (
                <View style={toolFullViewStyles.section}>
                    <View style={toolFullViewStyles.sectionHeader}>
                        <Ionicons name="log-out" size={20} color="#34C759" />
                        <Text style={toolFullViewStyles.sectionTitle}>{t('tools.fullView.output')}</Text>
                    </View>
                    <View style={localStyles.outputBox}>
                        <OutputRow label={t('tools.fullView.outputPath')} value={output.path ?? t('tools.fullView.unknownType')} />
                        {output.dimensions ? (
                            <OutputRow label={t('tools.fullView.outputDimensions')} value={output.dimensions} />
                        ) : null}
                        <OutputRow label={t('tools.fullView.outputType')} value={output.type ?? t('tools.fullView.unknownType')} />
                    </View>
                </View>
            ) : null}
        </>
    );
});

const localStyles = StyleSheet.create((theme) => ({
    description: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    outputBox: {
        gap: 8,
    },
    outputRow: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    outputLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.text,
    },
    outputValue: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        flexShrink: 1,
    },
}));
