export enum KanbanColumn {
  Backlog = "backlog",
  InProgress = "in_progress",
  InReview = "in_review",
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
  completionReport: string | null;
  prNumber: number | null;
  prBranch: string | null;
  labels: string[];
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KanbanTaskCreate {
  title: string;
  description?: string;
  column?: KanbanColumn;
  labels?: string[];
  blockedBy?: string[];
}

export interface KanbanTaskUpdate {
  title?: string;
  description?: string;
  column?: KanbanColumn;
  position?: number;
  assigneeAgentId?: string | null;
  completionReport?: string;
  prNumber?: number | null;
  prBranch?: string | null;
  labels?: string[];
  blockedBy?: string[];
}
