/**
 * Multi-agent "profile" model. Each agent is an isolated profile directory
 * (config, persona, memory DB, skills, credentials) — modeled on Hermes profiles.
 */

/**
 * A model provider. `builtin` is an embedding-only, in-process CPU embedder
 * (all-MiniLM-L6-v2 via fastembed) — it is not valid as a chat provider.
 */
export type ProviderId = "anthropic" | "openai" | "lmstudio" | "ollama" | "builtin";

export type AgentRole = "coo" | "agent" | "subagent";

export type AgentStatus =
  | "idle"
  | "thinking"
  | "working"
  | "waiting"
  | "stopped"
  | "error";

export type TransportId = "local" | "discord";

export type ChatService = "web" | "discord" | "slack";

/**
 * Per-agent config for a chat channel (Slack or Discord) the agent is reachable
 * in. `publicBot` lets anyone in the channel talk to the agent; otherwise only
 * the listed platform user IDs may.
 */
export interface ChannelBotConfig {
  enabled: boolean;
  channelId: string;
  /** Public bot: anyone in the channel may talk to the agent. */
  publicBot: boolean;
  /** Platform user IDs allowed to talk to the agent when publicBot is false. */
  allowedUserIds: string[];
}

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

/** An agent's visual identity in the UI. */
export interface AgentArtwork {
  /** URL of the uploaded avatar image, or null to render initials instead. */
  avatar: string | null;
}

/** Grants this agent permission to message a specific peer agent. */
export interface AgentPeerAccess {
  /** The peer agent this agent may send messages to. */
  agentId: string;
  /** When true, this agent may also read that peer's memory (read-only). */
  shareMemory: boolean;
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
  /** Per-agent Slack channel connector config; null when not configured. */
  slack: ChannelBotConfig | null;
  /** Per-agent Discord channel connector config; null when not configured. */
  discord: ChannelBotConfig | null;
  email: string | null;
  artwork: AgentArtwork;
  /** Peer agents this agent is permitted to message (+ optional memory access). */
  allowedPeers: AgentPeerAccess[];
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
