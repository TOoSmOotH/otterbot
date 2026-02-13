import type { KanbanTask } from "@smoothbot/shared";

export function KanbanCard({
  task,
  onUpdate,
}: {
  task: KanbanTask;
  onUpdate?: (taskId: string, updates: Partial<KanbanTask>) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 mb-2 hover:border-primary/30 transition-colors cursor-pointer">
      <h4 className="text-sm font-medium leading-snug">{task.title}</h4>
      {task.description && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2">
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
