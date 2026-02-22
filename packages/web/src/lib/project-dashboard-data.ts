import { KanbanColumn } from "@otterbot/shared";
import type { KanbanTask, Agent } from "@otterbot/shared";

export interface ProjectDashboardData {
  triage: KanbanTask[];
  backlog: KanbanTask[];
  inProgress: KanbanTask[];
  done: KanbanTask[];
  total: number;
  progressPct: number;
  githubTasks: KanbanTask[];
  projectAgents: Agent[];
  recentTasks: KanbanTask[];
}

export function deriveProjectDashboardData(
  tasks: KanbanTask[],
  agents: Map<string, Agent>,
  projectId: string,
): ProjectDashboardData {
  const triage = tasks.filter((t) => t.column === KanbanColumn.Triage);
  const backlog = tasks.filter((t) => t.column === KanbanColumn.Backlog);
  const inProgress = tasks.filter((t) => t.column === KanbanColumn.InProgress);
  const done = tasks.filter((t) => t.column === KanbanColumn.Done);
  // Triage tasks are unassigned issues — exclude from total/progress (not "work to do" until assigned)
  const total = tasks.length - triage.length;
  const progressPct = total > 0 ? Math.round((done.length / total) * 100) : 0;

  const githubTasks = tasks.filter((t) =>
    t.labels.some((l) => l.startsWith("github-issue")),
  );

  const projectAgents: Agent[] = [];
  agents.forEach((agent) => {
    if (agent.projectId === projectId) projectAgents.push(agent);
  });

  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  return { triage, backlog, inProgress, done, total, progressPct, githubTasks, projectAgents, recentTasks };
}
