/**
 * Poll scheduler for modules with PollTrigger.
 */

import type { PollTrigger } from "@otterbot/shared";
import type { LoadedModule } from "./module-loader.js";
import { setConfig } from "../auth/auth.js";

interface ScheduledPoll {
  moduleId: string;
  timer: ReturnType<typeof setInterval>;
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
    const intervalMs = Math.max(trigger.intervalMs, trigger.minIntervalMs ?? 30_000);

    const timer = setInterval(async () => {
      try {
        await this.executePoll(id, loaded);
      } catch (err) {
        console.error(`[ModuleScheduler] Poll failed for ${id}:`, err);
      }
    }, intervalMs);

    // Don't hold the process open
    timer.unref();

    this.polls.set(id, { moduleId: id, timer });
    console.log(
      `[ModuleScheduler] Started polling for ${id} every ${intervalMs}ms`,
    );

    // Execute first poll immediately (non-blocking)
    this.executePoll(id, loaded).catch((err) => {
      console.error(`[ModuleScheduler] Initial poll failed for ${id}:`, err);
    });
  }

  /** Stop polling for a module. */
  stopModule(id: string): void {
    const poll = this.polls.get(id);
    if (poll) {
      clearInterval(poll.timer);
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
