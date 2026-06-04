import { eq } from "drizzle-orm";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import { parseVerdict } from "./pipeline-manager.js";

export type TaskStatus =
  | "blocked"
  | "ready"
  | "running"
  | "awaiting_merge"
  | "merging"
  | "merged"
  | "conflict"
  | "failed";

export type TaskRole =
  | "coder"
  | "integrator"
  | "security-reviewer"
  | "test-writer"
  | "tester";

/** Roles whose VERDICT can fail the run and kick the work back. */
export const GATE_ROLES = new Set<TaskRole>(["security-reviewer", "tester"]);

/** Max times a task is kicked back before its run is marked failed. */
export const DEFAULT_MAX_ATTEMPTS = 2;

export interface BuildTask {
  id: string;
  runId: string;
  projectId: string;
  title: string;
  description: string;
  role: TaskRole;
  deps: string[];
  status: TaskStatus;
  assignedAgentId: string | null;
  branch: string | null;
  worktreePath: string | null;
  attempt: number;
  filesHint: string[] | null;
  report: string;
  transcriptRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus =
  | "planning"
  | "awaiting_approval"
  | "running"
  | "integrating"
  | "reviewing"
  | "done"
  | "failed"
  | "aborted";

export interface BuildRun {
  id: string;
  projectId: string;
  goal: string;
  status: RunStatus;
  integrationBranch: string | null;
  parallelism: number;
  prNumber: number | null;
  prUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildRunView extends BuildRun {
  tasks: BuildTask[];
}

/**
 * Tasks eligible to run now: not yet started (`blocked`/`ready`) and every
 * dependency `merged`. Pure — the scheduler's core selection logic.
 */
export function readyTasks(tasks: BuildTask[]): BuildTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const merged = (id: string) => byId.get(id)?.status === "merged";
  return tasks.filter(
    (t) => (t.status === "blocked" || t.status === "ready") && t.deps.every(merged)
  );
}

export { parseVerdict };
