import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import matter from "gray-matter";
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { AgentDrizzle } from "../db/agent-db.js";
import * as schema from "../db/schema.js";
import { scanSkillContent } from "./skill-scanner.js";
import type { MemoryService } from "../memory/memory-service.js";
import { getDefaultContext } from "../runtime/default-agent.js";
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

/**
 * Per-agent skill service. Skills live as markdown files in the agent's own
 * `skills/` directory and are mirrored into the agent's database. One instance
 * per agent.
 */
export class SkillService {
  constructor(
    private readonly db: AgentDrizzle,
    private readonly skillsDir: string,
    private readonly memory: MemoryService
  ) {}

  parseSkillFile(raw: string): { meta: SkillMeta; body: string } {
    const { data, content } = matter(raw);
    const meta: SkillMeta = {
      name: data.name ?? "Untitled Skill",
      description: data.description ?? "",
      version: data.version ?? "1.0.0",
      author: data.author ?? "",
      tools: Array.isArray(data.tools) ? data.tools : [],
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
      parameters:
        data.parameters && typeof data.parameters === "object"
          ? (data.parameters as Record<string, SkillParameterDef>)
          : {},
      tags: Array.isArray(data.tags) ? data.tags : [],
    };
    return { meta, body: content.trim() };
  }

  serializeSkillFile(meta: SkillMeta, body: string): string {
    const frontmatter: Record<string, unknown> = {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
    };
    if (meta.tools.length) frontmatter.tools = meta.tools;
    if (meta.capabilities.length) frontmatter.capabilities = meta.capabilities;
    if (Object.keys(meta.parameters).length) frontmatter.parameters = meta.parameters;
    if (meta.tags.length) frontmatter.tags = meta.tags;
    return matter.stringify(body, frontmatter);
  }

  list(): Skill[] {
    return this.db
      .select()
      .from(schema.skills)
      .all()
      .map((r) => this.toSkill(r));
  }

  get(id: string): Skill | null {
    const row = this.db.select().from(schema.skills).where(eq(schema.skills.id, id)).get();
    return row ? this.toSkill(row) : null;
  }

  create(data: SkillCreate, opts?: { id?: string; scanReport?: ScanReport }): Skill {
    const now = new Date().toISOString();
    const raw = this.serializeSkillFile(data.meta, data.body);
    const scanReport = opts?.scanReport ?? scanSkillContent(raw);
    const scanStatus = this.deriveScanStatus(scanReport);

    const id = opts?.id ?? nanoid();
    const filePath = this.writeToDisk(id, raw);
    const row = {
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
      source: (data.source ?? "authored") as SkillSource,
      scanStatus,
      scanFindings: scanReport.findings,
      useCount: 0,
      filePath,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(schema.skills).values(row).run();
    this.indexFts(row);
    return this.toSkill(row);
  }

  update(id: string, data: SkillUpdate): Skill | null {
    const existing = this.get(id);
    if (!existing) return null;

    const newMeta = { ...existing.meta, ...data.meta };
    const newBody =
      data.body !== undefined
        ? data.body
        : data.appendNote
          ? `${existing.body}\n\n## Note (${new Date().toISOString().slice(0, 10)})\n${data.appendNote}`
          : existing.body;
    const raw = this.serializeSkillFile(newMeta, newBody);
    const scanReport = scanSkillContent(raw);

    const updates: Record<string, unknown> = {
      name: newMeta.name,
      description: newMeta.description,
      version: newMeta.version,
      author: newMeta.author,
      tools: newMeta.tools,
      capabilities: newMeta.capabilities,
      parameters: newMeta.parameters,
      tags: newMeta.tags,
      body: newBody,
      scanStatus: this.deriveScanStatus(scanReport),
      scanFindings: scanReport.findings,
      updatedAt: new Date().toISOString(),
    };
    if (existing.meta.name !== newMeta.name) {
      this.writeToDisk(id, raw);
    } else {
      const row = this.db.select().from(schema.skills).where(eq(schema.skills.id, id)).get();
      if (row?.filePath) writeFileSync(row.filePath, raw, "utf8");
    }

    this.db.update(schema.skills).set(updates).where(eq(schema.skills.id, id)).run();
    const updated = this.get(id);
    if (updated) {
      this.indexFts({
        id: updated.id,
        name: updated.meta.name,
        description: updated.meta.description,
        tags: updated.meta.tags,
        body: updated.body,
      });
    }
    return updated;
  }

  recordUse(id: string) {
    this.db
      .update(schema.skills)
      .set({ useCount: sql`use_count + 1` })
      .where(eq(schema.skills.id, id))
      .run();
  }

  delete(id: string): boolean {
    const res = this.db.delete(schema.skills).where(eq(schema.skills.id, id)).run();
    this.memory.removeFts("skill", id);
    return res.changes > 0;
  }

  exportAsMarkdown(id: string): string | null {
    const skill = this.get(id);
    if (!skill) return null;
    return this.serializeSkillFile(skill.meta, skill.body);
  }

  /** Load all .md skills from disk into the DB. Called once on startup. */
  loadFromDisk(): number {
    const dir = this.skillsDir;
    if (!existsSync(dir)) return 0;
    let count = 0;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const filePath = join(dir, name);
      const raw = readFileSync(filePath, "utf8");
      const { meta, body } = this.parseSkillFile(raw);
      const id = name.replace(/\.md$/, "");
      const existing = this.db.select().from(schema.skills).where(eq(schema.skills.id, id)).get();
      const scanReport = scanSkillContent(raw);
      const now = new Date().toISOString();
      const row = {
        id,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        author: meta.author,
        tools: meta.tools,
        capabilities: meta.capabilities,
        parameters: meta.parameters as Record<string, unknown>,
        tags: meta.tags,
        body,
        source: "authored" as SkillSource,
        scanStatus: this.deriveScanStatus(scanReport),
        scanFindings: scanReport.findings,
        useCount: existing?.useCount ?? 0,
        filePath,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (existing) {
        this.db.update(schema.skills).set(row).where(eq(schema.skills.id, id)).run();
      } else {
        this.db.insert(schema.skills).values(row).run();
      }
      this.indexFts(row);
      count++;
    }
    return count;
  }

  private writeToDisk(id: string, raw: string): string {
    mkdirSync(this.skillsDir, { recursive: true });
    const filePath = resolve(this.skillsDir, `${id}.md`);
    writeFileSync(filePath, raw, "utf8");
    return filePath;
  }

  private indexFts(row: {
    id: string;
    name: string;
    description: string;
    tags: string[];
    body: string;
  }) {
    this.memory.indexFts({
      kind: "skill",
      refId: row.id,
      title: row.name,
      body: `${row.description}\n\n${row.body}`,
      tags: row.tags.join(" "),
    });
  }

  private deriveScanStatus(report: ScanReport): SkillScanStatus {
    if (report.findings.some((f) => f.severity === "error")) return "errors";
    if (report.findings.some((f) => f.severity === "warning")) return "warnings";
    return "clean";
  }

  private toSkill(row: {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    tools: string[];
    capabilities: string[];
    parameters: Record<string, unknown>;
    tags: string[];
    body: string;
    source: SkillSource;
    scanStatus: SkillScanStatus;
    scanFindings: ScanReport["findings"];
    useCount: number;
    createdAt: string;
    updatedAt: string;
  }): Skill {
    return {
      id: row.id,
      meta: {
        name: row.name,
        description: row.description,
        version: row.version,
        author: row.author,
        tools: row.tools,
        capabilities: row.capabilities,
        parameters: row.parameters as Record<string, SkillParameterDef>,
        tags: row.tags,
      },
      body: row.body,
      source: row.source,
      scanStatus: row.scanStatus,
      scanFindings: row.scanFindings,
      useCount: row.useCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/** @deprecated Compatibility shim — resolves to the default (COO) agent's skill service. */
export function getSkillService(): SkillService {
  return getDefaultContext().skills;
}
