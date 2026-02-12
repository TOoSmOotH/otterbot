export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  defaultModel: string;
  defaultProvider: string;
  tools: string[];
  builtIn: boolean;
  role: "coo" | "team_lead" | "worker";
  clonedFromId: string | null;
  createdAt: string;
}

export interface RegistryEntryCreate {
  name: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  defaultModel: string;
  defaultProvider: string;
  tools: string[];
  role?: "coo" | "team_lead" | "worker";
  clonedFromId?: string | null;
}

export interface RegistryEntryUpdate {
  name?: string;
  description?: string;
  systemPrompt?: string;
  capabilities?: string[];
  defaultModel?: string;
  defaultProvider?: string;
  tools?: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  createdAt: string;
}

export enum ProjectStatus {
  Active = "active",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}
