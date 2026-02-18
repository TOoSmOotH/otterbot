import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import matter from "gray-matter";
import { getDb, schema } from "../db/index.js";
import { scanSkillContent } from "./skill-scanner.js";
import type {
  Skill,
  SkillCreate,
  SkillUpdate,
  SkillMeta,
  SkillParameterDef,
  ScanReport,
  SkillScanStatus,
  SkillSource,
} from "@otterbot/shared";

export class SkillService {
  /**
   * Parse a raw .md skill file into meta + body.
   * Uses gray-matter for frontmatter extraction.
   */
  parseSkillFile(raw: string): { meta: SkillMeta; body: string } {
    const { data, content } = matter(raw);

    const meta: SkillMeta = {
      name: data.name ?? "Untitled Skill",
      description: data.description ?? "",
      version: data.version ?? "1.0.0",
      author: data.author ?? "",
      tools: Array.isArray(data.tools) ? data.tools : [],
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
      parameters: (data.parameters && typeof data.parameters === "object")
        ? data.parameters as Record<string, SkillParameterDef>
        : {},
      tags: Array.isArray(data.tags) ? data.tags : [],
    };

    return { meta, body: content.trim() };
  }

  /**
   * Serialize skill meta + body back to a .md file string.
   */
  serializeSkillFile(meta: SkillMeta, body: string): string {
    const frontmatter: Record<string, unknown> = {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
    };
    if (meta.tools.length > 0) frontmatter.tools = meta.tools;
    if (meta.capabilities.length > 0) frontmatter.capabilities = meta.capabilities;
    if (Object.keys(meta.parameters).length > 0) frontmatter.parameters = meta.parameters;
    if (meta.tags.length > 0) frontmatter.tags = meta.tags;

    return matter.stringify(body, frontmatter);
  }

  list(): Skill[] {
    const db = getDb();
    const rows = db.select().from(schema.skills).all();
    return rows.map(this.toSkill);
  }

  get(id: string): Skill | null {
    const db = getDb();
    const row = db
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.id, id))
      .get();
    return row ? this.toSkill(row) : null;
  }

  create(data: SkillCreate, scanReport?: ScanReport, opts?: { id?: string; source?: SkillSource; clonedFromId?: string | null }): Skill {
    const db = getDb();
    const now = new Date().toISOString();
    const scanStatus = this.deriveScanStatus(scanReport);

    const row = {
      id: opts?.id ?? nanoid(),
      name: data.meta.name,
      description: data.meta.description,
      version: data.meta.version,
      author: data.meta.author,
      tools: data.meta.tools,
      capabilities: data.meta.capabilities,
      parameters: data.meta.parameters as Record<string, unknown>,
      tags: data.meta.tags,
      body: data.body,
      source: opts?.source ?? "created",
      clonedFromId: opts?.clonedFromId ?? null,
      scanStatus,
      scanFindings: scanReport?.findings ?? [],
      createdAt: now,
      updatedAt: now,
    };

    db.insert(schema.skills).values(row).run();
    return this.toSkill(row);
  }

  update(id: string, data: SkillUpdate): Skill | null {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return null;

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (data.meta) {
      if (data.meta.name !== undefined) updates.name = data.meta.name;
      if (data.meta.description !== undefined) updates.description = data.meta.description;
      if (data.meta.version !== undefined) updates.version = data.meta.version;
      if (data.meta.author !== undefined) updates.author = data.meta.author;
      if (data.meta.tools !== undefined) updates.tools = data.meta.tools;
      if (data.meta.capabilities !== undefined) updates.capabilities = data.meta.capabilities;
      if (data.meta.parameters !== undefined) updates.parameters = data.meta.parameters;
      if (data.meta.tags !== undefined) updates.tags = data.meta.tags;
    }

    if (data.body !== undefined) updates.body = data.body;

    // Re-scan after update
    const newMeta = { ...existing.meta, ...data.meta };
    const newBody = data.body ?? existing.body;
    const raw = this.serializeSkillFile(newMeta, newBody);
    const scanReport = scanSkillContent(raw);
    updates.scanStatus = this.deriveScanStatus(scanReport);
    updates.scanFindings = scanReport.findings;

    db.update(schema.skills)
      .set(updates)
      .where(eq(schema.skills.id, id))
      .run();

    return this.get(id);
  }

  delete(id: string): boolean {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return false;

    // Remove agent skill assignments first
    db.delete(schema.agentSkills)
      .where(eq(schema.agentSkills.skillId, id))
      .run();

    const result = db
      .delete(schema.skills)
      .where(eq(schema.skills.id, id))
      .run();
    return result.changes > 0;
  }

  /**
   * Clone a skill. Returns the new skill with source "cloned".
   */
  clone(id: string): Skill | null {
    const source = this.get(id);
    if (!source) return null;

    return this.create(
      { meta: { ...source.meta, name: `${source.meta.name} (Clone)` }, body: source.body },
      undefined,
      { source: "cloned", clonedFromId: id },
    );
  }

  /**
   * Upsert a built-in skill (for seeding on startup).
   * If the skill already exists, updates it. Otherwise inserts it.
   */
  upsert(id: string, data: SkillCreate, source: SkillSource = "built-in"): Skill {
    const db = getDb();
    const now = new Date().toISOString();

    db.insert(schema.skills)
      .values({
        id,
        name: data.meta.name,
        description: data.meta.description,
        version: data.meta.version,
        author: data.meta.author,
        tools: data.meta.tools,
        capabilities: data.meta.capabilities,
        parameters: data.meta.parameters as Record<string, unknown>,
        tags: data.meta.tags,
        body: data.body,
        source,
        clonedFromId: null,
        scanStatus: "clean",
        scanFindings: [],
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.skills.id,
        set: {
          name: data.meta.name,
          description: data.meta.description,
          version: data.meta.version,
          author: data.meta.author,
          tools: data.meta.tools,
          capabilities: data.meta.capabilities,
          parameters: data.meta.parameters as Record<string, unknown>,
          tags: data.meta.tags,
          body: data.body,
          source,
          scanStatus: "clean",
          scanFindings: [],
          updatedAt: now,
        },
      })
      .run();

    return this.get(id)!;
  }

  /**
   * Export a skill as a markdown file string.
   */
  exportAsMarkdown(id: string): string | null {
    const skill = this.get(id);
    if (!skill) return null;
    return this.serializeSkillFile(skill.meta, skill.body);
  }

  /**
   * Get skills assigned to an agent template.
   */
  getForAgent(registryEntryId: string): Skill[] {
    const db = getDb();
    const assignments = db
      .select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.registryEntryId, registryEntryId))
      .all();

    const skills: Skill[] = [];
    for (const assignment of assignments) {
      const skill = this.get(assignment.skillId);
      if (skill) skills.push(skill);
    }
    return skills;
  }

  /**
   * Set the skills assigned to an agent template (replaces all).
   */
  setAgentSkills(registryEntryId: string, skillIds: string[]): void {
    const db = getDb();

    // Remove existing assignments
    db.delete(schema.agentSkills)
      .where(eq(schema.agentSkills.registryEntryId, registryEntryId))
      .run();

    // Insert new assignments
    for (const skillId of skillIds) {
      db.insert(schema.agentSkills)
        .values({ registryEntryId, skillId })
        .run();
    }
  }

  private deriveScanStatus(report?: ScanReport): SkillScanStatus {
    if (!report) return "unscanned";
    if (report.findings.some((f: { severity: string }) => f.severity === "error")) return "errors";
    if (report.findings.some((f: { severity: string }) => f.severity === "warning")) return "warnings";
    return "clean";
  }

  private toSkill(row: any): Skill {
    return {
      id: row.id,
      meta: {
        name: row.name,
        description: row.description,
        version: row.version,
        author: row.author,
        tools: row.tools as string[],
        capabilities: row.capabilities as string[],
        parameters: row.parameters as Record<string, SkillParameterDef>,
        tags: row.tags as string[],
      },
      body: row.body,
      source: row.source ?? "created",
      clonedFromId: row.clonedFromId ?? null,
      scanStatus: row.scanStatus,
      scanFindings: row.scanFindings as any[],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
