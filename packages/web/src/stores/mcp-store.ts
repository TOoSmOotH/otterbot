import { create } from "zustand";
import type {
  McpServerConfig,
  McpServerCreate,
  McpServerUpdate,
  McpServerRuntime,
  McpToolMeta,
} from "@otterbot/shared";

interface SecurityWarning {
  type: string;
  message: string;
}

interface McpState {
  servers: McpServerConfig[];
  statuses: Record<string, McpServerRuntime>;
  warnings: Record<string, SecurityWarning[]>;
  loading: boolean;
  error: string | null;

  loadServers: () => Promise<void>;
  createServer: (data: McpServerCreate) => Promise<McpServerConfig | null>;
  updateServer: (id: string, data: McpServerUpdate) => Promise<McpServerConfig | null>;
  deleteServer: (id: string) => Promise<boolean>;
  startServer: (id: string) => Promise<boolean>;
  stopServer: (id: string) => Promise<boolean>;
  restartServer: (id: string) => Promise<boolean>;
  testServer: (id: string) => Promise<{ ok: boolean; tools?: McpToolMeta[]; error?: string }>;
  discoverTools: (id: string) => Promise<McpToolMeta[]>;
  updateAllowedTools: (id: string, allowedTools: string[] | null) => Promise<McpServerConfig | null>;
  updateStatus: (runtime: McpServerRuntime) => void;
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  statuses: {},
  warnings: {},
  loading: false,
  error: null,

  loadServers: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/settings/mcp-servers");
      if (!res.ok) throw new Error("Failed to load MCP servers");
      const data = await res.json();
      set({
        servers: data.servers ?? [],
        statuses: data.statuses ?? {},
        warnings: data.warnings ?? {},
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  createServer: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create MCP server");
      }
      const server = await res.json();
      await get().loadServers();
      return server as McpServerConfig;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  updateServer: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/mcp-servers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update MCP server");
      }
      const server = await res.json();
      await get().loadServers();
      return server as McpServerConfig;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  deleteServer: async (id) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/mcp-servers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete MCP server");
      }
      await get().loadServers();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  startServer: async (id) => {
    try {
      const res = await fetch(`/api/settings/mcp-servers/${id}/start`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to start MCP server");
      }
      const data = await res.json();
      if (data.status) {
        set((s) => ({ statuses: { ...s.statuses, [id]: data.status } }));
      }
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  stopServer: async (id) => {
    try {
      const res = await fetch(`/api/settings/mcp-servers/${id}/stop`, { method: "POST" });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.status) {
        set((s) => ({ statuses: { ...s.statuses, [id]: data.status } }));
      }
      return true;
    } catch {
      return false;
    }
  },

  restartServer: async (id) => {
    try {
      const res = await fetch(`/api/settings/mcp-servers/${id}/restart`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to restart MCP server");
      }
      const data = await res.json();
      if (data.status) {
        set((s) => ({ statuses: { ...s.statuses, [id]: data.status } }));
      }
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  testServer: async (id) => {
    try {
      const res = await fetch(`/api/settings/mcp-servers/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || "Test failed" };
      if (data.status) {
        set((s) => ({ statuses: { ...s.statuses, [id]: data.status } }));
      }
      await get().loadServers();
      return { ok: true, tools: data.tools };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  },

  discoverTools: async (id) => {
    try {
      const res = await fetch(`/api/settings/mcp-servers/${id}/discover`, { method: "POST" });
      if (!res.ok) return [];
      const data = await res.json();
      await get().loadServers();
      return data.tools ?? [];
    } catch {
      return [];
    }
  },

  updateAllowedTools: async (id, allowedTools) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/mcp-servers/${id}/tools`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedTools }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update tools");
      }
      const server = await res.json();
      await get().loadServers();
      return server as McpServerConfig;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return null;
    }
  },

  updateStatus: (runtime) => {
    set((s) => ({
      statuses: { ...s.statuses, [runtime.id]: runtime },
    }));
  },
}));
