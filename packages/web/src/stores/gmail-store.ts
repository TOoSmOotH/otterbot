import { create } from "zustand";
import type { EmailSummary, EmailDetail } from "@otterbot/shared";

interface GmailState {
  messages: EmailSummary[];
  selectedMessage: EmailDetail | null;
  loading: boolean;
  loadingDetail: boolean;
  error: string | null;
  nextPageToken: string | null;

  loadMessages: (query?: string) => Promise<void>;
  loadMore: () => Promise<void>;
  readMessage: (id: string) => Promise<void>;
  clearSelection: () => void;
  sendEmail: (data: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
  }) => Promise<boolean>;
  archiveMessage: (id: string) => Promise<boolean>;
}

export const useGmailStore = create<GmailState>((set, get) => ({
  messages: [],
  selectedMessage: null,
  loading: false,
  loadingDetail: false,
  error: null,
  nextPageToken: null,

  loadMessages: async (query) => {
    set({ loading: true, error: null, messages: [], nextPageToken: null });
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("maxResults", "20");
      const res = await fetch(`/api/gmail/messages?${params}`);
      if (!res.ok) throw new Error("Failed to load emails");
      const data = await res.json();
      set({
        messages: data.messages,
        nextPageToken: data.nextPageToken,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  loadMore: async () => {
    const { nextPageToken } = get();
    if (!nextPageToken) return;
    try {
      const params = new URLSearchParams();
      params.set("pageToken", nextPageToken);
      params.set("maxResults", "20");
      const res = await fetch(`/api/gmail/messages?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      set((s) => ({
        messages: [...s.messages, ...data.messages],
        nextPageToken: data.nextPageToken,
      }));
    } catch {
      // Silently fail
    }
  },

  readMessage: async (id) => {
    set({ loadingDetail: true, error: null });
    try {
      const res = await fetch(`/api/gmail/messages/${id}`);
      if (!res.ok) throw new Error("Failed to read email");
      const email = await res.json();
      set({ selectedMessage: email, loadingDetail: false });
    } catch (err) {
      set({
        loadingDetail: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  clearSelection: () => set({ selectedMessage: null }),

  sendEmail: async (data) => {
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to send email");
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  archiveMessage: async (id) => {
    try {
      const res = await fetch(`/api/gmail/messages/${id}/archive`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to archive");
      // Remove from list
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== id),
        selectedMessage: s.selectedMessage?.id === id ? null : s.selectedMessage,
      }));
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },
}));
