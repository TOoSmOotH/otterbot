/** Category of a stored memory */
export type MemoryCategory = "preference" | "fact" | "instruction" | "relationship" | "general";

/** How the memory was created */
export type MemorySource = "user" | "agent" | "system";

/** A persistent memory record */
export interface Memory {
  id: string;
  category: MemoryCategory;
  content: string;
  source: MemorySource;
  agentScope: string | null;   // null = all agents, or specific role
  projectId: string | null;    // null = global, or project-scoped
  importance: number;          // 1-10
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A soul document that defines an agent's personality */
export interface SoulDocument {
  id: string;
  agentRole: string;              // 'coo', 'team_lead', 'worker', 'admin_assistant', 'global'
  registryEntryId: string | null; // null for role-level defaults, or specific registry entry ID
  content: string;                // markdown document
  createdAt: string;
  updatedAt: string;
}

/** A suggestion from the soul advisor */
export interface SoulSuggestion {
  agentRole: string;
  registryEntryId: string | null;
  currentContent: string | null;
  suggestedContent: string;
  reasoning: string;
  newInsights: string[];
}

/** An episodic daily log summarizing conversations */
export interface MemoryEpisode {
  id: string;
  date: string;              // YYYY-MM-DD
  projectId: string | null;
  summary: string;
  keyDecisions: string[];    // JSON array of key decisions
  createdAt: string;
}
