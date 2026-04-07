import { create } from 'zustand';

interface DetailViewState {
    isOpen: boolean;
    messageId: string | null;
    open: (messageId: string) => void;
    close: () => void;
}

export const useDetailView = create<DetailViewState>((set) => ({
    isOpen: false,
    messageId: null,
    open: (messageId) => set({ isOpen: true, messageId }),
    close: () => set({ isOpen: false, messageId: null }),
}));
