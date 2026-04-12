import { MarkdownSpan, parseMarkdown } from './parseMarkdown';
import * as React from 'react';
import { Image, Pressable, ScrollView, View, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '../StyledText';
import { Typography } from '@/constants/Typography';
import { SimpleSyntaxHighlighter } from '../SimpleSyntaxHighlighter';
import { Modal } from '@/modal';
import { useLocalSetting } from '@/sync/storage';
import { storeTempText } from '@/sync/persistence';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { MermaidRenderer } from './MermaidRenderer';
import { LatexRenderer } from './LatexRenderer';
import { t } from '@/text';
import { isHttpMarkdownLink } from './linkUtils';
import { downloadCodeOnWeb } from './codeDownload';

// Option type for callback
export type Option = {
    title: string;
};

function renderTextLikeBlock(
    block: ReturnType<typeof parseMarkdown>[number],
    index: number,
    total: number,
    selectable: boolean,
    handleLinkPress: (url: string) => void,
) {
    const first = index === 0;
    const last = index === total - 1;
    if (block.type === 'text') {
        return <RenderTextBlock spans={block.content} key={index} first={first} last={last} selectable={selectable} onLinkPress={handleLinkPress} />;
    } else if (block.type === 'header') {
        return <RenderHeaderBlock level={block.level} spans={block.content} key={index} first={first} last={last} selectable={selectable} onLinkPress={handleLinkPress} />;
    } else if (block.type === 'horizontal-rule') {
        return <View style={style.horizontalRule} key={index} />;
    } else if (block.type === 'list') {
        return <RenderListBlock items={block.items} key={index} first={first} last={last} selectable={selectable} onLinkPress={handleLinkPress} />;
    } else if (block.type === 'numbered-list') {
        return <RenderNumberedListBlock items={block.items} key={index} first={first} last={last} selectable={selectable} onLinkPress={handleLinkPress} />;
    } else if (block.type === 'code-block') {
        return <RenderCodeBlock content={block.content} language={block.language} key={index} first={first} last={last} selectable={selectable} />;
    }
    return null;
}

function renderComplexBlock(
    block: ReturnType<typeof parseMarkdown>[number],
    index: number,
    total: number,
    selectable: boolean,
    handleLinkPress: (url: string) => void,
    onOptionPress?: (option: Option) => void,
) {
    const first = index === 0;
    const last = index === total - 1;
    if (block.type === 'mermaid') {
        return <MermaidRenderer content={block.content} key={index} />;
    } else if (block.type === 'latex') {
        return <LatexRenderer content={block.content} key={index} />;
    } else if (block.type === 'options') {
        return <RenderOptionsBlock items={block.items} key={index} first={first} last={last} selectable={selectable} onOptionPress={onOptionPress} />;
    } else if (block.type === 'table') {
        return <RenderTableBlock headers={block.headers} rows={block.rows} onLinkPress={handleLinkPress} selectable={selectable} key={index} first={first} last={last} />;
    } else if (block.type === 'image') {
        return <RenderImageBlock url={block.url} alt={block.alt} key={index} first={first} last={last} />;
    }
    return null;
}

function renderBlock(
    block: ReturnType<typeof parseMarkdown>[number],
    index: number,
    total: number,
    selectable: boolean,
    handleLinkPress: (url: string) => void,
    onOptionPress?: (option: Option) => void,
) {
    return renderTextLikeBlock(block, index, total, selectable, handleLinkPress)
        ?? renderComplexBlock(block, index, total, selectable, handleLinkPress, onOptionPress);
}

export const MarkdownView = React.memo((props: {
    markdown: string;
    onOptionPress?: (option: Option) => void;
    sessionId?: string;
}) => {
    const blocks = React.useMemo(() => parseMarkdown(props.markdown), [props.markdown]);

    // Backwards compatibility: The original version just returned the view, wrapping the list of blocks.
    // It made each of the individual text elements selectable. When we enable the markdownCopyV2 feature,
    // we disable the selectable property on individual text segments on mobile only. Instead, the long press
    // will be handled by a wrapper Pressable. If we don't disable the selectable property, then you will see
    // the native copy modal come up at the same time as the long press handler is fired.
    const markdownCopyV2 = useLocalSetting('markdownCopyV2');
    const selectable = Platform.OS === 'web' || !markdownCopyV2;
    const router = useRouter();

    const handleLinkPress = React.useCallback((url: string) => {
        if (!isHttpMarkdownLink(url)) return;
        if (Platform.OS === 'web') {
            if (typeof window !== 'undefined') {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
            return;
        }
        void WebBrowser.openBrowserAsync(url);
    }, []);

    const handleLongPress = React.useCallback(() => {
        try {
            const textId = storeTempText(props.markdown);
            router.push(`/text-selection?textId=${textId}`);
        } catch (error) {
            console.error('Error storing text for selection:', error);
            Modal.alert('Error', 'Failed to open text selection. Please try again.');
        }
    }, [props.markdown, router]);

    const renderContent = () => (
        <View style={{ width: '100%' }}>
            {blocks.map((block, index) => renderBlock(block, index, blocks.length, selectable, handleLinkPress, props.onOptionPress))}
        </View>
    );

    if (!markdownCopyV2 || Platform.OS === 'web') {
        return renderContent();
    }

    // Use GestureDetector with LongPress gesture - it doesn't block pan gestures
    // so horizontal scrolling in code blocks and tables still works
    const longPressGesture = Gesture.LongPress()
        .minDuration(500)
        .onStart(() => { handleLongPress(); })
        .runOnJS(true);

    return (
        <GestureDetector gesture={longPressGesture}>
            <View style={{ width: '100%' }}>
                {renderContent()}
            </View>
        </GestureDetector>
    );
});

type RenderSpanProps = {
    spans: MarkdownSpan[];
    baseStyle?: any;
    selectable: boolean;
    onLinkPress: (url: string) => void;
};

function RenderTextBlock(props: { spans: MarkdownSpan[], first: boolean, last: boolean, selectable: boolean, onLinkPress: (url: string) => void }) {
    return <Text selectable={props.selectable} style={[style.text, props.first && style.first, props.last && style.last]}><RenderSpans spans={props.spans} baseStyle={style.text} selectable={props.selectable} onLinkPress={props.onLinkPress} /></Text>;
}

function RenderHeaderBlock(props: { level: 1 | 2 | 3 | 4 | 5 | 6, spans: MarkdownSpan[], first: boolean, last: boolean, selectable: boolean, onLinkPress: (url: string) => void }) {
    const s = (style as any)[`header${props.level}`];
    const headerStyle = [style.header, s, props.first && style.first, props.last && style.last];
    return <Text selectable={props.selectable} style={headerStyle}><RenderSpans spans={props.spans} baseStyle={headerStyle} selectable={props.selectable} onLinkPress={props.onLinkPress} /></Text>;
}

function RenderListBlock(props: { items: MarkdownSpan[][], first: boolean, last: boolean, selectable: boolean, onLinkPress: (url: string) => void }) {
    const listStyle = [style.text, style.list];
    return (
        <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
            {props.items.map((item, index) => (
                <Text selectable={props.selectable} style={listStyle} key={index}>- <RenderSpans spans={item} baseStyle={listStyle} selectable={props.selectable} onLinkPress={props.onLinkPress} /></Text>
            ))}
        </View>
    );
}

function RenderNumberedListBlock(props: { items: { number: number, spans: MarkdownSpan[] }[], first: boolean, last: boolean, selectable: boolean, onLinkPress: (url: string) => void }) {
    const listStyle = [style.text, style.list];
    return (
        <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
            {props.items.map((item, index) => (
                <Text selectable={props.selectable} style={listStyle} key={index}>{item.number.toString()}. <RenderSpans spans={item.spans} baseStyle={listStyle} selectable={props.selectable} onLinkPress={props.onLinkPress} /></Text>
            ))}
        </View>
    );
}

// Copy button extracted to keep CodeBlockButtons under 30 lines.
function CodeBlockCopyButton(props: { content: string }) {
    const copyCode = React.useCallback(async () => {
        try {
            await Clipboard.setStringAsync(props.content);
            Modal.alert(t('common.success'), t('markdown.codeCopied'), [{ text: t('common.ok'), style: 'cancel' }]);
        } catch (error) {
            console.error('Failed to copy code:', error);
            Modal.alert(t('common.error'), t('markdown.copyFailed'), [{ text: t('common.ok'), style: 'cancel' }]);
        }
    }, [props.content]);
    return (
        <Pressable style={style.copyButton} onPress={copyCode}>
            <Text style={style.copyButtonText}>{t('common.copy')}</Text>
        </Pressable>
    );
}

// Download button extracted to keep CodeBlockButtons under 30 lines.
function CodeBlockDownloadButton(props: { content: string, language: string | null }) {
    const downloadCode = React.useCallback(() => {
        try {
            downloadCodeOnWeb(props.content, props.language);
        } catch (error) {
            console.error('Failed to download code:', error);
            Modal.alert(t('common.error'), t('markdown.downloadFailed'), [{ text: t('common.ok'), style: 'cancel' }]);
        }
    }, [props.content, props.language]);
    return (
        <Pressable style={style.copyButton} onPress={downloadCode}>
            <Text style={style.copyButtonText}>{t('common.download')}</Text>
        </Pressable>
    );
}

function CodeBlockButtons(props: { content: string, language: string | null }) {
    const hasContent = props.content.trim().length > 0;
    return (
        <>
            <CodeBlockCopyButton content={props.content} />
            {hasContent && Platform.OS === 'web' && (
                <CodeBlockDownloadButton content={props.content} language={props.language} />
            )}
        </>
    );
}

function RenderCodeBlock(props: { content: string, language: string | null, first: boolean, last: boolean, selectable: boolean }) {
    const [isHovered, setIsHovered] = React.useState(false);
    return (
        <View
            style={[style.codeBlock, props.first && style.first, props.last && style.last]}
            // @ts-ignore - Web only events
            onMouseEnter={() => setIsHovered(true)}
            // @ts-ignore - Web only events
            onMouseLeave={() => setIsHovered(false)}
        >
            {props.language && <Text selectable={props.selectable} style={style.codeLanguage}>{props.language}</Text>}
            <ScrollView style={{ flexGrow: 0, flexShrink: 0 }} horizontal={true}
                contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
                showsHorizontalScrollIndicator={Platform.OS === 'web'}>
                <SimpleSyntaxHighlighter code={props.content} language={props.language} selectable={props.selectable} />
            </ScrollView>
            <View style={[style.copyButtonWrapper, isHovered && style.copyButtonWrapperVisible]}
                {...(Platform.OS === 'web' ? ({ className: 'copy-button-wrapper' } as any) : {})}>
                <CodeBlockButtons content={props.content} language={props.language} />
            </View>
        </View>
    );
}

function RenderImageBlock(props: { url: string, alt: string, first: boolean, last: boolean }) {
    const accessibleLabel = props.alt || 'Markdown image';
    return (
        <View style={[style.imageBlock, props.first && style.first, props.last && style.last]}>
            <Image
                source={{ uri: props.url }}
                style={style.image}
                accessibilityLabel={accessibleLabel}
                resizeMode="contain"
            />
            {props.alt ? (
                <Text style={style.imageCaption}>{props.alt}</Text>
            ) : null}
        </View>
    );
}

function RenderOptionItem(props: { item: string, selectable: boolean, onOptionPress?: (option: Option) => void }) {
    if (props.onOptionPress) {
        return (
            <Pressable
                style={({ pressed }) => [style.optionItem, pressed && style.optionItemPressed]}
                onPress={() => props.onOptionPress?.({ title: props.item })}
            >
                <Text selectable={props.selectable} style={style.optionText}>{props.item}</Text>
            </Pressable>
        );
    }
    return (
        <View style={style.optionItem}>
            <Text selectable={props.selectable} style={style.optionText}>{props.item}</Text>
        </View>
    );
}

function RenderOptionsBlock(props: {
    items: string[],
    first: boolean,
    last: boolean,
    selectable: boolean,
    onOptionPress?: (option: Option) => void
}) {
    return (
        <View style={[style.optionsContainer, props.first && style.first, props.last && style.last]}>
            {props.items.map((item, index) => (
                <RenderOptionItem key={index} item={item} selectable={props.selectable} onOptionPress={props.onOptionPress} />
            ))}
        </View>
    );
}

type RenderSpanItemProps = {
    span: MarkdownSpan;
    index: number;
    baseStyle?: any;
    selectable: boolean;
    onLinkPress: (url: string) => void;
};

// Single span item extracted to avoid inline nesting depth violations in RenderSpans.
function RenderSpanItem(props: RenderSpanItemProps) {
    const isExternalLink = !!props.span.url && isHttpMarkdownLink(props.span.url);
    const handleWebClick = React.useCallback(() => {
        if (typeof window !== 'undefined' && props.span.url) {
            window.open(props.span.url, '_blank', 'noopener,noreferrer');
        }
    }, [props.span.url]);

    if (!props.span.url) {
        return <Text key={props.index} selectable={props.selectable} style={[props.baseStyle, props.span.styles.map(s => style[s])]}>{props.span.text}</Text>;
    }
    const webProps = isExternalLink && Platform.OS === 'web' ? { onClick: handleWebClick } as any : {};
    return (
        <Text
            key={props.index}
            selectable={props.selectable}
            accessibilityRole={isExternalLink ? 'link' : undefined}
            style={[props.baseStyle, isExternalLink && style.link, props.span.styles.map(s => style[s])]}
            {...webProps}
            onPress={isExternalLink && Platform.OS !== 'web' ? () => props.onLinkPress(props.span.url!) : undefined}
        >
            {props.span.text}
        </Text>
    );
}

function RenderSpans(props: RenderSpanProps) {
    return (<>
        {props.spans.map((span, index) => (
            <RenderSpanItem key={index} span={span} index={index} baseStyle={props.baseStyle} selectable={props.selectable} onLinkPress={props.onLinkPress} />
        ))}
    </>);
}

function useTableStyles() {
    const { theme } = useUnistyles();
    return React.useMemo(() => ({
        table: { borderCollapse: 'collapse' as const, width: 'auto' as const, fontSize: 16, lineHeight: '24px' },
        th: {
            padding: '8px 12px', borderBottom: `1px solid ${theme.colors.divider}`,
            borderRight: `1px solid ${theme.colors.divider}`, backgroundColor: theme.colors.surfaceHigh,
            color: theme.colors.text, fontFamily: 'IBMPlexSans-Regular', fontWeight: 600 as const,
            textAlign: 'left' as const, whiteSpace: 'nowrap' as const,
        },
        td: {
            padding: '8px 12px', borderBottom: `1px solid ${theme.colors.divider}`,
            borderRight: `1px solid ${theme.colors.divider}`, color: theme.colors.text,
            fontFamily: 'IBMPlexSans-Regular', fontWeight: 400 as const,
            textAlign: 'left' as const, whiteSpace: 'nowrap' as const,
        },
        container: {
            marginTop: 8, marginBottom: 8, border: `1px solid ${theme.colors.divider}`,
            borderRadius: 8, overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const,
            width: 'fit-content' as const, maxWidth: 'min(100%, calc(100vw - 32px))',
        },
    }), [theme]);
}

function WebTableRow(props: { row: string[], colCount: number, isLast: boolean, tdStyle: React.CSSProperties }) {
    return (
        <tr>
            {Array.from({ length: props.colCount }, (_, colIndex) => (
                <td key={colIndex} style={{
                    ...props.tdStyle,
                    borderBottom: props.isLast ? 'none' : props.tdStyle.borderBottom,
                    borderRight: colIndex === props.colCount - 1 ? 'none' : props.tdStyle.borderRight,
                }}>{props.row[colIndex] ?? ''}</td>
            ))}
        </tr>
    );
}

function RenderTableBlockWeb(props: {
    headers: string[], rows: string[][], selectable: boolean,
}) {
    const s = useTableStyles();
    return (
        // @ts-ignore
        <div style={s.container}>
            {/* @ts-ignore */}
            <table style={s.table}>
                <thead>
                    <tr>
                        {props.headers.map((header, i) => (
                            <th key={i} style={{ ...s.th, borderRight: i === props.headers.length - 1 ? 'none' : s.th.borderRight }}>{header}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {props.rows.map((row, i) => (
                        <WebTableRow key={i} row={row} colCount={props.headers.length} isLast={i === props.rows.length - 1} tdStyle={s.td} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function NativeTableColumn(props: {
    header: string, colIndex: number, columnCount: number,
    rows: string[][], rowCount: number, selectable: boolean,
}) {
    return (
        <View style={[style.tableColumn, props.colIndex === props.columnCount - 1 && style.tableColumnLast]}>
            <View style={[style.tableCell, style.tableHeaderCell, style.tableCellFirst]}>
                <Text selectable={props.selectable} style={style.tableHeaderText}>{props.header}</Text>
            </View>
            {props.rows.map((row, rowIndex) => (
                <View key={`cell-${rowIndex}-${props.colIndex}`}
                    style={[style.tableCell, rowIndex === props.rowCount - 1 && style.tableCellLast]}>
                    <Text selectable={props.selectable} style={style.tableCellText}>{row[props.colIndex] ?? ''}</Text>
                </View>
            ))}
        </View>
    );
}

function RenderTableBlockNative(props: {
    headers: string[], rows: string[][], selectable: boolean, first: boolean, last: boolean,
}) {
    return (
        <View style={[style.tableContainer, props.first && style.first, props.last && style.last]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={true}
                nestedScrollEnabled={true} style={style.tableScrollView}>
                <View style={style.tableContent}>
                    {props.headers.map((header, colIndex) => (
                        <NativeTableColumn key={`column-${colIndex}`} header={header} colIndex={colIndex}
                            columnCount={props.headers.length} rows={props.rows}
                            rowCount={props.rows.length} selectable={props.selectable} />
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}

function RenderTableBlock(props: {
    headers: string[], rows: string[][], onLinkPress: (url: string) => void,
    selectable: boolean, first: boolean, last: boolean,
}) {
    if (Platform.OS === 'web') {
        return <RenderTableBlockWeb {...props} />;
    }
    return <RenderTableBlockNative {...props} />;
}


const style = StyleSheet.create((theme) => ({

    // Plain text

    text: {
        ...Typography.default(),
        fontSize: 16,
        lineHeight: 24, // Reduced from 28 to 24
        marginTop: 8,
        marginBottom: 8,
        color: theme.colors.text,
        fontWeight: '400',
    },

    italic: {
        fontStyle: 'italic',
    },
    bold: {
        fontWeight: 'bold',
    },
    semibold: {
        fontWeight: '600',
    },
    code: {
        ...Typography.mono(),
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.text,
    },
    link: {
        ...Typography.default(),
        color: theme.colors.text,
        fontWeight: '400',
        textDecorationLine: 'underline',
        cursor: 'pointer',
    },

    // Headers

    header: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
    },
    header1: {
        fontSize: 16,
        lineHeight: 24,  // Reduced from 36 to 24
        fontWeight: '900',
        marginTop: 16,
        marginBottom: 8
    },
    header2: {
        fontSize: 20,
        lineHeight: 24,  // Reduced from 36 to 32
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8
    },
    header3: {
        fontSize: 16,
        lineHeight: 28,  // Reduced from 32 to 28
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8,
    },
    header4: {
        fontSize: 16,
        lineHeight: 24,
        fontWeight: '600',
        marginTop: 8,
        marginBottom: 8,
    },
    header5: {
        fontSize: 16,
        lineHeight: 24,  // Reduced from 28 to 24
        fontWeight: '600'
    },
    header6: {
        fontSize: 16,
        lineHeight: 24, // Reduced from 28 to 24
        fontWeight: '600'
    },

    //
    // List
    //

    list: {
        ...Typography.default(),
        color: theme.colors.text,
        marginTop: 0,
        marginBottom: 0,
    },

    //
    // Common
    //

    first: {
        // marginTop: 0
    },
    last: {
        // marginBottom: 0
    },

    //
    // Code Block
    //

    codeBlock: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        marginVertical: 8,
        position: 'relative',
        zIndex: 1,
    },
    copyButtonWrapper: {
        position: 'absolute',
        top: 8,
        right: 8,
        opacity: 0,
        zIndex: 10,
        elevation: 10,
        pointerEvents: 'none',
        flexDirection: 'row',
        gap: 4,
    },
    copyButtonWrapperVisible: {
        opacity: 1,
        pointerEvents: 'auto',
    },
    codeLanguage: {
        ...Typography.mono(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 8,
        paddingHorizontal: 16,
        marginBottom: 0,
    },
    codeText: {
        ...Typography.mono(),
        color: theme.colors.text,
        fontSize: 14,
        lineHeight: 20,
    },
    horizontalRule: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginTop: 8,
        marginBottom: 8,
    },
    imageBlock: {
        width: '100%',
        maxWidth: 520,
        marginVertical: 8,
        alignSelf: 'flex-start',
        gap: 8,
    },
    image: {
        width: '100%',
        minHeight: 160,
        height: 240,
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHighest,
    },
    imageCaption: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    copyButtonContainer: {
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10,
        elevation: 10,
        opacity: 1,
    },
    copyButtonContainerHidden: {
        opacity: 0,
    },
    copyButton: {
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        cursor: 'pointer',
    },
    copyButtonHidden: {
        display: 'none',
    },
    copyButtonCopied: {
        backgroundColor: theme.colors.success,
        borderColor: theme.colors.success,
        opacity: 1,
    },
    copyButtonText: {
        ...Typography.default(),
        color: theme.colors.text,
        fontSize: 12,
        lineHeight: 16,
    },

    //
    // Options Block
    //

    optionsContainer: {
        flexDirection: 'column',
        gap: 8,
        marginVertical: 8,
    },
    optionItem: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    optionItemPressed: {
        opacity: 0.7,
        backgroundColor: theme.colors.surfaceHigh,
    },
    optionText: {
        ...Typography.default(),
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.text,
    },

    //
    // Table
    //

    tableContainer: {
        marginVertical: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 8,
        overflow: 'hidden',
        alignSelf: 'flex-start',
    },
    tableScrollView: {
        flexGrow: 0,
    },
    tableContent: {
        flexDirection: 'row',
    },
    tableColumn: {
        flexDirection: 'column',
        borderRightWidth: 1,
        borderRightColor: theme.colors.divider,
    },
    tableColumnLast: {
        borderRightWidth: 0,
    },
    tableCell: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
        alignItems: 'flex-start',
    },
    tableCellFirst: {
        borderTopWidth: 0,
    },
    tableCellLast: {
        borderBottomWidth: 0,
    },
    tableHeaderCell: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    tableHeaderText: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 16,
        lineHeight: 24,
    },
    tableCellText: {
        ...Typography.default(),
        color: theme.colors.text,
        fontSize: 16,
        lineHeight: 24,
    },

    // Add global style for Web platform (Unistyles supports this via compiler plugin)
    ...(Platform.OS === 'web' ? {
        // Web-only CSS styles
        _____web_global_styles: {}
    } : {}),
}));
