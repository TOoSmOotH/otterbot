import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import { eq, and, lte, not } from "drizzle-orm";
import type { MessageBus } from "../bus/message-bus.js";
import { emitTodoEvent } from "../tools/todo-emitter.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class ReminderScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private bus: MessageBus;
  private io: TypedServer;

  constructor(bus: MessageBus, io: TypedServer) {
    this.bus = bus;
    this.io = io;
  }

  /** Start the polling loop */
  start(pollIntervalMs = 30_000): void {
    if (this.intervalId) return;
    // Run immediately on start, then on interval
    this.poll().catch((err) => {
      console.error("[ReminderScheduler] Initial poll error:", err);
    });
    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[ReminderScheduler] Poll error:", err);
      });
    }, pollIntervalMs);
    console.log(`[ReminderScheduler] Started polling every ${pollIntervalMs / 1000}s`);
  }

  /** Stop the polling loop */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Check for due reminders and fire them */
  async poll(): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();

    // Find todos with a reminderAt that has passed and are not done
    const dueTodos = db
      .select()
      .from(schema.todos)
      .where(
        and(
          not(eq(schema.todos.status, "done")),
          lte(schema.todos.reminderAt, now),
        ),
      )
      .all()
      .filter((t) => t.reminderAt !== null);

    for (const todo of dueTodos) {
      // 1. Emit reminder:fired to frontend
      this.io.emit("reminder:fired", { todoId: todo.id, title: todo.title });

      // 2. Send a COO chat message so it appears in the chat UI
      const descLine = todo.description ? `\n\n${todo.description}` : "";
      this.bus.send({
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: `Reminder: **${todo.title}**${descLine}`,
      });

      // 3. Clear reminderAt to prevent re-firing
      db.update(schema.todos)
        .set({ reminderAt: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.todos.id, todo.id))
        .run();

      // 4. Emit todo:updated so the UI refreshes
      const updated = db.select().from(schema.todos).where(eq(schema.todos.id, todo.id)).get();
      if (updated) emitTodoEvent("updated", updated as any);

      console.log(`[ReminderScheduler] Fired reminder for todo "${todo.title}" (${todo.id})`);
    }
  }
}
