import type { GearConfig } from "./model-pack.js";

export enum AgentRole {
  COO = "coo",
  TeamLead = "team_lead",
  Worker = "worker",
}

export enum AgentStatus {
  Idle = "idle",
  Thinking = "thinking",
  Acting = "acting",
  Done = "done",
  Error = "error",
}

export interface Agent {
  id: string;
  registryEntryId: string | null;
  role: AgentRole;
  parentId: string | null;
  status: AgentStatus;
  model: string;
  provider: string;
  baseUrl?: string;
  temperature?: number;
  systemPrompt?: string;
  projectId: string | null;
  modelPackId: string | null;
  gearConfig: GearConfig | null;
  workspacePath: string | null;
  createdAt: string;
}

export interface AgentActivityRecord {
  id: string;
  agentId: string;
  type: "thinking" | "response" | "tool_call";
  content: string;
  metadata: Record<string, unknown>;
  projectId: string | null;
  messageId: string | null;
  timestamp: string;
}

export interface AgentSpawnOptions {
  registryEntryId?: string;
  role: AgentRole;
  parentId: string;
  projectId: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  temperature?: number;
  systemPrompt?: string;
  modelPackId?: string;
  gearConfig?: GearConfig | null;
}
