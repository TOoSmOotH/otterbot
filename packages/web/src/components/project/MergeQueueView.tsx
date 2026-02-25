import { useEffect } from "react";
import type { MergeQueueStatus } from "@otterbot/shared";
import { useMergeQueueStore } from "../../stores/merge-queue-store";
import { getSocket } from "../../lib/socket";

const STATUS_CONFIG: Record<MergeQueueStatus, { label: string; color: string; bg: string }> = {
  queued: { label: "Queued", color: "text-blue-400", bg: "bg-blue-400/10" },
  rebasing: { label: "Rebasing", color: "text-purple-400", bg: "bg-purple-400/10" },
  re_review: { label: "Re-Review", color: "text-indigo-400", bg: "bg-indigo-400/10" },
  merging: { label: "Merging", color: "text-emerald-400", bg: "bg-emerald-400/10" },
  merged: { label: "Merged", color: "text-emerald-400", bg: "bg-emerald-400/10" },
  conflict: { label: "Conflict", color: "text-red-400", bg: "bg-red-400/10" },
  failed: { label: "Failed", color: "text-red-400", bg: "bg-red-400/10" },
};

export function MergeQueueView({ projectId }: { projectId: string }) {
  const entries = useMergeQueueStore((s) => s.entries);
  const setEntries = useMergeQueueStore((s) => s.setEntries);

  useEffect(() => {
    const socket = getSocket();
    socket.emit("merge-queue:list", { projectId }, (result) => {
      if (result) setEntries(result);
    });
  }, [projectId, setEntries]);

  const activeEntries = entries
    .filter((e) => e.projectId === projectId && e.status !== "merged")
    .sort((a, b) => a.position - b.position);

  const mergedEntries = entries
    .filter((e) => e.projectId === projectId && e.status === "merged")
    .sort((a, b) => {
      const aTime = a.mergedAt ?? a.updatedAt;
      const bTime = b.mergedAt ?? b.updatedAt;
      return bTime.localeCompare(aTime);
    });

  const handleRemove = (taskId: string) => {
    const socket = getSocket();
    socket.emit("merge-queue:remove", { taskId });
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Merge Queue</h2>

      {activeEntries.length === 0 && mergedEntries.length === 0 && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No entries in the merge queue.
        </div>
      )}

      {activeEntries.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Active ({activeEntries.length})
          </h3>
          <div className="space-y-2">
            {activeEntries.map((entry, i) => {
              const config = STATUS_CONFIG[entry.status];
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3"
                >
                  <span className="text-muted-foreground font-mono text-sm w-6 text-right">
                    {i + 1}.
                  </span>
                  <span className="font-medium text-sm">PR #{entry.prNumber}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {entry.prBranch}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${config.color} ${config.bg}`}
                    >
                      {config.label}
                    </span>
                    {entry.status === "queued" && (
                      <button
                        className="text-muted-foreground hover:text-red-400 transition-colors text-sm"
                        onClick={() => handleRemove(entry.taskId)}
                        title="Remove from queue"
                      >
                        &times;
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mergedEntries.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Recently Merged ({mergedEntries.length})
          </h3>
          <div className="space-y-2">
            {mergedEntries.map((entry) => {
              const config = STATUS_CONFIG[entry.status];
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3 opacity-60"
                >
                  <span className="font-medium text-sm">PR #{entry.prNumber}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {entry.prBranch}
                  </span>
                  <span className="ml-auto">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${config.color} ${config.bg}`}
                    >
                      {config.label}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
