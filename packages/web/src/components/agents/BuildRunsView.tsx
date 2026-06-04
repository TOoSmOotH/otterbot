import { useEffect, useState } from "react";
import { GitBranch, X } from "lucide-react";
import { useProjectsStore } from "../../stores/projects-store";
import {
  taskKey,
  useBuildRunsStore,
  type BuildRunStatus,
  type BuildRunSummary,
  type BuildTaskStatus,
  type BuildTaskView,
  type BuildTranscriptMessage,
} from "../../stores/build-runs-store";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { fonts, type } from "../../lib/typography";

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
  const startRun = useBuildRunsStore((s) => s.startRun);
  const abortRun = useBuildRunsStore((s) => s.abortRun);
  const bindSocket = useBuildRunsStore((s) => s.bindSocket);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (!res.ok) setActionError(res.error ?? "Action failed");
    } finally {
      setBusy(false);
    }
  };

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
    setSelectedTaskId(null);
    void loadDetail(id);
  };

  const selectedTask =
    selected && selectedTaskId ? selected.tasks.find((t) => t.id === selectedTaskId) : undefined;

  return (
    <div
      className="grid h-full min-h-0"
      style={{
        gridTemplateColumns: selectedTask ? "320px 1fr 440px" : "360px 1fr",
      }}
    >
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
        {selected && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
            <Badge tone={RUN_TONE[selected.status] ?? "neutral"}>{selected.status}</Badge>
            {selected.status === "awaiting_approval" && (
              <button
                disabled={busy}
                onClick={() => void runAction(() => startRun(selected.id))}
                className="text-small px-2 py-1 rounded border border-success/40 text-success hover:bg-success-bg disabled:opacity-50"
              >
                Approve &amp; start
              </button>
            )}
            {["awaiting_approval", "running", "integrating", "reviewing"].includes(
              selected.status
            ) && (
              <button
                disabled={busy}
                onClick={() => void runAction(() => abortRun(selected.id))}
                className="text-small px-2 py-1 rounded border border-danger/40 text-danger hover:bg-danger-bg disabled:opacity-50"
              >
                Abort
              </button>
            )}
            {actionError && <span className="text-small text-danger">{actionError}</span>}
          </div>
        )}
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
                <TaskCard
                  key={task.id}
                  task={task}
                  active={task.id === selectedTaskId}
                  onClick={() => setSelectedTaskId(task.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedTask && selectedRunId && (
        <TaskDrillDown
          runId={selectedRunId}
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
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

function TaskCard({
  task,
  active,
  onClick,
}: {
  task: BuildTaskView;
  active: boolean;
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
    </button>
  );
}

function TaskDrillDown({
  runId,
  task,
  onClose,
}: {
  runId: string;
  task: BuildTaskView;
  onClose: () => void;
}) {
  const diffs = useBuildRunsStore((s) => s.diffs);
  const transcripts = useBuildRunsStore((s) => s.transcripts);
  const loadTaskDiff = useBuildRunsStore((s) => s.loadTaskDiff);
  const loadTaskTranscript = useBuildRunsStore((s) => s.loadTaskTranscript);

  const key = taskKey(runId, task.id);
  const diff = diffs[key];
  const transcript = transcripts[key];

  // Lazy-load diff + transcript when this task opens; cached entries are reused.
  useEffect(() => {
    if (diffs[key] === undefined) void loadTaskDiff(runId, task.id);
    if (transcripts[key] === undefined) void loadTaskTranscript(runId, task.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="flex flex-col min-h-0 border-l border-border">
      <header className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <span className="text-h2 min-w-0 truncate">{task.title}</span>
        <span className="flex-1" />
        <Badge tone={TASK_TONE[task.status] ?? "neutral"}>{task.status}</Badge>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-muted hover:text-fg"
        >
          <Icon icon={X} size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4 min-h-0">
        <div className="flex items-center flex-wrap gap-1.5">
          <Badge tone="info">{task.role}</Badge>
          {task.attempt > 0 && <Badge tone="warning">attempt {task.attempt}</Badge>}
          {task.branch && (
            <span className="text-small text-subtle" style={{ fontFamily: fonts.mono }}>
              {task.branch}
            </span>
          )}
        </div>

        <DrillSection title="Report">
          {task.report ? (
            <div className="text-body text-fg whitespace-pre-wrap leading-relaxed">
              {task.report}
            </div>
          ) : (
            <div className="text-body text-muted">No report yet.</div>
          )}
        </DrillSection>

        <DrillSection title="Diff">
          {diff === undefined ? (
            <div className="text-body text-muted">Loading diff…</div>
          ) : diff.trim() === "" ? (
            <div className="text-body text-muted">No diff (task hasn&apos;t run yet).</div>
          ) : (
            <pre
              className="rounded-md border border-border bg-surface-sunken p-2 overflow-auto whitespace-pre"
              style={{ ...type.monoSm, maxHeight: 360 }}
            >
              {diff}
            </pre>
          )}
        </DrillSection>

        <DrillSection title="Transcript">
          {transcript === undefined ? (
            <div className="text-body text-muted">Loading transcript…</div>
          ) : transcript.length === 0 ? (
            <div className="text-body text-muted">No transcript captured yet.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {transcript.map((m, i) => (
                <TranscriptMessage key={i} msg={m} />
              ))}
            </div>
          )}
        </DrillSection>
      </div>
    </div>
  );
}

function TranscriptMessage({ msg }: { msg: BuildTranscriptMessage }) {
  const tone: Tone =
    msg.role === "assistant"
      ? "success"
      : msg.role === "user"
        ? "info"
        : msg.role === "tool"
          ? "warning"
          : "neutral";
  const tools = summarizeToolCalls(msg.toolCalls);
  return (
    <div className="rounded-md border border-border bg-surface p-2.5 text-body shadow-sm">
      <Badge tone={tone}>{msg.role}</Badge>
      {msg.content && (
        <div
          className="mt-1.5 text-body text-fg whitespace-pre-wrap break-words"
          style={{ ...type.monoSm }}
        >
          {msg.content}
        </div>
      )}
      {tools && (
        <div
          className="mt-1.5 text-small text-subtle whitespace-pre-wrap break-words"
          style={{ fontFamily: fonts.mono }}
        >
          {tools}
        </div>
      )}
    </div>
  );
}

/** Compact one-liner(s) describing tool calls, if any are present. */
function summarizeToolCalls(toolCalls: unknown): string | null {
  if (!toolCalls) return null;
  const arr = Array.isArray(toolCalls) ? toolCalls : [toolCalls];
  if (arr.length === 0) return null;
  const parts = arr.map((c) => {
    if (c && typeof c === "object") {
      const obj = c as Record<string, unknown>;
      const fn = obj.function as Record<string, unknown> | undefined;
      const name = (fn?.name ?? obj.name ?? obj.type ?? "tool") as string;
      return `→ ${name}`;
    }
    return "→ tool";
  });
  return parts.join("\n");
}

function DrillSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-h2 mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="px-4 py-2.5 border-b border-border text-h2 flex items-center gap-2">
      {children}
    </header>
  );
}
