import { create } from "zustand";
import type { VideoManifest } from "@otterbot/shared";
import {
  createLoadItems,
  createDeleteItem,
  createAddItem,
  createUpdateItem,
  createRemoveItem,
} from "./create-studio-store";

const config = { apiPath: "/api/videos" };

interface VideoState {
  videos: VideoManifest[];
  loading: boolean;
  error: string | null;
  selectedVideoId: string | null;

  loadVideos: (projectId?: string) => Promise<void>;
  deleteVideo: (projectId: string, videoId: string) => Promise<boolean>;

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

  loadVideos: createLoadItems<VideoManifest>(config, set as any, "videos"),
  deleteVideo: createDeleteItem(config, set as any),

  addVideo: (video) => set((state) => createAddItem<VideoManifest>("videos")(video, state as any) as any),
  updateVideo: (video) => set((state) => createUpdateItem<VideoManifest>("videos")(video, state as any) as any),
  removeVideo: (videoId) => set((state) => createRemoveItem<VideoManifest>("videos", "selectedVideoId")(videoId, state as any) as any),

  setSelectedVideoId: (id) => set({ selectedVideoId: id }),
}));
