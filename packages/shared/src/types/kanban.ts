export enum KanbanColumn {
  Backlog = "backlog",
  InProgress = "in_progress",
  Done = "done",
}

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  column: KanbanColumn;
  position: number;
  assigneeAgentId: string | null;
  createdBy: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KanbanTaskCreate {
  title: string;
  description?: string;
  column?: KanbanColumn;
  labels?: string[];
}

export interface KanbanTaskUpdate {
  title?: string;
  description?: string;
  column?: KanbanColumn;
  position?: number;
  assigneeAgentId?: string | null;
  labels?: string[];
}
