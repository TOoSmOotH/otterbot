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
  McpServerConfig,
  SkillConfigSchema,
} from "@otterbot/shared";

/** A skill's `enabled` default: tool-bearing capabilities are on, pure-prompt skills off. */
function defaultEnabled(meta: SkillMeta): boolean {
  return meta.tools.length > 0;
}

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

  parseSkillFile(raw: string): { meta: SkillMeta; body: string; enabled: boolean } {
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
      mcpServers: Array.isArray(data.mcpServers)
        ? (data.mcpServers as McpServerConfig[])
        : undefined,
      credentialKeys: Array.isArray(data.credentialKeys)
        ? (data.credentialKeys as string[])
        : undefined,
      configSchema:
        data.configSchema &&
        typeof data.configSchema === "object" &&
        Array.isArray((data.configSchema as SkillConfigSchema).fields)
          ? (data.configSchema as SkillConfigSchema)
          : undefined,
    };
    // When frontmatter omits `enabled`, tool-bearing capabilities default on.
    const enabled = typeof data.enabled === "boolean" ? data.enabled : defaultEnabled(meta);
    return { meta, body: content.trim(), enabled };
  }

  serializeSkillFile(meta: SkillMeta, body: string, enabled?: boolean): string {
    const frontmatter: Record<string, unknown> = {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
    };
    if (meta.tools.length) frontmatter.tools = meta.tools;
    if (meta.capabilities.length) frontmatter.capabilities = meta.capabilities;
    if (meta.mcpServers && meta.mcpServers.length) frontmatter.mcpServers = meta.mcpServers;
    if (meta.credentialKeys && meta.credentialKeys.length) {
      frontmatter.credentialKeys = meta.credentialKeys;
    }
    if (meta.configSchema && meta.configSchema.fields.length) {
      frontmatter.configSchema = meta.configSchema;
    }
    if (Object.keys(meta.parameters).length) frontmatter.parameters = meta.parameters;
    if (meta.tags.length) frontmatter.tags = meta.tags;
    if (typeof enabled === "boolean") frontmatter.enabled = enabled;
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
    const enabled = data.enabled ?? defaultEnabled(data.meta);
    const raw = this.serializeSkillFile(data.meta, data.body, enabled);
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
      mcpServers: data.meta.mcpServers ?? [],
      credentialKeys: data.meta.credentialKeys ?? [],
      configSchema: data.meta.configSchema ?? null,
      parameters: data.meta.parameters as Record<string, unknown>,
      tags: data.meta.tags,
      body: data.body,
      source: (data.source ?? "authored") as SkillSource,
      scanStatus,
      scanFindings: scanReport.findings,
      enabled,
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
    const newEnabled = data.enabled ?? existing.enabled;
    const newBody =
      data.body !== undefined
        ? data.body
        : data.appendNote
          ? `${existing.body}\n\n## Note (${new Date().toISOString().slice(0, 10)})\n${data.appendNote}`
          : existing.body;
    const raw = this.serializeSkillFile(newMeta, newBody, newEnabled);
    const scanReport = scanSkillContent(raw);

    const updates: Record<string, unknown> = {
      name: newMeta.name,
      description: newMeta.description,
      version: newMeta.version,
      author: newMeta.author,
      tools: newMeta.tools,
      capabilities: newMeta.capabilities,
      mcpServers: newMeta.mcpServers ?? [],
      credentialKeys: newMeta.credentialKeys ?? [],
      configSchema: newMeta.configSchema ?? null,
      parameters: newMeta.parameters,
      tags: newMeta.tags,
      body: newBody,
      scanStatus: this.deriveScanStatus(scanReport),
      scanFindings: scanReport.findings,
      enabled: newEnabled,
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
      const { meta, body, enabled } = this.parseSkillFile(raw);
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
        mcpServers: meta.mcpServers ?? [],
        credentialKeys: meta.credentialKeys ?? [],
        configSchema: meta.configSchema ?? null,
        parameters: meta.parameters as Record<string, unknown>,
        tags: meta.tags,
        body,
        source: "authored" as SkillSource,
        scanStatus: this.deriveScanStatus(scanReport),
        scanFindings: scanReport.findings,
        // Markdown is the source of truth — `enabled` is persisted into the
        // file's frontmatter on create and on every PATCH toggle.
        enabled,
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

  /**
   * Backfill `configSchema` (and credential keys) from the catalog onto
   * already-installed capabilities that predate them — matched by id. Only
   * fills a missing schema; never touches the user's customization body or an
   * existing schema. Lets older installs gain a Configure panel on restart.
   */
  reconcileBuiltinConfig(
    catalog: Array<{ id: string; configSchema?: SkillConfigSchema; credentialKeys?: string[] }>,
  ): void {
    for (const entry of catalog) {
      if (!entry.configSchema) continue;
      const existing = this.get(entry.id);
      if (!existing || existing.meta.configSchema) continue;
      this.update(entry.id, {
        meta: {
          configSchema: entry.configSchema,
          credentialKeys: entry.credentialKeys ?? existing.meta.credentialKeys,
        },
      });
    }
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

  /** Skills currently enabled — their tools are granted and prompt injected. */
  listEnabled(): Skill[] {
    return this.list().filter((s) => s.enabled);
  }

  /** Toggle a skill on or off. Persists to the DB and the markdown file. */
  setEnabled(id: string, enabled: boolean): Skill | null {
    return this.update(id, { enabled });
  }

  /** The union of built-in tools granted by all enabled capabilities. */
  effectiveTools(): Set<string> {
    const granted = new Set<string>();
    for (const s of this.listEnabled()) {
      for (const t of s.meta.tools) granted.add(t);
    }
    return granted;
  }

  /** MCP servers carried by all enabled capabilities. */
  effectiveMcpServers(): McpServerConfig[] {
    const servers: McpServerConfig[] = [];
    for (const s of this.listEnabled()) {
      if (s.meta.mcpServers) servers.push(...s.meta.mcpServers);
    }
    return servers;
  }

  private toSkill(row: {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    tools: string[];
    capabilities: string[];
    mcpServers: McpServerConfig[];
    credentialKeys?: string[];
    configSchema?: SkillConfigSchema | null;
    parameters: Record<string, unknown>;
    tags: string[];
    body: string;
    source: SkillSource;
    scanStatus: SkillScanStatus;
    scanFindings: ScanReport["findings"];
    enabled: boolean;
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
        mcpServers: row.mcpServers ?? [],
        credentialKeys: row.credentialKeys ?? [],
        configSchema: row.configSchema ?? undefined,
        parameters: row.parameters as Record<string, SkillParameterDef>,
        tags: row.tags,
      },
      body: row.body,
      source: row.source,
      scanStatus: row.scanStatus,
      scanFindings: row.scanFindings,
      enabled: row.enabled,
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
