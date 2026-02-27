import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type {
  McpServerConfig,
  McpServerCreate,
  McpServerUpdate,
  McpToolMeta,
} from "@otterbot/shared";
import { validateCommand, validateArgs, validateSseUrl } from "./mcp-security.js";

const SECRET_PATTERN = /passw|secret|token|key|auth/i;

export class McpServerService {
  list(): McpServerConfig[] {
    const db = getDb();
    const rows = db.select().from(schema.mcpServers).all();
    return rows.map((r) => this.toConfig(r));
  }

  get(id: string): McpServerConfig | null {
    const db = getDb();
    const row = db
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.id, id))
      .get();
    return row ? this.toConfig(row) : null;
  }

  create(data: McpServerCreate): McpServerConfig {
    // Validate command for stdio
    if (data.transport === "stdio") {
      if (!data.command) {
        throw new Error("command is required for stdio transport");
      }
      const cmdResult = validateCommand(data.command);
      if (!cmdResult.valid) throw new Error(cmdResult.error);
      const argsResult = validateArgs(data.args ?? []);
      if (!argsResult.valid) throw new Error(argsResult.error);
    }

    // Validate URL for SSE
    if (data.transport === "sse") {
      if (!data.url) {
        throw new Error("url is required for sse transport");
      }
      const urlResult = validateSseUrl(data.url);
      if (!urlResult.valid) throw new Error(urlResult.error);
    }

    const db = getDb();
    const now = new Date().toISOString();
    const id = nanoid();

    const row = {
      id,
      name: data.name,
      enabled: false,
      transport: data.transport,
      command: data.command ?? null,
      args: (data.args ?? []) as any,
      env: (data.env ?? {}) as any,
      url: data.url ?? null,
      headers: (data.headers ?? {}) as any,
      autoStart: data.autoStart ?? false,
      timeout: data.timeout ?? 30000,
      allowedTools: null as any,
      discoveredTools: null as any,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(schema.mcpServers).values(row).run();
    return this.toConfig(row);
  }

  update(id: string, data: McpServerUpdate): McpServerConfig | null {
    const existing = this.get(id);
    if (!existing) return null;

    const transport = data.transport ?? existing.transport;

    // Validate command if changing stdio fields
    if (transport === "stdio" && data.command !== undefined) {
      const cmdResult = validateCommand(data.command!);
      if (!cmdResult.valid) throw new Error(cmdResult.error);
    }
    if (transport === "stdio" && data.args !== undefined) {
      const argsResult = validateArgs(data.args!);
      if (!argsResult.valid) throw new Error(argsResult.error);
    }

    // Validate URL if changing SSE fields
    if (transport === "sse" && data.url !== undefined) {
      const urlResult = validateSseUrl(data.url!);
      if (!urlResult.valid) throw new Error(urlResult.error);
    }

    const db = getDb();
    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (data.name !== undefined) updates.name = data.name;
    if (data.enabled !== undefined) updates.enabled = data.enabled;
    if (data.transport !== undefined) updates.transport = data.transport;
    if (data.command !== undefined) updates.command = data.command;
    if (data.args !== undefined) updates.args = data.args;
    if (data.env !== undefined) updates.env = data.env;
    if (data.url !== undefined) updates.url = data.url;
    if (data.headers !== undefined) updates.headers = data.headers;
    if (data.autoStart !== undefined) updates.autoStart = data.autoStart;
    if (data.timeout !== undefined) updates.timeout = data.timeout;
    if (data.allowedTools !== undefined) updates.allowedTools = data.allowedTools;

    db.update(schema.mcpServers)
      .set(updates)
      .where(eq(schema.mcpServers.id, id))
      .run();

    return this.get(id);
  }

  updateDiscoveredTools(id: string, tools: McpToolMeta[]): void {
    const db = getDb();
    db.update(schema.mcpServers)
      .set({
        discoveredTools: tools as any,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.mcpServers.id, id))
      .run();
  }

  delete(id: string): boolean {
    const db = getDb();
    const result = db
      .delete(schema.mcpServers)
      .where(eq(schema.mcpServers.id, id))
      .run();
    return result.changes > 0;
  }

  /** Return config with secrets masked for API responses */
  maskSecrets(config: McpServerConfig): McpServerConfig {
    return {
      ...config,
      env: this.maskRecord(config.env),
      headers: this.maskRecord(config.headers),
    };
  }

  private maskRecord(record: Record<string, string>): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (SECRET_PATTERN.test(key) && value.length > 4) {
        masked[key] = "****" + value.slice(-4);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }

  private toConfig(row: any): McpServerConfig {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      transport: row.transport,
      command: row.command ?? undefined,
      args: row.args ?? [],
      env: row.env ?? {},
      url: row.url ?? undefined,
      headers: row.headers ?? {},
      autoStart: row.autoStart,
      timeout: row.timeout,
      allowedTools: row.allowedTools ?? null,
      discoveredTools: row.discoveredTools ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
