/**
 * Scenario playback engine for mock mode.
 *
 * Executes scenario steps sequentially with delays:
 * - "user-message": sends a chat message through the MessageBus to the COO
 * - "wait-for-idle": polls the agents table until all agents are idle/done
 */
import { nanoid } from "nanoid";
import { eq, and, notInArray } from "drizzle-orm";
import type { MessageBus } from "../bus/message-bus.js";
import type { COO } from "../agents/coo.js";
import type { Server } from "socket.io";
import { getDb, schema } from "../db/index.js";
import { getScenario } from "./scenarios/index.js";
import { setActiveResponses, resetCallCounts } from "./mock-llm.js";

export class ScenarioRunner {
  private bus: MessageBus;
  private coo: COO;
  private io: Server;

  constructor(bus: MessageBus, coo: COO, io: Server) {
    this.bus = bus;
    this.coo = coo;
    this.io = io;
  }

  async start(scenarioId: string): Promise<void> {
    const scenario = getScenario(scenarioId);
    if (!scenario) {
      console.error(`[scenario-runner] Unknown scenario: "${scenarioId}"`);
      console.error(
        `[scenario-runner] Available scenarios can be registered via import`,
      );
      return;
    }

    console.log(
      `[scenario-runner] Starting scenario: "${scenario.name}" (${scenario.steps.length} steps)`,
    );

    // Set the stream delay from scenario (can be overridden by MOCK_STREAM_DELAY env)
    if (!process.env.MOCK_STREAM_DELAY) {
      process.env.MOCK_STREAM_DELAY = String(scenario.streamDelayMs);
    }

    // Load scenario responses into the mock LLM
    resetCallCounts();
    setActiveResponses(scenario.responses);

    // Execute steps sequentially
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      console.log(
        `[scenario-runner] Step ${i + 1}/${scenario.steps.length}: ${step.type}`,
      );

      if (step.delayMs > 0) {
        await sleep(step.delayMs);
      }

      switch (step.type) {
        case "user-message":
          await this.sendUserMessage(step.content);
          break;
        case "wait-for-idle":
          await this.waitForIdle();
          break;
      }
    }

    console.log(`[scenario-runner] Scenario "${scenario.name}" completed.`);
  }

  /**
   * Send a message as the CEO (user) to the COO, replicating the
   * socket "ceo:message" handler flow.
   */
  private async sendUserMessage(content: string): Promise<void> {
    const db = getDb();

    // Create a conversation if the COO doesn't have one
    let conversationId = this.coo.getCurrentConversationId();
    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      db.insert(schema.conversations)
        .values({
          id: conversationId,
          title: content.slice(0, 80),
          projectId: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      this.coo.startNewConversation(conversationId, null, null);
      this.io.emit("conversation:created", {
        id: conversationId,
        title: content.slice(0, 80),
        projectId: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    console.log(
      `[scenario-runner] Sending user message: "${content.slice(0, 60)}..."`,
    );

    // Send via bus (same as the socket handler)
    this.bus.send({
      fromAgentId: null, // CEO
      toAgentId: "coo",
      type: "chat" as any,
      content,
      conversationId,
    });
  }

  /**
   * Wait until all agents in the DB are idle or done.
   * Polls every 500ms with a maximum timeout of 5 minutes.
   */
  private async waitForIdle(): Promise<void> {
    const MAX_WAIT_MS = 5 * 60_000;
    const POLL_INTERVAL_MS = 500;
    const start = Date.now();

    while (Date.now() - start < MAX_WAIT_MS) {
      const db = getDb();
      const busyAgents = db
        .select({ id: schema.agents.id, status: schema.agents.status })
        .from(schema.agents)
        .where(
          and(
            notInArray(schema.agents.status, ["idle", "done", "error"]),
          ),
        )
        .all();

      if (busyAgents.length === 0) {
        console.log(`[scenario-runner] All agents idle.`);
        return;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    console.warn(
      `[scenario-runner] Timed out waiting for agents to become idle.`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
