import * as React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import type { ToolViewProps } from './_all';
import { ToolSectionView } from '../ToolSectionView';
import { extractPlanItems, summarizePlanItems } from '@/utils/codexToolRendering';

function iconNameForStatus(status: string) {
    if (status === 'completed') return 'checkmark-circle';
    if (status === 'in_progress') return 'time-outline';
    return 'ellipse-outline';
}

function statusStyle(status: string) {
    if (status === 'completed') return planStyles.completedText;
    if (status === 'in_progress') return planStyles.inProgressText;
    return planStyles.pendingText;
}

export const CodexPlanView = React.memo<ToolViewProps>(({ tool }) => {
    const items = extractPlanItems(tool.input);
    if (items.length === 0) return null;
    return (
        <ToolSectionView>
            <View style={planStyles.container}>
                <Text style={planStyles.summary}>{summarizePlanItems(items)}</Text>
                {items.map((item, index) => (
                    <View key={`${item.status}-${index}`} style={planStyles.row}>
                        <Ionicons
                            name={iconNameForStatus(item.status) as any}
                            size={16}
                            style={[planStyles.icon, statusStyle(item.status)]}
                        />
                        <Text style={[planStyles.text, statusStyle(item.status)]}>{item.step}</Text>
                    </View>
                ))}
            </View>
        </ToolSectionView>
    );
});

const planStyles = StyleSheet.create((theme) => ({
    container: {
        gap: 4,
    },
    summary: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        marginBottom: 2,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        paddingVertical: 2,
    },
    icon: {
        marginTop: 1,
    },
    text: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
    },
    completedText: {
        color: theme.colors.success,
    },
    inProgressText: {
        color: theme.colors.status.connecting,
    },
    pendingText: {
        color: theme.colors.textSecondary,
    },
}));
