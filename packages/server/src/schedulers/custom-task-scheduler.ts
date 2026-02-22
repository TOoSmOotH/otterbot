import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type { MessageBus } from "../bus/message-bus.js";
import { MessageType, AgentRole, AgentStatus } from "@otterbot/shared";
import type { Agent } from "@otterbot/shared";
import type { Server } from "socket.io";

export const MIN_CUSTOM_TASK_INTERVAL_MS = 60_000;
export const NO_REPORT_SENTINEL = "[NO_REPORT]";
/** How long (ms) the scheduler pseudo-agent shows as "acting" before reverting to idle */
const ACTING_DURATION_MS = 15_000;

export type CustomTaskRow = typeof schema.customScheduledTasks.$inferSelect;

export class CustomTaskScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  /** Timeouts for reverting acting→idle after a task fires */
  private actingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private bus: MessageBus;
  private io: Server;

  constructor(bus: MessageBus, io: Server) {
    this.bus = bus;
    this.io = io;
  }

  /** Build a pseudo-agent data object for a scheduled task (socket-only, no DB row). */
  private buildPseudoAgent(task: CustomTaskRow, status: AgentStatus = AgentStatus.Idle): Agent {
    return {
      id: `scheduler-${task.id}`,
      name: task.name,
      registryEntryId: null,
      role: AgentRole.Scheduler,
      parentId: null,
      status,
      model: "",
      provider: "",
      projectId: null,
      modelPackId: null,
      gearConfig: null,
      workspacePath: null,
      createdAt: task.createdAt,
    };
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

    // Emit pseudo-agent spawned if starting a new task (e.g. via API create/enable)
    this.io.emit("agent:spawned", this.buildPseudoAgent(task));
  }

  stopTask(taskId: string): void {
    const hadTimer = this.timers.has(taskId);
    const timer = this.timers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(taskId);
    }
    const actingTimeout = this.actingTimeouts.get(taskId);
    if (actingTimeout) {
      clearTimeout(actingTimeout);
      this.actingTimeouts.delete(taskId);
    }
    // Only emit destroyed if there was actually a running task
    if (hadTimer) {
      this.io.emit("agent:destroyed", { agentId: `scheduler-${taskId}` });
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

  /** Return pseudo-agent data for all currently-running scheduler tasks. */
  getActivePseudoAgents(): Agent[] {
    const db = getDb();
    const agents: Agent[] = [];
    for (const taskId of this.timers.keys()) {
      const task = db
        .select()
        .from(schema.customScheduledTasks)
        .where(eq(schema.customScheduledTasks.id, taskId))
        .get();
      if (task) {
        agents.push(this.buildPseudoAgent(task));
      }
    }
    return agents;
  }

  stopAll(): void {
    for (const [taskId] of this.timers) {
      this.io.emit("agent:destroyed", { agentId: `scheduler-${taskId}` });
    }
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    for (const timeout of this.actingTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.actingTimeouts.clear();
  }

  private fireTask(task: CustomTaskRow): void {
    const now = new Date().toISOString();
    const agentId = `scheduler-${task.id}`;

    // Update lastRunAt in DB
    const db = getDb();
    db.update(schema.customScheduledTasks)
      .set({ lastRunAt: now, updatedAt: now })
      .where(eq(schema.customScheduledTasks.id, task.id))
      .run();

    // Show pseudo-agent as acting in 3D view
    this.io.emit("agent:status", { agentId, status: AgentStatus.Acting });

    // Revert to idle after a delay
    const prevTimeout = this.actingTimeouts.get(task.id);
    if (prevTimeout) clearTimeout(prevTimeout);
    this.actingTimeouts.set(
      task.id,
      setTimeout(() => {
        this.io.emit("agent:status", { agentId, status: AgentStatus.Idle });
        this.actingTimeouts.delete(task.id);
      }, ACTING_DURATION_MS),
    );

    const baseMeta = { source: "custom-scheduled-task", taskId: task.id, taskName: task.name };

    if (task.mode === "coo-prompt") {
      // Send as a user message to COO — it will process it like a user message
      this.bus.send({
        fromAgentId: null,
        toAgentId: "coo",
        type: MessageType.Chat,
        content: task.message,
        metadata: baseMeta,
      });
    } else if (task.mode === "coo-background") {
      // Send to COO but suppress from chat. COO only responds if there's
      // something to report — otherwise it replies with [NO_REPORT] which
      // the broadcast handler filters out.
      const wrappedMessage = [
        task.message,
        "",
        "---",
        "IMPORTANT: This is an automated background check. Perform the requested task using your tools.",
        `If there is nothing meaningful to report, respond with exactly: ${NO_REPORT_SENTINEL}`,
        "Only provide a substantive response if you found something worth telling the user about.",
      ].join("\n");
      this.bus.send({
        fromAgentId: null,
        toAgentId: "coo",
        type: MessageType.Chat,
        content: wrappedMessage,
        metadata: { ...baseMeta, backgroundTask: true },
      });
    } else {
      // notification mode: post as a COO message to the chat (no agent processing)
      this.bus.send({
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: task.message,
        metadata: baseMeta,
      });
    }

    console.log(
      `[CustomTaskScheduler] Fired task "${task.name}" (mode=${task.mode})`,
    );
  }
}
