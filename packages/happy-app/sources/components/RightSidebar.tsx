import * as React from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions, Modal as RNModal } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { useRightSidebar } from '@/stores/rightSidebarStore';
import { t } from '@/text';
import type { ToolCall } from '@/sync/typesMessage';

const SIDEBAR_WIDTH = 450;
const DESKTOP_MIN_WIDTH = 901;

/**
 * Hook to close sidebar on Escape key press (web only)
 */
function useEscapeToClose(isOpen: boolean, close: () => void) {
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !isOpen) {
            return;
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, close]);
}

function SidebarCloseButton({ onClose }: { onClose: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={onClose}
            hitSlop={8}
            style={{
                width: 28, height: 28, borderRadius: 14,
                alignItems: 'center', justifyContent: 'center', marginLeft: 8,
            }}
        >
            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

function SidebarHeader({ tool, onClose }: { tool: ToolCall; onClose: () => void }) {
    const { theme } = useUnistyles();
    return (
        <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
        }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text, flex: 1 }} numberOfLines={1}>
                {tool.name || t('sidebar.toolDetail')}
            </Text>
            <SidebarCloseButton onClose={onClose} />
        </View>
    );
}

function SidebarContent({ toolName }: { toolName: string }) {
    const { theme } = useUnistyles();
    return (
        <View style={{ flex: 1, padding: 16 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>
                {t('sidebar.toolDetail')}: {toolName}
            </Text>
        </View>
    );
}

function MobileSidebar({ tool, onClose }: { tool: ToolCall; onClose: () => void }) {
    const { theme } = useUnistyles();
    return (
        <RNModal visible={true} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                <SidebarHeader tool={tool} onClose={onClose} />
                <SidebarContent toolName={tool.name} />
            </View>
        </RNModal>
    );
}

function DesktopSidebar({ tool, onClose }: { tool: ToolCall; onClose: () => void }) {
    const { theme } = useUnistyles();
    return (
        <View style={{
            width: SIDEBAR_WIDTH, borderLeftWidth: 1,
            borderLeftColor: theme.colors.border, backgroundColor: theme.colors.surface,
        }}>
            <SidebarHeader tool={tool} onClose={onClose} />
            <SidebarContent toolName={tool.name} />
        </View>
    );
}

/**
 * RightSidebar renders tool detail in a side panel (desktop) or modal (mobile).
 * Closes on Escape key (web).
 */
export const RightSidebar = React.memo(function RightSidebar() {
    const { isOpen, data, close } = useRightSidebar();
    const { width } = useWindowDimensions();
    const isDesktop = width >= DESKTOP_MIN_WIDTH;

    useEscapeToClose(isOpen, close);

    if (!isOpen || !data) {
        return null;
    }

    if (!isDesktop) {
        return <MobileSidebar tool={data.tool} onClose={close} />;
    }

    return <DesktopSidebar tool={data.tool} onClose={close} />;
});
