import type { AgentRole } from "@otterbot/shared";

export interface ToolContext {
  /** Agent's private workspace directory (absolute path) */
  workspacePath: string;
  /** Project ID for workspace access scoping */
  projectId: string;
  /** Agent ID (used for per-agent browser sessions, etc.) */
  agentId: string;
  /** Agent role for access control */
  role: AgentRole;
  /** If true, web_browse allows navigation to localhost/private IPs (e.g. for demo recording) */
  allowLocalBrowsing?: boolean;
  /** GitHub repo slug (owner/repo) for project-scoped access control */
  projectRepo?: string;
}
