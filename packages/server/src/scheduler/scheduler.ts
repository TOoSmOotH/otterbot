import { Cron } from "croner";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { ScheduledTask } from "@otterbot/shared";
import { controlSchema, type ControlDb } from "../db/control-db.js";

/** Minimal shape the scheduler needs from a runtime to fire a prompt. */
export interface SchedulableRuntime {
  respond(args: {
    conversationId: string;
    userMessage: string;
    onChunk: () => void;
  }): Promise<unknown>;
}

/**
 * Fires cron-scheduled prompts against agents. Backed by the control DB's
 * `scheduled_tasks` table; uses `croner` for the actual timing.
 */
export class Scheduler {
  private readonly jobs = new Map<string, Cron>();

  constructor(
    private readonly control: ControlDb,
    private readonly getRuntime: (agentId: string) => SchedulableRuntime | undefined
  ) {}

  /** Arm every enabled task. Call once at boot. */
  start(): void {
    for (const task of this.list()) {
      if (task.enabled) this.arm(task);
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  /** Create a new scheduled task and arm it. Returns null if the cron is invalid. */
  add(agentId: string, cron: string, prompt: string): ScheduledTask | null {
    let nextRunAt: string | null = null;
    try {
      nextRunAt = new Cron(cron).nextRun()?.toISOString() ?? null;
    } catch {
      return null; // invalid cron expression
    }
    const task: ScheduledTask = {
      id: nanoid(),
      agentId,
      cron,
      prompt,
      enabled: true,
      lastRunAt: null,
      nextRunAt,
    };
    this.control.db.insert(controlSchema.scheduledTasks).values(task).run();
    this.arm(task);
    return task;
  }

  /** Disable and unschedule a task. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
    const res = this.control.db
      .update(controlSchema.scheduledTasks)
      .set({ enabled: false })
      .where(eq(controlSchema.scheduledTasks.id, id))
      .run();
    return res.changes > 0;
  }

  /** List scheduled tasks, optionally filtered to one agent. */
  list(agentId?: string): ScheduledTask[] {
    const rows = this.control.db.select().from(controlSchema.scheduledTasks).all();
    return rows.filter((r) => !agentId || r.agentId === agentId);
  }

  private arm(task: ScheduledTask): void {
    try {
      const job = new Cron(task.cron, () => void this.fire(task.id));
      this.jobs.set(task.id, job);
    } catch (err) {
      console.warn(`[scheduler] could not arm task ${task.id}:`, err);
    }
  }

  private async fire(taskId: string): Promise<void> {
    const task = this.control.db
      .select()
      .from(controlSchema.scheduledTasks)
      .where(eq(controlSchema.scheduledTasks.id, taskId))
      .get();
    if (!task || !task.enabled) return;

    const runtime = this.getRuntime(task.agentId);
    const now = new Date().toISOString();
    const nextRunAt = this.jobs.get(taskId)?.nextRun()?.toISOString() ?? null;

    if (runtime) {
      try {
        await runtime.respond({
          conversationId: `sched-${taskId}-${Date.now()}`,
          userMessage: task.prompt,
          onChunk: () => {},
        });
      } catch (err) {
        console.error(`[scheduler] task ${taskId} failed:`, err);
      }
    }

    this.control.db
      .update(controlSchema.scheduledTasks)
      .set({ lastRunAt: now, nextRunAt })
      .where(eq(controlSchema.scheduledTasks.id, taskId))
      .run();
  }
}
