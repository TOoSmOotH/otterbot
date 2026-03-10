import { create } from "zustand";

export interface Release {
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  url: string;
  prerelease: boolean;
}

interface WhatsNewState {
  releases: Release[];
  loading: boolean;
  error: string | null;
  lastSeenTag: string | null;
  /** Number of releases newer than the last-seen tag */
  unreadCount: number;
  fetchReleases: () => Promise<void>;
  markAllRead: () => void;
}

function getLastSeenTag(): string | null {
  return localStorage.getItem("otterbot-whats-new-seen") ?? null;
}

function computeUnread(releases: Release[], lastSeenTag: string | null): number {
  if (!lastSeenTag || releases.length === 0) return releases.length > 0 ? releases.length : 0;
  const idx = releases.findIndex((r) => r.tag === lastSeenTag);
  if (idx === -1) return releases.length; // tag not found → all are "new"
  return idx; // releases before that index are newer
}

export const useWhatsNewStore = create<WhatsNewState>((set, get) => ({
  releases: [],
  loading: false,
  error: null,
  lastSeenTag: getLastSeenTag(),
  unreadCount: 0,

  fetchReleases: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/releases");
      if (!res.ok) throw new Error("Failed to fetch releases");
      const data = await res.json();
      const releases: Release[] = data.releases ?? [];
      const lastSeenTag = get().lastSeenTag;
      set({
        releases,
        loading: false,
        unreadCount: computeUnread(releases, lastSeenTag),
      });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  markAllRead: () => {
    const { releases } = get();
    if (releases.length > 0) {
      const latestTag = releases[0].tag;
      localStorage.setItem("otterbot-whats-new-seen", latestTag);
      set({ lastSeenTag: latestTag, unreadCount: 0 });
    }
  },
}));
