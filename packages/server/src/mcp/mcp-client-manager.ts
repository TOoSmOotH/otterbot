import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { mkdirSync } from "node:fs";
import type { McpServerConfig, McpServerRuntime, McpServerStatus, McpToolMeta } from "@otterbot/shared";
import { McpServerService } from "./mcp-service.js";
import { filterEnvVars, getIsolatedWorkDir } from "./mcp-security.js";

interface ManagedClient {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport;
  status: McpServerStatus;
  error?: string;
  pid?: number;
  connectedAt?: string;
  toolCount: number;
}

type StatusListener = (runtime: McpServerRuntime) => void;

class McpClientManagerSingleton {
  private clients = new Map<string, ManagedClient>();
  private statusListeners: StatusListener[] = [];

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private emitStatus(id: string) {
    const runtime = this.getStatus(id);
    for (const listener of this.statusListeners) {
      listener(runtime);
    }
  }

  async start(serverId: string): Promise<void> {
    // Stop if already running
    if (this.clients.has(serverId)) {
      await this.stop(serverId);
    }

    const service = new McpServerService();
    const config = service.get(serverId);
    if (!config) throw new Error(`MCP server "${serverId}" not found`);

    this.setClientState(serverId, { status: "connecting", toolCount: 0 });
    this.emitStatus(serverId);

    try {
      const transport = this.createTransport(config);
      const client = new Client(
        { name: "otterbot", version: "0.1.0" },
        { capabilities: {} },
      );

      await client.connect(transport);

      // Get PID for stdio transports
      let pid: number | undefined;
      if (transport instanceof StdioClientTransport) {
        pid = transport.pid ?? undefined;
      }

      // Discover tools
      const toolCount = await this.discoverAndSaveTools(serverId, client, service);

      this.clients.set(serverId, {
        client,
        transport,
        status: "connected",
        pid,
        connectedAt: new Date().toISOString(),
        toolCount,
      });

      // Set up disconnect handler
      transport.onclose = () => {
        const managed = this.clients.get(serverId);
        if (managed) {
          managed.status = "disconnected";
          this.emitStatus(serverId);
        }
      };

      transport.onerror = (err: Error) => {
        const managed = this.clients.get(serverId);
        if (managed) {
          managed.status = "error";
          managed.error = err.message;
          this.emitStatus(serverId);
        }
      };

      this.emitStatus(serverId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setClientState(serverId, { status: "error", error: message, toolCount: 0 });
      this.emitStatus(serverId);
      throw err;
    }
  }

  async stop(serverId: string): Promise<void> {
    const managed = this.clients.get(serverId);
    if (!managed) return;

    try {
      await managed.transport.close();
    } catch {
      // Ignore close errors
    }

    this.clients.delete(serverId);
    this.emitStatus(serverId);
  }

  async restart(serverId: string): Promise<void> {
    await this.stop(serverId);
    await this.start(serverId);
  }

  async stopAll(): Promise<void> {
    const ids = [...this.clients.keys()];
    await Promise.allSettled(ids.map((id) => this.stop(id)));
  }

  async autoStartAll(): Promise<void> {
    const service = new McpServerService();
    const servers = service.list().filter((s) => s.enabled && s.autoStart);
    for (const server of servers) {
      try {
        await this.start(server.id);
        console.log(`[MCP] Auto-started server "${server.name}"`);
      } catch (err) {
        console.error(`[MCP] Failed to auto-start server "${server.name}":`, err);
      }
    }
  }

  async discoverTools(serverId: string): Promise<McpToolMeta[]> {
    const managed = this.clients.get(serverId);
    if (!managed || managed.status !== "connected") {
      throw new Error("MCP server is not connected");
    }
    const service = new McpServerService();
    const toolCount = await this.discoverAndSaveTools(serverId, managed.client, service);
    managed.toolCount = toolCount;
    return service.get(serverId)?.discoveredTools ?? [];
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const managed = this.clients.get(serverId);
    if (!managed || managed.status !== "connected") {
      throw new Error("MCP server is not connected");
    }

    // Check allowed tools gate
    const service = new McpServerService();
    const config = service.get(serverId);
    if (config?.allowedTools !== null) {
      if (!config?.allowedTools?.includes(toolName)) {
        throw new Error(`Tool "${toolName}" is not in the allowed tools list for server "${config?.name}"`);
      }
    }

    const result = await managed.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  /**
   * Search connected servers for a tool by name.
   * Returns the server ID and tool metadata if found.
   */
  findTool(toolName: string): { serverId: string; tool: McpToolMeta } | null {
    const service = new McpServerService();
    const servers = service.list().filter((s) => s.enabled);

    for (const server of servers) {
      const managed = this.clients.get(server.id);
      if (!managed || managed.status !== "connected") continue;

      const tools = server.discoveredTools ?? [];
      // Check allowed tools gate
      if (server.allowedTools !== null && !server.allowedTools?.includes(toolName)) {
        continue;
      }
      const tool = tools.find((t) => t.name === toolName);
      if (tool) return { serverId: server.id, tool };
    }
    return null;
  }

  /**
   * Get all enabled tool names from connected MCP servers, filtered by allowedTools.
   */
  getAllEnabledToolNames(): string[] {
    const service = new McpServerService();
    const servers = service.list().filter((s) => s.enabled);
    const names: string[] = [];

    for (const server of servers) {
      const managed = this.clients.get(server.id);
      if (!managed || managed.status !== "connected") continue;

      const tools = server.discoveredTools ?? [];
      for (const tool of tools) {
        if (server.allowedTools === null || server.allowedTools.includes(tool.name)) {
          names.push(`mcp_${this.sanitizeName(server.name)}_${tool.name}`);
        }
      }
    }

    return names;
  }

  getStatus(serverId: string): McpServerRuntime {
    const managed = this.clients.get(serverId);
    if (!managed) {
      return { id: serverId, status: "disconnected", toolCount: 0 };
    }
    return {
      id: serverId,
      status: managed.status,
      error: managed.error,
      pid: managed.pid,
      connectedAt: managed.connectedAt,
      toolCount: managed.toolCount,
    };
  }

  getAllStatuses(): Map<string, McpServerRuntime> {
    const statuses = new Map<string, McpServerRuntime>();
    for (const id of this.clients.keys()) {
      statuses.set(id, this.getStatus(id));
    }
    return statuses;
  }

  isConnected(serverId: string): boolean {
    const managed = this.clients.get(serverId);
    return managed?.status === "connected";
  }

  /** Convert server name to safe identifier */
  sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  private createTransport(config: McpServerConfig): StdioClientTransport | SSEClientTransport {
    if (config.transport === "stdio") {
      const workDir = getIsolatedWorkDir(config.id);
      mkdirSync(workDir, { recursive: true });

      return new StdioClientTransport({
        command: config.command!,
        args: config.args,
        env: filterEnvVars(config.env),
        cwd: workDir,
        stderr: "pipe",
      });
    }

    return new SSEClientTransport(new URL(config.url!), {
      requestInit: {
        headers: config.headers,
      },
    });
  }

  private async discoverAndSaveTools(
    serverId: string,
    client: Client,
    service: McpServerService,
  ): Promise<number> {
    try {
      const result = await client.listTools();
      const tools: McpToolMeta[] = (result.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
      service.updateDiscoveredTools(serverId, tools);
      return tools.length;
    } catch (err) {
      console.warn(`[MCP] Failed to discover tools for "${serverId}":`, err);
      return 0;
    }
  }

  private setClientState(
    serverId: string,
    state: Partial<ManagedClient>,
  ) {
    const existing = this.clients.get(serverId);
    if (existing) {
      Object.assign(existing, state);
    } else {
      this.clients.set(serverId, {
        client: null as any,
        transport: null as any,
        status: "disconnected",
        toolCount: 0,
        ...state,
      });
    }
  }
}

/** Singleton MCP client manager */
export const McpClientManager = new McpClientManagerSingleton();
