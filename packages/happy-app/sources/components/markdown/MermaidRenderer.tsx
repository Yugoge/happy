import * as React from 'react';
import { View, Platform, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

// Pre-processes timeline diagram content before mermaid.render().
// The mermaid timeline parser rejects non-ASCII characters (CJK, Arabic, etc.)
// and empty event entries. Only timeline diagrams are affected; other types work fine.
// Root cause: commit f8b208fa introduced MermaidRenderer without timeline-specific handling.
function sanitizeMermaidTimeline(content: string): string {
    if (!/^timeline\b/i.test(content.trimStart())) {
        return content;
    }
    return content
        .split('\n')
        .map((line) => line.replace(/[^\x00-\x7F]+/g, '').trimEnd())
        .filter((line) => !/^\s*:\s*$/.test(line))
        .join('\n');
}

// Cycle 6 (#7): extract diagram type token from the first meaningful directive
// line. Skips comment lines (`%%`), init directives, and optional frontmatter
// (`--- ... ---`). Allows hyphens/digits (e.g., `stateDiagram-v2`, `block-beta`).
function extractMermaidDiagramType(content: string): string {
    let inFrontmatter = false;
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('%%')) continue;
        if (line === '---') { inFrontmatter = !inFrontmatter; continue; }
        if (inFrontmatter) continue;
        const match = line.match(/^[A-Za-z][A-Za-z0-9_-]*/);
        return match && match[0] ? match[0] : 'Mermaid';
    }
    return 'Mermaid';
}

// Cycle 6 (#1): inject explicit intrinsic width + max-width:none on root <svg>.
function buildSvgStyleAttr(intrinsicWidth: number | null): string {
    const widthStyle = intrinsicWidth ? `width:${intrinsicWidth}px;` : '';
    return `${widthStyle}max-width:none;height:auto;`;
}

function injectStyleIntoSvgTag(svg: string, styleStr: string): string {
    return svg.replace(/^(<svg\b)([^>]*)>/, (_m, p1, p2) => {
        const existingMatch = p2.match(/style="([^"]*)"/);
        if (existingMatch) {
            const merged = `style="${styleStr}${existingMatch[1]}"`;
            return `${p1}${p2.replace(/style="[^"]*"/, merged)}>`;
        }
        return `${p1}${p2} style="${styleStr}">`;
    });
}

function parseSvgViewBoxWidth(svg: string): number | null {
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    if (!viewBoxMatch || !viewBoxMatch[1]) return null;
    const parts = viewBoxMatch[1].trim().split(/\s+/);
    if (parts.length !== 4) return null;
    const w = parseFloat(parts[2]);
    return Number.isFinite(w) && w > 0 ? w : null;
}

// Normalize Mermaid SVG so the diagram renders at intrinsic width (from viewBox)
// rather than scaling down to container width via the baked-in `width="100%"`.
// Removes the root <svg> width/height attrs and adds an explicit style so the
// parent container's overflow:auto produces a horizontal scrollbar when needed.
function normalizeMermaidSvg(svg: string): string {
    const intrinsicWidth = parseSvgViewBoxWidth(svg);
    let normalized = svg.replace(/^(<svg\b[^>]*?)\s+width="[^"]*"/, '$1');
    normalized = normalized.replace(/^(<svg\b[^>]*?)\s+height="[^"]*"/, '$1');
    return injectStyleIntoSvgTag(normalized, buildSvgStyleAttr(intrinsicWidth));
}

function buildMermaidThemeVars(dark: boolean) {
    return {
        fontFamily: '"IBM Plex Sans", sans-serif',
        fontSize: '14px',
        primaryColor: dark ? '#2C2C2E' : '#f0f0f0',
        primaryTextColor: dark ? '#E5E5EA' : '#1C1C1E',
        primaryBorderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
        lineColor: dark ? '#8E8E93' : '#636366',
        secondaryColor: dark ? '#38383A' : '#F8F8F8',
        tertiaryColor: dark ? '#1C1C1E' : '#ffffff',
    };
}

function buildWebContainerStyle(theme: any): React.CSSProperties {
    return {
        backgroundColor: theme.colors.surfaceHighest as string,
        borderRadius: 8, padding: 16, overflow: 'auto',
        color: theme.colors.text as string,
        maxWidth: '100%', boxSizing: 'border-box',
        border: `1px solid ${theme.colors.divider as string}`,
        marginTop: 8, marginBottom: 8,
    };
}

async function renderMermaidSvg(
    content: string,
    dark: boolean,
    isMounted: boolean,
    onSuccess: (svg: string) => void,
    onError: (value: boolean) => void,
): Promise<void> {
    const diagramType = extractMermaidDiagramType(content);
    try {
        const mermaidModule: any = await import('mermaid');
        const mermaid = mermaidModule.default || mermaidModule;
        if (mermaid.initialize) {
            mermaid.initialize({
                startOnLoad: false,
                theme: dark ? 'dark' : 'default',
                themeVariables: buildMermaidThemeVars(dark),
            });
        }
        if (mermaid.render) {
            const { svg } = await mermaid.render(`mermaid-${Date.now()}`, content);
            if (isMounted) { onSuccess(normalizeMermaidSvg(svg)); }
        }
    } catch (error) {
        console.warn(`[Mermaid] ${t('markdown.mermaidRenderFailed', { type: diagramType })}: ${error instanceof Error ? error.message : String(error)}`);
        if (isMounted) { onError(true); }
    }
}

function MermaidLoadingPlaceholder() {
    return (
        <View style={[style.container, style.loadingContainer]}>
            <View style={style.loadingPlaceholder} />
        </View>
    );
}

function MermaidErrorFallback(props: { diagramType: string }) {
    // Cycle 6 (#7): error label reflects actual diagram type, not hardcoded "Timeline".
    return (
        <View style={[style.container, style.errorContainer]}>
            <View style={style.errorContent}>
                <Text style={style.errorText}>{t('markdown.mermaidRenderFailed', { type: props.diagramType })}</Text>
            </View>
        </View>
    );
}

function MermaidWebRenderer(props: { content: string; theme: any }) {
    const { content, theme } = props;
    const [hasError, setHasError] = React.useState(false);
    const [svgContent, setSvgContent] = React.useState<string | null>(null);
    const diagramType = React.useMemo(() => extractMermaidDiagramType(content), [content]);

    React.useEffect(() => {
        let isMounted = true;
        setHasError(false);
        setSvgContent(null);
        renderMermaidSvg(sanitizeMermaidTimeline(content), theme.dark, isMounted, setSvgContent, setHasError);
        return () => { isMounted = false; };
    }, [content, theme.dark]);

    if (hasError) { return <MermaidErrorFallback diagramType={diagramType} />; }
    if (!svgContent) { return <MermaidLoadingPlaceholder />; }
    return (
        <View style={style.container}>
            <div style={buildWebContainerStyle(theme)}>
                <div dangerouslySetInnerHTML={{ __html: svgContent }} />
            </div>
        </View>
    );
}

function updateHeight(prev: { width: number; height: number }, newHeight: number) {
    return { ...prev, height: Math.max(prev.height, newHeight) };
}

export const MermaidRenderer = React.memo((props: { content: string }) => {
    const { theme } = useUnistyles();
    const [dimensions, setDimensions] = React.useState({ width: 0, height: 200 });

    const onLayout = React.useCallback((event: any) => {
        const { width } = event.nativeEvent.layout;
        setDimensions(prev => ({ ...prev, width }));
    }, []);

    const onWebViewMessage = React.useCallback((event: any) => {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'dimensions') {
            setDimensions(prev => updateHeight(prev, data.height));
        }
    }, []);

    if (Platform.OS === 'web') {
        return <MermaidWebRenderer content={props.content} theme={theme} />;
    }

    const html = buildNativeHtml(props.content, theme);
    return (
        <View style={style.container} onLayout={onLayout}>
            <View style={[style.innerContainer, { height: dimensions.height }]}>
                <WebView source={{ html }} style={{ flex: 1 }} scrollEnabled={true} onMessage={onWebViewMessage} />
            </View>
        </View>
    );
});

// Cycle 7 (M1 #1-native): mirror Cycle 6 web fix's viewBox-based intrinsic-width
// normalization to native HTML. After mermaid.run, we mutate the rendered SVG's
// width/height attrs and inline style so the diagram renders at intrinsic width
// and the inner #mc-scroll wrapper produces a horizontal scrollbar when needed.
// Page-level overflow is hidden so there's no double scroll with WebView gestures.
function buildNativeHtml(content: string, theme: any): string {
    const vars = buildMermaidThemeVars(theme.dark);
    const themeStr = theme.dark ? 'dark' : 'default';
    const bg = theme.colors.surfaceHighest;
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>html,body{margin:0;padding:0;overflow-x:hidden}body{padding:16px;background-color:${bg}}
#mc-scroll{overflow-x:auto;overflow-y:hidden;width:100%}
#mc{display:inline-block;text-align:left;min-width:100%;width:max-content}</style>
</head><body><div id="mc-scroll"><div id="mc" class="mermaid">${content}</div></div>
<script>mermaid.initialize({startOnLoad:false,theme:'${themeStr}',themeVariables:{fontFamily:'"IBM Plex Sans",sans-serif',fontSize:'14px',primaryColor:'${vars.primaryColor}',primaryTextColor:'${vars.primaryTextColor}',primaryBorderColor:'${vars.primaryBorderColor}',lineColor:'${vars.lineColor}',secondaryColor:'${vars.secondaryColor}',tertiaryColor:'${vars.tertiaryColor}'}});
function normalizeRenderedSvg(){var s=document.querySelector('#mc svg');if(!s)return;var w=s.viewBox&&s.viewBox.baseVal&&s.viewBox.baseVal.width;s.removeAttribute('width');s.removeAttribute('height');if(w&&w>0){s.style.width=w+'px';}s.style.maxWidth='none';s.style.height='auto';}
mermaid.run().then(function(){requestAnimationFrame(function(){normalizeRenderedSvg();window.ReactNativeWebView.postMessage(JSON.stringify({type:'dimensions',height:document.body.scrollHeight}));});});</script>
</body></html>`;
}

const style = StyleSheet.create((theme) => ({
    container: {
        marginVertical: 8,
        width: '100%',
    },
    innerContainer: {
        width: '100%',
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        overflow: 'hidden',
    },
    loadingContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        height: 100,
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
    errorContent: {
        flexDirection: 'column',
        gap: 12,
    },
    errorText: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 16,
    },
}));
