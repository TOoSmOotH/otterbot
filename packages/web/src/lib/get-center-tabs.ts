export type CenterView =
  | "graph"
  | "live3d"
  | "live2d"
  | "charter"
  | "kanban"
  | "desktop"
  | "files"
  | "usage"
  | "todos"
  | "inbox"
  | "calendar"
  | "code"
  | "ssh"
  | "settings"
  | "merge-queue"
  | "dashboard"
  | "games"
  | "apps"
  | "videos";

export const centerViewLabels: Record<CenterView, string> = {
  graph: "Graph",
  live3d: "Live",
  live2d: "2D",
  dashboard: "Dashboard",
  charter: "Charter",
  kanban: "Board",
  files: "Files",
  todos: "Todos",
  inbox: "Inbox",
  calendar: "Calendar",
  code: "Code",
  ssh: "SSH",
  settings: "Settings",
  "merge-queue": "Merge Queue",
  usage: "Usage",
  desktop: "Desktop",
  games: "Games",
  apps: "Apps",
  videos: "Videos",
};

/** Maps studio id to its corresponding CenterView tab */
const STUDIO_TABS: Record<string, CenterView> = {
  games: "games",
  apps: "apps",
  videos: "videos",
};

const baseProjectTabs: CenterView[] = ["dashboard", "kanban", "charter", "files", "code", "ssh", "settings", "merge-queue"];
const globalTabs: CenterView[] = ["dashboard", "todos", "inbox", "calendar", "usage"];

const basicProjectTabs: CenterView[] = ["dashboard", "kanban", "files", "settings"];
const basicGlobalTabs: CenterView[] = ["dashboard", "todos"];

export function getCenterTabs(activeProjectId: string | null, isBasic = false, studios: string[] = []): CenterView[] {
  if (isBasic) {
    if (!activeProjectId) return basicGlobalTabs;
    const studioTabs = studios.map((s) => STUDIO_TABS[s]).filter((t): t is CenterView => !!t);
    return [...basicProjectTabs, ...studioTabs];
  }
  if (!activeProjectId) return globalTabs;
  const studioTabs = studios.map((s) => STUDIO_TABS[s]).filter((t): t is CenterView => !!t);
  return [...baseProjectTabs, ...studioTabs];
}
