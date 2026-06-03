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
  /**
   * Non-secret account metadata (the secret half lives in `global_secrets`).
   * Empty `{}` for plain secret bundles; for absorbed account types it holds the
   * account fields (a git account's provider/transport/committer, an `ssh-key`'s
   * public key + fingerprint…).
   */
  config: Record<string, unknown>;
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
  /** Agent ids this connection is explicitly assigned to (resolved from the link table). */
  assignedAgentIds: string[];
  /**
   * When true the binding applies to every agent (instance-wide), independent of
   * `assignedAgentIds` — the model for absorbed generic secrets and the legacy
   * all-agents Proxmox/SSH config. Defaults to false.
   */
  allAgents: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Re-export the config shapes a connection's `config` may take, for convenience. */
export type ChatConnectionConfig = ChannelBotConfig;
export type McpConnectionConfig = McpServerConfig;

/**
 * Unified "Integrations" vocabulary (the user-facing model that replaces the
 * Credentials + Connections tabs). The two-tier shape is unchanged underneath:
 *
 * - An {@link Account} is the reusable identity + secret (was a {@link Credential}).
 *   Beyond chat/smtp tokens it now absorbs git/forge accounts, reusable SSH keys,
 *   and generic instance-wide secrets.
 * - A {@link Binding} is one use of an account + who it's for (was a
 *   {@link Connection}). It targets specific agents (via `assignedAgentIds`) or
 *   every agent (via {@link Binding.allAgents}, for instance-wide secrets).
 *
 * The names are aliases during the transition so existing call sites keep working.
 */
export type Account = Credential;
export type Binding = Connection;
/** A service kind in the unified registry (account or binding type). */
export type IntegrationType = string;
