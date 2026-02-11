export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  defaultModel: string;
  defaultProvider: string;
  tools: string[];
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
