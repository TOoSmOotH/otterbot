export interface McpToolMeta {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "sse";
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
  autoStart: boolean;
  timeout: number;
  allowedTools: string[] | null;
  discoveredTools: McpToolMeta[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerCreate {
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  autoStart?: boolean;
  timeout?: number;
}

export interface McpServerUpdate {
  name?: string;
  enabled?: boolean;
  transport?: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  autoStart?: boolean;
  timeout?: number;
  allowedTools?: string[] | null;
}

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpServerRuntime {
  id: string;
  status: McpServerStatus;
  error?: string;
  pid?: number;
  connectedAt?: string;
  toolCount: number;
}
