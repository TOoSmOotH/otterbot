import { useEffect, useState } from "react";
import { useVideoStore } from "../../stores/video-store";
import { useProjectStore } from "../../stores/project-store";
import type { VideoManifest, VideoScene } from "@otterbot/shared";

const ASPECT_RATIO_COLORS: Record<string, string> = {
  "16:9": "bg-blue-500/20 text-blue-400",
  "9:16": "bg-pink-500/20 text-pink-400",
  "1:1": "bg-yellow-500/20 text-yellow-400",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/20 text-zinc-400",
  scripting: "bg-yellow-500/20 text-yellow-400",
  recording: "bg-orange-500/20 text-orange-400",
  compositing: "bg-blue-500/20 text-blue-400",
  complete: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
};

function SceneCard({ scene, index }: { scene: VideoScene; index: number }) {
  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-2 min-w-[140px] space-y-1.5">
      {/* Scene thumbnail area */}
      <div className="h-20 bg-zinc-900 rounded flex items-center justify-center">
        {scene.type === "slide" ? (
          <div className="text-[10px] text-zinc-500 text-center px-1">
            {scene.textOverlay ? (
              <span className="line-clamp-3">{scene.textOverlay}</span>
            ) : (
              "Slide"
            )}
          </div>
        ) : scene.type === "screen-record" ? (
          <div className="text-[10px] text-zinc-500 text-center px-1 truncate">
            {scene.url}
          </div>
        ) : scene.type === "title" ? (
          <div className="text-[10px] text-zinc-400 text-center px-1 font-medium">
            <div className="line-clamp-2">{scene.text}</div>
            {scene.subtitle && (
              <div className="text-zinc-500 line-clamp-1 mt-0.5">{scene.subtitle}</div>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500">#{index + 1}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400">
          {scene.type}
        </span>
      </div>

      {scene.duration && (
        <div className="text-[10px] text-zinc-500">{scene.duration}s</div>
      )}
    </div>
  );
}

function VideoCard({ video, onSelect, onDelete }: {
  video: VideoManifest;
  onSelect: (video: VideoManifest) => void;
  onDelete: (video: VideoManifest) => void;
}) {
  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg overflow-hidden hover:border-zinc-600/50 transition-colors group">
      {/* Thumbnail area */}
      <div
        className="h-36 bg-zinc-900 flex items-center justify-center relative cursor-pointer"
        onClick={() => onSelect(video)}
      >
        <div className="text-4xl opacity-30">
          {video.aspectRatio}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(video); }}
          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <span className="text-white text-lg font-medium">View</span>
        </button>
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-200 truncate">{video.name}</h3>
          <button
            onClick={() => onDelete(video)}
            className="text-zinc-500 hover:text-red-400 shrink-0 text-xs"
            title="Delete video"
          >
            &times;
          </button>
        </div>

        {video.description && (
          <p className="text-xs text-zinc-400 line-clamp-2">{video.description}</p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ASPECT_RATIO_COLORS[video.aspectRatio] ?? "bg-zinc-500/20 text-zinc-400"}`}>
            {video.aspectRatio}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[video.status] ?? STATUS_COLORS.draft}`}>
            {video.status}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400">
            {video.scenes.length} scene{video.scenes.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="text-[10px] text-zinc-500">
          {new Date(video.updatedAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}

export function VideoStudio() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const videos = useVideoStore((s) => s.videos);
  const loading = useVideoStore((s) => s.loading);
  const loadVideos = useVideoStore((s) => s.loadVideos);
  const deleteVideo = useVideoStore((s) => s.deleteVideo);
  const [selectedVideo, setSelectedVideo] = useState<VideoManifest | null>(null);

  useEffect(() => {
    loadVideos(activeProjectId ?? undefined);
  }, [loadVideos, activeProjectId]);

  // Keep selected video in sync with store updates
  useEffect(() => {
    if (selectedVideo) {
      const updated = videos.find((v) => v.id === selectedVideo.id);
      if (updated) setSelectedVideo(updated);
      else setSelectedVideo(null);
    }
  }, [videos, selectedVideo?.id]);

  const handleSelect = (video: VideoManifest) => {
    setSelectedVideo(video);
  };

  const handleDelete = async (video: VideoManifest) => {
    if (!confirm(`Delete "${video.name}"? This cannot be undone.`)) return;
    await deleteVideo(video.projectId, video.id);
    if (selectedVideo?.id === video.id) setSelectedVideo(null);
    loadVideos();
  };

  const handleBack = () => {
    setSelectedVideo(null);
  };

  // Detail view for a selected video
  if (selectedVideo) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/80 border-b border-zinc-700/50">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="text-zinc-400 hover:text-zinc-200 text-sm"
            >
              &larr; Back
            </button>
            <span className="text-sm text-zinc-200 font-medium">{selectedVideo.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ASPECT_RATIO_COLORS[selectedVideo.aspectRatio] ?? "bg-zinc-500/20 text-zinc-400"}`}>
              {selectedVideo.aspectRatio}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[selectedVideo.status] ?? STATUS_COLORS.draft}`}>
              {selectedVideo.status}
            </span>
          </div>
          <button
            onClick={() => handleDelete(selectedVideo)}
            className="text-xs text-zinc-400 hover:text-red-400"
          >
            Delete
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Video description */}
          {selectedVideo.description && (
            <p className="text-sm text-zinc-400">{selectedVideo.description}</p>
          )}

          {/* Video info */}
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{selectedVideo.resolution}</span>
            {selectedVideo.duration && <span>{selectedVideo.duration}s total</span>}
            <span>{selectedVideo.scenes.length} scene{selectedVideo.scenes.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Video player */}
          {selectedVideo.outputPath && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-zinc-300">Output</h3>
              <video
                src={`/api/videos/${selectedVideo.projectId}/${selectedVideo.id}/output`}
                controls
                className="w-full max-w-2xl rounded-lg border border-zinc-700/50 bg-black"
              />
            </div>
          )}

          {/* Scene storyboard */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-300">
              Scenes ({selectedVideo.scenes.length})
            </h3>
            {selectedVideo.scenes.length === 0 ? (
              <p className="text-xs text-zinc-500">No scenes yet.</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {selectedVideo.scenes.map((scene, i) => (
                  <SceneCard key={scene.id} scene={scene} index={i} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">Video Studio</h2>
          <span className="text-xs text-zinc-500">{videos.length} video{videos.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
            Loading videos...
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-500 space-y-3">
            <div className="text-4xl opacity-30">Video Studio</div>
            <p className="text-sm">No videos yet. Ask your agents to create one!</p>
            <p className="text-xs text-zinc-600 max-w-md text-center">
              Try: &quot;Create a product demo video with screen recordings&quot; or
              &quot;Make a presentation video from my slides&quot;
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                onSelect={handleSelect}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
