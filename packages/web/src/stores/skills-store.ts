import { create } from "zustand";
import type { Skill, SkillCreate, SkillUpdate, ScanReport } from "@otterbot/shared";

interface SkillsState {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  scanReport: ScanReport | null;
  importing: boolean;
  availableTools: string[];

  loadSkills: () => Promise<void>;
  createSkill: (data: SkillCreate) => Promise<Skill | null>;
  updateSkill: (id: string, data: SkillUpdate) => Promise<Skill | null>;
  deleteSkill: (id: string) => Promise<boolean>;
  importSkill: (file: File) => Promise<{ skill: Skill; scanReport: ScanReport } | null>;
  exportSkill: (id: string) => Promise<void>;
  scanContent: (content: string) => Promise<ScanReport | null>;
  loadAvailableTools: () => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  loading: false,
  error: null,
  scanReport: null,
  importing: false,
  availableTools: [],

  loadSkills: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) throw new Error("Failed to load skills");
      const data = await res.json();
      set({ skills: data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  createSkill: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create skill");
      }
      const skill = await res.json();
      await get().loadSkills();
      return skill as Skill;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  updateSkill: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/skills/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update skill");
      }
      const skill = await res.json();
      await get().loadSkills();
      return skill as Skill;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  deleteSkill: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/skills/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete skill");
      }
      await get().loadSkills();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  importSkill: async (file) => {
    set({ importing: true, error: null, scanReport: null });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/skills/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to import skill");
      }
      const result = await res.json();
      set({ scanReport: result.scanReport, importing: false });
      await get().loadSkills();
      return result as { skill: Skill; scanReport: ScanReport };
    } catch (err) {
      set({
        importing: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
      return null;
    }
  },

  exportSkill: async (id) => {
    try {
      const res = await fetch(`/api/skills/${id}/export`);
      if (!res.ok) throw new Error("Failed to export skill");
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition");
      const match = disposition?.match(/filename="(.+)"/);
      const filename = match?.[1] ?? "skill.md";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },

  scanContent: async (content) => {
    set({ error: null });
    try {
      const res = await fetch("/api/skills/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to scan content");
      const report = await res.json();
      set({ scanReport: report });
      return report as ScanReport;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  loadAvailableTools: async () => {
    try {
      const res = await fetch("/api/tools/available");
      if (!res.ok) return;
      const data = await res.json();
      set({ availableTools: data.tools });
    } catch {
      // Silently fail
    }
  },
}));
