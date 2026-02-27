import type { GearConfig } from "./model-pack.js";

export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  promptAddendum: string | null;
  /** Derived from assigned skills — not stored on the entry directly */
  capabilities: string[];
  defaultModel: string;
  defaultProvider: string;
  /** Derived from assigned skills — not stored on the entry directly */
  tools: string[];
  builtIn: boolean;
  role: "coo" | "team_lead" | "worker" | "module_agent";
  modelPackId: string | null;
  gearConfig: GearConfig | null;
  clonedFromId: string | null;
  createdAt: string;
}

export interface RegistryEntryCreate {
  name: string;
  description: string;
  systemPrompt: string;
  promptAddendum?: string | null;
  defaultModel: string;
  defaultProvider: string;
  role?: "coo" | "team_lead" | "worker" | "module_agent";
  clonedFromId?: string | null;
  modelPackId?: string | null;
  gearConfig?: GearConfig | null;
  /** Optional skill IDs to assign after creation */
  skillIds?: string[];
}

export interface RegistryEntryUpdate {
  name?: string;
  description?: string;
  systemPrompt?: string;
  promptAddendum?: string | null;
  defaultModel?: string;
  defaultProvider?: string;
  modelPackId?: string | null;
  gearConfig?: GearConfig | null;
}

export enum CharterStatus {
  Gathering = "gathering",
  Finalized = "finalized",
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  charter: string | null;
  charterStatus: CharterStatus;
  githubRepo: string | null;
  githubBranch: string | null;
  githubIssueMonitor: boolean;
  rules: string[];
  createdAt: string;
}

/** Per-project role → registry entry ID mapping for agent assignments */
export type ProjectAgentAssignments = Record<string, string>;

export enum ProjectStatus {
  Active = "active",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

// ---------------------------------------------------------------------------
// Pipeline configuration
// ---------------------------------------------------------------------------

export interface PipelineStageConfig {
  agentId: string;   // registry entry ID
  enabled: boolean;
}

export interface ProjectPipelineConfig {
  enabled: boolean;  // master toggle — pipeline on/off for this project
  stages: Record<string, PipelineStageConfig>;
}

export const PIPELINE_STAGES = [
  { key: "triage", label: "Triage", description: "Analyzes incoming issues to classify them as bugs, features, or user error. Decides whether to proceed with implementation.", defaultAgentId: "builtin-triage" },
  { key: "coder", label: "Coder", description: "Creates a feature branch, implements the solution, and commits changes.", defaultAgentId: "builtin-coder" },
  { key: "security", label: "Security Reviewer", description: "Audits the implementation for vulnerabilities and security risks. Can send issues back to the Coder for fixes.", defaultAgentId: "builtin-security-reviewer" },
  { key: "tester", label: "Tester", description: "Writes and runs tests to validate the implementation.", defaultAgentId: "builtin-tester" },
  { key: "reviewer", label: "Code Reviewer", description: "Reviews code quality and correctness, then creates the pull request.", defaultAgentId: "builtin-reviewer" },
] as const;
