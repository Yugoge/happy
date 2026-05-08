import * as React from 'react';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { knownTools } from '@/components/tools/knownTools';
import { ToolDiffView } from '@/components/tools/ToolDiffView';
import { trimIdent } from '@/utils/trimIdent';
import { SimpleSyntaxHighlighter } from '@/components/SimpleSyntaxHighlighter';
import { parseUnifiedDiff } from '@/utils/codexUnifiedDiff';

// Tools whose result may contain full file content injected by the CLI
const FILE_CONTENT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

// Detect file language from extension for syntax highlighting
function getLanguageFromPath(filePath: string): string | null {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext) return null;
    const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
        json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
        md: 'markdown', css: 'css', scss: 'css', html: 'html',
        sh: 'bash', bash: 'bash', zsh: 'bash',
        sql: 'sql', swift: 'swift', kt: 'kotlin',
    };
    return map[ext] ?? null;
}

// Check if tool.result contains full file content (long multiline string from CLI enrichment)
function hasFileContent(tool: ToolCall): boolean {
    return FILE_CONTENT_TOOLS.has(tool.name)
        && typeof tool.result === 'string'
        && tool.result.length > 100
        && tool.result.includes('\n');
}

interface SidebarFileViewProps {
    tool: ToolCall;
}

export const SidebarFileView = React.memo<SidebarFileViewProps>(({ tool }) => {
    const filePath = tool.input?.file_path || tool.input?.path || '';
    const showFileContent = hasFileContent(tool);
    const [activeTab, setActiveTab] = React.useState<'diff' | 'file'>(showFileContent ? 'file' : 'diff');
    const language = filePath ? getLanguageFromPath(filePath) : null;

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
            {filePath ? (
                <Text
                    style={styles.filePath}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                >
                    {filePath}
                </Text>
            ) : null}
            {showFileContent ? (
                <View style={styles.tabBar}>
                    <Pressable
                        style={[styles.tab, activeTab === 'file' && styles.tabActive]}
                        onPress={() => setActiveTab('file')}
                    >
                        <Text style={[styles.tabText, activeTab === 'file' && styles.tabTextActive]}>File</Text>
                    </Pressable>
                    <Pressable
                        style={[styles.tab, activeTab === 'diff' && styles.tabActive]}
                        onPress={() => setActiveTab('diff')}
                    >
                        <Text style={[styles.tabText, activeTab === 'diff' && styles.tabTextActive]}>Diff</Text>
                    </Pressable>
                </View>
            ) : null}
            {activeTab === 'diff' ? (
                <FileContent tool={tool} />
            ) : (
                <SimpleSyntaxHighlighter
                    code={tool.result as string}
                    language={language}
                    selectable={true}
                />
            )}
        </ScrollView>
    );
});

// Routes to the appropriate diff rendering based on tool name
const FileContent = React.memo<{ tool: ToolCall }>(({ tool }) => {
    switch (tool.name) {
        case 'Edit':
            return <EditContent tool={tool} />;
        case 'Write':
            return <WriteContent tool={tool} />;
        case 'MultiEdit':
            return <MultiEditContent tool={tool} />;
        case 'CodexPatch':
            return <CodexPatchContent tool={tool} />;
        case 'CodexDiff':
            return <CodexDiffContent tool={tool} />;
        case 'edit':
            return <GeminiEditContent tool={tool} />;
        default:
            return null;
    }
});

const EditContent = React.memo<{ tool: ToolCall }>(({ tool }) => {
    const parsed = knownTools.Edit.input.safeParse(tool.input);
    if (!parsed.success) return null;

    const oldString = trimIdent(parsed.data.old_string || '');
    const newString = trimIdent(parsed.data.new_string || '');

    return (
        <ToolDiffView
            oldText={oldString}
            newText={newString}
            showLineNumbers={true}
            showPlusMinusSymbols={true}
        />
    );
});

const WriteContent = React.memo<{ tool: ToolCall }>(({ tool }) => {
    const parsed = knownTools.Write.input.safeParse(tool.input);
    if (!parsed.success) return null;

    return (
        <ToolDiffView
            oldText=""
            newText={parsed.data.content || ''}
            showLineNumbers={true}
            showPlusMinusSymbols={true}
        />
    );
});

const MultiEditContent = React.memo<{ tool: ToolCall }>(({ tool }) => {
    const parsed = knownTools.MultiEdit.input.safeParse(tool.input);
    if (!parsed.success) return null;

    const edits = parsed.data.edits || [];

    return (
        <View style={styles.multiEditContainer}>
            {edits.map((edit: { old_string?: string; new_string?: string }, index: number) => (
                <View key={index} style={styles.editBlock}>
                    {edits.length > 1 && (
                        <Text style={styles.editLabel}>Edit {index + 1}</Text>
                    )}
                    <ToolDiffView
                        oldText={trimIdent(edit.old_string || '')}
                        newText={trimIdent(edit.new_string || '')}
                        showLineNumbers={true}
                        showPlusMinusSymbols={true}
                    />
                </View>
            ))}
        </View>
    );
});

const CodexPatchContent = React.memo<{ tool: ToolCall }>(({ tool }) => {
    const changes = tool.input?.changes ?? tool.input?.fileChanges;
    if (!changes || typeof changes !== 'object') return null;

    const files = Object.keys(changes);

    return (
        <View style={styles.multiEditContainer}>
            {files.map((file) => {
                const change = changes[file];
                let oldText = '';
                let newText = '';

                if (change?.modify) {
                    oldText = change.modify.old_content || '';
                    newText = change.modify.new_content || '';
                } else if (change?.add) {
                    newText = change.add.content || '';
                } else if (change?.delete) {
                    oldText = change.delete.content || '';
                } else if (typeof change?.diff === 'string' || typeof change?.unified_diff === 'string') {
                    const parsed = parseUnifiedDiff(change.diff ?? change.unified_diff);
                    oldText = parsed.oldText;
                    newText = parsed.newText;
                }

                return (
                    <View key={file} style={styles.editBlock}>
                        <Text style={styles.editLabel}>{file}</Text>
                        <ToolDiffView
                            oldText={oldText}
                            newText={newText}
                            showLineNumbers={true}
                            showPlusMinusSymbols={true}
                        />
                    </View>
                );
            })}
        </View>
    );
});

const CodexDiffContent = React.memo<{ tool: ToolCall }>(({ tool }) => {
    const unifiedDiff = tool.input?.unified_diff;
    if (typeof unifiedDiff !== 'string') return null;
    const parsed = parseUnifiedDiff(unifiedDiff);
    return (
        <View style={styles.editBlock}>
            {parsed.fileName ? <Text style={styles.editLabel}>{parsed.fileName}</Text> : null}
            <ToolDiffView
                oldText={parsed.oldText}
                newText={parsed.newText}
                showLineNumbers={true}
                showPlusMinusSymbols={true}
            />
        </View>
    );
});

const GeminiEditContent = React.memo<{ tool: ToolCall }>(({ tool }) => {
    const oldText = tool.input?.oldText || tool.input?.old_string || '';
    const newText = tool.input?.newText || tool.input?.new_string || '';

    return (
        <ToolDiffView
            oldText={trimIdent(oldText)}
            newText={trimIdent(newText)}
            showLineNumbers={true}
            showPlusMinusSymbols={true}
        />
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    contentContainer: {
        padding: 12,
    },
    filePath: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        marginBottom: 8,
        flexShrink: 1,
    },
    tabBar: {
        flexDirection: 'row',
        marginBottom: 8,
        gap: 4,
    },
    tab: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: theme.colors.surfaceHighest,
    },
    tabActive: {
        backgroundColor: theme.colors.text,
    },
    tabText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.text,
    },
    tabTextActive: {
        color: theme.colors.surface,
    },
    multiEditContainer: {
        gap: 12,
    },
    editBlock: {
        gap: 4,
    },
    editLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
}));
