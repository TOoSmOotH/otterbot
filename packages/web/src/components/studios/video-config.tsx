import type { VideoManifest, VideoScene } from "@otterbot/shared";
import { useVideoStore } from "../../stores/video-store";
import type { StudioGalleryConfig } from "./StudioGallery";

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

function VideoDetailView({
  video,
  onBack,
  onDelete,
}: {
  video: VideoManifest;
  onBack: () => void;
  onDelete: (video: VideoManifest) => void;
}) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/80 border-b border-zinc-700/50">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-zinc-400 hover:text-zinc-200 text-sm"
          >
            &larr; Back
          </button>
          <span className="text-sm text-zinc-200 font-medium">{video.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ASPECT_RATIO_COLORS[video.aspectRatio] ?? "bg-zinc-500/20 text-zinc-400"}`}>
            {video.aspectRatio}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[video.status] ?? STATUS_COLORS.draft}`}>
            {video.status}
          </span>
        </div>
        <button
          onClick={() => onDelete(video)}
          className="text-xs text-zinc-400 hover:text-red-400"
        >
          Delete
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {video.description && (
          <p className="text-sm text-zinc-400">{video.description}</p>
        )}

        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{video.resolution}</span>
          {video.duration && <span>{video.duration}s total</span>}
          <span>{video.scenes.length} scene{video.scenes.length !== 1 ? "s" : ""}</span>
        </div>

        {video.outputPath && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-300">Output</h3>
            <video
              src={`/api/videos/${video.projectId}/${video.id}/output`}
              controls
              className="w-full max-w-2xl rounded-lg border border-zinc-700/50 bg-black"
            />
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-300">
            Scenes ({video.scenes.length})
          </h3>
          {video.scenes.length === 0 ? (
            <p className="text-xs text-zinc-500">No scenes yet.</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {video.scenes.map((scene, i) => (
                <SceneCard key={scene.id} scene={scene} index={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const videoConfig: StudioGalleryConfig<VideoManifest> = {
  studioLabel: "Video Studio",
  entityName: "video",
  entityNamePlural: "videos",

  useItems: () => useVideoStore((s) => s.videos),
  useLoading: () => useVideoStore((s) => s.loading),
  loadItems: (projectId) => useVideoStore.getState().loadVideos(projectId),
  deleteItem: (projectId, id) => useVideoStore.getState().deleteVideo(projectId, id),

  getId: (v) => v.id,
  getProjectId: (v) => v.projectId,
  getName: (v) => v.name,
  getDescription: (v) => v.description || undefined,
  getTags: () => [],
  getUpdatedAt: (v) => v.updatedAt,

  getCategoryBadge: (v) => ({
    label: v.aspectRatio,
    className: ASPECT_RATIO_COLORS[v.aspectRatio] ?? "bg-zinc-500/20 text-zinc-400",
  }),
  getStatusBadge: (v) => ({
    label: v.status,
    className: STATUS_COLORS[v.status] ?? STATUS_COLORS.draft,
  }),

  renderThumbnail: (v) => (
    <div className="text-4xl opacity-30">{v.aspectRatio}</div>
  ),

  actionableStatuses: ["draft", "scripting", "recording", "compositing", "complete", "failed"],
  actionLabel: "View",

  renderDetailView: (video, onBack, onDelete) => (
    <VideoDetailView video={video} onBack={onBack} onDelete={onDelete} />
  ),

  emptyHint: "No videos yet. Ask your agents to create one!",
  emptyExamples:
    'Try: "Create a product demo video with screen recordings" or "Make a presentation video from my slides"',

  showSidecarStatus: true,
};
