import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolViewProps } from "./_all";
import { knownTools } from '../../tools/knownTools';
import { ToolSectionView } from '../../tools/ToolSectionView';

export interface Todo {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority?: 'high' | 'medium' | 'low';
    id?: string;
}

const TodoStatusIcon = React.memo<{ status: string }>(({ status }) => {
    switch (status) {
        case 'completed':
            return <Ionicons name="checkmark-circle" size={18} color={styles.iconCompleted.color} style={styles.iconMargin} />;
        case 'in_progress':
            return <Ionicons name="time-outline" size={18} color={styles.iconInProgress.color} style={styles.iconMargin} />;
        default:
            return <Ionicons name="ellipse-outline" size={18} color={styles.iconPending.color} style={styles.iconMargin} />;
    }
});

const TodoItem = React.memo<{ todo: Todo; index: number }>(({ todo, index }) => {
    return (
        <View key={todo.id || `todo-${index}`} style={styles.todoItem}>
            <TodoStatusIcon status={todo.status} />
            <Text style={[
                styles.todoText,
                todo.status === 'completed' && styles.completedText,
                todo.status === 'in_progress' && styles.inProgressText,
                todo.status === 'pending' && styles.pendingText,
            ]}>
                {todo.content}
            </Text>
        </View>
    );
});

function parseTodos(tool: ToolViewProps['tool']): Todo[] {
    let todosList: Todo[] = [];

    const parsedArguments = knownTools.TodoWrite.input.safeParse(tool.input);
    if (parsedArguments.success && parsedArguments.data.todos) {
        todosList = parsedArguments.data.todos;
    }

    const parsed = knownTools.TodoWrite.result.safeParse(tool.result);
    if (parsed.success && parsed.data.newTodos) {
        todosList = parsed.data.newTodos;
    }

    return todosList;
}

export const TodoView = React.memo<ToolViewProps>(({ tool }) => {
    const todosList = parseTodos(tool);

    if (todosList.length === 0) {
        return null;
    }

    return (
        <ToolSectionView>
            <View style={styles.container}>
                {todosList.map((todo, index) => (
                    <TodoItem key={todo.id || `todo-${index}`} todo={todo} index={index} />
                ))}
            </View>
        </ToolSectionView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 4,
    },
    todoItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        paddingVertical: 2,
    },
    todoText: {
        fontSize: 14,
        color: theme.colors.text,
        flex: 1,
    },
    completedText: {
        color: theme.colors.success,
        textDecorationLine: 'line-through',
    },
    inProgressText: {
        color: '#007AFF',
    },
    pendingText: {
        color: theme.colors.text,
    },
    iconCompleted: {
        color: theme.colors.success,
    },
    iconInProgress: {
        color: '#007AFF',
    },
    iconPending: {
        color: theme.colors.text,
    },
    iconMargin: {
        marginTop: 1,
    },
}));
