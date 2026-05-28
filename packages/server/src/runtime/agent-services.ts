import type { AgentMessage, CodeSearchHit, MemorySearchResult, ScheduledTask } from "@otterbot/shared";
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
  /** Hybrid keyword + semantic search over the instance's reference repos. */
  searchCodeReference(query: string, opts?: { limit?: number; repo?: string }): Promise<CodeSearchHit[]>;
  /** Exact grep over the instance's reference repos. */
  grepCodeReference(
    pattern: string,
    opts?: { repo?: string; limit?: number; regex?: boolean }
  ): Promise<CodeSearchHit[]>;
  /** Read a file (or line range) from a reference repo clone. */
  readCodeReference(
    repo: string,
    path: string,
    range?: { start: number; end?: number }
  ): { ok: boolean; content?: string; path?: string; truncated?: boolean; error?: string };
  /** List the reference repos available to search. */
  listCodeReferenceRepos(): { repo: string; path: string; state: string }[];
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
   * Announce that an agent started a live (PTY) coding-CLI session, so the UI
   * can attach a terminal view. The session itself is tracked in
   * `integrations/coding-cli.ts`; this is just the notification. Present only
   * when the orchestrator wired it.
   */
  notifyCodingSession?(agentId: string, tool: string): void;
}
