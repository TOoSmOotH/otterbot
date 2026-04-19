import { create } from "zustand";
import type { Skill } from "@otterbot/shared";

interface SkillsState {
  skills: Skill[];
  loaded: boolean;
  load: () => Promise<void>;
  importFromUrl: (url: string) => Promise<Skill | { error: string }>;
}

export const useSkillsStore = create<SkillsState>((set) => ({
  skills: [],
  loaded: false,
  load: async () => {
    try {
      const res = await fetch("/api/skills");
      const skills = res.ok ? ((await res.json()) as Skill[]) : [];
      set({ skills, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  importFromUrl: async (url: string) => {
    const res = await fetch("/api/skills/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) return data;
    set((state) => ({ skills: [...state.skills, data as Skill] }));
    return data as Skill;
  },
}));
