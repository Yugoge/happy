import * as React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
import type { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { readImagePreviewUri } from '@/utils/codexToolRendering';

const readImagePreviewStyle = {
    width: '100%' as const,
    maxWidth: 720,
    height: 260,
    borderRadius: 8,
    marginVertical: 4,
};

// B05 (bidirectional): Claude Code `Read` of an image gains an inline preview
// thumbnail, reusing the same attachment-preview recognition as Codex's
// view_image. Renders ONLY when the Read result carries a recognizable image
// preview URI; a text-file Read (no preview signal) renders nothing here and
// the header-only minimal layout is preserved (no regression).
export const ReadView = React.memo<ToolViewProps>(({ tool }) => {
    // B05 R2 (codex F1): resolve the preview STRICTLY from a producer-emitted
    // structured object result, so a text Read never renders a thumbnail (even
    // if its content happens to be a JSON image data-URI string).
    const previewUri = readImagePreviewUri(tool.input, tool.result);
    if (!previewUri) {
        return null;
    }
    return (
        <ToolSectionView>
            <View style={readStyles.body}>
                <Image
                    source={{ uri: previewUri }}
                    style={readImagePreviewStyle}
                    contentFit="contain"
                />
            </View>
        </ToolSectionView>
    );
});

const readStyles = StyleSheet.create(() => ({
    body: {
        minWidth: 0,
    },
}));
