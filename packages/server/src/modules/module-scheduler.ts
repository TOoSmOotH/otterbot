/**
 * Poll scheduler for modules with PollTrigger.
 */

import type { PollTrigger } from "@otterbot/shared";
import type { LoadedModule } from "./module-loader.js";
import type { SchedulerInfo } from "../schedulers/scheduler-registry.js";
import { getConfig, setConfig } from "../auth/auth.js";

interface ScheduledPoll {
  moduleId: string;
  timer: ReturnType<typeof setInterval> | null;
  loaded: LoadedModule;
  trigger: PollTrigger;
  effectiveIntervalMs: number;
}

export class ModuleScheduler {
  private polls = new Map<string, ScheduledPoll>();

  /** Start poll timers for all loaded modules that have poll triggers. */
  startAll(modules: Map<string, LoadedModule>): void {
    for (const [id, loaded] of modules) {
      this.startModule(id, loaded);
    }
  }

  /** Start polling for a single module. */
  startModule(id: string, loaded: LoadedModule): void {
    if (this.polls.has(id)) return;

    const pollTriggers = (loaded.definition.triggers ?? []).filter(
      (t): t is PollTrigger => t.type === "poll",
    );

    if (pollTriggers.length === 0 || !loaded.definition.onPoll) return;

    const trigger = pollTriggers[0];
    const minMs = trigger.minIntervalMs ?? 30_000;

    // Check config overrides
    const enabledRaw = getConfig(`module:${id}:poll_enabled`);
    const enabled = enabledRaw !== "false";

    const intervalRaw = getConfig(`module:${id}:poll_interval_ms`);
    const effectiveIntervalMs = Math.max(
      intervalRaw ? Number(intervalRaw) : trigger.intervalMs,
      minMs,
    );

    let timer: ReturnType<typeof setInterval> | null = null;

    if (enabled) {
      timer = setInterval(async () => {
        try {
          await this.executePoll(id, loaded);
        } catch (err) {
          console.error(`[ModuleScheduler] Poll failed for ${id}:`, err);
        }
      }, effectiveIntervalMs);

      // Don't hold the process open
      timer.unref();
    }

    this.polls.set(id, { moduleId: id, timer, loaded, trigger, effectiveIntervalMs });
    console.log(
      enabled
        ? `[ModuleScheduler] Started polling for ${id} every ${effectiveIntervalMs}ms`
        : `[ModuleScheduler] Poll registered but disabled for ${id}`,
    );

    // Execute first poll immediately (non-blocking) if enabled
    if (enabled) {
      this.executePoll(id, loaded).catch((err) => {
        console.error(`[ModuleScheduler] Initial poll failed for ${id}:`, err);
      });
    }
  }

  /** Stop polling for a module. */
  stopModule(id: string): void {
    const poll = this.polls.get(id);
    if (poll) {
      if (poll.timer) clearInterval(poll.timer);
      this.polls.delete(id);
      console.log(`[ModuleScheduler] Stopped polling for ${id}`);
    }
  }

  /** Stop all polls. */
  stopAll(): void {
    for (const id of [...this.polls.keys()]) {
      this.stopModule(id);
    }
  }

  /** Return all module polls as SchedulerInfo for the scheduled-tasks API. */
  getAll(): SchedulerInfo[] {
    const result: SchedulerInfo[] = [];
    for (const [id, poll] of this.polls) {
      const manifest = poll.loaded.definition.manifest;
      const enabledRaw = getConfig(`module:${id}:poll_enabled`);
      const intervalRaw = getConfig(`module:${id}:poll_interval_ms`);
      const minMs = poll.trigger.minIntervalMs ?? 30_000;

      result.push({
        id: `module-poll:${id}`,
        name: `${manifest.name} (Data Sync)`,
        description: manifest.description,
        defaultIntervalMs: poll.trigger.intervalMs,
        minIntervalMs: minMs,
        enabled: enabledRaw !== "false",
        intervalMs: intervalRaw
          ? Math.max(Number(intervalRaw), minMs)
          : poll.trigger.intervalMs,
      });
    }
    return result;
  }

  /** Update a module poll's enabled/interval settings. Returns updated info or null. */
  update(
    taskId: string,
    patch: { enabled?: boolean; intervalMs?: number },
  ): SchedulerInfo | null {
    const moduleId = taskId.replace(/^module-poll:/, "");
    const poll = this.polls.get(moduleId);
    if (!poll) return null;

    const minMs = poll.trigger.minIntervalMs ?? 30_000;

    // Persist settings
    if (patch.enabled !== undefined) {
      setConfig(`module:${moduleId}:poll_enabled`, String(patch.enabled));
    }
    if (patch.intervalMs !== undefined) {
      const clamped = Math.max(patch.intervalMs, minMs);
      setConfig(`module:${moduleId}:poll_interval_ms`, String(clamped));
    }

    // Re-read config to get current state
    const enabledRaw = getConfig(`module:${moduleId}:poll_enabled`);
    const enabled = enabledRaw !== "false";
    const intervalRaw = getConfig(`module:${moduleId}:poll_interval_ms`);
    const effectiveIntervalMs = Math.max(
      intervalRaw ? Number(intervalRaw) : poll.trigger.intervalMs,
      minMs,
    );

    // Stop existing timer
    if (poll.timer) {
      clearInterval(poll.timer);
      poll.timer = null;
    }

    // Restart if enabled
    if (enabled) {
      const timer = setInterval(async () => {
        try {
          await this.executePoll(moduleId, poll.loaded);
        } catch (err) {
          console.error(`[ModuleScheduler] Poll failed for ${moduleId}:`, err);
        }
      }, effectiveIntervalMs);
      timer.unref();
      poll.timer = timer;
    }

    poll.effectiveIntervalMs = effectiveIntervalMs;

    const manifest = poll.loaded.definition.manifest;
    return {
      id: taskId,
      name: `${manifest.name} (Data Sync)`,
      description: manifest.description,
      defaultIntervalMs: poll.trigger.intervalMs,
      minIntervalMs: minMs,
      enabled,
      intervalMs: effectiveIntervalMs,
    };
  }

  /** Execute a single poll cycle for a module. When fullSync is true, uses onFullSync if available. */
  async executePoll(id: string, loaded: LoadedModule, fullSync?: boolean): Promise<number> {
    const handler = fullSync && loaded.definition.onFullSync
      ? loaded.definition.onFullSync
      : loaded.definition.onPoll;

    if (!handler) return 0;

    const result = await handler(loaded.context);

    // Auto-ingest items into knowledge store
    for (const item of result.items) {
      const content = `# ${item.title}\n\n${item.content}`;
      const metadata: Record<string, unknown> = {
        ...item.metadata,
        ...(item.url ? { url: item.url } : {}),
        title: item.title,
      };

      await loaded.knowledgeStore.upsert(item.id, content, metadata);
    }

    // Track last poll time
    setConfig(`module:${id}:last_polled_at`, new Date().toISOString());

    if (result.items.length > 0) {
      loaded.context.log(`Polled ${result.items.length} items`);
    }

    return result.items.length;
  }
}
