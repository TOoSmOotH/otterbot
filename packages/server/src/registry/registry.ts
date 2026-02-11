import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type {
  RegistryEntry,
  RegistryEntryCreate,
  RegistryEntryUpdate,
} from "@smoothbot/shared";

export class Registry {
  list(): RegistryEntry[] {
    const db = getDb();
    const entries = db.select().from(schema.registryEntries).all();
    return entries.map(this.toRegistryEntry);
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
    const entry = {
      id: nanoid(),
      name: data.name,
      description: data.description,
      systemPrompt: data.systemPrompt,
      capabilities: data.capabilities,
      defaultModel: data.defaultModel,
      defaultProvider: data.defaultProvider,
      tools: data.tools,
      createdAt: new Date().toISOString(),
    };
    db.insert(schema.registryEntries).values(entry).run();
    return this.toRegistryEntry(entry);
  }

  update(id: string, data: RegistryEntryUpdate): RegistryEntry | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;

    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.systemPrompt !== undefined) updates.systemPrompt = data.systemPrompt;
    if (data.capabilities !== undefined) updates.capabilities = data.capabilities;
    if (data.defaultModel !== undefined) updates.defaultModel = data.defaultModel;
    if (data.defaultProvider !== undefined) updates.defaultProvider = data.defaultProvider;
    if (data.tools !== undefined) updates.tools = data.tools;

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
    const result = db
      .delete(schema.registryEntries)
      .where(eq(schema.registryEntries.id, id))
      .run();
    return result.changes > 0;
  }

  search(capability: string): RegistryEntry[] {
    const entries = this.list();
    return entries.filter((e) =>
      e.capabilities.some((c) =>
        c.toLowerCase().includes(capability.toLowerCase()),
      ),
    );
  }

  private toRegistryEntry(row: any): RegistryEntry {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      systemPrompt: row.systemPrompt,
      capabilities: row.capabilities as string[],
      defaultModel: row.defaultModel,
      defaultProvider: row.defaultProvider,
      tools: row.tools as string[],
      createdAt: row.createdAt,
    };
  }
}
