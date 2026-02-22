import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useProjectStore } from "../../stores/project-store";
import { KanbanCard } from "./KanbanCard";
import { KanbanTaskDetail } from "./KanbanTaskDetail";
import { KanbanDroppableColumn } from "./KanbanDroppableColumn";
import { KanbanColumn, type KanbanTask } from "@otterbot/shared";

const COLUMNS: { key: KanbanColumn; label: string }[] = [
  { key: KanbanColumn.Backlog, label: "Backlog" },
  { key: KanbanColumn.InProgress, label: "In Progress" },
  { key: KanbanColumn.Done, label: "Done" },
];

export function KanbanBoard({ projectId }: { projectId: string }) {
  const tasks = useProjectStore((s) => s.tasks);
  const updateTask = useProjectStore((s) => s.updateTask);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const tasksByColumn = useCallback(
    (column: KanbanColumn) =>
      tasks
        .filter((t) => t.column === column && t.projectId === projectId)
        .sort((a, b) => a.position - b.position),
    [tasks, projectId],
  );

  const columnTaskIds = useMemo(
    () =>
      Object.fromEntries(
        COLUMNS.map((col) => [
          col.key,
          tasksByColumn(col.key).map((t) => t.id),
        ]),
      ) as Record<KanbanColumn, string[]>,
    [tasksByColumn],
  );

  const selectedTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      setActiveTask(task ?? null);
    },
    [tasks],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as string;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      // Determine target column: `over` could be a column ID or a task ID
      let targetColumn: KanbanColumn | null = null;
      if (Object.values(KanbanColumn).includes(over.id as KanbanColumn)) {
        targetColumn = over.id as KanbanColumn;
      } else {
        // Dropped over another task — find which column it's in
        const overTask = tasks.find((t) => t.id === over.id);
        if (overTask) targetColumn = overTask.column;
      }

      if (!targetColumn || targetColumn === task.column) return;

      // Optimistic update
      updateTask({ ...task, column: targetColumn });

      // Persist to server
      try {
        await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ column: targetColumn }),
        });
      } catch (err) {
        console.error("Failed to move task:", err);
        // Revert optimistic update
        updateTask(task);
      }
    },
    [tasks, projectId, updateTask],
  );

  const handleDelete = useCallback(
    async (taskId: string) => {
      if (!window.confirm("Delete this task? This cannot be undone.")) return;
      try {
        const res = await fetch(
          `/api/projects/${projectId}/tasks/${taskId}`,
          { method: "DELETE" },
        );
        if (!res.ok) console.error("Failed to delete task");
      } catch (err) {
        console.error("Failed to delete task:", err);
      }
    },
    [projectId],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="h-full flex gap-4 p-4 overflow-x-auto">
        {COLUMNS.map((col) => {
          const colTasks = tasksByColumn(col.key);
          return (
            <KanbanDroppableColumn
              key={col.key}
              columnKey={col.key}
              label={col.label}
              count={colTasks.length}
            >
              <SortableContext
                items={columnTaskIds[col.key]}
                strategy={verticalListSortingStrategy}
              >
                {colTasks.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-xs text-muted-foreground">No tasks</p>
                  </div>
                ) : (
                  colTasks.map((task) => (
                    <KanbanCard
                      key={task.id}
                      task={task}
                      onClick={setSelectedTaskId}
                      onDelete={handleDelete}
                    />
                  ))
                )}
              </SortableContext>
            </KanbanDroppableColumn>
          );
        })}

        {selectedTask && (
          <KanbanTaskDetail
            task={selectedTask}
            projectId={projectId}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="bg-card border border-primary/40 rounded-lg p-3 shadow-xl opacity-90 rotate-[2deg] w-[250px]">
            <h4 className="text-sm font-medium leading-snug">
              {activeTask.title}
            </h4>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
