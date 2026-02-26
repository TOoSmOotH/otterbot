import { create } from "zustand";
import type { SshSession, SshKeyInfo, SshKeyType } from "@otterbot/shared";
import { getSocket } from "../lib/socket";

interface SshState {
  sessions: SshSession[];
  selectedSessionId: string | null;
  sshKeys: SshKeyInfo[];
  sshKeysLoading: boolean;

  // Session actions
  loadSessions: () => Promise<void>;
  selectSession: (id: string | null) => void;
  deleteSession: (id: string) => Promise<void>;
  connectToHost: (keyId: string, host: string) => Promise<{ ok: boolean; sessionId?: string; agentId?: string; error?: string }>;
  disconnectSession: (sessionId: string) => Promise<void>;

  // Key management actions
  loadKeys: () => Promise<void>;
  generateKey: (data: { name: string; username: string; allowedHosts: string[]; keyType?: SshKeyType; port?: number }) => Promise<{ key?: SshKeyInfo; error?: string }>;
  importKey: (data: { name: string; username: string; privateKey: string; allowedHosts: string[]; port?: number }) => Promise<{ key?: SshKeyInfo; error?: string }>;
  updateKey: (id: string, data: { name?: string; username?: string; allowedHosts?: string[]; port?: number }) => Promise<{ key?: SshKeyInfo; error?: string }>;
  deleteKey: (id: string) => Promise<boolean>;
  getPublicKey: (id: string) => Promise<string | null>;
  testConnection: (keyId: string, host: string) => Promise<{ ok: boolean; error?: string }>;

  // Socket event handlers
  handleSessionStart: (data: { sessionId: string; keyId: string; host: string; username: string; agentId: string }) => void;
  handleSessionEnd: (data: { sessionId: string; agentId: string; status: string }) => void;
}

export const useSshStore = create<SshState>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  sshKeys: [],
  sshKeysLoading: false,

  loadSessions: async () => {
    try {
      const res = await fetch("/api/ssh/sessions");
      const data = await res.json();
      set({ sessions: data.sessions ?? [] });
    } catch (err) {
      console.error("Failed to load SSH sessions:", err);
    }
  },

  loadKeys: async () => {
    set({ sshKeysLoading: true });
    try {
      const res = await fetch("/api/settings/ssh/keys");
      const data = await res.json();
      set({ sshKeys: data.keys ?? [], sshKeysLoading: false });
    } catch (err) {
      console.error("Failed to load SSH keys:", err);
      set({ sshKeysLoading: false });
    }
  },

  selectSession: (id) => set({ selectedSessionId: id }),

  deleteSession: async (id) => {
    try {
      await fetch(`/api/ssh/sessions/${id}`, { method: "DELETE" });
      set((s) => ({
        sessions: s.sessions.filter((session) => session.id !== id),
        selectedSessionId: s.selectedSessionId === id ? null : s.selectedSessionId,
      }));
    } catch (err) {
      console.error("Failed to delete SSH session:", err);
    }
  },

  connectToHost: (keyId, host) => {
    return new Promise((resolve) => {
      const socket = getSocket();
      socket.emit("ssh:connect", { keyId, host }, (ack) => {
        resolve(ack ?? { ok: false, error: "No response" });
      });
    });
  },

  disconnectSession: async (sessionId) => {
    const socket = getSocket();
    socket.emit("ssh:disconnect", { sessionId });
  },

  generateKey: async (data) => {
    try {
      const res = await fetch("/api/settings/ssh/keys/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.key) {
        set((s) => ({ sshKeys: [result.key, ...s.sshKeys] }));
        return { key: result.key };
      }
      return { error: result.error || "Failed to generate key" };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to generate key" };
    }
  },

  importKey: async (data) => {
    try {
      const res = await fetch("/api/settings/ssh/keys/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.key) {
        set((s) => ({ sshKeys: [result.key, ...s.sshKeys] }));
        return { key: result.key };
      }
      return { error: result.error || "Failed to import key" };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to import key" };
    }
  },

  updateKey: async (id, data) => {
    try {
      const res = await fetch(`/api/settings/ssh/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.key) {
        set((s) => ({
          sshKeys: s.sshKeys.map((k) => (k.id === id ? result.key : k)),
        }));
        return { key: result.key };
      }
      return { error: result.error || "Failed to update key" };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to update key" };
    }
  },

  deleteKey: async (id) => {
    try {
      const res = await fetch(`/api/settings/ssh/keys/${id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.ok) {
        set((s) => ({ sshKeys: s.sshKeys.filter((k) => k.id !== id) }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  getPublicKey: async (id) => {
    try {
      const res = await fetch(`/api/settings/ssh/keys/${id}/public-key`);
      const result = await res.json();
      return result.publicKey ?? null;
    } catch {
      return null;
    }
  },

  testConnection: async (keyId, host) => {
    try {
      const res = await fetch("/api/settings/ssh/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId, host }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Test failed" };
    }
  },

  handleSessionStart: (data) => {
    const session: SshSession = {
      id: data.sessionId,
      sshKeyId: data.keyId,
      host: data.host,
      username: data.username,
      status: "active",
      startedAt: new Date().toISOString(),
      completedAt: null,
      initiatedBy: "user",
    };
    set((s) => ({
      sessions: [session, ...s.sessions],
      selectedSessionId: data.sessionId,
    }));
  },

  handleSessionEnd: (data) => {
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === data.sessionId
          ? { ...session, status: data.status as SshSession["status"], completedAt: new Date().toISOString() }
          : session,
      ),
    }));
  },
}));
