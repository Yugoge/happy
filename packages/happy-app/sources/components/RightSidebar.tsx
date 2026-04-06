import * as React from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions, Modal as RNModal } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { useRightSidebar, SidebarData } from '@/stores/rightSidebarStore';
import { t } from '@/text';
import type { ToolCall, Message } from '@/sync/typesMessage';
import type { Metadata } from '@/sync/storageTypes';
import { SidebarContentRenderer } from './sidebar/SidebarContentRenderer';

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

function SidebarBackButton({ onBack }: { onBack: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            onPress={onBack}
            hitSlop={8}
            style={{
                width: 28, height: 28, borderRadius: 14,
                alignItems: 'center', justifyContent: 'center', marginRight: 8,
            }}
        >
            <Ionicons name="arrow-back" size={18} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

function SidebarHeader({ tool, onClose, hasHistory, onBack }: { tool: ToolCall; onClose: () => void; hasHistory: boolean; onBack: () => void }) {
    const { theme } = useUnistyles();
    return (
        <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
        }}>
            {hasHistory && <SidebarBackButton onBack={onBack} />}
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text, flex: 1 }} numberOfLines={1}>
                {tool.name || t('sidebar.toolDetail')}
            </Text>
            <SidebarCloseButton onClose={onClose} />
        </View>
    );
}

const HIDDEN_LAYER_STYLE = { position: 'absolute' as const, width: '100%' as const, height: '100%' as const, opacity: 0, pointerEvents: 'none' as const };
const VISIBLE_LAYER_STYLE = { flex: 1 };

/** Single sidebar stack layer -- visible or hidden to preserve scroll position */
function SidebarLayer({ layer, isTop }: { layer: SidebarData; isTop: boolean }) {
    return (
        <View style={isTop ? VISIBLE_LAYER_STYLE : HIDDEN_LAYER_STYLE}>
            <SidebarContentRenderer tool={layer.tool} messages={layer.messages} metadata={layer.metadata} sessionId={layer.sessionId} />
        </View>
    );
}

/**
 * Renders all sidebar stack layers. Previous layers stay mounted (hidden) to preserve
 * scroll position. Only the topmost layer is visible.
 */
function SidebarContentStack({ history, current }: { history: SidebarData[]; current: SidebarData }) {
    const allLayers = React.useMemo(() => [...history, current], [history, current]);

    return (
        <View style={{ flex: 1 }}>
            {allLayers.map((layer, index) => (
                <SidebarLayer key={`sidebar-layer-${index}`} layer={layer} isTop={index === allLayers.length - 1} />
            ))}
        </View>
    );
}

interface SidebarPanelProps {
    tool: ToolCall; messages: Message[]; metadata: Metadata | null;
    sessionId: string; onClose: () => void; hasHistory: boolean; onBack: () => void;
}

interface SidebarPanelPropsExt extends SidebarPanelProps {
    history: SidebarData[];
}

function MobileSidebar({ tool, messages, metadata, sessionId, onClose, hasHistory, onBack, history }: SidebarPanelPropsExt) {
    const { theme } = useUnistyles();
    const current = React.useMemo(() => ({ tool, messages, metadata, sessionId }), [tool, messages, metadata, sessionId]);
    return (
        <RNModal visible={true} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                <SidebarHeader tool={tool} onClose={onClose} hasHistory={hasHistory} onBack={onBack} />
                <SidebarContentStack history={history} current={current} />
            </View>
        </RNModal>
    );
}

function DesktopSidebar({ tool, messages, metadata, sessionId, onClose, hasHistory, onBack, history }: SidebarPanelPropsExt) {
    const { theme } = useUnistyles();
    const current = React.useMemo(() => ({ tool, messages, metadata, sessionId }), [tool, messages, metadata, sessionId]);
    return (
        <View style={{
            width: SIDEBAR_WIDTH, borderLeftWidth: 1,
            borderLeftColor: theme.colors.divider, backgroundColor: theme.colors.surface,
        }}>
            <SidebarHeader tool={tool} onClose={onClose} hasHistory={hasHistory} onBack={onBack} />
            <SidebarContentStack history={history} current={current} />
        </View>
    );
}

/**
 * RightSidebar renders tool detail in a side panel (desktop) or modal (mobile).
 * Closes on Escape key (web).
 */
export const RightSidebar = React.memo(function RightSidebar() {
    const { isOpen, data, close, history, pop } = useRightSidebar();
    const { width } = useWindowDimensions();
    const isDesktop = width >= DESKTOP_MIN_WIDTH;
    const hasHistory = history.length > 0;

    useEscapeToClose(isOpen, close);

    if (!isOpen || !data) {
        return null;
    }

    if (!isDesktop) {
        return <MobileSidebar tool={data.tool} messages={data.messages} metadata={data.metadata} sessionId={data.sessionId} onClose={close} hasHistory={hasHistory} onBack={pop} history={history} />;
    }

    return <DesktopSidebar tool={data.tool} messages={data.messages} metadata={data.metadata} sessionId={data.sessionId} onClose={close} hasHistory={hasHistory} onBack={pop} history={history} />;
});
