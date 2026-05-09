import { MarkdownSpan, parseMarkdown } from './parseMarkdown';
import * as React from 'react';
import { Image, Pressable, ScrollView, View, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native-unistyles';
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
import { parseMarkdownSpans } from './parseMarkdownSpans';
import { RenderTableBlockWeb } from './MarkdownTableWeb';

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
    } else if (block.type === 'task-list') {
        return <RenderTaskListBlock items={block.items} key={index} first={first} last={last} selectable={selectable} onLinkPress={handleLinkPress} />;
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
    } else if (block.type === 'blockquote') {
        return <RenderBlockquoteBlock content={block.content} key={index} selectable={selectable} onLinkPress={handleLinkPress} onOptionPress={onOptionPress} />;
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
        <View style={{ width: '100%', overflow: 'hidden' }}>
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
            <View style={{ width: '100%', overflow: 'hidden' }}>
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

function RenderListBlock(props: { items: { depth: number, spans: MarkdownSpan[] }[], first: boolean, last: boolean, selectable: boolean, onLinkPress: (url: string) => void }) {
    const listStyle = [style.text, style.list];
    return (
        <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }} accessibilityRole={Platform.OS === 'web' ? ('list' as any) : undefined}>
            {props.items.map((item, index) => (
                <View key={index} style={{ flexDirection: 'row', paddingLeft: item.depth * 16 }} accessibilityRole={Platform.OS === 'web' ? ('listitem' as any) : undefined}>
                    <Text selectable={false} style={[listStyle, { width: 16, flexShrink: 0 }]}>{'• '}</Text><Text selectable={props.selectable} style={[listStyle, { flex: 1 }]}><RenderSpans spans={item.spans} baseStyle={listStyle} selectable={props.selectable} onLinkPress={props.onLinkPress} /></Text>
                </View>
            ))}
        </View>
    );
}

function RenderTaskListBlock(props: { items: { checked: boolean, depth: number, spans: MarkdownSpan[] }[], first: boolean, last: boolean, selectable: boolean, onLinkPress: (url: string) => void }) {
    const listStyle = [style.text, style.list];
    return (
        <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }}>
            {props.items.map((item, index) => (
                <Text selectable={props.selectable} style={[listStyle, { paddingLeft: item.depth * 16 }]} key={index}>
                    <Text style={style.taskCheckbox}>{item.checked ? '☑ ' : '☐ '}</Text>
                    <RenderSpans spans={item.spans} baseStyle={listStyle} selectable={props.selectable} onLinkPress={props.onLinkPress} />
                </Text>
            ))}
        </View>
    );
}

function RenderBlockquoteBlock(props: { content: ReturnType<typeof parseMarkdown>, selectable: boolean, onLinkPress: (url: string) => void, onOptionPress?: (option: Option) => void }) {
    return (
        <View style={style.blockquote}>
            {props.content.map((block, index) => renderBlock(block, index, props.content.length, props.selectable, props.onLinkPress, props.onOptionPress))}
        </View>
    );
}

function RenderNumberedListBlock(props: { items: { number: number, depth: number, spans: MarkdownSpan[] }[], first: boolean, last: boolean, selectable: boolean, onLinkPress: (url: string) => void }) {
    const listStyle = [style.text, style.list];
    return (
        <View style={{ flexDirection: 'column', marginBottom: 8, gap: 1 }} accessibilityRole={Platform.OS === 'web' ? ('list' as any) : undefined}>
            {props.items.map((item, index) => (
                <View key={index} style={{ flexDirection: 'row', paddingLeft: item.depth * 16 }} accessibilityRole={Platform.OS === 'web' ? ('listitem' as any) : undefined}>
                    <Text selectable={false} style={[listStyle, { minWidth: 24, flexShrink: 0 }]}>{`${item.number}. `}</Text><Text selectable={props.selectable} style={[listStyle, { flex: 1 }]}><RenderSpans spans={item.spans} baseStyle={listStyle} selectable={props.selectable} onLinkPress={props.onLinkPress} /></Text>
                </View>
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

    if (props.span.latex) {
        return <LatexRenderer key={props.index} content={props.span.text} inline={!props.span.latexDisplay} />;
    }
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

function NativeTableColumn(props: {
    header: string, colIndex: number, columnCount: number,
    rows: string[][], rowCount: number, selectable: boolean, onLinkPress: (url: string) => void,
}) {
    return (
        <View style={[style.tableColumn, props.colIndex === props.columnCount - 1 && style.tableColumnLast]}>
            <View style={[style.tableCell, style.tableHeaderCell, style.tableCellFirst]}>
                <Text selectable={props.selectable} style={style.tableHeaderText}>
                    <RenderSpans spans={parseMarkdownSpans(props.header, false)}
                        baseStyle={style.tableHeaderText} selectable={props.selectable} onLinkPress={props.onLinkPress} />
                </Text>
            </View>
            {props.rows.map((row, rowIndex) => (
                <View key={`cell-${rowIndex}-${props.colIndex}`}
                    style={[style.tableCell, rowIndex === props.rowCount - 1 && style.tableCellLast]}>
                    <Text selectable={props.selectable} style={style.tableCellText}>
                        <RenderSpans spans={parseMarkdownSpans(row[props.colIndex] ?? '', false)}
                            baseStyle={style.tableCellText} selectable={props.selectable} onLinkPress={props.onLinkPress} />
                    </Text>
                </View>
            ))}
        </View>
    );
}

function RenderTableBlockNative(props: {
    headers: string[], rows: string[][], selectable: boolean, first: boolean, last: boolean,
    onLinkPress: (url: string) => void,
}) {
    return (
        <View style={[style.tableContainer, props.first && style.first, props.last && style.last]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={true}
                nestedScrollEnabled={true} style={style.tableScrollView}>
                <View style={style.tableContent}>
                    {props.headers.map((header, colIndex) => (
                        <NativeTableColumn key={`column-${colIndex}`} header={header} colIndex={colIndex}
                            columnCount={props.headers.length} rows={props.rows}
                            rowCount={props.rows.length} selectable={props.selectable}
                            onLinkPress={props.onLinkPress} />
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
        return (
            <RenderTableBlockWeb
                headers={props.headers}
                rows={props.rows}
                selectable={props.selectable}
                onLinkPress={props.onLinkPress}
                renderSpans={RenderSpans}
                tableHeaderTextStyle={style.tableHeaderText}
                tableCellTextStyle={style.tableCellText}
            />
        );
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
    code: { ...Typography.mono(), fontSize: 16, lineHeight: 24, color: theme.colors.text },
    strikethrough: { textDecorationLine: 'line-through' },
    kbd: {
        ...Typography.mono(), fontSize: 14, lineHeight: 20, color: theme.colors.text,
        backgroundColor: theme.colors.surfaceHigh, borderWidth: 1, borderColor: theme.colors.divider,
        borderRadius: 3, paddingHorizontal: 4,
    },
    taskCheckbox: { ...Typography.default(), color: theme.colors.text },
    blockquote: {
        borderLeftWidth: 3, borderLeftColor: theme.colors.divider, paddingLeft: 12,
        marginVertical: 4, backgroundColor: theme.colors.surfaceHigh,
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
        fontSize: 24,
        lineHeight: 32,
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
        fontSize: 18,
        lineHeight: 28,
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8,
    },
    header4: {
        fontSize: 17,
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
