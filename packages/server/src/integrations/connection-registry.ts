import type { CredentialType, ConnectionType, SkillConfigSchema } from "@otterbot/shared";
import { isChatConnectionType } from "@otterbot/shared";
import { getCatalogCapability } from "../skills/builtin-catalog.js";
import { PROVIDERS, type ChatProviderId } from "./chat/providers.js";

/**
 * Describes one {@link CredentialType}: the typed secret bundle's fields. The UI
 * renders a form from `fieldSchema` (reusing `SkillConfigForm`); the server uses
 * the schema's `credentialKey`s to know which `global_secrets` keys to write
 * under `cred:<id>:<KEY>`.
 */
export interface CredentialTypeDef {
  type: CredentialType;
  label: string;
  fieldSchema: SkillConfigSchema;
}

/**
 * Describes one {@link ConnectionType}: which credential it references and its
 * own non-secret config fields (a `ChannelBotConfig` for chat, an
 * `McpServerConfig` for mcp, empty for capabilities whose config lives entirely
 * on the credential).
 */
export interface ConnectionTypeDef {
  type: ConnectionType;
  label: string;
  isChat: boolean;
  /** Which credential kind this connection authenticates with; null = none. */
  credentialType: CredentialType | null;
  /** The connection's own non-secret config fields. */
  configSchema: SkillConfigSchema;
}

/** Build the gate/room config schema shared by every chat connection type. */
function chatConfigSchema(channelLabel: string, channelPlaceholder: string): SkillConfigSchema {
  return {
    fields: [
      {
        key: "channelId",
        label: channelLabel,
        type: "string",
        required: true,
        placeholder: channelPlaceholder,
      },
      {
        key: "mentionOnly",
        label: "Only respond when @mentioned",
        type: "boolean",
        default: false,
      },
      {
        key: "publicBot",
        label: "Public — anyone in the channel may talk to the agent",
        type: "boolean",
        default: false,
      },
      {
        key: "allowedUserIds",
        label: "Allowed user IDs (when not public)",
        type: "list",
        itemFields: [{ key: "id", label: "User ID", type: "string", required: true }],
      },
    ],
  };
}

/** Derive a chat credential's field schema from the provider's token keys. */
function chatCredentialSchema(provider: ChatProviderId): SkillConfigSchema {
  const labels: Record<string, { label: string; secret: boolean }> = {
    SLACK_BOT_TOKEN: { label: "Bot OAuth token (xoxb-…)", secret: true },
    SLACK_APP_TOKEN: { label: "App-level / Socket Mode token (xapp-…)", secret: true },
    DISCORD_BOT_TOKEN: { label: "Bot token", secret: true },
    MATRIX_HOMESERVER_URL: { label: "Homeserver URL", secret: false },
    MATRIX_USER: { label: "Username", secret: false },
    MATRIX_PASSWORD: { label: "Password", secret: true },
  };
  return {
    fields: PROVIDERS[provider].connectorTokenKeys.map((key) => {
      const meta = labels[key] ?? { label: key, secret: true };
      return {
        key,
        label: meta.label,
        type: meta.secret ? ("secret" as const) : ("string" as const),
        required: true,
        secret: meta.secret || undefined,
        credentialKey: key,
        scope: "direct" as const,
      };
    }),
  };
}

const SMTP_CREDENTIAL_SCHEMA: SkillConfigSchema = {
  description: "SMTP account the agent sends email from.",
  fields: [
    { key: "SMTP_HOST", label: "SMTP host", type: "string", required: true, credentialKey: "SMTP_HOST", scope: "direct" },
    { key: "SMTP_PORT", label: "Port", type: "number", default: 587, credentialKey: "SMTP_PORT", scope: "direct" },
    { key: "SMTP_USER", label: "Username", type: "string", required: true, credentialKey: "SMTP_USER", scope: "direct" },
    { key: "SMTP_PASS", label: "Password", type: "secret", secret: true, required: true, credentialKey: "SMTP_PASS", scope: "direct" },
    { key: "SMTP_FROM", label: "From address", type: "string", required: true, credentialKey: "SMTP_FROM", scope: "direct" },
  ],
};

const GITHUB_CREDENTIAL_SCHEMA: SkillConfigSchema = {
  description: "A GitHub token for the gh CLI and GitHub tools.",
  fields: [
    {
      key: "GITHUB_TOKEN",
      label: "GitHub token",
      type: "secret",
      secret: true,
      required: true,
      credentialKey: "GITHUB_TOKEN",
      scope: "cap:gh-auth",
    },
  ],
};

/** Pull a capability's configSchema from the builtin catalog (proxmox/ssh). */
function catalogSchema(capId: string): SkillConfigSchema {
  const cap = getCatalogCapability(capId);
  if (!cap?.configSchema) throw new Error(`capability ${capId} has no configSchema`);
  return cap.configSchema;
}

const CREDENTIAL_TYPES: CredentialTypeDef[] = [
  { type: "slack", label: "Slack", fieldSchema: chatCredentialSchema("slack") },
  { type: "discord", label: "Discord", fieldSchema: chatCredentialSchema("discord") },
  { type: "matrix", label: "Matrix", fieldSchema: chatCredentialSchema("matrix") },
  { type: "smtp", label: "SMTP / Email", fieldSchema: SMTP_CREDENTIAL_SCHEMA },
  { type: "github", label: "GitHub token", fieldSchema: GITHUB_CREDENTIAL_SCHEMA },
  { type: "proxmox", label: "Proxmox", fieldSchema: catalogSchema("proxmox") },
  { type: "ssh", label: "SSH", fieldSchema: catalogSchema("ssh") },
];

const MCP_CONFIG_SCHEMA: SkillConfigSchema = {
  description: "A Model Context Protocol server the agent connects to for extra tools.",
  fields: [
    { key: "name", label: "Name (namespaces its tools as mcp_<name>_*)", type: "string", required: true },
    { key: "transport", label: "Transport (stdio | sse)", type: "string", required: true, default: "stdio" },
    { key: "command", label: "Command (stdio)", type: "string", placeholder: "npx -y some-mcp-server" },
    { key: "url", label: "URL (sse)", type: "string" },
    { key: "enabled", label: "Enabled", type: "boolean", default: true },
  ],
};

const CONNECTION_TYPES: ConnectionTypeDef[] = [
  { type: "slack", label: "Slack channel", isChat: true, credentialType: "slack", configSchema: chatConfigSchema("Channel ID", "C0123456789") },
  { type: "discord", label: "Discord channel", isChat: true, credentialType: "discord", configSchema: chatConfigSchema("Channel ID", "123456789012345678") },
  { type: "matrix", label: "Matrix room", isChat: true, credentialType: "matrix", configSchema: chatConfigSchema("Room ID", "!room:server") },
  { type: "smtp", label: "Email (SMTP)", isChat: false, credentialType: "smtp", configSchema: { fields: [] } },
  { type: "github", label: "GitHub", isChat: false, credentialType: "github", configSchema: { fields: [] } },
  { type: "proxmox", label: "Proxmox VM control", isChat: false, credentialType: "proxmox", configSchema: { fields: [] } },
  { type: "ssh", label: "SSH remote access", isChat: false, credentialType: "ssh", configSchema: { fields: [] } },
  { type: "mcp", label: "MCP server", isChat: false, credentialType: null, configSchema: MCP_CONFIG_SCHEMA },
];

export function listConnectionTypes(): ConnectionTypeDef[] {
  return CONNECTION_TYPES;
}

export function listCredentialTypes(): CredentialTypeDef[] {
  return CREDENTIAL_TYPES;
}

export function getConnectionTypeDef(type: ConnectionType): ConnectionTypeDef | undefined {
  return CONNECTION_TYPES.find((t) => t.type === type);
}

export function getCredentialTypeDef(type: CredentialType): CredentialTypeDef | undefined {
  return CREDENTIAL_TYPES.find((t) => t.type === type);
}

/** Credential keys (`global_secrets` env keys) a credential type stores. */
export function credentialKeysFor(type: CredentialType): string[] {
  const def = getCredentialTypeDef(type);
  if (!def) return [];
  return collectCredentialKeys(def.fieldSchema);
}

function collectCredentialKeys(schema: SkillConfigSchema): string[] {
  const keys: string[] = [];
  for (const f of schema.fields) {
    if (f.credentialKey) keys.push(f.credentialKey);
  }
  return keys;
}

export { isChatConnectionType };
