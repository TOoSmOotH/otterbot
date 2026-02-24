import { create } from "zustand";

interface OpenRouterBalance {
  balance: number;
  limit: number | null;
  usage: number;
}

interface OpenRouterBalanceState {
  balance: OpenRouterBalance | null;
  loading: boolean;
  fetchBalance: () => Promise<void>;
  startPolling: () => () => void;
}

export const useOpenRouterBalanceStore = create<OpenRouterBalanceState>((set, get) => ({
  balance: null,
  loading: false,

  fetchBalance: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/settings/openrouter/balance");
      if (!res.ok) {
        set({ loading: false });
        return;
      }
      const data = await res.json();
      if (!data.available) {
        set({ balance: null, loading: false });
        return;
      }
      set({
        balance: { balance: data.balance, limit: data.limit, usage: data.usage },
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  startPolling: () => {
    get().fetchBalance();
    const id = setInterval(() => get().fetchBalance(), 60_000);
    return () => clearInterval(id);
  },
}));
