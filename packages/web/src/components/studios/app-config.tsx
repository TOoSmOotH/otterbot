import type { AppManifest } from "@otterbot/shared";
import { useAppStore } from "../../stores/app-store";
import type { StudioGalleryConfig } from "./StudioGallery";

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

export const appConfig: StudioGalleryConfig<AppManifest> = {
  studioLabel: "App Studio",
  entityName: "app",
  entityNamePlural: "apps",

  useItems: () => useAppStore((s) => s.apps),
  useLoading: () => useAppStore((s) => s.loading),
  loadItems: (projectId) => useAppStore.getState().loadApps(projectId),
  loadTemplates: () => useAppStore.getState().loadTemplates(),
  deleteItem: (projectId, id) => useAppStore.getState().deleteApp(projectId, id),

  getId: (a) => a.id,
  getProjectId: (a) => a.projectId,
  getName: (a) => a.name,
  getDescription: (a) => a.description || undefined,
  getTags: (a) => a.tags,
  getUpdatedAt: (a) => a.updatedAt,

  getCategoryBadge: (a) => ({
    label: FRAMEWORK_LABELS[a.framework] ?? a.framework,
    className: FRAMEWORK_COLORS[a.framework] ?? FRAMEWORK_COLORS.custom,
  }),
  getStatusBadge: (a) => ({
    label: a.status,
    className: STATUS_COLORS[a.status] ?? STATUS_COLORS.draft,
  }),

  renderThumbnail: (a) => (
    <div className="text-4xl opacity-30">
      {FRAMEWORK_LABELS[a.framework] ?? a.framework}
    </div>
  ),

  filterOptions: Object.entries(FRAMEWORK_LABELS).map(([key, label]) => ({ key, label })),
  getFilterValue: (a) => a.framework,

  actionableStatuses: ["preview", "deployed"],
  actionLabel: "Preview",
  getIframeSrc: (a) => `/api/apps/${a.projectId}/${a.id}/preview/index.html`,
  getNewTabUrl: (a) => `/api/apps/${a.projectId}/${a.id}/preview/index.html`,

  emptyHint: "No apps yet. Ask your agents to create one!",
  emptyExamples:
    'Try: "Build a React dashboard for my project metrics" or "Create an HTML landing page for my product"',

  showSidecarStatus: true,
};
