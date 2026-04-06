import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { knownTools } from '@/components/tools/knownTools';

interface SidebarTodoViewProps {
    tool: ToolCall;
}

interface Todo {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm?: string;
}

export const SidebarTodoView = React.memo<SidebarTodoViewProps>(({ tool }) => {
    let todosList: Todo[] = [];

    const parsedInput = knownTools.TodoWrite.input.safeParse(tool.input);
    if (parsedInput.success && parsedInput.data.todos) {
        todosList = parsedInput.data.todos;
    }

    // If result has newTodos, prefer that
    const parsedResult = knownTools.TodoWrite.result.safeParse(tool.result);
    if (parsedResult.success && parsedResult.data.newTodos) {
        todosList = parsedResult.data.newTodos;
    }

    if (todosList.length === 0) {
        return null;
    }

    return (
        <View style={styles.container}>
            {todosList.map((todo, index) => (
                <View key={`todo-${index}`} style={styles.item}>
                    <TodoIcon status={todo.status} />
                    <Text
                        style={[
                            styles.text,
                            todo.status === 'completed' && styles.completedText,
                            todo.status === 'in_progress' && styles.inProgressText,
                            todo.status === 'pending' && styles.pendingText,
                        ]}
                    >
                        {todo.content}
                    </Text>
                </View>
            ))}
        </View>
    );
});

const TodoIcon = React.memo<{ status: string }>(({ status }) => {
    switch (status) {
        case 'completed':
            return <Ionicons name="checkmark-circle" size={18} color={styles.iconCompleted.color} style={styles.iconMargin} />;
        case 'in_progress':
            return <Ionicons name="time-outline" size={18} color={styles.iconInProgress.color} style={styles.iconMargin} />;
        default:
            return <Ionicons name="ellipse-outline" size={18} color={styles.iconPending.color} style={styles.iconMargin} />;
    }
});

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 8,
        padding: 16,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    text: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
        flex: 1,
    },
    completedText: {
        textDecorationLine: 'line-through',
        color: theme.colors.success,
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
