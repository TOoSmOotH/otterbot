import type { ModelRef, ScheduledTask } from "@otterbot/shared";
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
    opts?: { modelRef?: ModelRef }
  ): Promise<SpawnResult>;
  /** Schedule a recurring prompt (cron expression) for an agent. */
  scheduleTask(agentId: string, cron: string, prompt: string): ScheduledTask | null;
  /** List an agent's scheduled tasks. */
  listScheduledTasks(agentId: string): ScheduledTask[];
  /** Cancel a scheduled task by id. */
  cancelScheduledTask(id: string): boolean;
}
