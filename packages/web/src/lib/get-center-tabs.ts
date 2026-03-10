export type CenterView =
  | "graph"
  | "live3d"
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
  | "dashboard";

export const centerViewLabels: Record<CenterView, string> = {
  graph: "Graph",
  live3d: "Live",
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
};

const projectTabs: CenterView[] = ["dashboard", "kanban", "charter", "files", "code", "ssh", "settings", "merge-queue"];
const globalTabs: CenterView[] = ["dashboard", "todos", "inbox", "calendar", "usage"];

const basicProjectTabs: CenterView[] = ["dashboard", "kanban", "files", "settings"];
const basicGlobalTabs: CenterView[] = ["dashboard", "todos"];

export function getCenterTabs(activeProjectId: string | null, isBasic = false): CenterView[] {
  if (isBasic) {
    return activeProjectId ? basicProjectTabs : basicGlobalTabs;
  }
  return activeProjectId ? projectTabs : globalTabs;
}
