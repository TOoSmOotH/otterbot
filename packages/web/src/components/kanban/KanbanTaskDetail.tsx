import { useCallback, useEffect, useState } from "react";
import type { KanbanTask } from "@otterbot/shared";
import { KanbanColumn } from "@otterbot/shared";
import { useProjectStore } from "../../stores/project-store";

const STATUS_CONFIG: Record<KanbanColumn, { label: string; className: string }> = {
  [KanbanColumn.Backlog]: {
    label: "Backlog",
    className: "bg-secondary text-secondary-foreground",
  },
  [KanbanColumn.InProgress]: {
    label: "In Progress",
    className: "bg-primary/15 text-primary",
  },
  [KanbanColumn.InReview]: {
    label: "In Review",
    className: "bg-amber-500/15 text-amber-400",
  },
  [KanbanColumn.Done]: {
    label: "Done",
    className: "bg-emerald-500/15 text-emerald-400",
  },
};

const COLUMN_OPTIONS: { key: KanbanColumn; label: string }[] = [
  { key: KanbanColumn.Backlog, label: "Backlog" },
  { key: KanbanColumn.InProgress, label: "In Progress" },
  { key: KanbanColumn.InReview, label: "In Review" },
  { key: KanbanColumn.Done, label: "Done" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function KanbanTaskDetail({
  task,
  projectId,
  onClose,
}: {
  task: KanbanTask;
  projectId: string;
  onClose: () => void;
}) {
  const tasks = useProjectStore((s) => s.tasks);
  const updateTask = useProjectStore((s) => s.updateTask);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const status = STATUS_CONFIG[task.column];

  const blockers = task.blockedBy.map((id) => {
    const found = tasks.find((t) => t.id === id);
    return { id, title: found?.title ?? "(deleted task)", done: found?.column === KanbanColumn.Done };
  });

  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);

  const handleRemoveBlocker = useCallback(
    async (blockerId: string) => {
      const newBlockedBy = task.blockedBy.filter((id) => id !== blockerId);
      // Optimistic update
      updateTask({ ...task, blockedBy: newBlockedBy });
      try {
        const res = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blockedBy: newBlockedBy }),
        });
        if (!res.ok) {
          console.error("Failed to remove blocker:", res.statusText);
          updateTask(task);
        }
      } catch (err) {
        console.error("Failed to remove blocker:", err);
        updateTask(task);
      }
    },
    [projectId, task, updateTask],
  );

  const handleDelete = useCallback(async () => {
    if (!window.confirm("Delete this task? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: "DELETE",
      });
      if (res.ok) onClose();
    } finally {
      setDeleting(false);
    }
  }, [projectId, task.id, onClose]);

  const handleColumnChange = useCallback(
    async (newColumn: KanbanColumn) => {
      if (newColumn === task.column) return;
      setMoving(true);
      // Optimistic update
      updateTask({ ...task, column: newColumn });
      try {
        await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ column: newColumn }),
        });
      } catch (err) {
        console.error("Failed to move task:", err);
        // Revert
        updateTask(task);
      } finally {
        setMoving(false);
      }
    },
    [projectId, task, updateTask],
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug">{task.title}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              <span
                className={`inline-block text-[11px] font-medium rounded px-2 py-0.5 ${status.className}`}
              >
                {status.label}
              </span>
              {/* Column move dropdown */}
              <select
                value={task.column}
                onChange={(e) => handleColumnChange(e.target.value as KanbanColumn)}
                disabled={moving}
                className="text-[11px] bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 border-none outline-none cursor-pointer disabled:opacity-50"
              >
                {COLUMN_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    Move to {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs text-muted-foreground hover:text-red-400 disabled:opacity-50 px-1.5 py-0.5 rounded hover:bg-red-500/10 transition-colors"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-lg leading-none"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-sm">
          {/* Description */}
          {task.description && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Description
              </h3>
              <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">
                {task.description}
              </p>
            </section>
          )}

          {/* Completion Report */}
          {task.completionReport && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Completion Report
              </h3>
              <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">
                {task.completionReport}
              </p>
            </section>
          )}

          {/* Blocked By */}
          {blockers.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Blocked By
              </h3>
              <ul className="space-y-1">
                {blockers.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-xs group">
                    {b.done ? (
                      <span className="text-emerald-400" title="Done">&#10003;</span>
                    ) : (
                      <span className="text-yellow-400" title="Not done">&#9719;</span>
                    )}
                    <span className={b.done ? "text-muted-foreground line-through" : "text-foreground"}>
                      {b.title}
                    </span>
                    <button
                      onClick={() => handleRemoveBlocker(b.id)}
                      title="Remove blocker"
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded px-1 py-0.5 text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
                    >
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Labels */}
          {task.labels.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Labels
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {task.labels.map((label) => (
                  <span
                    key={label}
                    className="text-[11px] bg-primary/10 text-primary rounded px-2 py-0.5"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Assignee */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Assignee
            </h3>
            <p className="text-foreground/90">
              {task.assigneeAgentId ?? "Unassigned"}
            </p>
          </section>

          {/* Timestamps */}
          <section className="flex gap-8">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Created
              </h3>
              <p className="text-xs text-foreground/80">{formatDate(task.createdAt)}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Updated
              </h3>
              <p className="text-xs text-foreground/80">{formatDate(task.updatedAt)}</p>
            </div>
          </section>

          {/* Task ID */}
          <p className="text-[10px] text-muted-foreground font-mono pt-2 border-t border-border">
            ID: {task.id}
          </p>
        </div>
      </div>
    </div>
  );
}
