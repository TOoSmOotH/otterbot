import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type { MessageBus } from "../bus/message-bus.js";
import { MessageType } from "@otterbot/shared";
import type { Server } from "socket.io";

export const MIN_CUSTOM_TASK_INTERVAL_MS = 60_000;

export type CustomTaskRow = typeof schema.customScheduledTasks.$inferSelect;

export class CustomTaskScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private bus: MessageBus;
  private io: Server;

  constructor(bus: MessageBus, io: Server) {
    this.bus = bus;
    this.io = io;
  }

  /** Load all enabled custom tasks from DB and start their timers. */
  loadAndStart(): void {
    const db = getDb();
    const tasks = db
      .select()
      .from(schema.customScheduledTasks)
      .all();

    for (const task of tasks) {
      if (task.enabled) {
        this.startTask(task);
      }
    }

    console.log(
      `[CustomTaskScheduler] Loaded ${tasks.length} custom tasks (${tasks.filter((t) => t.enabled).length} enabled)`,
    );
  }

  startTask(task: CustomTaskRow): void {
    // Clear any existing timer first
    this.stopTask(task.id);

    const intervalMs = Math.max(task.intervalMs, MIN_CUSTOM_TASK_INTERVAL_MS);

    const timer = setInterval(() => {
      this.fireTask(task);
    }, intervalMs);

    this.timers.set(task.id, timer);
  }

  stopTask(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(taskId);
    }
  }

  restartTask(taskId: string): void {
    this.stopTask(taskId);

    const db = getDb();
    const task = db
      .select()
      .from(schema.customScheduledTasks)
      .where(eq(schema.customScheduledTasks.id, taskId))
      .get();

    if (task && task.enabled) {
      this.startTask(task);
    }
  }

  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  private fireTask(task: CustomTaskRow): void {
    const now = new Date().toISOString();

    // Update lastRunAt in DB
    const db = getDb();
    db.update(schema.customScheduledTasks)
      .set({ lastRunAt: now, updatedAt: now })
      .where(eq(schema.customScheduledTasks.id, task.id))
      .run();

    if (task.mode === "coo-prompt") {
      // Send as a user message to COO — it will process it like a user message
      this.bus.send({
        fromAgentId: null,
        toAgentId: "coo",
        type: MessageType.Chat,
        content: task.message,
        metadata: { source: "custom-scheduled-task", taskId: task.id, taskName: task.name },
      });
    } else {
      // notification mode: post as a COO message to the chat (no agent processing)
      this.bus.send({
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: task.message,
        metadata: { source: "custom-scheduled-task", taskId: task.id, taskName: task.name },
      });
    }

    console.log(
      `[CustomTaskScheduler] Fired task "${task.name}" (mode=${task.mode})`,
    );
  }
}
