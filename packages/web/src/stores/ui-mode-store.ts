import { create } from "zustand";

export type UIMode = "basic" | "advanced";

interface UIModeState {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
  toggleMode: () => void;
}

function getInitialMode(): UIMode {
  const stored = localStorage.getItem("otterbot-ui-mode") as UIMode | null;
  if (stored && (stored === "basic" || stored === "advanced")) return stored;
  return "basic";
}

export const useUIModeStore = create<UIModeState>((set) => ({
  mode: getInitialMode(),
  setMode: (mode) => {
    localStorage.setItem("otterbot-ui-mode", mode);
    set({ mode });
  },
  toggleMode: () =>
    set((state) => {
      const next = state.mode === "basic" ? "advanced" : "basic";
      localStorage.setItem("otterbot-ui-mode", next);
      return { mode: next };
    }),
}));
