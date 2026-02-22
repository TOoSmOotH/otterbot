import { useDroppable } from "@dnd-kit/core";
import type { KanbanColumn } from "@otterbot/shared";
import type { ReactNode } from "react";

export function KanbanDroppableColumn({
  columnKey,
  label,
  count,
  children,
}: {
  columnKey: KanbanColumn;
  label: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[250px] flex flex-col rounded-lg transition-colors ${
        isOver ? "bg-primary/5 ring-1 ring-primary/20" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </h3>
        <span className="text-[10px] text-muted-foreground bg-secondary rounded-full px-1.5 py-0.5">
          {count}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-0">{children}</div>
    </div>
  );
}
