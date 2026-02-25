import { create } from "zustand";
import type { MergeQueueEntry } from "@otterbot/shared";

interface MergeQueueState {
  entries: MergeQueueEntry[];
  setEntries: (entries: MergeQueueEntry[]) => void;
  updateEntry: (entry: MergeQueueEntry) => void;
}

export const useMergeQueueStore = create<MergeQueueState>((set) => ({
  entries: [],

  setEntries: (entries) => set({ entries }),

  updateEntry: (entry) =>
    set((state) => {
      const exists = state.entries.some((e) => e.id === entry.id);
      if (exists) {
        return {
          entries: state.entries.map((e) => (e.id === entry.id ? entry : e)),
        };
      }
      return { entries: [...state.entries, entry] };
    }),
}));
