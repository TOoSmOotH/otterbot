export type SubagentTaskStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

/** A unit of work delegated to a spawned subagent. Tracked in control DB. */
export interface SubagentTask {
  id: string;
  /** Root of the spawn tree (== id for a top-level spawn). */
  rootId: string;
  /** Parent task id, or null for a top-level spawn. */
  parentTaskId: string | null;
  /** Agent that requested the spawn. */
  parentAgentId: string;
  /** The ephemeral subagent created for this task. */
  subagentId: string;
  goal: string;
  status: SubagentTaskStatus;
  resultSummary: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** A cron-scheduled prompt fired against an agent. Tracked in control DB. */
export interface ScheduledTask {
  id: string;
  agentId: string;
  /** Cron expression understood by `croner`. */
  cron: string;
  prompt: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}
