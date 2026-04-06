import { create } from 'zustand';
import { ToolCall, Message } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';

interface SidebarData {
    tool: ToolCall;
    messages: Message[];
    metadata: Metadata | null;
    sessionId: string;
}

interface RightSidebarState {
    isOpen: boolean;
    data: SidebarData | null;
    open: (data: SidebarData) => void;
    close: () => void;
}

export const useRightSidebar = create<RightSidebarState>((set) => ({
    isOpen: false,
    data: null,
    open: (data) => set({ isOpen: true, data }),
    close: () => set({ isOpen: false, data: null }),
}));
