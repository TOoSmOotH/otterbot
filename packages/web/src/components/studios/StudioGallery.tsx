import { useEffect, useState, type ReactNode } from "react";
import { useProjectStore } from "../../stores/project-store";
import { AssetProgressBar } from "./AssetProgressBar";

/** Badge with label and Tailwind className */
export interface StudioBadge {
  label: string;
  className: string;
}

/** Filter option for the filter bar */
export interface FilterOption {
  key: string;
  label: string;
}

/** Configuration object that parameterizes the generic gallery for a specific studio type */
export interface StudioGalleryConfig<T> {
  /** Display label, e.g. "Game Studio" */
  studioLabel: string;
  /** Singular entity name, e.g. "game" */
  entityName: string;
  /** Plural entity name, e.g. "games" */
  entityNamePlural: string;

  // --- Data hooks ---
  useItems: () => T[];
  useLoading: () => boolean;
  loadItems: (projectId?: string) => Promise<void>;
  loadTemplates?: () => Promise<void>;
  deleteItem: (projectId: string, itemId: string) => Promise<boolean>;

  // --- Item accessors ---
  getId: (item: T) => string;
  getProjectId: (item: T) => string;
  getName: (item: T) => string;
  getDescription: (item: T) => string | undefined;
  getTags: (item: T) => string[];
  getUpdatedAt: (item: T) => string;

  // --- Badges ---
  getCategoryBadge: (item: T) => StudioBadge | null;
  getStatusBadge: (item: T) => StudioBadge;

  // --- Thumbnail ---
  renderThumbnail: (item: T) => ReactNode;

  // --- Filter bar (optional) ---
  filterOptions?: FilterOption[];
  getFilterValue?: (item: T) => string;

  // --- Primary action (preview/play/view) ---
  /** Statuses that enable the primary action overlay */
  actionableStatuses: string[];
  /** Label shown on the overlay button, e.g. "Play", "Preview", "View" */
  actionLabel: string;
  /** Returns the iframe src when in fullscreen mode; if undefined, uses detail renderer */
  getIframeSrc?: (item: T) => string;
  /** Opens item in new tab URL */
  getNewTabUrl?: (item: T) => string;
  /** Custom detail view renderer (used instead of iframe, e.g. for Video storyboard) */
  renderDetailView?: (item: T, onBack: () => void, onDelete: (item: T) => void) => ReactNode;

  // --- Empty state ---
  emptyHint: string;
  emptyExamples: string;

  /** Show sidecar health indicators in the gallery header */
  showSidecarStatus?: boolean;
}

interface SidecarStatus {
  providers: { image: string; model: string; sound: string };
  sidecars: {
    comfyui: { configured: boolean; reachable: boolean };
    trellis: { configured: boolean; reachable: boolean };
  };
}

function SidecarStatusBar() {
  const [status, setStatus] = useState<SidecarStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = () =>
      fetch("/api/asset-status")
        .then((r) => r.json())
        .then((data: SidecarStatus) => { if (mounted) setStatus(data); })
        .catch(() => {});
    load();
    const interval = setInterval(load, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (!status) return null;

  const pills: { label: string; color: string }[] = [];

  if (status.sidecars.comfyui.configured) {
    pills.push(status.sidecars.comfyui.reachable
      ? { label: "ComfyUI", color: "bg-emerald-500" }
      : { label: "ComfyUI offline", color: "bg-yellow-500" });
  }
  if (status.sidecars.trellis.configured) {
    pills.push(status.sidecars.trellis.reachable
      ? { label: "Trellis", color: "bg-emerald-500" }
      : { label: "Trellis offline", color: "bg-yellow-500" });
  }
  if (pills.length === 0) {
    pills.push({ label: "Procedural only", color: "bg-zinc-500" });
  }

  return (
    <div className="flex items-center gap-2">
      {pills.map((pill) => (
        <span key={pill.label} className="flex items-center gap-1 text-[10px] text-zinc-400">
          <span className={`w-1.5 h-1.5 rounded-full ${pill.color}`} />
          {pill.label}
        </span>
      ))}
    </div>
  );
}

export function StudioGallery<T>({ config }: { config: StudioGalleryConfig<T> }) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const items = config.useItems();
  const loading = config.useLoading();
  const [filter, setFilter] = useState<string>("");
  const [activeItem, setActiveItem] = useState<T | null>(null);

  useEffect(() => {
    config.loadItems(activeProjectId ?? undefined);
    config.loadTemplates?.();
  }, [activeProjectId]);

  // Keep active item in sync with store updates
  useEffect(() => {
    if (activeItem) {
      const updated = items.find((it) => config.getId(it) === config.getId(activeItem));
      if (updated) setActiveItem(updated);
      else setActiveItem(null);
    }
  }, [items, activeItem ? config.getId(activeItem) : null]);

  const filteredItems = filter && config.getFilterValue
    ? items.filter((it) => config.getFilterValue!(it) === filter)
    : items;

  const handleAction = (item: T) => {
    setActiveItem(item);
  };

  const handleDelete = async (item: T) => {
    if (!confirm(`Delete "${config.getName(item)}"? This cannot be undone.`)) return;
    const id = config.getId(item);
    await config.deleteItem(config.getProjectId(item), id);
    if (activeItem && config.getId(activeItem) === id) setActiveItem(null);
    config.loadItems();
  };

  const handleBack = () => {
    setActiveItem(null);
  };

  // --- Detail / fullscreen view ---
  if (activeItem) {
    // Custom detail renderer (e.g. Video storyboard)
    if (config.renderDetailView) {
      return config.renderDetailView(activeItem, handleBack, handleDelete);
    }

    // Iframe-based preview/play (Game, App)
    const iframeSrc = config.getIframeSrc?.(activeItem);
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/80 border-b border-zinc-700/50">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="text-zinc-400 hover:text-zinc-200 text-sm"
            >
              &larr; Back
            </button>
            <span className="text-sm text-zinc-200 font-medium">{config.getName(activeItem)}</span>
            {config.getCategoryBadge(activeItem) && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${config.getCategoryBadge(activeItem)!.className}`}>
                {config.getCategoryBadge(activeItem)!.label}
              </span>
            )}
          </div>
          {config.getNewTabUrl && (
            <button
              onClick={() => window.open(config.getNewTabUrl!(activeItem), "_blank")}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Open in new tab
            </button>
          )}
        </div>
        <div className="flex-1">
          {iframeSrc && (
            <iframe
              src={iframeSrc}
              className="w-full h-full border-0"
              title={config.getName(activeItem)}
            />
          )}
        </div>
      </div>
    );
  }

  // --- Gallery view ---
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">{config.studioLabel}</h2>
          <span className="text-xs text-zinc-500">
            {items.length} {items.length !== 1 ? config.entityNamePlural : config.entityName}
          </span>
          {config.showSidecarStatus && <SidecarStatusBar />}
          {config.showSidecarStatus && <AssetProgressBar />}
        </div>

        {/* Filter bar */}
        {config.filterOptions && config.filterOptions.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilter("")}
              className={`text-xs px-2 py-1 rounded ${!filter ? "bg-zinc-700 text-zinc-200" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              All
            </button>
            {config.filterOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key === filter ? "" : opt.key)}
                className={`text-xs px-2 py-1 rounded ${filter === opt.key ? "bg-zinc-700 text-zinc-200" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
            Loading {config.entityNamePlural}...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-500 space-y-3">
            <div className="text-4xl opacity-30">
              {filter && config.filterOptions
                ? (config.filterOptions.find((o) => o.key === filter)?.label ?? filter)
                : config.studioLabel}
            </div>
            <p className="text-sm">
              {filter && config.filterOptions
                ? `No ${config.filterOptions.find((o) => o.key === filter)?.label ?? filter} ${config.entityNamePlural} yet.`
                : config.emptyHint}
            </p>
            <p className="text-xs text-zinc-600 max-w-md text-center">
              {config.emptyExamples}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredItems.map((item) => (
              <StudioCard
                key={config.getId(item)}
                item={item}
                config={config}
                onAction={handleAction}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Generic card component used inside StudioGallery */
function StudioCard<T>({
  item,
  config,
  onAction,
  onDelete,
}: {
  item: T;
  config: StudioGalleryConfig<T>;
  onAction: (item: T) => void;
  onDelete: (item: T) => void;
}) {
  const status = config.getStatusBadge(item);
  const isActionable = config.actionableStatuses.includes(status.label);

  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg overflow-hidden hover:border-zinc-600/50 transition-colors group">
      {/* Thumbnail area */}
      <div
        className="h-36 bg-zinc-900 flex items-center justify-center relative cursor-pointer"
        onClick={() => onAction(item)}
      >
        {config.renderThumbnail(item)}
        {isActionable && (
          <button
            onClick={(e) => { e.stopPropagation(); onAction(item); }}
            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <span className="text-white text-lg font-medium">{config.actionLabel}</span>
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-200 truncate">{config.getName(item)}</h3>
          <button
            onClick={() => onDelete(item)}
            className="text-zinc-500 hover:text-red-400 shrink-0 text-xs"
            title={`Delete ${config.entityName}`}
          >
            &times;
          </button>
        </div>

        {config.getDescription(item) && (
          <p className="text-xs text-zinc-400 line-clamp-2">{config.getDescription(item)}</p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          {config.getCategoryBadge(item) && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${config.getCategoryBadge(item)!.className}`}>
              {config.getCategoryBadge(item)!.label}
            </span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${status.className}`}>
            {status.label}
          </span>
        </div>

        {config.getTags(item).length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {config.getTags(item).map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="text-[10px] text-zinc-500">
          {new Date(config.getUpdatedAt(item)).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
