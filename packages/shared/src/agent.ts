/**
 * Multi-agent "profile" model. Each agent is an isolated profile directory
 * (config, persona, memory DB, skills, credentials) — modeled on Hermes profiles.
 */

export type ProviderId = "anthropic" | "openai" | "lmstudio" | "ollama";

export type AgentRole = "coo" | "agent" | "subagent";

export type AgentStatus =
  | "idle"
  | "thinking"
  | "working"
  | "waiting"
  | "stopped"
  | "error";

export type TransportId = "local" | "discord";

export type ChatService = "web" | "discord";

/** A reference to a specific model on a specific provider. */
export interface ModelRef {
  provider: ProviderId;
  /** Provider-specific model id. "*" is a wildcard, valid only in allowedModels. */
  modelId: string;
}

/** The chat + embedding models an agent currently uses. */
export interface AgentModelConfig {
  chat: ModelRef;
  embedding: ModelRef;
}

/** Which worker character art/GLB this agent renders as. */
export interface AgentArtwork {
  /** A modelPack id discovered from assets/workers/*. */
  modelPack: string;
}

/**
 * A full agent profile. On disk this is `profile.json` inside the profile
 * directory, except `persona` (stored separately as `SOUL.md`) which the
 * ProfileStore resolves and attaches when loading.
 */
export interface AgentProfile {
  id: string;
  displayName: string;
  role: AgentRole;
  /** Persona / system-prompt persona block — resolved from SOUL.md. */
  persona: string;
  model: AgentModelConfig;
  /** Allowlist of models this agent may use. Supports per-provider "*" wildcard. */
  allowedModels: ModelRef[];
  allowedChatServices: ChatService[];
  /** Transport used for this agent's outbound agent-to-agent messages. */
  transport: TransportId;
  email: string | null;
  artwork: AgentArtwork;
  canSpawnSubagents: boolean;
  subagentLimit: number;
  /** Set for subagents; null for the COO and top-level agents. */
  parentId: string | null;
  createdAt: string;
}

/** Lightweight roster entry for the agent list / dashboard UI. */
export interface AgentProfileSummary {
  id: string;
  displayName: string;
  role: AgentRole;
  status: AgentStatus;
  chatModel: ModelRef;
  artwork: AgentArtwork;
  parentId: string | null;
  activeSubagents: number;
}
