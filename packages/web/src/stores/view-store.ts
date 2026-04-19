import { create } from "zustand";

export type ViewPane = "none" | "2d" | "3d" | "desktop";

interface ViewState {
  pane: ViewPane;
  setPane: (pane: ViewPane) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  pane: "none",
  setPane: (pane) => set({ pane }),
}));
