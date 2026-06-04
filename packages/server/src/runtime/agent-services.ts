import type {
  AgentMessage,
  CodingModelPreset,
  MemorySearchResult,
  ScheduledTask,
} from "@otterbot/shared";
import type { MessageBus } from "../bus/bus.js";

export interface AgentDirectoryEntry {
  id: string;
  displayName: string;
  role: string;
  /** What this agent is for — its persona's first line, for delegation hints. */
  summary: string;
}

export interface SpawnResult {
  subagentId: string;
  taskId: string;
  summary: string;
}

/**
 * Cross-agent capabilities handed to each runtime: the message bus, a directory
 * of peers to address, and subagent spawning. Shared by all runtimes — each one
 * identifies itself via its own `ctx.profile.id`.
 */
export interface AgentServices {
  bus: MessageBus;
  /** Every currently-running agent, for addressing and delegation. */
  listAgents(): AgentDirectoryEntry[];
  /** Spawn a subagent under `parentId` to pursue `goal`, awaiting its result. */
  spawnSubagent(
    parentId: string,
    goal: string,
    opts?: { modelId?: string }
  ): Promise<SpawnResult>;
  /**
   * Service-agent dispatch: handle an inbound delegated `request` by spawning a
   * non-blocking subagent (inheriting `parentId`'s skills/credentials) that
   * replies directly to the original requester (correlationId = request.id).
   * Returns immediately — the reply arrives later over the bus. Present only
   * when the orchestrator wired it; runtimes guard on its existence.
   */
  dispatchToSubagent?(args: { parentId: string; request: AgentMessage }): void;
  /** Schedule a recurring prompt (cron expression) for an agent. */
  scheduleTask(agentId: string, cron: string, prompt: string): ScheduledTask | null;
  /** List an agent's scheduled tasks. */
  listScheduledTasks(agentId: string): ScheduledTask[];
  /** Cancel a scheduled task by id. */
  cancelScheduledTask(id: string): boolean;
  /** Search another agent's memory, read-only. Returns that agent's own hits. */
  searchPeerMemory(
    targetAgentId: string,
    query: string,
    limit: number
  ): Promise<MemorySearchResult[]>;
  /**
   * Read the text contents of an agent's produced file (artifact) by basename.
   * Used by the `read_file` tool to pull a shared doc into a turn. Binary files
   * (images, …) are not returned as text.
   */
  readArtifact(
    agentId: string,
    file: string
  ): { ok: boolean; content?: string; mimeType?: string; truncated?: boolean; error?: string };
  /**
   * Read the raw bytes of an agent's file (`files/`) or generated image
   * (`images/`) by basename. Used to resolve cross-agent image references for
   * editing. Returns null if the agent/file is unknown or the name is unsafe.
   */
  readArtifactBinary(
    agentId: string,
    dir: "files" | "images",
    name: string
  ): { data: Buffer; mimeType: string } | null;
  /**
   * The configured coding-CLI model presets (Settings → Coding Models), so
   * `coding_cli_run` can resolve a pinned/per-call preset id into the tool's
   * model + reasoning flags. Present only when the orchestrator wired it.
   */
  codingModelPresets?(): CodingModelPreset[];
  /** The project an agent belongs to (most-recent), or null. For the PM. */
  projectIdForAgent?(agentId: string): string | null;
  /** Start a build-pipeline run for a project; returns the run id. */
  startPipeline?(projectId: string, goal: string): string;
  /** A pipeline run's current state (stages, statuses, reports). */
  getPipelineRun?(runId: string): PipelineRunStatus | null;
}

/** A pipeline run's state, surfaced to the PM via `pipeline_status`. */
interface PipelineRunStatus {
  id: string;
  projectId: string;
  goal: string;
  status: string;
  currentStage: string | null;
  attempt: number;
  stages: Array<{ stage: string; agentId: string; status: string; report: string; attempt: number }>;
}
