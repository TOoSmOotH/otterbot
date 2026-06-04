import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { useProjectsStore } from "../../stores/projects-store";
import {
  useBuildRunsStore,
  type BuildRunStatus,
  type BuildRunSummary,
  type BuildTaskStatus,
  type BuildTaskView,
} from "../../stores/build-runs-store";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { fonts } from "../../lib/typography";

type Tone = "neutral" | "accent" | "success" | "warning" | "info" | "danger";

const RUN_TONE: Record<BuildRunStatus, Tone> = {
  planning: "neutral",
  awaiting_approval: "neutral",
  running: "warning",
  integrating: "warning",
  reviewing: "warning",
  done: "success",
  failed: "danger",
  aborted: "danger",
};

const TASK_TONE: Record<BuildTaskStatus, Tone> = {
  blocked: "neutral",
  ready: "info",
  running: "warning",
  awaiting_merge: "warning",
  merging: "warning",
  merged: "success",
  conflict: "danger",
  failed: "danger",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function BuildRunsView() {
  const projects = useProjectsStore((s) => s.projects);
  const loadProjects = useProjectsStore((s) => s.load);
  const runsByProject = useBuildRunsStore((s) => s.runsByProject);
  const detail = useBuildRunsStore((s) => s.detail);
  const loadForProject = useBuildRunsStore((s) => s.loadForProject);
  const loadDetail = useBuildRunsStore((s) => s.loadDetail);
  const bindSocket = useBuildRunsStore((s) => s.bindSocket);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    bindSocket();
    if (projects.length === 0) void loadProjects();
  }, [bindSocket, loadProjects, projects.length]);

  // Default to the first project once the list is available.
  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projectId, projects]);

  useEffect(() => {
    if (projectId) void loadForProject(projectId);
  }, [projectId, loadForProject]);

  const runs = projectId ? runsByProject[projectId] ?? [] : [];
  const selected = selectedRunId ? detail[selectedRunId] : undefined;

  const selectRun = (id: string) => {
    setSelectedRunId(id);
    void loadDetail(id);
  };

  return (
    <div className="grid h-full min-h-0" style={{ gridTemplateColumns: "360px 1fr" }}>
      <div className="flex flex-col min-h-0 border-r border-border">
        <SectionHeader>
          <Icon icon={GitBranch} size={14} />
          Build runs
          {runs.length > 0 && <Badge tone="accent">{runs.length}</Badge>}
        </SectionHeader>

        {projects.length > 1 && (
          <div className="px-3 py-2 border-b border-border">
            <select
              value={projectId ?? ""}
              onChange={(e) => {
                setProjectId(e.target.value);
                setSelectedRunId(null);
              }}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-fg"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
          {projects.length === 0 && (
            <div className="text-body text-muted">No projects yet.</div>
          )}
          {projects.length > 0 && runs.length === 0 && (
            <div className="text-body text-muted">No build runs for this project yet.</div>
          )}
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              active={run.id === selectedRunId}
              taskCount={detail[run.id]?.tasks.length}
              onClick={() => selectRun(run.id)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col min-h-0">
        <SectionHeader>Task board</SectionHeader>
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {!selected && (
            <div className="text-body text-muted">Select a build run to see its tasks.</div>
          )}
          {selected && selected.tasks.length === 0 && (
            <div className="text-body text-muted">No tasks planned for this run yet.</div>
          )}
          {selected && selected.tasks.length > 0 && (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
            >
              {sortTasks(selected.tasks).map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Sort tasks so active/blocking work surfaces first, then by creation order. */
function sortTasks(tasks: BuildTaskView[]): BuildTaskView[] {
  const order: Record<BuildTaskStatus, number> = {
    running: 0,
    conflict: 1,
    awaiting_merge: 2,
    merging: 3,
    ready: 4,
    blocked: 5,
    failed: 6,
    merged: 7,
  };
  return [...tasks].sort((a, b) => {
    const d = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (d !== 0) return d;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function RunCard({
  run,
  active,
  taskCount,
  onClick,
}: {
  run: BuildRunSummary;
  active: boolean;
  taskCount?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-md border p-3 text-body shadow-sm transition-colors ${
        active ? "border-accent bg-surface-elevated" : "border-border bg-surface hover:bg-surface/60"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-fg">{truncate(run.goal, 80)}</span>
        <Badge tone={RUN_TONE[run.status] ?? "neutral"}>{run.status}</Badge>
      </div>
      <div
        className="mt-1.5 flex items-center gap-2 text-small text-subtle"
        style={{ fontFamily: fonts.mono }}
      >
        <span>{fmtTime(run.createdAt)}</span>
        {typeof taskCount === "number" && <span>· {taskCount} tasks</span>}
        {run.prNumber != null && <span>· PR #{run.prNumber}</span>}
      </div>
    </button>
  );
}

function TaskCard({ task }: { task: BuildTaskView }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3 text-body shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-fg min-w-0">{task.title}</span>
        <Badge tone={TASK_TONE[task.status] ?? "neutral"}>{task.status}</Badge>
      </div>
      <div className="mt-1.5 flex items-center flex-wrap gap-1.5">
        <Badge tone="info">{task.role}</Badge>
        {task.attempt > 0 && <Badge tone="warning">attempt {task.attempt}</Badge>}
      </div>
      {task.deps.length > 0 && (
        <div
          className="mt-2 text-small text-subtle"
          style={{ fontFamily: fonts.mono }}
        >
          deps: {task.deps.join(", ")}
        </div>
      )}
      {task.report && (
        <div className="mt-2 text-small text-muted whitespace-pre-wrap leading-relaxed">
          {truncate(task.report, 240)}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="px-4 py-2.5 border-b border-border text-h2 flex items-center gap-2">
      {children}
    </header>
  );
}
