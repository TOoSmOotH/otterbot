import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { VideoManifest, VideoScene, VideoAspectRatio } from "@otterbot/shared";

export function createVideo(workspacePath: string, opts: {
  name: string;
  description?: string;
  aspectRatio?: VideoAspectRatio;
  resolution?: "720p" | "1080p";
  projectId: string;
}): VideoManifest {
  const id = nanoid(12);
  const videoDir = path.join(workspacePath, "videos", id);
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(path.join(videoDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(videoDir, "clips"), { recursive: true });

  const manifest: VideoManifest = {
    id,
    name: opts.name,
    description: opts.description ?? "",
    aspectRatio: opts.aspectRatio ?? "16:9",
    resolution: opts.resolution ?? "1080p",
    scenes: [],
    status: "draft",
    projectId: opts.projectId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(videoDir, "video.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function listVideos(workspacePath: string, projectId?: string): VideoManifest[] {
  const videosDir = path.join(workspacePath, "videos");
  if (!fs.existsSync(videosDir)) return [];

  const entries = fs.readdirSync(videosDir, { withFileTypes: true });
  const manifests: VideoManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(videosDir, entry.name, "video.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as VideoManifest;
      if (!projectId || data.projectId === projectId) {
        manifests.push(data);
      }
    } catch {
      // Skip malformed manifests
    }
  }

  return manifests;
}

export function getVideo(workspacePath: string, videoId: string): VideoManifest | null {
  const manifestPath = path.join(workspacePath, "videos", videoId, "video.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as VideoManifest;
  } catch {
    return null;
  }
}

export function addScene(workspacePath: string, videoId: string, scene: VideoScene): VideoManifest {
  const manifest = getVideo(workspacePath, videoId);
  if (!manifest) throw new Error(`Video ${videoId} not found`);

  manifest.scenes.push(scene);
  manifest.updatedAt = new Date().toISOString();

  const manifestPath = path.join(workspacePath, "videos", videoId, "video.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function removeScene(workspacePath: string, videoId: string, sceneId: string): VideoManifest {
  const manifest = getVideo(workspacePath, videoId);
  if (!manifest) throw new Error(`Video ${videoId} not found`);

  manifest.scenes = manifest.scenes.filter((s) => s.id !== sceneId);
  manifest.updatedAt = new Date().toISOString();

  const manifestPath = path.join(workspacePath, "videos", videoId, "video.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function updateManifest(workspacePath: string, videoId: string, updates: Partial<VideoManifest>): VideoManifest {
  const manifest = getVideo(workspacePath, videoId);
  if (!manifest) throw new Error(`Video ${videoId} not found`);

  Object.assign(manifest, updates, { updatedAt: new Date().toISOString() });

  const manifestPath = path.join(workspacePath, "videos", videoId, "video.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function deleteVideo(workspacePath: string, videoId: string): boolean {
  const videoDir = path.join(workspacePath, "videos", videoId);
  if (!fs.existsSync(videoDir)) return false;
  fs.rmSync(videoDir, { recursive: true, force: true });
  return true;
}

/** Get the absolute path to a video's directory */
export function getVideoDir(workspacePath: string, videoId: string): string {
  return path.join(workspacePath, "videos", videoId);
}
