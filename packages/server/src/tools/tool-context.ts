import type { AgentRole } from "@smoothbot/shared";

export interface ToolContext {
  /** Agent's private workspace directory (absolute path) */
  workspacePath: string;
  /** Project ID for workspace access scoping */
  projectId: string;
  /** Agent ID (used for per-agent browser sessions, etc.) */
  agentId: string;
  /** Agent role for access control */
  role: AgentRole;
}
