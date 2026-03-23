import * as React from 'react';
import { View, Platform, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

const webStyle: any = {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    overflow: 'auto',
    textAlign: 'center',
};

export const LatexRenderer = React.memo((props: {
    content: string;
}) => {
    const { theme } = useUnistyles();
    const [dimensions, setDimensions] = React.useState({ width: 0, height: 80 });

    const onLayout = React.useCallback((event: any) => {
        const { width } = event.nativeEvent.layout;
        setDimensions(prev => ({ ...prev, width }));
    }, []);

    if (Platform.OS === 'web') {
        const [htmlContent, setHtmlContent] = React.useState<string | null>(null);
        const [hasError, setHasError] = React.useState(false);

        React.useEffect(() => {
            let isMounted = true;
            setHasError(false);

            const renderLatex = async () => {
                try {
                    const katex = await import('katex');
                    const rendered = (katex.default || katex).renderToString(props.content, {
                        displayMode: true,
                        throwOnError: false,
                    });
                    if (isMounted) {
                        setHtmlContent(rendered);
                    }
                } catch (error) {
                    if (isMounted) {
                        console.warn(`[LaTeX] Render failed: ${error instanceof Error ? error.message : String(error)}`);
                        setHasError(true);
                    }
                }
            };

            renderLatex();
            return () => { isMounted = false; };
        }, [props.content]);

        if (hasError) {
            return (
                <View style={[style.container, style.errorContainer]}>
                    <View style={style.codeBlock}>
                        <Text style={style.codeText}>{props.content}</Text>
                    </View>
                </View>
            );
        }

        if (!htmlContent) {
            return (
                <View style={[style.container, style.loadingContainer]}>
                    <View style={style.loadingPlaceholder} />
                </View>
            );
        }

        return (
            <View style={style.container}>
                {/* @ts-ignore - Web only */}
                <div
                    style={webStyle}
                    dangerouslySetInnerHTML={{ __html: htmlContent }}
                />
            </View>
        );
    }

    // Native: WebView with KaTeX CDN
    const escapedContent = props.content
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css">
            <script src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js"></script>
            <style>
                body {
                    margin: 0;
                    padding: 16px;
                    background-color: ${theme.colors.surfaceHighest};
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                #latex-container {
                    text-align: center;
                    width: 100%;
                    color: ${theme.colors.text};
                }
                .katex { font-size: 1.2em; }
                .katex-error { color: #ff6b6b; font-family: monospace; font-size: 14px; }
            </style>
        </head>
        <body>
            <div id="latex-container"></div>
            <script>
                try {
                    katex.render(\`${escapedContent}\`, document.getElementById('latex-container'), {
                        displayMode: true,
                        throwOnError: false
                    });
                } catch (e) {
                    document.getElementById('latex-container').textContent = \`${escapedContent}\`;
                }
                setTimeout(function() {
                    var height = document.body.scrollHeight;
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dimensions', height: height }));
                }, 100);
            </script>
        </body>
        </html>
    `;

    return (
        <View style={style.container} onLayout={onLayout}>
            <View style={[style.innerContainer, { height: dimensions.height }]}>
                <WebView
                    source={{ html }}
                    style={{ flex: 1 }}
                    scrollEnabled={true}
                    onMessage={(event) => {
                        const data = JSON.parse(event.nativeEvent.data);
                        if (data.type === 'dimensions') {
                            setDimensions(prev => ({
                                ...prev,
                                height: Math.max(prev.height, data.height)
                            }));
                        }
                    }}
                />
            </View>
        </View>
    );
});

const style = StyleSheet.create((theme) => ({
    container: {
        marginVertical: 8,
        width: '100%',
    },
    innerContainer: {
        width: '100%',
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
    },
    loadingContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        height: 60,
    },
    loadingPlaceholder: {
        width: 200,
        height: 20,
        backgroundColor: theme.colors.divider,
        borderRadius: 4,
    },
    errorContainer: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        padding: 16,
    },
    codeBlock: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 4,
        padding: 12,
    },
    codeText: {
        ...Typography.mono(),
        color: theme.colors.text,
        fontSize: 14,
        lineHeight: 20,
    },
}));
