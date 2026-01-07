import { create } from 'zustand';

type SnackbarMessage = {
  id: string;
  text: string;
  kind: 'success' | 'warn' | 'error';
};

type UIState = {
  isSettingsOpen: boolean;
  isHistoryOpen: boolean;
  showSummary: boolean;
  snackbar: SnackbarMessage | null;

  setSettingsOpen: (isOpen: boolean) => void;
  setHistoryOpen: (isOpen: boolean) => void;
  setShowSummary: (show: boolean) => void;
  showSnackbar: (text: string, kind?: 'success' | 'warn' | 'error') => void;
  hideSnackbar: () => void;
};

export const useUIStore = create<UIState>((set) => ({
  isSettingsOpen: false,
  isHistoryOpen: false,
  showSummary: false,
  snackbar: null,

  setSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
  setHistoryOpen: (isOpen) => set({ isHistoryOpen: isOpen }),
  setShowSummary: (show) => set({ showSummary: show }),
  
  showSnackbar: (text, kind = 'success') => {
      const id = Date.now().toString();
      set({ snackbar: { id, text, kind } });
  },
  
  hideSnackbar: () => set({ snackbar: null }),
}));