import { nanoid } from "nanoid";
import { AgentRole, AgentStatus, type Agent as AgentData } from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

const ADMIN_ASSISTANT_ID = "admin-assistant";

export interface AdminAssistantOptions {
  model: string;
  provider: string;
  baseUrl?: string;
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
}

/**
 * AdminAssistant is a placeholder agent that exists in the main office.
 * It has no LLM capabilities yet — it simply registers in the DB and
 * is visually present in the 3D world.
 */
export class AdminAssistant {
  readonly id = ADMIN_ASSISTANT_ID;
  private status: AgentStatus = AgentStatus.Idle;
  private options: AdminAssistantOptions;

  constructor(options: AdminAssistantOptions) {
    this.options = options;
  }

  /** Spawn the admin assistant (insert into DB if not already present) */
  async spawn(): Promise<AgentData> {
    const db = getDb();

    // Check if already exists
    const existing = db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, this.id))
      .get();

    if (existing) {
      // Update status to idle on restart
      db.update(schema.agents)
        .set({ status: "idle" })
        .where(eq(schema.agents.id, this.id))
        .run();

      return this.toAgentData();
    }

    // Insert new agent
    db.insert(schema.agents)
      .values({
        id: this.id,
        role: "admin_assistant",
        parentId: null,
        status: "idle",
        model: this.options.model,
        provider: this.options.provider,
        baseUrl: this.options.baseUrl ?? null,
        projectId: null,
      })
      .run();

    return this.toAgentData();
  }

  private toAgentData(): AgentData {
    return {
      id: this.id,
      registryEntryId: null,
      role: AgentRole.AdminAssistant,
      parentId: null,
      status: this.status,
      model: this.options.model,
      provider: this.options.provider,
      baseUrl: this.options.baseUrl,
      projectId: null,
      modelPackId: null,
      gearConfig: null,
      workspacePath: null,
      createdAt: new Date().toISOString(),
    };
  }
}
