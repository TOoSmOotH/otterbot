import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { SkillService } from "../skills/skill-service.js";
import type {
  RegistryEntry,
  RegistryEntryCreate,
  RegistryEntryUpdate,
} from "@otterbot/shared";

export class Registry {
  private skillService = new SkillService();

  list(): RegistryEntry[] {
    const db = getDb();
    const entries = db.select().from(schema.registryEntries).all();
    return entries.map((row) => this.toRegistryEntry(row));
  }

  get(id: string): RegistryEntry | null {
    const db = getDb();
    const entry = db
      .select()
      .from(schema.registryEntries)
      .where(eq(schema.registryEntries.id, id))
      .get();
    return entry ? this.toRegistryEntry(entry) : null;
  }

  create(data: RegistryEntryCreate): RegistryEntry {
    const db = getDb();
    const id = nanoid();
    const entry = {
      id,
      name: data.name,
      description: data.description,
      systemPrompt: data.systemPrompt,
      capabilities: [] as string[],
      defaultModel: data.defaultModel,
      defaultProvider: data.defaultProvider,
      tools: [] as string[],
      builtIn: false,
      role: data.role ?? "worker" as const,
      modelPackId: data.modelPackId ?? null,
      gearConfig: data.gearConfig ? JSON.stringify(data.gearConfig) : null,
      promptAddendum: data.promptAddendum ?? null,
      clonedFromId: data.clonedFromId ?? null,
      createdAt: new Date().toISOString(),
    };
    db.insert(schema.registryEntries).values(entry).run();

    // Assign skills if provided
    if (data.skillIds && data.skillIds.length > 0) {
      this.skillService.setAgentSkills(id, data.skillIds);
    }

    return this.toRegistryEntry(entry);
  }

  update(id: string, data: RegistryEntryUpdate): RegistryEntry | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;
    if (existing.builtIn) return null;

    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.systemPrompt !== undefined) updates.systemPrompt = data.systemPrompt;
    if (data.defaultModel !== undefined) updates.defaultModel = data.defaultModel;
    if (data.defaultProvider !== undefined) updates.defaultProvider = data.defaultProvider;
    if (data.modelPackId !== undefined) updates.modelPackId = data.modelPackId;
    if (data.gearConfig !== undefined) updates.gearConfig = data.gearConfig ? JSON.stringify(data.gearConfig) : null;
    if (data.promptAddendum !== undefined) updates.promptAddendum = data.promptAddendum;

    if (Object.keys(updates).length > 0) {
      db.update(schema.registryEntries)
        .set(updates)
        .where(eq(schema.registryEntries.id, id))
        .run();
    }

    return this.get(id);
  }

  delete(id: string): boolean {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return false;
    if (existing.builtIn) return false;

    // Remove skill assignments first
    db.delete(schema.agentSkills)
      .where(eq(schema.agentSkills.registryEntryId, id))
      .run();

    const result = db
      .delete(schema.registryEntries)
      .where(eq(schema.registryEntries.id, id))
      .run();
    return result.changes > 0;
  }

  clone(id: string): RegistryEntry | null {
    const source = this.get(id);
    if (!source) return null;

    // Get skills from the source entry to copy them
    const sourceSkills = this.skillService.getForAgent(id);
    const skillIds = sourceSkills.map((s) => s.id);

    return this.create({
      name: `${source.name} (Custom)`,
      description: source.description,
      systemPrompt: source.systemPrompt,
      defaultModel: source.defaultModel,
      defaultProvider: source.defaultProvider,
      role: source.role,
      clonedFromId: source.id,
      modelPackId: source.modelPackId,
      gearConfig: source.gearConfig,
      promptAddendum: source.promptAddendum,
      skillIds,
    });
  }

  search(capability: string): RegistryEntry[] {
    const entries = this.list();
    return entries.filter((e) =>
      e.capabilities.some((c) =>
        c.toLowerCase().includes(capability.toLowerCase()),
      ),
    );
  }

  /**
   * Derive tools and capabilities from assigned skills for a registry entry.
   */
  private deriveFromSkills(entryId: string): { tools: string[]; capabilities: string[] } {
    const skills = this.skillService.getForAgent(entryId);
    const tools = [...new Set(skills.flatMap((s) => s.meta.tools))];
    const capabilities = [...new Set(skills.flatMap((s) => s.meta.capabilities))];
    return { tools, capabilities };
  }

  private toRegistryEntry(row: any): RegistryEntry {
    const { tools, capabilities } = this.deriveFromSkills(row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      systemPrompt: row.systemPrompt,
      promptAddendum: row.promptAddendum ?? null,
      capabilities,
      defaultModel: row.defaultModel,
      defaultProvider: row.defaultProvider,
      tools,
      builtIn: row.builtIn ?? false,
      role: row.role ?? "worker",
      modelPackId: row.modelPackId ?? null,
      gearConfig: row.gearConfig ? JSON.parse(row.gearConfig) : null,
      clonedFromId: row.clonedFromId ?? null,
      createdAt: row.createdAt,
    };
  }
}
