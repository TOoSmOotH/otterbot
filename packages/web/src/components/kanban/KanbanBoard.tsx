import { useProjectStore } from "../../stores/project-store";
import { KanbanCard } from "./KanbanCard";
import { KanbanColumn } from "@smoothbot/shared";

const COLUMNS: { key: KanbanColumn; label: string }[] = [
  { key: KanbanColumn.Backlog, label: "Backlog" },
  { key: KanbanColumn.InProgress, label: "In Progress" },
  { key: KanbanColumn.Done, label: "Done" },
];

export function KanbanBoard({ projectId }: { projectId: string }) {
  const tasks = useProjectStore((s) => s.tasks);

  const tasksByColumn = (column: KanbanColumn) =>
    tasks
      .filter((t) => t.column === column && t.projectId === projectId)
      .sort((a, b) => a.position - b.position);

  return (
    <div className="h-full flex gap-4 p-4 overflow-x-auto">
      {COLUMNS.map((col) => {
        const columnTasks = tasksByColumn(col.key);
        return (
          <div
            key={col.key}
            className="flex-1 min-w-[250px] flex flex-col"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {col.label}
              </h3>
              <span className="text-[10px] text-muted-foreground bg-secondary rounded-full px-1.5 py-0.5">
                {columnTasks.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-0">
              {columnTasks.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-muted-foreground">No tasks</p>
                </div>
              ) : (
                columnTasks.map((task) => (
                  <KanbanCard key={task.id} task={task} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
