import { create } from "zustand";

interface DesktopState {
  enabled: boolean;
  connected: boolean;
  resolution: string;
  wsPath: string;
  checkStatus: () => Promise<void>;
  setConnected: (connected: boolean) => void;
}

export const useDesktopStore = create<DesktopState>((set) => ({
  enabled: false,
  connected: false,
  resolution: "1280x720x24",
  wsPath: "/desktop/ws",

  checkStatus: async () => {
    try {
      const res = await fetch("/api/desktop/status");
      if (!res.ok) return;
      const data = await res.json();
      set({
        enabled: data.enabled,
        resolution: data.resolution,
        wsPath: data.wsPath,
      });
    } catch {
      // Ignore — desktop status is optional
    }
  },

  setConnected: (connected) => set({ connected }),
}));
