import { create } from "zustand";
import type { CustomTool, CustomToolCreate, CustomToolUpdate } from "@otterbot/shared";

interface ToolMeta {
  description: string;
  parameters?: { name: string; type: string; required: boolean; description: string }[];
  builtIn: boolean;
  category?: string;
}

export interface ToolExample {
  name: string;
  description: string;
  category: string;
  parameters: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
  }>;
  code: string;
  timeout: number;
}

interface ToolsState {
  customTools: CustomTool[];
  builtInTools: string[];
  toolMeta: Record<string, ToolMeta>;
  examples: ToolExample[];
  loading: boolean;
  error: string | null;

  loadTools: () => Promise<void>;
  loadExamples: () => Promise<void>;
  getCustomTool: (id: string) => Promise<CustomTool | null>;
  createTool: (data: CustomToolCreate) => Promise<CustomTool | null>;
  updateTool: (id: string, data: CustomToolUpdate) => Promise<CustomTool | null>;
  deleteTool: (id: string) => Promise<boolean>;
  testTool: (id: string, params: Record<string, unknown>) => Promise<{ result?: string; error?: string }>;
  generateTool: (description: string) => Promise<Partial<CustomToolCreate> | null>;
}

export const useToolsStore = create<ToolsState>((set, get) => ({
  customTools: [],
  builtInTools: [],
  toolMeta: {},
  examples: [],
  loading: false,
  error: null,

  loadExamples: async () => {
    try {
      const res = await fetch("/api/tools/examples");
      if (!res.ok) return;
      const data = await res.json();
      set({ examples: data });
    } catch {
      // silently ignore — examples are optional
    }
  },

  loadTools: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/tools");
      if (!res.ok) throw new Error("Failed to load tools");
      const data = await res.json();
      set({
        customTools: data.customTools ?? [],
        builtInTools: data.builtInTools ?? [],
        toolMeta: data.toolMeta ?? {},
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  getCustomTool: async (id) => {
    try {
      const res = await fetch(`/api/tools/${id}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  createTool: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create tool");
      }
      const tool = await res.json();
      await get().loadTools();
      return tool as CustomTool;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  updateTool: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/tools/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update tool");
      }
      const tool = await res.json();
      await get().loadTools();
      return tool as CustomTool;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  deleteTool: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/tools/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete tool");
      }
      await get().loadTools();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  testTool: async (id, params) => {
    try {
      const res = await fetch(`/api/tools/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params }),
      });
      return await res.json();
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Unknown error" };
    }
  },

  generateTool: async (description) => {
    try {
      const res = await fetch("/api/tools/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
}));
