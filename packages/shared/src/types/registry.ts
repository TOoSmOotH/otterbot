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
  role: "coo" | "team_lead" | "worker";
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
  role?: "coo" | "team_lead" | "worker";
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

export enum ProjectStatus {
  Active = "active",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}
