import { experimental_createMCPClient, type Tool } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import type { McpServerConfig, McpServerStatus } from "@otterbot/shared";

/**
 * Per-agent Model Context Protocol connections. Each agent's configured MCP
 * servers are connected when the agent starts; the tools they expose are
 * merged into the agent's tool set (namespaced `mcp_<server>_<tool>`). A
 * server that fails to connect is isolated — it never breaks the agent.
 */

type McpClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

interface Session {
  clients: McpClient[];
  statuses: McpServerStatus[];
}

/** Sanitize a server name for use in a tool-name prefix. */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "mcp";
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Environment for a stdio MCP server — the agent's secrets plus a basic PATH. */
function stdioEnv(secrets: Map<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.HOME) env.HOME = process.env.HOME;
  for (const [key, value] of secrets) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = value;
  }
  return env;
}

function createClient(cfg: McpServerConfig, secrets: Map<string, string>): Promise<McpClient> {
  if (cfg.transport === "sse") {
    if (!cfg.url) throw new Error("an SSE MCP server needs a URL");
    return experimental_createMCPClient({ transport: { type: "sse", url: cfg.url } });
  }
  if (!cfg.command) throw new Error("a stdio MCP server needs a command");
  return experimental_createMCPClient({
    transport: new Experimental_StdioMCPTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: stdioEnv(secrets),
    }),
  });
}

export class McpManager {
  private readonly sessions = new Map<string, Session>();

  /** Connect an agent's MCP servers and populate `mcpTools` with their tools. */
  async connect(
    agentId: string,
    servers: McpServerConfig[],
    secrets: Map<string, string>,
    mcpTools: Record<string, Tool>
  ): Promise<void> {
    await this.disconnect(agentId);
    const session: Session = { clients: [], statuses: [] };
    this.sessions.set(agentId, session);

    for (const cfg of servers) {
      if (!cfg.enabled) {
        session.statuses.push({ name: cfg.name, state: "disabled", error: null, toolCount: 0 });
        continue;
      }
      try {
        const client = await createClient(cfg, secrets);
        session.clients.push(client);
        const tools = (await client.tools()) as Record<string, Tool>;
        const prefix = `mcp_${slug(cfg.name)}_`;
        let count = 0;
        for (const [name, toolDef] of Object.entries(tools)) {
          mcpTools[prefix + name] = toolDef;
          count += 1;
        }
        session.statuses.push({
          name: cfg.name,
          state: "connected",
          error: null,
          toolCount: count,
        });
        console.info(`[mcp] ${agentId}: connected "${cfg.name}" (${count} tool(s))`);
      } catch (err) {
        session.statuses.push({
          name: cfg.name,
          state: "error",
          error: errMsg(err),
          toolCount: 0,
        });
        console.warn(`[mcp] ${agentId}: "${cfg.name}" failed: ${errMsg(err)}`);
      }
    }
  }

  /** Close an agent's MCP connections. */
  async disconnect(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) return;
    this.sessions.delete(agentId);
    await Promise.allSettled(session.clients.map((c) => c.close()));
  }

  /** Live status of an agent's MCP servers. */
  status(agentId: string): McpServerStatus[] {
    return this.sessions.get(agentId)?.statuses ?? [];
  }

  /** Close every agent's MCP connections. */
  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.disconnect(id)));
  }
}
