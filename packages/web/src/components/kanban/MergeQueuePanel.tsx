import { useEffect } from "react";
import type { MergeQueueStatus } from "@otterbot/shared";
import { useMergeQueueStore } from "../../stores/merge-queue-store";
import { useProjectStore } from "../../stores/project-store";
import { getSocket } from "../../lib/socket";

const STATUS_CONFIG: Record<MergeQueueStatus, { label: string; color: string }> = {
  queued: { label: "Queued", color: "text-blue-400" },
  rebasing: { label: "Rebasing...", color: "text-purple-400" },
  re_review: { label: "Re-Review...", color: "text-indigo-400" },
  merging: { label: "Merging...", color: "text-emerald-400" },
  merged: { label: "Merged", color: "text-emerald-400" },
  conflict: { label: "Conflict", color: "text-red-400" },
  failed: { label: "Failed", color: "text-red-400" },
};

export function MergeQueuePanel({ projectId }: { projectId: string }) {
  const entries = useMergeQueueStore((s) => s.entries);
  const setEntries = useMergeQueueStore((s) => s.setEntries);
  const tasks = useProjectStore((s) => s.tasks);

  useEffect(() => {
    const socket = getSocket();
    socket.emit("merge-queue:list", { projectId }, (result) => {
      if (result) setEntries(result);
    });
  }, [projectId, setEntries]);

  // IDs of tasks already in the merge queue
  const mqTaskIds = new Set(entries.filter((e) => e.projectId === projectId).map((e) => e.taskId));

  // Tasks with PRs in pipeline or awaiting approval, not yet in merge queue
  const pendingPrTasks = tasks
    .filter(
      (t) =>
        t.projectId === projectId &&
        t.prNumber != null &&
        (t.column === "in_progress" || t.column === "in_review") &&
        !mqTaskIds.has(t.id),
    )
    .sort((a, b) => a.position - b.position);

  const queueEntries = entries
    .filter((e) => e.projectId === projectId && e.status !== "merged")
    .sort((a, b) => a.position - b.position);

  const totalCount = pendingPrTasks.length + queueEntries.length;

  if (totalCount === 0) return null;

  const handleRemove = (taskId: string) => {
    const socket = getSocket();
    socket.emit("merge-queue:remove", { taskId });
  };

  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Merge Queue ({totalCount})
      </h3>
      <div className="space-y-2">
        {pendingPrTasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5"
          >
            <span className="text-muted-foreground font-mono w-4">&middot;</span>
            <span className="truncate flex-1">PR #{task.prNumber}</span>
            <span className="font-medium text-yellow-400">
              {task.column === "in_progress" ? "Pipeline" : "Review"}
            </span>
          </div>
        ))}
        {queueEntries.map((entry, i) => {
          const config = STATUS_CONFIG[entry.status];
          return (
            <div
              key={entry.id}
              className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5"
            >
              <span className="text-muted-foreground font-mono w-4">{i + 1}.</span>
              <span className="truncate flex-1">PR #{entry.prNumber}</span>
              <span className={`font-medium ${config.color}`}>{config.label}</span>
              {(entry.status === "queued" || entry.status === "conflict" || entry.status === "failed") && (
                <button
                  className="text-muted-foreground hover:text-red-400 transition-colors"
                  onClick={() => handleRemove(entry.taskId)}
                  title="Remove from queue"
                >
                  &times;
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
