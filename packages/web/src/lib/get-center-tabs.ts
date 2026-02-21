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
  usage: "Usage",
  desktop: "Desktop",
};

const projectTabs: CenterView[] = ["dashboard", "kanban", "charter", "files", "code"];
const globalTabs: CenterView[] = ["graph", "todos", "inbox", "calendar", "code", "usage", "desktop"];

export function getCenterTabs(activeProjectId: string | null): CenterView[] {
  return activeProjectId ? projectTabs : globalTabs;
}
