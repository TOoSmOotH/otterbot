import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type {
  CustomTool,
  CustomToolCreate,
  CustomToolUpdate,
  CustomToolParameter,
} from "@otterbot/shared";

export class CustomToolService {
  list(): CustomTool[] {
    const db = getDb();
    const rows = db.select().from(schema.customTools).all();
    return rows.map(this.toCustomTool);
  }

  get(id: string): CustomTool | null {
    const db = getDb();
    const row = db
      .select()
      .from(schema.customTools)
      .where(eq(schema.customTools.id, id))
      .get();
    return row ? this.toCustomTool(row) : null;
  }

  getByName(name: string): CustomTool | null {
    const db = getDb();
    const row = db
      .select()
      .from(schema.customTools)
      .where(eq(schema.customTools.name, name))
      .get();
    return row ? this.toCustomTool(row) : null;
  }

  create(data: CustomToolCreate): CustomTool {
    const db = getDb();
    const now = new Date().toISOString();
    const id = nanoid();

    const row = {
      id,
      name: data.name,
      description: data.description,
      parameters: data.parameters as any,
      code: data.code,
      timeout: data.timeout ?? 30000,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(schema.customTools).values(row).run();
    return this.toCustomTool(row);
  }

  update(id: string, data: CustomToolUpdate): CustomTool | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.parameters !== undefined) updates.parameters = data.parameters;
    if (data.code !== undefined) updates.code = data.code;
    if (data.timeout !== undefined) updates.timeout = data.timeout;

    db.update(schema.customTools)
      .set(updates)
      .where(eq(schema.customTools.id, id))
      .run();

    return this.get(id);
  }

  delete(id: string): boolean {
    const db = getDb();
    const result = db
      .delete(schema.customTools)
      .where(eq(schema.customTools.id, id))
      .run();
    return result.changes > 0;
  }

  /** Check if a name is available (not used by any built-in or custom tool) */
  isNameAvailable(name: string, excludeId?: string): boolean {
    const existing = this.getByName(name);
    if (existing && existing.id !== excludeId) return false;
    return true;
  }

  private toCustomTool(row: any): CustomTool {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      parameters: row.parameters as CustomToolParameter[],
      code: row.code,
      timeout: row.timeout,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
