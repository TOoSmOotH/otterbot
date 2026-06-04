import { create } from "zustand";
import type { CodingSessionInfo } from "@otterbot/shared";
import { apiFetch } from "../lib/api";
import { getSocket } from "../lib/socket";

/**
 * Live coding-CLI sessions across all agents, for the Activity view's "Live
 * coding sessions" list. Seeded from `GET /api/coding-sessions`, then kept
 * current by the `coding:started` / `coding:ended` socket events.
 */
interface CodingSessionsState {
  sessions: CodingSessionInfo[];
  socketBound: boolean;
  load: () => Promise<void>;
  bindSocket: () => void;
}

export const useCodingSessionsStore = create<CodingSessionsState>((set, get) => ({
  sessions: [],
  socketBound: false,

  load: async () => {
    const res = await apiFetch("/api/coding-sessions");
    if (res.ok) set({ sessions: (await res.json()) as CodingSessionInfo[] });
  },

  bindSocket: () => {
    if (get().socketBound) return;
    set({ socketBound: true });
    const socket = getSocket();
    socket.on("coding:started", (s: CodingSessionInfo) => {
      set((st) => ({
        sessions: [s, ...st.sessions.filter((x) => x.agentId !== s.agentId)],
      }));
    });
    socket.on("coding:ended", (p: { agentId: string }) => {
      set((st) => ({ sessions: st.sessions.filter((x) => x.agentId !== p.agentId) }));
    });
  },
}));
