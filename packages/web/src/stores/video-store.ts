import { create } from "zustand";
import type { VideoManifest } from "@otterbot/shared";

interface VideoState {
  videos: VideoManifest[];
  loading: boolean;
  error: string | null;
  selectedVideoId: string | null;

  loadVideos: (projectId?: string) => Promise<void>;
  deleteVideo: (projectId: string, videoId: string) => Promise<boolean>;

  // Socket-driven state updaters
  addVideo: (video: VideoManifest) => void;
  updateVideo: (video: VideoManifest) => void;
  removeVideo: (videoId: string) => void;

  setSelectedVideoId: (id: string | null) => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  videos: [],
  loading: false,
  error: null,
  selectedVideoId: null,

  loadVideos: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const qs = projectId ? `?projectId=${projectId}` : "";
      const res = await fetch(`/api/videos${qs}`);
      if (!res.ok) throw new Error("Failed to load videos");
      const data = await res.json();
      set({ videos: data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  deleteVideo: async (projectId, videoId) => {
    try {
      const res = await fetch(`/api/videos/${projectId}/${videoId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete video");
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  addVideo: (video) => {
    set((state) => {
      if (state.videos.some((v) => v.id === video.id)) return state;
      return { videos: [...state.videos, video] };
    });
  },

  updateVideo: (video) => {
    set((state) => ({
      videos: state.videos.map((v) => (v.id === video.id ? video : v)),
    }));
  },

  removeVideo: (videoId) => {
    set((state) => ({
      videos: state.videos.filter((v) => v.id !== videoId),
      selectedVideoId:
        state.selectedVideoId === videoId ? null : state.selectedVideoId,
    }));
  },

  setSelectedVideoId: (id) => set({ selectedVideoId: id }),
}));
