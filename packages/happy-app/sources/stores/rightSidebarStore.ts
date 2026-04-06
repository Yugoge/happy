import { create } from 'zustand';
import { ToolCall, Message } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';

export interface SidebarData {
    tool: ToolCall;
    messages: Message[];
    metadata: Metadata | null;
    sessionId: string;
}

interface RightSidebarState {
    isOpen: boolean;
    data: SidebarData | null;
    history: SidebarData[];
    open: (data: SidebarData) => void;
    close: () => void;
    push: (data: SidebarData) => void;
    pop: () => void;
}

export const useRightSidebar = create<RightSidebarState>((set) => ({
    isOpen: false,
    data: null,
    history: [],
    open: (data) => set({ isOpen: true, data, history: [] }),
    close: () => set({ isOpen: false, data: null, history: [] }),
    push: (data) => set((state) => ({
        isOpen: true,
        data,
        history: state.data ? [...state.history, state.data] : state.history,
    })),
    pop: () => set((state) => {
        if (state.history.length > 0) {
            const newHistory = [...state.history];
            const previous = newHistory.pop()!;
            return { data: previous, history: newHistory };
        }
        return { isOpen: false, data: null, history: [] };
    }),
}));
