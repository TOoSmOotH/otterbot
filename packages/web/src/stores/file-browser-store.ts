import { create } from "zustand";
import type { FileEntry } from "@smoothbot/shared";

interface PreviewFile {
  name: string;
  path: string;
  content: string;
  truncated: boolean;
  size: number;
}

interface FileBrowserState {
  currentPath: string;
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  previewFile: PreviewFile | null;
  previewLoading: boolean;

  navigateTo: (projectId: string, path: string) => Promise<void>;
  navigateUp: (projectId: string) => Promise<void>;
  openPreview: (projectId: string, filePath: string, fileName: string) => Promise<void>;
  closePreview: () => void;
  reset: () => void;
}

export const useFileBrowserStore = create<FileBrowserState>((set, get) => ({
  currentPath: "",
  entries: [],
  loading: false,
  error: null,
  previewFile: null,
  previewLoading: false,

  navigateTo: async (projectId, path) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(
        `/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        set({ loading: false, error: body.error ?? "Request failed" });
        return;
      }
      const data = await res.json();
      set({ currentPath: path, entries: data.entries, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  navigateUp: async (projectId) => {
    const { currentPath } = get();
    const segments = currentPath.split("/").filter(Boolean);
    segments.pop();
    const parentPath = segments.join("/");
    await get().navigateTo(projectId, parentPath);
  },

  openPreview: async (projectId, filePath, fileName) => {
    set({ previewLoading: true });
    try {
      const res = await fetch(
        `/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`,
      );
      if (!res.ok) {
        // Fallback: trigger download instead
        window.open(
          `/api/projects/${projectId}/files/download?path=${encodeURIComponent(filePath)}`,
          "_blank",
        );
        set({ previewLoading: false });
        return;
      }
      const data = await res.json();
      set({
        previewFile: {
          name: fileName,
          path: filePath,
          content: data.content,
          truncated: data.truncated,
          size: data.size,
        },
        previewLoading: false,
      });
    } catch {
      set({ previewLoading: false });
    }
  },

  closePreview: () => set({ previewFile: null }),

  reset: () =>
    set({
      currentPath: "",
      entries: [],
      loading: false,
      error: null,
      previewFile: null,
      previewLoading: false,
    }),
}));
