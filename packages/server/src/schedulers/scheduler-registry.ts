import { getConfig, setConfig } from "../auth/auth.js";
import { AgentRole, AgentStatus } from "@otterbot/shared";
import type { Agent } from "@otterbot/shared";
import type { Server } from "socket.io";
import { getRandomModelPackId } from "../models3d/model-packs.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Scheduler {
  start(intervalMs?: number): void;
  stop(): void;
}

export interface SchedulerMeta {
  id: string;
  name: string;
  description: string;
  defaultIntervalMs: number;
  minIntervalMs: number;
}

export interface SchedulerInfo extends SchedulerMeta {
  enabled: boolean;
  intervalMs: number;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class SchedulerRegistry {
  private entries = new Map<
    string,
    { instance: Scheduler; meta: SchedulerMeta }
  >();
  private io: Server;
  /** Stable model pack assignments per built-in scheduler */
  private modelPackIds = new Map<string, string | null>();

  constructor(io: Server) {
    this.io = io;
  }

  private getModelPackId(schedulerId: string): string | null {
    if (!this.modelPackIds.has(schedulerId)) {
      this.modelPackIds.set(schedulerId, getRandomModelPackId());
    }
    return this.modelPackIds.get(schedulerId) ?? null;
  }

  /** Build a pseudo-agent for a built-in scheduler (socket-only, no DB row). */
  private buildPseudoAgent(meta: SchedulerMeta, status: AgentStatus = AgentStatus.Idle): Agent {
    return {
      id: `builtin-scheduler-${meta.id}`,
      name: meta.name,
      registryEntryId: null,
      role: AgentRole.Scheduler,
      parentId: null,
      status,
      model: "",
      provider: "",
      projectId: null,
      modelPackId: this.getModelPackId(meta.id),
      gearConfig: null,
      workspacePath: null,
      createdAt: new Date().toISOString(),
    };
  }

  register(id: string, instance: Scheduler, meta: Omit<SchedulerMeta, "id">): void {
    this.entries.set(id, { instance, meta: { id, ...meta } });
  }

  getAll(): SchedulerInfo[] {
    const result: SchedulerInfo[] = [];
    for (const { meta } of this.entries.values()) {
      const enabledRaw = getConfig(`scheduler:${meta.id}:enabled`);
      const intervalRaw = getConfig(`scheduler:${meta.id}:intervalMs`);
      result.push({
        ...meta,
        enabled: enabledRaw !== undefined ? enabledRaw === "true" : true,
        intervalMs: intervalRaw ? Number(intervalRaw) : meta.defaultIntervalMs,
      });
    }
    return result;
  }

  update(
    id: string,
    patch: { enabled?: boolean; intervalMs?: number },
  ): SchedulerInfo | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    const { instance, meta } = entry;

    // Read current enabled state before applying patch
    const wasEnabledRaw = getConfig(`scheduler:${id}:enabled`);
    const wasEnabled = wasEnabledRaw !== undefined ? wasEnabledRaw === "true" : true;

    // Persist and clamp interval
    if (patch.intervalMs !== undefined) {
      const clamped = Math.max(patch.intervalMs, meta.minIntervalMs);
      setConfig(`scheduler:${id}:intervalMs`, String(clamped));
    }

    if (patch.enabled !== undefined) {
      setConfig(`scheduler:${id}:enabled`, String(patch.enabled));
    }

    // Read back persisted values
    const info = this.getOne(id)!;

    // Restart or stop
    instance.stop();
    if (info.enabled) {
      instance.start(info.intervalMs);
    }

    // Emit pseudo-agent events on enable/disable transitions
    if (wasEnabled && !info.enabled) {
      this.io.emit("agent:destroyed", { agentId: `builtin-scheduler-${id}` });
    } else if (!wasEnabled && info.enabled) {
      this.io.emit("agent:spawned", this.buildPseudoAgent(meta));
    }

    return info;
  }

  startAll(): void {
    for (const { instance, meta } of this.entries.values()) {
      const enabledRaw = getConfig(`scheduler:${meta.id}:enabled`);
      const intervalRaw = getConfig(`scheduler:${meta.id}:intervalMs`);
      const enabled = enabledRaw !== undefined ? enabledRaw === "true" : true;
      const intervalMs = intervalRaw ? Number(intervalRaw) : meta.defaultIntervalMs;

      if (enabled) {
        instance.start(intervalMs);
        this.io.emit("agent:spawned", this.buildPseudoAgent(meta));
        console.log(
          `[SchedulerRegistry] Started "${meta.name}" (every ${intervalMs / 1000}s)`,
        );
      } else {
        console.log(`[SchedulerRegistry] "${meta.name}" is disabled, skipping.`);
      }
    }
  }

  /** Return pseudo-agent data for all currently enabled built-in schedulers. */
  getActivePseudoAgents(): Agent[] {
    const agents: Agent[] = [];
    for (const { meta } of this.entries.values()) {
      const enabledRaw = getConfig(`scheduler:${meta.id}:enabled`);
      const enabled = enabledRaw !== undefined ? enabledRaw === "true" : true;
      if (enabled) {
        agents.push(this.buildPseudoAgent(meta));
      }
    }
    return agents;
  }

  private getOne(id: string): SchedulerInfo | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const { meta } = entry;
    const enabledRaw = getConfig(`scheduler:${meta.id}:enabled`);
    const intervalRaw = getConfig(`scheduler:${meta.id}:intervalMs`);
    return {
      ...meta,
      enabled: enabledRaw !== undefined ? enabledRaw === "true" : true,
      intervalMs: intervalRaw ? Number(intervalRaw) : meta.defaultIntervalMs,
    };
  }
}
