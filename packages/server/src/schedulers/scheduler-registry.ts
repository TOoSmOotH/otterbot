import { getConfig, setConfig } from "../auth/auth.js";

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
        console.log(
          `[SchedulerRegistry] Started "${meta.name}" (every ${intervalMs / 1000}s)`,
        );
      } else {
        console.log(`[SchedulerRegistry] "${meta.name}" is disabled, skipping.`);
      }
    }
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
