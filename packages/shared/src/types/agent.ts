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
  workspacePath: string | null;
  createdAt: string;
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
}
