import type { McpServerConfig } from "./agent.js";

export interface SkillParameterDef {
  type: string;
  default?: string | number | boolean;
  description?: string;
}

/** Field kinds a skill's generated config form can render. */
export type SkillConfigFieldType =
  | "string"
  | "secret"
  | "boolean"
  | "number"
  /** A single-choice dropdown; options are static (`options`) or dynamic (`optionsSource`). */
  | "select"
  /** A repeatable array of sub-objects shaped by `itemFields` (e.g. VMs → snapshots). */
  | "list";

/** One choice in a `select` field. */
export interface SkillConfigOption {
  value: string;
  label: string;
}

/**
 * A single field in a skill's config form. Scalar fields map to one credential
 * key; a `list` field JSON-encodes its whole array into one credential value.
 * See {@link SkillConfigSchema}.
 */
export interface SkillConfigField {
  /** Stable field key — identifies the value in the config form payload. */
  key: string;
  label: string;
  type: SkillConfigFieldType;
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  placeholder?: string;
  /**
   * The `agent_secrets` credential key this field's value is written to. For a
   * scalar field this is an env-var name (e.g. `PROXMOX_HOST`); for a `list`
   * field the JSON-encoded array is stored under this single key. Omit for
   * nested item fields (their values live inside the parent list's JSON).
   */
  credentialKey?: string;
  /** True secret — value is write-only: never returned by the config read API. */
  secret?: boolean;
  /** Scope assigned when this field's credential key is first written. */
  scope?: CredentialScope;
  /** For `type: "list"` — the shape of each item (item fields may nest one list). */
  itemFields?: SkillConfigField[];
  /** For `type: "select"` — a static list of choices. */
  options?: SkillConfigOption[];
  /**
   * For `type: "select"` — the name of a dynamic option source the UI resolves
   * at render time instead of using a static `options` list. Currently
   * `"codingModelPresets"` (the configured coding-CLI presets, filtered by the
   * agent's chosen tool).
   */
  optionsSource?: string;
}

/** A skill's typed config schema; Agent Studio renders a form from it. */
export interface SkillConfigSchema {
  /** Optional intro shown above the generated form. */
  description?: string;
  fields: SkillConfigField[];
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
  // Image generation via ChatGPT Codex OAuth (gpt-image-2) — granted together
  // by the `image-gen` capability.
  "generate_image",
  "edit_image",
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
  // Proxmox VE VM management — granted together by the `proxmox` capability.
  "proxmox_list_vms",
  "proxmox_status",
  "proxmox_start",
  "proxmox_stop",
  "proxmox_list_snapshots",
  "proxmox_rollback",
  "proxmox_create_snapshot",
  "proxmox_delete_snapshot",
  // SSH remote access — granted together by the `ssh` capability.
  "ssh_generate_key",
  "ssh_get_public_key",
  "ssh_list_hosts",
  "ssh_exec",
  // Command-line coding agents (Claude Code, Codex, Gemini CLI, OpenCode) —
  // granted together by the `coding-cli` capability.
  "coding_cli_run",
  "coding_cli_status",
  // Build-pipeline control — granted by the `project-management` capability.
  "pipeline_start",
  "pipeline_status",
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
  /**
   * Optional typed config schema. When present, Agent Studio renders a
   * generated config form for the skill instead of relying on raw credential
   * entry. Field values are persisted into the agent's credentials store.
   */
  configSchema?: SkillConfigSchema;
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
