import type { ChannelBotConfig, McpServerConfig } from "./agent.js";

/**
 * Reusable, named integration model.
 *
 * A {@link Credential} is a named, typed secret bundle (Slack tokens, a Matrix
 * login, a GitHub token, SMTP creds…). A {@link Connection} is a named connector
 * that references a Credential by id and carries non-secret per-connector config
 * (chat room + gates, MCP transport, host allowlists…). Agents reference
 * Connections through `connection_assignments` (a many-to-many link).
 *
 * This mirrors the existing Provider-account → Model → (agent picks model id)
 * pattern: edit the Credential once and every Connection using it updates.
 */

/**
 * A credential kind. Open by design — the server's connection registry
 * (`packages/server/src/integrations/connection-registry.ts`) is the source of
 * truth, so new kinds can be added without changing this type.
 */
export type CredentialType = string;

/**
 * A connector kind. Open by design — see the connection registry. Built-in kinds
 * today: chat (`slack`, `discord`, `matrix`) and non-chat (`smtp`, `github`,
 * `proxmox`, `ssh`, `mcp`).
 */
export type ConnectionType = string;

/** Connector kinds that drive a chat connector (governs the v1 single-agent rule). */
export const CHAT_CONNECTION_TYPES = ["slack", "discord", "matrix"] as const;
export type ChatConnectionType = (typeof CHAT_CONNECTION_TYPES)[number];

export function isChatConnectionType(type: ConnectionType): type is ChatConnectionType {
  return (CHAT_CONNECTION_TYPES as readonly string[]).includes(type);
}

/**
 * A named, typed secret bundle. Secret values are never serialized — only
 * `fieldsPresent` (which keys are set) and optional masked `hints`. Stored in
 * the `credentials` table; values live in `global_secrets` under
 * `cred:<id>:<KEY>`.
 */
export interface Credential {
  /** Stable slug, generated on create; referenced by {@link Connection.credentialId}. */
  id: string;
  /** Display name shown in every credential picker. */
  label: string;
  type: CredentialType;
  /** Which secret keys are currently stored (never the values). */
  fieldsPresent: Record<string, boolean>;
  /** Masked previews per field (e.g. `xoxb…a1b2`), like {@link ProviderAccount.apiKeyHint}. */
  hints?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A named connector. References a {@link Credential} and carries non-secret
 * per-connector config. Assigned to agents via `connection_assignments`.
 */
export interface Connection {
  /** Stable slug, generated on create. */
  id: string;
  /** Display name shown in every connection picker. */
  label: string;
  type: ConnectionType;
  /**
   * Non-secret type-specific config. For chat types this is a
   * {@link ChannelBotConfig}; for `mcp` it is an {@link McpServerConfig}; for
   * other types it holds endpoint/allowlist fields (host, VM list…).
   */
  config: Record<string, unknown>;
  /** The {@link Credential} this connection authenticates with; null when none is needed. */
  credentialId: string | null;
  /** Agent ids this connection is assigned to (resolved from the link table). */
  assignedAgentIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Re-export the config shapes a connection's `config` may take, for convenience. */
export type ChatConnectionConfig = ChannelBotConfig;
export type McpConnectionConfig = McpServerConfig;
