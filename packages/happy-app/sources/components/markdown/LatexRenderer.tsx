import * as React from 'react';
import { View, Platform, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

function ensureKatexStylesheet() {
    if (document.querySelector('link[data-katex]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-katex', '');
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css';
    document.head.appendChild(link);
}

async function renderKatexToString(content: string, displayMode: boolean): Promise<string> {
    const katex = await import('katex');
    ensureKatexStylesheet();
    return (katex.default || katex).renderToString(content, { displayMode, throwOnError: false });
}

function useKatexHtml(content: string, displayMode: boolean) {
    const [htmlContent, setHtmlContent] = React.useState<string | null>(null);
    const [hasError, setHasError] = React.useState(false);

    React.useEffect(() => {
        let isMounted = true;
        setHasError(false);
        renderKatexToString(content, displayMode).then(rendered => {
            if (isMounted) setHtmlContent(rendered);
        }).catch(error => {
            if (!isMounted) return;
            console.warn(`[LaTeX] Render failed: ${error instanceof Error ? error.message : String(error)}`);
            setHasError(true);
        });
        return () => { isMounted = false; };
    }, [content, displayMode]);

    return { htmlContent, hasError };
}

const LatexWebBlock = React.memo((props: { content: string, webStyle: React.CSSProperties }) => {
    const { htmlContent, hasError } = useKatexHtml(props.content, true);
    if (hasError) {
        return (
            <View style={[style.container, style.errorContainer]}>
                <View style={style.codeBlock}><Text style={style.codeText}>{props.content}</Text></View>
            </View>
        );
    }
    if (!htmlContent) {
        return <View style={[style.container, style.loadingContainer]}><View style={style.loadingPlaceholder} /></View>;
    }
    return (
        <View style={style.container}>
            {/* @ts-ignore - Web only */}
            <div style={props.webStyle} dangerouslySetInnerHTML={{ __html: htmlContent }} />
        </View>
    );
});

const LatexWebInline = React.memo((props: { content: string, webStyle: React.CSSProperties }) => {
    const { htmlContent, hasError } = useKatexHtml(props.content, false);
    if (hasError || !htmlContent) {
        // @ts-ignore - Web only
        return <span style={{ fontFamily: 'monospace', fontSize: 'inherit' }}>{props.content}</span>;
    }
    // @ts-ignore - Web only
    return <span style={props.webStyle} dangerouslySetInnerHTML={{ __html: htmlContent }} />;
});

function buildNativeHtmlStyles(bgColor: string, textColor: string): string {
    return `body { margin: 0; padding: 16px; background-color: ${bgColor}; display: flex; justify-content: center; align-items: center; }
#latex-container { text-align: center; width: 100%; color: ${textColor}; }
.katex { font-size: 1.2em; color: ${textColor}; }
.katex-error { color: #ff6b6b; font-family: monospace; font-size: 14px; }`;
}

function buildNativeHtml(escapedContent: string, bgColor: string, textColor: string): string {
    const styles = buildNativeHtmlStyles(bgColor, textColor);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css"><script src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js"></script><style>${styles}</style></head><body><div id="latex-container"></div><script>try { katex.render(\`${escapedContent}\`, document.getElementById('latex-container'), { displayMode: true, throwOnError: false }); } catch (e) { document.getElementById('latex-container').textContent = \`${escapedContent}\`; } setTimeout(function() { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dimensions', height: document.body.scrollHeight })); }, 100);</script></body></html>`;
}

const LatexNativeBlock = React.memo((props: { content: string, bgColor: string, textColor: string }) => {
    const [dimensions, setDimensions] = React.useState({ width: 0, height: 80 });
    const onLayout = React.useCallback((event: any) => {
        const { width } = event.nativeEvent.layout;
        setDimensions(prev => ({ ...prev, width }));
    }, []);
    const escapedContent = props.content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const html = buildNativeHtml(escapedContent, props.bgColor, props.textColor);
    const onMessage = React.useCallback((event: any) => {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'dimensions') {
            setDimensions(prev => ({ ...prev, height: Math.max(prev.height, data.height) }));
        }
    }, []);
    return (
        <View style={style.container} onLayout={onLayout}>
            <View style={[style.innerContainer, { height: dimensions.height }]}>
                <WebView source={{ html }} style={{ flex: 1 }} scrollEnabled={true} onMessage={onMessage} />
            </View>
        </View>
    );
});

function getWebStyle(isInline: boolean, theme: any): React.CSSProperties {
    if (isInline) {
        return { color: theme.colors.text as string, fontSize: 'inherit', display: 'inline' };
    }
    return {
        backgroundColor: theme.colors.surfaceHighest as string,
        borderRadius: 8,
        padding: 16,
        overflow: 'auto',
        textAlign: 'center',
        color: theme.colors.text as string,
        maxWidth: '100%',
        boxSizing: 'border-box',
    };
}

export const LatexRenderer = React.memo((props: {
    content: string;
    inline?: boolean;
}) => {
    const { theme } = useUnistyles();
    const isInline = props.inline === true;
    const webStyle = getWebStyle(isInline, theme);

    if (Platform.OS === 'web') {
        if (isInline) return <LatexWebInline content={props.content} webStyle={webStyle} />;
        return <LatexWebBlock content={props.content} webStyle={webStyle} />;
    }
    // Native inline: monospace text fallback (full WebView per inline span is impractical).
    if (isInline) {
        return <Text style={style.codeText}>{props.content}</Text>;
    }
    return <LatexNativeBlock content={props.content} bgColor={theme.colors.surfaceHighest as string} textColor={theme.colors.text as string} />;
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
