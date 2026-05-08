import * as React from 'react';
import { ScrollView, Text, View, Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

interface CodeViewProps {
    code: string;
    language?: string;
    maxHeight?: number;
}

export const CodeView = React.memo<CodeViewProps>(({ 
    code, 
    language,
    maxHeight,
}) => {
    const content = (
        <Text selectable style={styles.codeText}>{code}</Text>
    );
    return (
        <View style={styles.codeBlock}>
            {maxHeight ? (
                <ScrollView style={{ maxHeight }} nestedScrollEnabled>
                    {content}
                </ScrollView>
            ) : content}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    codeBlock: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 6,
        padding: 12,
        maxWidth: '100%',
        overflow: 'hidden',
    },
    codeText: {
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
        fontSize: 12,
        color: theme.colors.text,
        lineHeight: 18,
        ...(Platform.OS === 'web' ? { wordBreak: 'break-word' as any } : null),
    },
}));
