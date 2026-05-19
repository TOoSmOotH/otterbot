/**
 * Multi-agent "profile" model. Each agent is an isolated profile directory
 * (config, persona, memory DB, skills, credentials) — modeled on Hermes profiles.
 */

/**
 * A model provider id. Open by design — the server's provider catalog
 * (`packages/server/src/providers/catalog.ts`) is the source of truth, so new
 * providers can be added without changing this type. Built-in ids today:
 * `anthropic`, `openai`, `lmstudio`, `ollama`, `builtin` (embedding-only).
 */
export type ProviderId = string;

/**
 * Serializable metadata describing one provider — exposed by `GET /api/providers`
 * and consumed by the web UI to render provider pickers without hardcoding.
 */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Whether the provider can back a chat model. */
  supportsChat: boolean;
  /** Whether the provider can produce embeddings. */
  supportsEmbeddings: boolean;
  /** Whether the provider needs an API key credential. */
  needsApiKey: boolean;
  /** Secret/env key holding the API credential, or null. */
  apiKeyEnv: string | null;
  /** Secret/env key for a custom base URL, or null. */
  baseUrlEnv: string | null;
  /** Default base URL for HTTP providers, or null. */
  defaultBaseUrl: string | null;
}

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
  /**
   * When true the agent only replies when its bot is @mentioned in the
   * channel; when false it replies to every message. Mention detection is
   * identity-based — it triggers on the bot's own handle regardless of the
   * agent's display name.
   */
  mentionOnly: boolean;
}

/** A Model Context Protocol server an agent connects to for extra tools. */
export interface McpServerConfig {
  /** Label — namespaces the server's tools as `mcp_<name>_<tool>`. */
  name: string;
  /** `stdio` spawns a local command; `sse` connects to a remote URL. */
  transport: "stdio" | "sse";
  enabled: boolean;
  /** stdio: the executable to run. */
  command?: string;
  /** stdio: arguments for the command. */
  args?: string[];
  /** sse: the server URL. */
  url?: string;
}

/** Live state of one MCP server connection. */
export type McpState = "connecting" | "connected" | "error" | "disabled";

export interface McpServerStatus {
  name: string;
  state: McpState;
  error: string | null;
  /** Number of tools the server contributed. */
  toolCount: number;
}

/** Live state of one chat-channel connector (Slack / Discord). */
export type ConnectorState =
  | "off"
  | "missing-tokens"
  | "connecting"
  | "connected"
  | "error";

/** Live connector status for one channel, surfaced in the Channels UI. */
export interface ChannelConnectorStatus {
  enabled: boolean;
  state: ConnectorState;
  error: string | null;
  channelId: string | null;
}

/** Live Slack + Discord connector status for an agent. */
export interface AgentConnectorStatus {
  slack: ChannelConnectorStatus;
  discord: ChannelConnectorStatus;
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
  /**
   * The chat model's total context window, in tokens. Used to size the
   * conversation-history budget before compaction kicks in. Optional — when
   * unset the global default context window applies.
   */
  contextWindow?: number;
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
  /**
   * When true the agent gets a `shell_exec` tool that runs commands in its own
   * sandboxed workspace directory. Off by default — it runs real commands.
   */
  canRunShell: boolean;
  /** When true the agent gets a `web_search` tool (DuckDuckGo). */
  canWebSearch: boolean;
  /**
   * When true the agent runs its post-session learning loop on chat close —
   * summarize, extract facts, rebuild its user profile, author a capability.
   */
  autoLearn: boolean;
  /** MCP servers this agent connects to for additional tools. */
  mcpServers: McpServerConfig[];
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
