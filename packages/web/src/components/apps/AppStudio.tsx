import { useEffect, useState } from "react";
import { useAppStore } from "../../stores/app-store";
import { useProjectStore } from "../../stores/project-store";
import type { AppManifest } from "@otterbot/shared";

const FRAMEWORK_LABELS: Record<string, string> = {
  html: "HTML",
  react: "React",
  nextjs: "Next.js",
  astro: "Astro",
  vue: "Vue",
  custom: "Custom",
};

const FRAMEWORK_COLORS: Record<string, string> = {
  html: "bg-orange-500/20 text-orange-400",
  react: "bg-sky-500/20 text-sky-400",
  nextjs: "bg-zinc-500/20 text-zinc-300",
  astro: "bg-purple-500/20 text-purple-400",
  vue: "bg-emerald-500/20 text-emerald-400",
  custom: "bg-zinc-500/20 text-zinc-400",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/20 text-zinc-400",
  building: "bg-yellow-500/20 text-yellow-400",
  preview: "bg-emerald-500/20 text-emerald-400",
  testing: "bg-blue-500/20 text-blue-400",
  deployed: "bg-violet-500/20 text-violet-400",
};

function AppCard({ app, onPreview, onDelete }: {
  app: AppManifest;
  onPreview: (app: AppManifest) => void;
  onDelete: (app: AppManifest) => void;
}) {
  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg overflow-hidden hover:border-zinc-600/50 transition-colors group">
      {/* Thumbnail area */}
      <div className="h-36 bg-zinc-900 flex items-center justify-center relative">
        <div className="text-4xl opacity-30">
          {FRAMEWORK_LABELS[app.framework] ?? app.framework}
        </div>
        {app.status === "preview" || app.status === "deployed" ? (
          <button
            onClick={() => onPreview(app)}
            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <span className="text-white text-lg font-medium">Preview</span>
          </button>
        ) : null}
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-200 truncate">{app.name}</h3>
          <button
            onClick={() => onDelete(app)}
            className="text-zinc-500 hover:text-red-400 shrink-0 text-xs"
            title="Delete app"
          >
            &times;
          </button>
        </div>

        {app.description && (
          <p className="text-xs text-zinc-400 line-clamp-2">{app.description}</p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${FRAMEWORK_COLORS[app.framework] ?? FRAMEWORK_COLORS.custom}`}>
            {FRAMEWORK_LABELS[app.framework] ?? app.framework}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[app.status] ?? STATUS_COLORS.draft}`}>
            {app.status}
          </span>
        </div>

        {app.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {app.tags.map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="text-[10px] text-zinc-500">
          {new Date(app.updatedAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}

export function AppStudio() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const apps = useAppStore((s) => s.apps);
  const loading = useAppStore((s) => s.loading);
  const loadApps = useAppStore((s) => s.loadApps);
  const loadTemplates = useAppStore((s) => s.loadTemplates);
  const deleteApp = useAppStore((s) => s.deleteApp);
  const [filterFramework, setFilterFramework] = useState<string>("");
  const [previewingApp, setPreviewingApp] = useState<AppManifest | null>(null);

  useEffect(() => {
    loadApps(activeProjectId ?? undefined);
    loadTemplates();
  }, [loadApps, loadTemplates, activeProjectId]);

  const filteredApps = filterFramework
    ? apps.filter((a) => a.framework === filterFramework)
    : apps;

  const handlePreview = (app: AppManifest) => {
    setPreviewingApp(app);
  };

  const handleDelete = async (app: AppManifest) => {
    if (!confirm(`Delete "${app.name}"? This cannot be undone.`)) return;
    await deleteApp(app.projectId, app.id);
    loadApps();
  };

  const handleClosePreview = () => {
    setPreviewingApp(null);
  };

  // Full-screen app preview
  if (previewingApp) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/80 border-b border-zinc-700/50">
          <div className="flex items-center gap-3">
            <button
              onClick={handleClosePreview}
              className="text-zinc-400 hover:text-zinc-200 text-sm"
            >
              &larr; Back
            </button>
            <span className="text-sm text-zinc-200 font-medium">{previewingApp.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${FRAMEWORK_COLORS[previewingApp.framework] ?? FRAMEWORK_COLORS.custom}`}>
              {FRAMEWORK_LABELS[previewingApp.framework] ?? previewingApp.framework}
            </span>
          </div>
          <button
            onClick={() => {
              const url = `/api/apps/${previewingApp.projectId}/${previewingApp.id}/preview/index.html`;
              window.open(url, "_blank");
            }}
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            Open in new tab
          </button>
        </div>
        <div className="flex-1">
          <iframe
            src={`/api/apps/${previewingApp.projectId}/${previewingApp.id}/preview/index.html`}
            className="w-full h-full border-0"
            title={previewingApp.name}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">App Studio</h2>
          <span className="text-xs text-zinc-500">{apps.length} app{apps.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Framework filter */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilterFramework("")}
            className={`text-xs px-2 py-1 rounded ${!filterFramework ? "bg-zinc-700 text-zinc-200" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            All
          </button>
          {Object.entries(FRAMEWORK_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterFramework(key === filterFramework ? "" : key)}
              className={`text-xs px-2 py-1 rounded ${filterFramework === key ? "bg-zinc-700 text-zinc-200" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
            Loading apps...
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-500 space-y-3">
            <div className="text-4xl opacity-30">
              {filterFramework ? (
                FRAMEWORK_LABELS[filterFramework] ?? filterFramework
              ) : (
                "App Studio"
              )}
            </div>
            <p className="text-sm">
              {filterFramework
                ? `No ${FRAMEWORK_LABELS[filterFramework]} apps yet.`
                : "No apps yet. Ask your agents to create one!"}
            </p>
            <p className="text-xs text-zinc-600 max-w-md text-center">
              Try: &quot;Build a React dashboard for my project metrics&quot; or
              &quot;Create an HTML landing page for my product&quot;
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredApps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                onPreview={handlePreview}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
