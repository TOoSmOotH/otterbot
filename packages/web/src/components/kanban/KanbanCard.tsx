import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { KanbanTask, KanbanColumn, MergeQueueStatus } from "@otterbot/shared";
import { PIPELINE_STAGES } from "@otterbot/shared";
import { useMergeQueueStore } from "../../stores/merge-queue-store";
import { getSocket } from "../../lib/socket";

const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.key, s.label]),
);

const MERGE_QUEUE_STATUS_CONFIG: Record<MergeQueueStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-blue-500/15 text-blue-400" },
  rebasing: { label: "Rebasing", className: "bg-purple-500/15 text-purple-400" },
  re_review: { label: "Re-Review", className: "bg-indigo-500/15 text-indigo-400" },
  merging: { label: "Merging", className: "bg-emerald-500/15 text-emerald-400" },
  merged: { label: "Merged", className: "bg-emerald-500/15 text-emerald-400" },
  conflict: { label: "Conflict", className: "bg-red-500/15 text-red-400" },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-400" },
};

function PipelineProgress({
  stages,
  currentStage,
  taskColumn,
}: {
  stages: string[];
  currentStage: string | null;
  taskColumn: KanbanColumn;
}) {
  const isDone = taskColumn === "done" || taskColumn === "in_review";
  const currentIndex = currentStage ? stages.indexOf(currentStage) : -1;

  return (
    <div className="mt-2 space-y-0.5">
      {stages.map((stage, i) => {
        let status: "done" | "active" | "pending";
        if (isDone && currentStage === null) {
          status = "done";
        } else if (currentIndex >= 0 && i < currentIndex) {
          status = "done";
        } else if (i === currentIndex) {
          status = "active";
        } else {
          status = "pending";
        }

        return (
          <div key={stage} className="flex items-center gap-1.5 text-[11px]">
            {status === "done" && (
              <svg className="w-3 h-3 text-emerald-400 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="1" width="14" height="14" rx="2" />
                <path d="M4.5 8l2.5 2.5 4.5-5" />
              </svg>
            )}
            {status === "active" && (
              <svg className="w-3 h-3 text-blue-400 shrink-0 animate-pulse" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="1" width="14" height="14" rx="2" />
                <circle cx="8" cy="8" r="2" fill="currentColor" />
              </svg>
            )}
            {status === "pending" && (
              <svg className="w-3 h-3 text-muted-foreground/40 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="1" width="14" height="14" rx="2" />
              </svg>
            )}
            <span className={status === "pending" ? "text-muted-foreground/40" : status === "active" ? "text-blue-400" : "text-muted-foreground"}>
              {STAGE_LABELS[stage] ?? stage}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function KanbanCard({
  task,
  onClick,
  onDelete,
}: {
  task: KanbanTask;
  onClick?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const mergeQueueEntries = useMergeQueueStore((s) => s.entries);
  const mqEntry = mergeQueueEntries.find((e) => e.taskId === task.id);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleApproveForMerge = (e: React.MouseEvent) => {
    e.stopPropagation();
    const socket = getSocket();
    socket.emit("merge-queue:approve", { taskId: task.id });
  };

  const showApproveButton =
    task.column === "in_review" &&
    task.prNumber != null &&
    task.prBranch != null &&
    !mqEntry;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative bg-card border border-border rounded-lg p-3 mb-2 hover:border-primary/30 transition-colors cursor-pointer ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
      onClick={() => onClick?.(task.id)}
      {...attributes}
      {...listeners}
    >
      {/* Drag handle indicator */}
      <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 transition-opacity text-muted-foreground pointer-events-none">
        <svg width="6" height="14" viewBox="0 0 6 14" fill="currentColor">
          <circle cx="1.5" cy="1.5" r="1" />
          <circle cx="4.5" cy="1.5" r="1" />
          <circle cx="1.5" cy="5.5" r="1" />
          <circle cx="4.5" cy="5.5" r="1" />
          <circle cx="1.5" cy="9.5" r="1" />
          <circle cx="4.5" cy="9.5" r="1" />
          <circle cx="1.5" cy="13.5" r="1" />
          <circle cx="4.5" cy="13.5" r="1" />
        </svg>
      </div>

      {/* Delete button */}
      {onDelete && (
        <button
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded w-5 h-5 flex items-center justify-center text-xs leading-none"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
          title="Delete task"
        >
          &times;
        </button>
      )}

      <h4 className="text-sm font-medium leading-snug pr-4">
        {task.taskNumber && (
          <span className="text-muted-foreground font-mono mr-1.5 text-xs">#{task.taskNumber}</span>
        )}
        {task.title}
      </h4>
      {task.description && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {task.description}
        </p>
      )}
      {task.pipelineStages?.length > 0 && (
        <PipelineProgress stages={task.pipelineStages} currentStage={task.pipelineStage} taskColumn={task.column} />
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {task.prNumber && (
          <span className="text-[10px] bg-amber-500/15 text-amber-400 rounded px-1.5 py-0.5 font-medium">
            PR #{task.prNumber}
          </span>
        )}
        {mqEntry && (
          <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${MERGE_QUEUE_STATUS_CONFIG[mqEntry.status].className}`}>
            {MERGE_QUEUE_STATUS_CONFIG[mqEntry.status].label}
          </span>
        )}
        {task.column === "backlog" && task.blockedBy?.length > 0 && (
          <span className="text-[10px] bg-destructive/15 text-destructive rounded px-1.5 py-0.5 font-medium">
            Blocked
          </span>
        )}
        {task.labels.map((label) => (
          <span
            key={label}
            className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5"
          >
            {label}
          </span>
        ))}
        {task.assigneeAgentId && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {task.assigneeAgentId.slice(0, 6)}
          </span>
        )}
      </div>
      {showApproveButton && (
        <button
          className="mt-2 w-full text-[11px] font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 rounded px-2 py-1 transition-colors"
          onClick={handleApproveForMerge}
        >
          Approve for Merge
        </button>
      )}
    </div>
  );
}
