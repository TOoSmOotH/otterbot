import type { McpServerConfig } from "./agent.js";

export interface SkillParameterDef {
  type: string;
  default?: string | number | boolean;
  description?: string;
}

/**
 * Built-in tools a capability may grant on top of an agent's always-available
 * core tool set. A capability's `meta.tools` is validated against this list and
 * the UI renders a picker from it. Core tools (memory, profile, skill authoring)
 * are always available and are not listed here.
 */
export const GRANTABLE_TOOL_NAMES = [
  "shell_exec",
  "web_search",
  "send_email",
  "github_create_issue",
  "github_list_issues",
  "spawn_subagent",
  // Agentic browsing (agent-browser) — granted together by the
  // `agentic-browsing` capability.
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_scroll",
  "browser_back",
  "browser_get_images",
  "browser_console",
  "browser_vision",
] as const;

export type GrantableToolName = (typeof GRANTABLE_TOOL_NAMES)[number];

export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  author: string;
  /** Built-in tools this capability grants — see `GRANTABLE_TOOL_NAMES`. */
  tools: string[];
  capabilities: string[];
  parameters: Record<string, SkillParameterDef>;
  tags: string[];
  /** MCP servers this capability carries; connected while the skill is enabled. */
  mcpServers?: McpServerConfig[];
  /**
   * Env-var names this capability looks for in the agent's shell environment.
   * Drives credential-tagging UI hints and the auto-suggest mapping when a
   * user adds a credential. Not enforced at injection time — actual exposure
   * is governed by each credential's `scope` field.
   */
  credentialKeys?: string[];
}

/** A credential's exposure rule. Strings serialised into the `scope` column. */
export type CredentialScope =
  | "direct"
  | "broad"
  | `cap:${string}`;

export interface AgentCredentialEntry {
  key: string;
  scope: CredentialScope;
}

export type SkillSource = "builtin" | "authored" | "imported";

export type SkillScanStatus = "clean" | "warnings" | "errors" | "unscanned";

export type ScanSeverity = "error" | "warning" | "info";

export interface ScanFinding {
  severity: ScanSeverity;
  category: "hidden-content" | "prompt-injection" | "dangerous-tools" | "exfiltration";
  message: string;
  line?: number;
  snippet?: string;
}

export interface ScanReport {
  clean: boolean;
  findings: ScanFinding[];
}

export interface Skill {
  id: string;
  meta: SkillMeta;
  body: string;
  source: SkillSource;
  scanStatus: SkillScanStatus;
  scanFindings: ScanFinding[];
  useCount: number;
  /**
   * Whether this capability is active. Enabled tool-bearing capabilities are
   * always-on — their prompt is injected and their tools granted every turn.
   * Disabled / pure-prompt skills keep semantic-search recall behaviour.
   */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillCreate {
  meta: SkillMeta;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export interface SkillUpdate {
  meta?: Partial<SkillMeta>;
  body?: string;
  appendNote?: string;
  enabled?: boolean;
}
