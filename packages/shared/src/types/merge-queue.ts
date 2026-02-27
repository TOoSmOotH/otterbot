export type MergeQueueStatus =
  | "queued"
  | "rebasing"
  | "re_review"
  | "merging"
  | "merged"
  | "conflict"
  | "failed";

export interface MergeQueueEntry {
  id: string;
  taskId: string;
  projectId: string;
  prNumber: number;
  prBranch: string;
  baseBranch: string;
  status: MergeQueueStatus;
  position: number;
  rebaseAttempts: number;
  lastError: string | null;
  approvedAt: string;
  mergedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
