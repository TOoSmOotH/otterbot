import { useProjectStore } from "../../stores/project-store";
import { useAgentStore } from "../../stores/agent-store";
import { KanbanColumn } from "@otterbot/shared";
import type { KanbanTask, Agent } from "@otterbot/shared";

export function ProjectDashboard({ projectId }: { projectId: string }) {
  const tasks = useProjectStore((s) => s.tasks);
  const project = useProjectStore((s) => s.activeProject);
  const agentsMap = useAgentStore((s) => s.agents);

  const backlog = tasks.filter((t) => t.column === KanbanColumn.Backlog);
  const inProgress = tasks.filter((t) => t.column === KanbanColumn.InProgress);
  const done = tasks.filter((t) => t.column === KanbanColumn.Done);
  const total = tasks.length;
  const progressPct = total > 0 ? Math.round((done.length / total) * 100) : 0;

  const githubTasks = tasks.filter((t) =>
    t.labels.some((l) => l.startsWith("github-issue")),
  );

  const projectAgents: Agent[] = [];
  agentsMap.forEach((agent) => {
    if (agent.projectId === projectId) projectAgents.push(agent);
  });

  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-6xl mx-auto">
        {/* Progress Card */}
        <Card title="Progress">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Completion</span>
              <span className="font-medium">{progressPct}%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Backlog: {backlog.length}</span>
              <span>In Progress: {inProgress.length}</span>
              <span>Done: {done.length}</span>
            </div>
          </div>
        </Card>

        {/* Active Work Card */}
        <Card title="Active Work" count={inProgress.length}>
          {inProgress.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tasks in progress</p>
          ) : (
            <ul className="space-y-2">
              {inProgress.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </Card>

        {/* GitHub Issues Card */}
        <Card title="GitHub Issues" count={githubTasks.length}>
          {githubTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No synced issues</p>
          ) : (
            <ul className="space-y-2">
              {githubTasks.slice(0, 8).map((t) => (
                <TaskRow key={t.id} task={t} showColumn />
              ))}
              {githubTasks.length > 8 && (
                <p className="text-xs text-muted-foreground">+{githubTasks.length - 8} more</p>
              )}
            </ul>
          )}
        </Card>

        {/* Agents Card */}
        <Card title="Agents" count={projectAgents.length}>
          {projectAgents.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active agents</p>
          ) : (
            <ul className="space-y-2">
              {projectAgents.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={a.status} />
                    <span className="truncate font-medium">{a.name ?? a.id.slice(0, 8)}</span>
                    <span className="text-muted-foreground">{a.role}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0">{a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent Activity Card */}
        <Card title="Recent Activity" count={recentTasks.length}>
          {recentTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent activity</p>
          ) : (
            <ul className="space-y-2">
              {recentTasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ColumnBadge column={t.column} />
                    <span className="truncate">{t.title}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {formatRelative(t.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {count !== undefined && (
          <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function TaskRow({ task, showColumn }: { task: KanbanTask; showColumn?: boolean }) {
  return (
    <li className="flex items-center justify-between text-xs gap-2">
      <div className="flex items-center gap-2 min-w-0">
        {showColumn && <ColumnBadge column={task.column} />}
        <span className="truncate">{task.title}</span>
      </div>
      {task.assigneeAgentId && (
        <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
          {task.assigneeAgentId.slice(0, 6)}
        </span>
      )}
    </li>
  );
}

function ColumnBadge({ column }: { column: KanbanColumn }) {
  const styles: Record<KanbanColumn, string> = {
    [KanbanColumn.Backlog]: "bg-secondary text-muted-foreground",
    [KanbanColumn.InProgress]: "bg-blue-500/20 text-blue-400",
    [KanbanColumn.Done]: "bg-green-500/20 text-green-400",
  };
  const labels: Record<KanbanColumn, string> = {
    [KanbanColumn.Backlog]: "Backlog",
    [KanbanColumn.InProgress]: "Active",
    [KanbanColumn.Done]: "Done",
  };
  return (
    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[column]}`}>
      {labels[column]}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "idle"
      ? "bg-gray-400"
      : status === "thinking" || status === "acting"
        ? "bg-green-400 animate-pulse"
        : status === "error"
          ? "bg-red-400"
          : "bg-yellow-400";
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${color}`} />;
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
