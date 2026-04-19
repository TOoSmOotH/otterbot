import { create } from "zustand";

interface DesktopState {
  enabled: boolean;
  wsPath: string;
  connected: boolean;
  checked: boolean;
  checkStatus: () => Promise<void>;
  setConnected: (v: boolean) => void;
}

export const useDesktopStore = create<DesktopState>((set, get) => ({
  enabled: false,
  wsPath: "/desktop/ws",
  connected: false,
  checked: false,
  checkStatus: async () => {
    if (get().checked) return;
    try {
      const res = await fetch("/api/desktop/status");
      const data = (await res.json()) as { enabled: boolean; wsPath?: string };
      set({
        enabled: data.enabled,
        wsPath: data.wsPath ?? "/desktop/ws",
        checked: true,
      });
    } catch {
      set({ checked: true });
    }
  },
  setConnected: (v) => set({ connected: v }),
}));
