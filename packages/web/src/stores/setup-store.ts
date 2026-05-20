import { create } from "zustand";
import { apiFetch } from "../lib/api";

interface SetupState {
  checked: boolean;
  onboardingComplete: boolean;
  load: () => Promise<void>;
  markComplete: () => Promise<void>;
}

export const useSetupStore = create<SetupState>((set) => ({
  checked: false,
  // Assume complete until told otherwise — avoids a wizard flash on load.
  onboardingComplete: true,

  load: async () => {
    try {
      const res = await apiFetch("/api/setup-state");
      if (res.ok) {
        const state = (await res.json()) as { onboardingComplete?: boolean };
        set({ checked: true, onboardingComplete: Boolean(state.onboardingComplete) });
        return;
      }
    } catch {
      // ignore — leave onboarding hidden
    }
    set({ checked: true });
  },

  markComplete: async () => {
    try {
      await apiFetch("/api/setup-state/complete", { method: "POST" });
    } finally {
      set({ onboardingComplete: true });
    }
  },
}));
