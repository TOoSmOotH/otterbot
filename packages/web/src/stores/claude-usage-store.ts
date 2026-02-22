import { create } from "zustand";
import type { ClaudeCodeOAuthUsage } from "@otterbot/shared";

interface ClaudeUsageState {
  usage: ClaudeCodeOAuthUsage | null;
  loading: boolean;
  fetchUsage: () => Promise<void>;
  startPolling: () => () => void;
}

export const useClaudeUsageStore = create<ClaudeUsageState>((set, get) => ({
  usage: null,
  loading: false,

  fetchUsage: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/settings/claude-code/usage");
      if (!res.ok) {
        set({ loading: false });
        return;
      }
      const data = await res.json();
      set({ usage: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  startPolling: () => {
    get().fetchUsage();
    const id = setInterval(() => get().fetchUsage(), 60_000);
    return () => clearInterval(id);
  },
}));
