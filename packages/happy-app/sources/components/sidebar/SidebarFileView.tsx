import * as React from 'react';
import { View, ScrollView, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ToolCall } from '@/sync/typesMessage';
import { knownTools } from '@/components/tools/knownTools';
import { ToolDiffView } from '@/components/tools/ToolDiffView';
import { trimIdent } from '@/utils/trimIdent';

interface SidebarFileViewProps {
    tool: ToolCall;
}

export const SidebarFileView = React.memo<SidebarFileViewProps>(({ tool }) => {
    const filePath = tool.input?.file_path || tool.input?.path || '';

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
            {filePath ? (
                <Text style={styles.filePath} numberOfLines={1}>{filePath}</Text>
            ) : null}
            <FileContent tool={tool} />
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
    const changes = tool.input?.changes;
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
