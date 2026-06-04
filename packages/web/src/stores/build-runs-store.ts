import { create } from "zustand";
import { apiFetch } from "../lib/api";
import { getSocket } from "../lib/socket";

export type BuildRunStatus =
  | "planning"
  | "awaiting_approval"
  | "running"
  | "integrating"
  | "reviewing"
  | "done"
  | "failed"
  | "aborted";

export type BuildTaskStatus =
  | "blocked"
  | "ready"
  | "running"
  | "awaiting_merge"
  | "merging"
  | "merged"
  | "conflict"
  | "failed";

/** A build run without its tasks, as listed for a project. */
export interface BuildRunSummary {
  id: string;
  projectId: string;
  goal: string;
  status: BuildRunStatus;
  integrationBranch: string | null;
  parallelism: number;
  prNumber: number | null;
  prUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One task within a build run. */
export interface BuildTaskView {
  id: string;
  title: string;
  role: string;
  deps: string[];
  status: BuildTaskStatus;
  assignedAgentId: string | null;
  branch: string | null;
  worktreePath: string | null;
  attempt: number;
  filesHint: string | null;
  report: string | null;
  transcriptRef: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A build run plus its tasks. */
export interface BuildRunDetail extends BuildRunSummary {
  tasks: BuildTaskView[];
}

/** One message in a worker transcript. */
export interface BuildTranscriptMessage {
  role: string;
  content: string;
  toolCalls: unknown;
}

/** Cache key for per-task diff/transcript caches. */
function taskKey(runId: string, taskId: string): string {
  return `${runId}/${taskId}`;
}

interface BuildRunsState {
  /** runs keyed by project id (summaries, no tasks) */
  runsByProject: Record<string, BuildRunSummary[]>;
  /** full detail (with tasks) keyed by run id */
  detail: Record<string, BuildRunDetail>;
  /** git diff text keyed by `${runId}/${taskId}` */
  diffs: Record<string, string>;
  /** worker transcript keyed by `${runId}/${taskId}` */
  transcripts: Record<string, BuildTranscriptMessage[]>;
  socketBound: boolean;

  loadForProject: (projectId: string) => Promise<void>;
  loadDetail: (runId: string) => Promise<void>;
  loadTaskDiff: (runId: string, taskId: string) => Promise<void>;
  loadTaskTranscript: (runId: string, taskId: string) => Promise<void>;
  bindSocket: () => void;
}

export const useBuildRunsStore = create<BuildRunsState>((set, get) => ({
  runsByProject: {},
  detail: {},
  diffs: {},
  transcripts: {},
  socketBound: false,

  loadForProject: async (projectId) => {
    const res = await apiFetch(`/api/projects/${projectId}/build-runs`);
    if (!res.ok) return;
    const runs = (await res.json()) as BuildRunSummary[];
    set((s) => ({ runsByProject: { ...s.runsByProject, [projectId]: runs } }));
  },

  loadDetail: async (runId) => {
    const res = await apiFetch(`/api/build-runs/${runId}`);
    if (!res.ok) return;
    const run = (await res.json()) as BuildRunDetail;
    set((s) => ({ detail: { ...s.detail, [run.id]: run } }));
  },

  loadTaskDiff: async (runId, taskId) => {
    const res = await apiFetch(`/api/build-runs/${runId}/tasks/${taskId}/diff`);
    if (!res.ok) return;
    const body = (await res.json()) as { diff: string };
    set((s) => ({ diffs: { ...s.diffs, [taskKey(runId, taskId)]: body.diff } }));
  },

  loadTaskTranscript: async (runId, taskId) => {
    const res = await apiFetch(`/api/build-runs/${runId}/tasks/${taskId}/transcript`);
    if (!res.ok) return;
    const body = (await res.json()) as { transcript: BuildTranscriptMessage[] };
    set((s) => ({
      transcripts: { ...s.transcripts, [taskKey(runId, taskId)]: body.transcript },
    }));
  },

  bindSocket: () => {
    if (get().socketBound) return;
    set({ socketBound: true });
    getSocket().on("build:update", (run: BuildRunDetail) => {
      set((s) => {
        const list = s.runsByProject[run.projectId] ?? [];
        const summary: BuildRunSummary = {
          id: run.id,
          projectId: run.projectId,
          goal: run.goal,
          status: run.status,
          integrationBranch: run.integrationBranch,
          parallelism: run.parallelism,
          prNumber: run.prNumber,
          prUrl: run.prUrl,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        };
        const next = list.some((r) => r.id === run.id)
          ? list.map((r) => (r.id === run.id ? summary : r))
          : [summary, ...list];
        return {
          detail: { ...s.detail, [run.id]: run },
          runsByProject: { ...s.runsByProject, [run.projectId]: next },
        };
      });
    });
  },
}));

export { taskKey };
