import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { KanbanTask } from "@otterbot/shared";

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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

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

      <h4 className="text-sm font-medium leading-snug pr-4">{task.title}</h4>
      {task.description && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
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
    </div>
  );
}
