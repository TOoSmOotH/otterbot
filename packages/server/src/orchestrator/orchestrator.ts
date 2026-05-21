import { join } from "node:path";
import { existsSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  AgentProfile,
  AgentProfileSummary,
  AgentStatus,
  AgentRole,
  AgentConnectorStatus,
  ChannelBotConfig,
  ChannelConnectorStatus,
  ConfiguredModel,
  GlobalSettings,
  McpServerStatus,
  ModelRef,
  ProviderAccount,
  ProviderId,
} from "@otterbot/shared";
import type { Config } from "../config.js";
import {
  ProfileStore,
  normalizeProfile,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_EMBEDDING_MODEL_ID,
} from "../profiles/profile-store.js";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import { buildAgentContext, type AgentContext } from "../runtime/agent-context.js";
import { DEFAULT_CONTEXT_WINDOW } from "../runtime/context-manager.js";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import type { AgentServices, SpawnResult } from "../runtime/agent-services.js";
import { resolveEmbedder } from "../providers/registry.js";
import { PROVIDER_CATALOG, findProvider } from "../providers/catalog.js";
import { setDefaultContext } from "../runtime/default-agent.js";
import { MessageBus } from "../bus/bus.js";
import { createTransport } from "../bus/transports/factory.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { SecretsStore, type ScopedSecret } from "../secrets/secrets-store.js";
import { suggestScopeForKey } from "../secrets/shell-secrets.js";
import type { CredentialScope } from "@otterbot/shared";
import {
  type ChannelConnector,
  connectorSignature,
} from "../integrations/channel-connector.js";
import { WebClient } from "@slack/web-api";
import { SlackConnector } from "../integrations/slack-connector.js";
import { DiscordConnector } from "../integrations/discord-connector.js";
import { McpManager } from "../integrations/mcp.js";

/** A live per-agent chat connector plus the signature it was started with. */
interface TrackedConnector<C extends ChannelConnector> {
  connector: C;
  signature: string;
}

/** Derive the UI-facing status for one channel from its config + connector. */
function channelStatus(
  cfg: ChannelBotConfig | null,
  tracked: TrackedConnector<ChannelConnector> | undefined
): ChannelConnectorStatus {
  if (!cfg?.enabled) {
    return { enabled: false, state: "off", error: null, channelId: cfg?.channelId ?? null };
  }
  if (!tracked) {
    // Enabled but no connector — reconcile skipped it for missing tokens.
    return {
      enabled: true,
      state: "missing-tokens",
      error: "Add the bot token and app/socket token, then save.",
      channelId: cfg.channelId,
    };
  }
  const s = tracked.connector.getStatus();
  return { enabled: true, state: s.state, error: s.error, channelId: s.channelId };
}

/** Input for creating a new agent profile. */
export interface CreateAgentInput {
  displayName: string;
  role?: AgentRole;
  persona?: string;
  model?: AgentProfile["model"];
  allowedChatServices?: AgentProfile["allowedChatServices"];
  transport?: AgentProfile["transport"];
  slack?: ChannelBotConfig | null;
  discord?: ChannelBotConfig | null;
  allowedPeers?: AgentProfile["allowedPeers"];
  email?: string | null;
  artwork?: AgentProfile["artwork"];
  canSpawnSubagents?: boolean;
  subagentLimit?: number;
  parentId?: string | null;
}

export const GLOBAL_SETTINGS_KEY = "global_settings";

/** The auto-created first account for every provider. */
export const DEFAULT_ACCOUNT = "default";

function defaultAccountFor(p: { id: string; defaultBaseUrl: string | null }): ProviderAccount {
  return {
    account: DEFAULT_ACCOUNT,
    baseUrl: p.defaultBaseUrl ?? "",
    apiKeyConfigured: false,
    ...(p.id === "openai" ? { authMethod: "api-key" as const } : {}),
  };
}

/** The chat + embedding models a fresh install ships with (local LM Studio). */
const DEFAULT_MODELS: ConfiguredModel[] = [
  {
    id: DEFAULT_CHAT_MODEL_ID,
    label: "local-model",
    provider: "lmstudio",
    account: DEFAULT_ACCOUNT,
    modelId: "local-model",
    kind: "chat",
  },
  {
    id: DEFAULT_EMBEDDING_MODEL_ID,
    label: "local-model",
    provider: "lmstudio",
    account: DEFAULT_ACCOUNT,
    modelId: "local-model",
    kind: "embedding",
  },
];

/** Per-provider default settings, derived from the provider catalog. */
const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  theme: "obsidian",
  models: DEFAULT_MODELS.map((m) => ({ ...m })),
  defaultChatModelId: DEFAULT_CHAT_MODEL_ID,
  defaultEmbeddingModelId: DEFAULT_EMBEDDING_MODEL_ID,
  providers: Object.fromEntries(PROVIDER_CATALOG.map((p) => [p.id, [defaultAccountFor(p)]])),
};

/**
 * Legacy (pre-registry) GlobalSettings shape — agents and defaults stored
 * `ModelRef`s and a separate context-window table. Accepted by
 * {@link normalizeGlobalSettings} so old installs migrate transparently.
 */
interface LegacyGlobalSettings {
  defaultChatModel?: Partial<ModelRef>;
  defaultEmbeddingModel?: Partial<ModelRef>;
  modelContextWindows?: Array<{ provider?: string; modelId?: string; contextWindow?: number }>;
}

/** Normalize one configured-model entry; returns null if it can't be salvaged. */
function normalizeConfiguredModel(raw: unknown): ConfiguredModel | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<ConfiguredModel>;
  if (typeof m.id !== "string" || !m.id.trim()) return null;
  if (typeof m.provider !== "string" || typeof m.modelId !== "string") return null;
  const kind = m.kind === "embedding" ? "embedding" : "chat";
  const out: ConfiguredModel = {
    id: m.id,
    label: typeof m.label === "string" && m.label.trim() ? m.label : m.modelId || m.id,
    provider: m.provider,
    account: typeof m.account === "string" && m.account ? m.account : DEFAULT_ACCOUNT,
    modelId: m.modelId,
    kind,
  };
  if (kind === "chat" && typeof m.contextWindow === "number" && m.contextWindow > 0) {
    out.contextWindow = Math.round(m.contextWindow);
  }
  return out;
}

/**
 * Synthesize a model registry from the legacy ModelRef-based settings. The old
 * default chat/embedding refs become the two default models; any extra context
 * windows become standalone chat entries so their tuning isn't lost.
 */
function migrateLegacyModels(legacy: LegacyGlobalSettings): {
  models: ConfiguredModel[];
  defaultChatModelId: string;
  defaultEmbeddingModelId: string;
} {
  const models: ConfiguredModel[] = [];
  const cwFor = (provider?: string, modelId?: string) =>
    legacy.modelContextWindows?.find((m) => m.provider === provider && m.modelId === modelId)
      ?.contextWindow;

  const chat = legacy.defaultChatModel;
  const emb = legacy.defaultEmbeddingModel;
  let defaultChatModelId = "";
  let defaultEmbeddingModelId = "";
  if (chat?.provider) {
    models.push({
      id: DEFAULT_CHAT_MODEL_ID,
      label: chat.modelId || "chat model",
      provider: chat.provider,
      account: chat.account || DEFAULT_ACCOUNT,
      modelId: chat.modelId ?? "",
      kind: "chat",
      ...(cwFor(chat.provider, chat.modelId) ? { contextWindow: cwFor(chat.provider, chat.modelId) } : {}),
    });
    defaultChatModelId = DEFAULT_CHAT_MODEL_ID;
  }
  if (emb?.provider) {
    models.push({
      id: DEFAULT_EMBEDDING_MODEL_ID,
      label: emb.modelId || "embedding model",
      provider: emb.provider,
      account: emb.account || DEFAULT_ACCOUNT,
      modelId: emb.modelId ?? "",
      kind: "embedding",
    });
    defaultEmbeddingModelId = DEFAULT_EMBEDDING_MODEL_ID;
  }
  for (const cw of legacy.modelContextWindows ?? []) {
    if (!cw.provider || !cw.modelId) continue;
    if (models.some((m) => m.provider === cw.provider && m.modelId === cw.modelId)) continue;
    models.push({
      id: uniqueModelId(models, cw.modelId),
      label: cw.modelId,
      provider: cw.provider,
      account: DEFAULT_ACCOUNT,
      modelId: cw.modelId,
      kind: "chat",
      ...(cw.contextWindow && cw.contextWindow > 0 ? { contextWindow: Math.round(cw.contextWindow) } : {}),
    });
  }
  return { models, defaultChatModelId, defaultEmbeddingModelId };
}

/**
 * Accept both the new shape (`ProviderAccount[]`) and the pre-multi-account
 * shape (a single `ProviderAccount`-ish object). Old single-config installs
 * become one `"default"` account.
 */
function normalizeProviderAccounts(
  raw: unknown,
  providerId: ProviderId
): ProviderAccount[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? [raw]
      : [];
  const seen = new Set<string>();
  const out: ProviderAccount[] = [];
  for (const item of list as Partial<ProviderAccount>[]) {
    if (!item || typeof item !== "object") continue;
    let label = (item.account ?? DEFAULT_ACCOUNT).trim() || DEFAULT_ACCOUNT;
    while (seen.has(label)) label = `${label}-2`;
    seen.add(label);
    const apiKey = typeof item.apiKey === "string" ? item.apiKey : undefined;
    const account: ProviderAccount = {
      account: label,
      baseUrl: typeof item.baseUrl === "string" ? item.baseUrl : "",
      apiKeyConfigured: Boolean(apiKey || item.apiKeyConfigured),
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(providerId === "openai" && item.authMethod
        ? { authMethod: item.authMethod }
        : providerId === "openai"
          ? { authMethod: "api-key" }
          : {}),
    };
    out.push(account);
  }
  return out;
}

function normalizeGlobalSettings(input?: Partial<GlobalSettings> | null): GlobalSettings {
  const defaults = DEFAULT_GLOBAL_SETTINGS;
  const nextProviders: Record<ProviderId, ProviderAccount[]> = {};
  const inputProviders = input?.providers as Record<string, unknown> | undefined;
  const hasProviders =
    !!inputProviders && typeof inputProviders === "object" && Object.keys(inputProviders).length > 0;
  if (!hasProviders) {
    // Fresh / legacy install: seed every catalog provider with its default account.
    for (const provider of Object.keys(defaults.providers) as ProviderId[]) {
      nextProviders[provider] = defaults.providers[provider].map((a) => ({ ...a }));
    }
  } else {
    // Respect exactly what the caller sent. An empty list means the user removed
    // that provider, so don't resurrect a default account for it.
    for (const [provider, raw] of Object.entries(inputProviders)) {
      nextProviders[provider] = normalizeProviderAccounts(raw, provider);
    }
  }
  // Resolve the model registry. Three cases:
  //  - new shape: `models` is an array (may be empty if the user cleared it).
  //  - legacy shape: ModelRef-based defaults / context windows → synthesize.
  //  - nothing supplied: ship the built-in defaults.
  const legacy = input as (Partial<GlobalSettings> & LegacyGlobalSettings) | null | undefined;
  let models: ConfiguredModel[];
  let defaultChatModelId: string;
  let defaultEmbeddingModelId: string;
  if (Array.isArray(input?.models)) {
    const seen = new Set<string>();
    models = [];
    for (const raw of input.models) {
      const m = normalizeConfiguredModel(raw);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      models.push(m);
    }
    defaultChatModelId = typeof input?.defaultChatModelId === "string" ? input.defaultChatModelId : "";
    defaultEmbeddingModelId =
      typeof input?.defaultEmbeddingModelId === "string" ? input.defaultEmbeddingModelId : "";
  } else if (legacy?.defaultChatModel || legacy?.defaultEmbeddingModel || legacy?.modelContextWindows) {
    ({ models, defaultChatModelId, defaultEmbeddingModelId } = migrateLegacyModels(legacy));
  } else {
    models = defaults.models.map((m) => ({ ...m }));
    defaultChatModelId = defaults.defaultChatModelId;
    defaultEmbeddingModelId = defaults.defaultEmbeddingModelId;
  }
  // A default id must point at a real entry, else clear it.
  if (defaultChatModelId && !models.some((m) => m.id === defaultChatModelId)) defaultChatModelId = "";
  if (defaultEmbeddingModelId && !models.some((m) => m.id === defaultEmbeddingModelId))
    defaultEmbeddingModelId = "";
  return {
    theme: input?.theme ?? defaults.theme,
    models,
    defaultChatModelId,
    defaultEmbeddingModelId,
    providers: nextProviders,
  };
}

export function redactGlobalSettings(settings: GlobalSettings): GlobalSettings {
  const providers: Record<ProviderId, ProviderAccount[]> = {};
  for (const provider of Object.keys(settings.providers) as ProviderId[]) {
    providers[provider] = (settings.providers[provider] ?? []).map((acc) => {
      const { apiKey, ...rest } = acc;
      return {
        ...rest,
        apiKeyConfigured: Boolean(apiKey || rest.apiKeyConfigured),
      };
    });
  }
  return { ...settings, providers };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent"
  );
}

/** A slug id for a configured model, unique within the given registry. */
function uniqueModelId(existing: { id: string }[], base: string): string {
  const root = slugify(base) || "model";
  let id = root;
  let n = 2;
  while (existing.some((m) => m.id === id)) id = `${root}-${n++}`;
  return id;
}

/**
 * Owns the lifecycle of every agent: builds one isolated `AgentContext` and
 * `AgentRuntime` per profile, keeps the control DB registry in sync, and
 * exposes create/update/delete. The COO is just the profile with role "coo".
 */
export class Orchestrator {
  private readonly contexts = new Map<string, AgentContext>();
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly statusListeners = new Set<(id: string, status: AgentStatus) => void>();
  /** Background embedding-init promises, awaited on shutdown. */
  private readonly pendingInits: Promise<void>[] = [];
  private readonly bus: MessageBus;
  private readonly scheduler: Scheduler;
  private readonly secrets: SecretsStore;
  private readonly services: AgentServices;
  /** Per-agent chat connectors, keyed by agent id. */
  private readonly slackConnectors = new Map<string, TrackedConnector<SlackConnector>>();
  private readonly discordConnectors = new Map<string, TrackedConnector<DiscordConnector>>();
  /** Per-agent MCP server connections. */
  private readonly mcp = new McpManager();
  private subagentSeq = 0;

  constructor(
    private readonly profiles: ProfileStore,
    private readonly control: ControlDb,
    private readonly cfg: Config
  ) {
    this.bus = new MessageBus(control, createTransport(cfg));
    this.scheduler = new Scheduler(control, (id) => this.runtimes.get(id));
    this.secrets = new SecretsStore(control);
    this.bus.setDeliver((agentId, msg) => {
      if (agentId === "*") {
        for (const rt of this.runtimes.values()) {
          if (rt.id !== msg.from) void rt.handleBusMessage(msg);
        }
      } else {
        void this.runtimes.get(agentId)?.handleBusMessage(msg);
      }
    });
    this.services = {
      bus: this.bus,
      listAgents: () =>
        this.listProfiles().map((p) => ({
          id: p.id,
          displayName: p.displayName,
          role: p.role,
          summary: p.persona.split("\n").find((l) => l.trim())?.slice(0, 140) ?? "",
        })),
      spawnSubagent: (parentId, goal, opts) => this.spawnSubagent(parentId, goal, opts),
      scheduleTask: (agentId, cron, prompt) => this.scheduler.add(agentId, cron, prompt),
      listScheduledTasks: (agentId) => this.scheduler.list(agentId),
      cancelScheduledTask: (id) => this.scheduler.cancel(id),
      searchPeerMemory: async (targetAgentId, query, limit) => {
        const targetCtx = this.contexts.get(targetAgentId);
        if (!targetCtx) return [];
        return targetCtx.memory.search(query, { limit });
      },
    };
  }

  /** The agent-to-agent message bus. */
  getBus(): MessageBus {
    return this.bus;
  }

  /** The cron scheduler. */
  getScheduler(): Scheduler {
    return this.scheduler;
  }

  /** The per-agent credential store. */
  getSecrets(): SecretsStore {
    return this.secrets;
  }

  /** Read an app-level setting (e.g. onboarding state). */
  getSetting(key: string): string | null {
    const row = this.control.db
      .select()
      .from(controlSchema.appSettings)
      .where(eq(controlSchema.appSettings.key, key))
      .get();
    return row?.value ?? null;
  }

  /** Write an app-level setting. */
  setSetting(key: string, value: string): void {
    this.control.db
      .insert(controlSchema.appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: controlSchema.appSettings.key, set: { value } })
      .run();
  }

  getGlobalSettings(): GlobalSettings {
    const raw = this.getSetting(GLOBAL_SETTINGS_KEY);
    if (!raw) {
      const settings = normalizeGlobalSettings();
      const lm = settings.providers.lmstudio?.[0];
      if (lm) {
        lm.baseUrl = this.cfg.lmstudioBaseUrl;
        if (this.cfg.lmstudioApiKey) {
          lm.apiKey = this.cfg.lmstudioApiKey;
          lm.apiKeyConfigured = true;
        }
      }
      // Seed the default chat model's id from the configured fallback model.
      if (this.cfg.model) {
        const chat = settings.models.find((m) => m.id === DEFAULT_CHAT_MODEL_ID);
        if (chat) {
          chat.modelId = this.cfg.model;
          chat.label = this.cfg.model;
        }
      }
      return settings;
    }
    try {
      return normalizeGlobalSettings(JSON.parse(raw) as Partial<GlobalSettings>);
    } catch {
      return normalizeGlobalSettings();
    }
  }

  setGlobalSettings(settings: GlobalSettings): GlobalSettings {
    const current = this.getGlobalSettings();
    const mergedProviders: Record<ProviderId, ProviderAccount[]> = {};
    // Merge each incoming account against current (preserves apiKey when caller
    // sent only a redacted view — apiKey is dropped over the wire).
    for (const provider of Object.keys(settings.providers) as ProviderId[]) {
      const incomingList = settings.providers[provider] ?? [];
      const currentByName = new Map(
        (current.providers[provider] ?? []).map((a) => [a.account, a])
      );
      mergedProviders[provider] = incomingList.map((incoming) => {
        const prev = currentByName.get(incoming.account);
        const apiKey =
          incoming.apiKey !== undefined
            ? incoming.apiKey === ""
              ? undefined
              : incoming.apiKey
            : prev?.apiKey;
        return {
          ...(prev ?? {}),
          ...incoming,
          ...(apiKey !== undefined ? { apiKey } : { apiKey: undefined }),
          apiKeyConfigured: Boolean(apiKey),
        };
      });
    }
    const next = normalizeGlobalSettings({ ...settings, providers: mergedProviders });
    this.setSetting(GLOBAL_SETTINGS_KEY, JSON.stringify(next));
    this.restartAgents();
    return next;
  }

  /**
   * Resolve a provider+account pair to its stored {@link ProviderAccount}.
   * Falls back to the first configured account for the provider when the named
   * one is missing (e.g. a profile referencing a deleted account).
   */
  findAccount(
    provider: ProviderId,
    account: string,
    settings: GlobalSettings = this.getGlobalSettings()
  ): ProviderAccount | undefined {
    const list = settings.providers[provider] ?? [];
    return list.find((a) => a.account === account) ?? list[0];
  }

  /**
   * Build the env-var secrets map for a profile. Overlays only the credentials
   * for the accounts the profile actually references (chat + embedding), not
   * every configured provider — so an unused "work" account never leaks into
   * an agent that's using "personal".
   */
  /**
   * Walk every agent's stored credentials and apply `suggestScopeForKey` to any
   * row still at the schema-default `broad`. Known keys (GITHUB_TOKEN, SMTP_*,
   * SLACK_*, DISCORD_*) get a tightened scope; unknown keys stay broad so
   * existing shell-dependent agents keep working. Logs a per-agent summary.
   */
  private tagLegacyCredentialScopes(): void {
    let totalRetagged = 0;
    let remainingBroad = 0;
    for (const id of this.profiles.listIds()) {
      const scoped = this.secrets.getScoped(id);
      if (scoped.size === 0) continue;
      let retaggedHere = 0;
      let broadHere = 0;
      for (const [key, { scope }] of scoped) {
        if (scope !== "broad") continue;
        const suggested = suggestScopeForKey(key);
        if (suggested === "broad") {
          broadHere += 1;
          continue;
        }
        this.secrets.setScope(id, key, suggested);
        retaggedHere += 1;
      }
      if (retaggedHere > 0 || broadHere > 0) {
        console.info(
          `[secrets] ${id}: re-tagged ${retaggedHere} credential(s); ${broadHere} remain broad-shell`,
        );
      }
      totalRetagged += retaggedHere;
      remainingBroad += broadHere;
    }
    if (totalRetagged > 0 || remainingBroad > 0) {
      console.info(
        `[secrets] migration summary: re-tagged ${totalRetagged}, ${remainingBroad} remain broad-shell — review in Agent Studio › Credentials`,
      );
    }
  }

  /**
   * Merge an agent's per-credential bag: global provider keys get an implicit
   * `direct` scope (they power chat/embedder calls and never need to be in
   * the shell env), agent-owned credentials carry their stored scope. Agent
   * credentials win when keys collide.
   */
  private buildScopedSecrets(profile: AgentProfile): Map<string, ScopedSecret> {
    const out = new Map<string, ScopedSecret>();
    for (const [k, v] of this.getProviderSecretsForProfile(profile)) {
      out.set(k, { value: v, scope: "direct" });
    }
    for (const [k, entry] of this.secrets.getScoped(profile.id)) {
      out.set(k, entry);
    }
    return out;
  }

  /**
   * Resolve a configured-model id to its runtime {@link ModelRef}. An unknown
   * id (deleted/never-set model) yields an empty ref the runtime treats as
   * "no model configured" rather than crashing.
   */
  resolveModelRef(
    modelId: string,
    settings: GlobalSettings = this.getGlobalSettings()
  ): ModelRef {
    const m = settings.models.find((x) => x.id === modelId);
    return m
      ? { provider: m.provider, account: m.account, modelId: m.modelId }
      : { provider: "", account: DEFAULT_ACCOUNT, modelId: "" };
  }

  /**
   * Migrate profiles persisted with the old ModelRef-based `model` shape. Each
   * legacy ref is matched against (or appended to) the model registry, and the
   * profile is rewritten to reference the resulting id. The synthesized registry
   * (legacy defaults + any new agent models) is persisted once at the end.
   * Idempotent: profiles already storing string ids are left untouched.
   */
  private migrateLegacyModelRefs(): void {
    const storedRaw = this.getSetting(GLOBAL_SETTINGS_KEY);
    const wasLegacySettings = storedRaw ? !Array.isArray(JSON.parse(storedRaw)?.models) : false;
    const settings = this.getGlobalSettings(); // already normalized to the new shape
    let changed = wasLegacySettings;

    const findOrCreate = (raw: unknown, kind: "chat" | "embedding"): string => {
      if (!raw || typeof raw !== "object") {
        return kind === "chat" ? settings.defaultChatModelId : settings.defaultEmbeddingModelId;
      }
      const ref = raw as Partial<ModelRef>;
      const provider = String(ref.provider ?? "");
      const account = ref.account || DEFAULT_ACCOUNT;
      const modelId = String(ref.modelId ?? "");
      const existing = settings.models.find(
        (m) => m.kind === kind && m.provider === provider && m.account === account && m.modelId === modelId
      );
      if (existing) return existing.id;
      const id = uniqueModelId(settings.models, modelId || provider || kind);
      settings.models.push({ id, label: modelId || provider || kind, provider, account, modelId, kind });
      changed = true;
      return id;
    };

    for (const id of this.profiles.listIds()) {
      const raw = this.profiles.readProfileJson(id);
      if (!raw) continue;
      const model = raw.model as { chat?: unknown; embedding?: unknown } | undefined;
      const legacyChat = !!model && typeof model.chat === "object" && model.chat !== null;
      const legacyEmb = !!model && typeof model.embedding === "object" && model.embedding !== null;
      if (!legacyChat && !legacyEmb && !("allowedModels" in raw)) continue;
      const chatId = legacyChat
        ? findOrCreate(model!.chat, "chat")
        : typeof model?.chat === "string"
          ? model.chat
          : settings.defaultChatModelId;
      const embId = legacyEmb
        ? findOrCreate(model!.embedding, "embedding")
        : typeof model?.embedding === "string"
          ? model.embedding
          : settings.defaultEmbeddingModelId;
      raw.model = { chat: chatId, embedding: embId };
      delete raw.allowedModels;
      this.profiles.writeProfileJson(id, raw);
      console.info(`[profiles] migrated ${id} to configured-model ids`);
    }

    if (changed) this.setSetting(GLOBAL_SETTINGS_KEY, JSON.stringify(settings));
  }

  getProviderSecretsForProfile(profile: AgentProfile): Map<string, string> {
    const settings = this.getGlobalSettings();
    const secrets = new Map<string, string>();
    for (const id of [profile.model.chat, profile.model.embedding]) {
      this.overlayAccountSecrets(secrets, this.resolveModelRef(id, settings), settings);
    }
    return secrets;
  }

  private overlayAccountSecrets(
    into: Map<string, string>,
    ref: ModelRef,
    settings: GlobalSettings
  ): void {
    const def = findProvider(ref.provider);
    if (!def) return;
    const account = this.findAccount(ref.provider, ref.account, settings);
    if (!account) return;
    if (def.apiKeyEnv && account.apiKey) into.set(def.apiKeyEnv, account.apiKey);
    if (def.baseUrlEnv && account.baseUrl) into.set(def.baseUrlEnv, account.baseUrl);
    if (ref.provider === "openai" && account.authMethod) {
      into.set("OPENAI_AUTH_METHOD", account.authMethod);
    }
  }

  /**
   * Stored credentials for one specific provider account — for the test/list
   * endpoints so they can verify a named account (not just the first one).
   * Callers may layer typed/unsaved overrides on top.
   */
  getAccountSecrets(provider: ProviderId, account: string): Map<string, string> {
    const secrets = new Map<string, string>();
    this.overlayAccountSecrets(secrets, { provider, account, modelId: "" }, this.getGlobalSettings());
    return secrets;
  }

  /**
   * Default-account secrets for the test/list endpoints. The endpoints layer
   * the caller's typed credentials on top, so this is just a fallback.
   */
  getGlobalProviderSecrets(): Map<string, string> {
    const settings = this.getGlobalSettings();
    const secrets = new Map<string, string>();
    for (const [provider, accounts] of Object.entries(settings.providers)) {
      const first = accounts[0];
      if (!first) continue;
      const def = findProvider(provider);
      if (def?.apiKeyEnv && first.apiKey) secrets.set(def.apiKeyEnv, first.apiKey);
      if (def?.baseUrlEnv && first.baseUrl) secrets.set(def.baseUrlEnv, first.baseUrl);
      if (provider === "openai" && first.authMethod) {
        secrets.set("OPENAI_AUTH_METHOD", first.authMethod);
      }
    }
    return secrets;
  }

  /** Stop the scheduler + bus and close every agent's database. */
  async shutdown(): Promise<void> {
    this.scheduler.stop();
    await this.bus.stop();
    await Promise.allSettled([
      ...[...this.slackConnectors.values()].map((t) => t.connector.stop()),
      ...[...this.discordConnectors.values()].map((t) => t.connector.stop()),
    ]);
    this.slackConnectors.clear();
    this.discordConnectors.clear();
    await this.mcp.shutdown();
    await Promise.allSettled(this.pendingInits.splice(0));
    for (const ctx of this.contexts.values()) {
      try {
        ctx.close();
      } catch {
        // already closed
      }
    }
    this.contexts.clear();
    this.runtimes.clear();
  }

  /** Load (or first-run migrate) every profile and start its runtime. */
  async boot(): Promise<void> {
    this.profiles.ensureCooProfile({
      chatModelId: this.cfg.model,
      legacySkillsDir: this.cfg.skillsDir,
    });

    // One-time migration: fold any legacy plaintext `.env` credential files
    // into the encrypted secrets store, then delete them.
    for (const id of this.profiles.listIds()) {
      const legacy = this.profiles.readLegacyEnv(id);
      if (legacy) {
        if (legacy.size > 0) {
          const merged = this.secrets.get(id);
          for (const [k, v] of legacy) if (!merged.has(k)) merged.set(k, v);
          this.secrets.set(id, merged);
        }
        this.profiles.removeLegacyEnv(id);
        console.info(`[profiles] migrated legacy .env for ${id} into the secrets store`);
      }
    }

    // One-time migration: tag every legacy credential with a sane default
    // scope based on its env-var name. Re-runs are cheap and idempotent —
    // we only touch rows still at the schema default `broad`.
    this.tagLegacyCredentialScopes();

    // One-time migration: rewrite any profile still storing ModelRef objects
    // into configured-model id references, registering matching entries in the
    // model registry. Idempotent — profiles already on ids are skipped.
    this.migrateLegacyModelRefs();

    for (const profile of this.profiles.list()) {
      this.startAgent(profile);
    }

    const coo = this.contexts.get("coo");
    if (!coo) throw new Error("COO profile failed to load");
    setDefaultContext(coo);

    for (const profile of this.listProfiles()) {
      this.reconcileConnectors(profile);
    }

    await this.bus.start();
    this.scheduler.start();
  }

  /** Build and register a runtime + context for a profile. */
  private startAgent(profile: AgentProfile): AgentContext {
    const paths = this.profiles.pathsFor(profile.id);
    const scopedSecrets = this.buildScopedSecrets(profile);
    const secrets = new Map<string, string>();
    for (const [k, { value }] of scopedSecrets) secrets.set(k, value);
    const settings = this.getGlobalSettings();
    const chatModelRef = this.resolveModelRef(profile.model.chat, settings);
    const embeddingRef = this.resolveModelRef(profile.model.embedding, settings);
    const contextWindow =
      settings.models.find((m) => m.id === profile.model.chat)?.contextWindow ??
      DEFAULT_CONTEXT_WINDOW;
    const ctx = buildAgentContext({
      profile,
      chatModelRef,
      scopedSecrets,
      contextWindow,
      agentDbPath: paths.agentDb,
      skillsDir: paths.skillsDir,
      workspaceDir: paths.workspace,
      embedder: resolveEmbedder(embeddingRef, secrets),
      dbKey: this.cfg.dbKey,
    });
    const runtime = new AgentRuntime(ctx, this.services);
    runtime.onStatus((status) => {
      this.persistStatus(profile.id, status);
      for (const listener of this.statusListeners) listener(profile.id, status);
    });
    this.contexts.set(profile.id, ctx);
    this.runtimes.set(profile.id, runtime);
    this.registerInControl(profile, paths.dir);
    this.pendingInits.push(ctx.embedding.init());
    // Load on-disk skills first so capability-carried MCP servers are known
    // before we connect.
    ctx.skills.loadFromDisk();
    // Connect the agent's MCP servers in the background; their tools merge in
    // once available. A failing server never blocks the agent. The set is the
    // union of the profile's servers and those carried by enabled capabilities.
    this.pendingInits.push(
      this.mcp
        .connect(
          profile.id,
          [...profile.mcpServers, ...ctx.skills.effectiveMcpServers()],
          secrets,
          ctx.mcpTools
        )
        .catch((err) => console.warn(`[mcp] connect failed for ${profile.id}:`, err))
    );
    return ctx;
  }

  private registerInControl(profile: AgentProfile, profileDir: string): void {
    this.control.db
      .insert(controlSchema.agents)
      .values({
        id: profile.id,
        displayName: profile.displayName,
        role: profile.role,
        profileDir,
        status: "idle",
        parentId: profile.parentId,
        createdAt: profile.createdAt,
      })
      .onConflictDoUpdate({
        target: controlSchema.agents.id,
        set: {
          displayName: profile.displayName,
          role: profile.role,
          parentId: profile.parentId,
        },
      })
      .run();
  }

  private persistStatus(id: string, status: AgentStatus): void {
    this.control.db
      .update(controlSchema.agents)
      .set({ status })
      .where(eq(controlSchema.agents.id, id))
      .run();
  }

  /**
   * Bring an agent's Slack + Discord chat connectors in line with its profile
   * and credentials. Connectors are deliberately decoupled from agent context
   * lifecycle: a connector only reconnects when its channel/tokens actually
   * change; a gate-only change (publicBot / allowedUserIds) is applied in place.
   */
  /** Live Slack/Discord connector status for an agent. */
  getConnectorStatus(id: string): AgentConnectorStatus | null {
    const ctx = this.contexts.get(id);
    if (!ctx) return null;
    return {
      slack: channelStatus(ctx.profile.slack, this.slackConnectors.get(id)),
      discord: channelStatus(ctx.profile.discord, this.discordConnectors.get(id)),
    };
  }

  private reconcileConnectors(profile: AgentProfile): void {
    const secrets = this.secrets.get(profile.id);
    this.reconcileOne(
      profile.id,
      profile.slack,
      [secrets.get("SLACK_BOT_TOKEN") ?? "", secrets.get("SLACK_APP_TOKEN") ?? ""],
      this.slackConnectors,
      (cfg, [bot, appToken]) =>
        new SlackConnector(profile.id, cfg, bot, appToken, () =>
          this.runtimes.get(profile.id)
        )
    );
    this.reconcileOne(
      profile.id,
      profile.discord,
      [secrets.get("DISCORD_BOT_TOKEN") ?? ""],
      this.discordConnectors,
      (cfg, [bot]) =>
        new DiscordConnector(profile.id, cfg, bot, () => this.runtimes.get(profile.id))
    );
  }

  private reconcileOne<C extends ChannelConnector>(
    agentId: string,
    cfg: ChannelBotConfig | null,
    tokens: string[],
    connectors: Map<string, TrackedConnector<C>>,
    make: (cfg: ChannelBotConfig, tokens: string[]) => C
  ): void {
    const existing = connectors.get(agentId);
    if (!cfg?.enabled || tokens.some((t) => !t)) {
      if (existing) {
        void existing.connector.stop();
        connectors.delete(agentId);
      }
      return;
    }
    const signature = connectorSignature(cfg, tokens);
    if (existing && existing.signature === signature) {
      existing.connector.updateGate(cfg);
      return;
    }
    if (existing) void existing.connector.stop();
    const connector = make(cfg, tokens);
    connectors.set(agentId, { connector, signature });
    this.pendingInits.push(
      connector
        .start()
        .then(() => connector.markConnected())
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          connector.markError(message);
          console.warn(`[connector] start failed for ${agentId}:`, message);
        })
    );
  }

  private async stopConnectors(agentId: string): Promise<void> {
    const slack = this.slackConnectors.get(agentId);
    const discord = this.discordConnectors.get(agentId);
    this.slackConnectors.delete(agentId);
    this.discordConnectors.delete(agentId);
    await Promise.allSettled([slack?.connector.stop(), discord?.connector.stop()]);
  }

  // --- Accessors -----------------------------------------------------------

  getRuntime(id: string): AgentRuntime | undefined {
    return this.runtimes.get(id);
  }

  getContext(id: string): AgentContext | undefined {
    return this.contexts.get(id);
  }

  getCoo(): AgentRuntime {
    const coo = this.runtimes.get("coo");
    if (!coo) throw new Error("COO runtime not started");
    return coo;
  }

  listProfiles(): AgentProfile[] {
    return [...this.contexts.values()].map((c) => c.profile);
  }

  listSummaries(): AgentProfileSummary[] {
    const settings = this.getGlobalSettings();
    return [...this.runtimes.values()].map((r) => {
      const p = r.ctx.profile;
      return {
        id: p.id,
        displayName: p.displayName,
        role: p.role,
        status: r.status,
        chatModel: this.resolveModelRef(p.model.chat, settings),
        artwork: p.artwork,
        parentId: p.parentId,
        activeSubagents: [...this.contexts.values()].filter(
          (c) => c.profile.parentId === p.id
        ).length,
      };
    });
  }

  onStatusChange(listener: (id: string, status: AgentStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // --- Mutations -----------------------------------------------------------

  /** Create a new agent profile, scaffold its directory, and start it. */
  createAgent(input: CreateAgentInput): AgentProfile {
    let id = slugify(input.displayName);
    let n = 2;
    while (this.profiles.exists(id) || this.contexts.has(id)) {
      id = `${slugify(input.displayName)}-${n++}`;
    }
    const defaults = this.getGlobalSettings();
    const model = input.model ?? {
      chat: defaults.defaultChatModelId,
      embedding: defaults.defaultEmbeddingModelId,
    };
    const profile = normalizeProfile({
      id,
      displayName: input.displayName,
      role: input.role ?? "agent",
      persona: input.persona,
      model,
      allowedChatServices: input.allowedChatServices,
      transport: input.transport,
      slack: input.slack ?? null,
      discord: input.discord ?? null,
      allowedPeers: input.allowedPeers,
      email: input.email ?? null,
      artwork: input.artwork,
      canSpawnSubagents: input.canSpawnSubagents,
      subagentLimit: input.subagentLimit,
      parentId: input.parentId ?? null,
      createdAt: new Date().toISOString(),
    });
    this.profiles.create(profile);
    this.startAgent(profile);
    this.reconcileConnectors(profile);
    return profile;
  }

  /** Update a profile and restart its runtime so model/persona changes apply. */
  updateAgent(id: string, patch: Partial<AgentProfile>): AgentProfile | null {
    const ctx = this.contexts.get(id);
    if (!ctx) return null;
    const updated = normalizeProfile({ ...ctx.profile, ...patch, id });
    this.profiles.save(updated);

    void this.mcp.disconnect(id);
    ctx.close();
    this.contexts.delete(id);
    this.runtimes.delete(id);
    const fresh = this.startAgent(updated);
    if (id === "coo") setDefaultContext(fresh);
    this.reconcileConnectors(updated);
    return updated;
  }

  /** Live MCP server status for an agent. */
  getMcpStatus(id: string): McpServerStatus[] | null {
    return this.contexts.has(id) ? this.mcp.status(id) : null;
  }

  /**
   * Reconnect an agent's MCP servers without the full `updateAgent()`
   * teardown/restart. Used when a capability is toggled or (un)installed so the
   * union of profile + capability-carried MCP servers stays current.
   */
  async reloadAgentMcp(id: string): Promise<void> {
    const ctx = this.contexts.get(id);
    if (!ctx) return;
    const secrets = new Map([
      ...this.getProviderSecretsForProfile(ctx.profile),
      ...this.secrets.get(id),
    ]);
    await this.mcp
      .connect(
        id,
        [...ctx.profile.mcpServers, ...ctx.skills.effectiveMcpServers()],
        secrets,
        ctx.mcpTools
      )
      .catch((err) => console.warn(`[mcp] reload failed for ${id}:`, err));
  }

  /** Absolute path to an agent's stored avatar image, or null if it has none. */
  agentAvatarPath(id: string): string | null {
    if (!this.contexts.has(id)) return null;
    const dir = this.profiles.pathsFor(id).dir;
    if (!existsSync(dir)) return null;
    const file = readdirSync(dir).find((n) => /^avatar\.(png|jpg|jpeg|webp|gif)$/i.test(n));
    return file ? join(dir, file) : null;
  }

  /** Save an uploaded avatar image and point the agent's artwork at it. */
  setAgentAvatar(id: string, data: Buffer, ext: string): AgentProfile | null {
    if (!this.contexts.has(id)) return null;
    const dir = this.profiles.pathsFor(id).dir;
    this.clearAvatarFiles(dir);
    writeFileSync(join(dir, `avatar.${ext}`), data);
    // Cache-bust the URL so the browser refetches when the image changes.
    return this.updateAgent(id, { artwork: { avatar: `/api/agents/${id}/avatar?v=${Date.now()}` } });
  }

  /** Remove an agent's avatar image; the UI falls back to initials. */
  clearAgentAvatar(id: string): AgentProfile | null {
    if (!this.contexts.has(id)) return null;
    this.clearAvatarFiles(this.profiles.pathsFor(id).dir);
    return this.updateAgent(id, { artwork: { avatar: null } });
  }

  private clearAvatarFiles(dir: string): void {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (/^avatar\./i.test(name)) rmSync(join(dir, name), { force: true });
    }
  }

  /** Delete an agent. The COO cannot be deleted. */
  async deleteAgent(id: string): Promise<boolean> {
    if (id === "coo") return false;
    const ctx = this.contexts.get(id);
    if (!ctx) return false;
    await this.stopConnectors(id);
    await this.mcp.disconnect(id);
    ctx.close();
    this.contexts.delete(id);
    this.runtimes.delete(id);
    this.control.db.delete(controlSchema.agents).where(eq(controlSchema.agents.id, id)).run();
    this.secrets.delete(id);
    this.profiles.delete(id);
    return true;
  }

  /** Stored credentials for an agent, masked: only `key` and `scope`. */
  listCredentials(id: string): Array<{ key: string; scope: CredentialScope }> | null {
    if (!this.contexts.has(id)) return null;
    return this.secrets
      .listScopes(id)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Merge credentials into an agent's existing bag, then restart it. Each
   * entry may be a plain string (legacy: scope defaults to existing-or-broad)
   * or `{ value, scope }`. Empty/whitespace keys are dropped.
   */
  mergeCredentials(
    id: string,
    secrets: Record<string, string | { value: string; scope?: CredentialScope }>,
  ): boolean {
    if (!this.contexts.has(id)) return false;
    for (const [rawKey, entry] of Object.entries(secrets)) {
      const key = rawKey.trim();
      if (!key) continue;
      if (typeof entry === "string") {
        this.secrets.upsert(id, key, entry);
      } else {
        this.secrets.upsert(id, key, entry.value, entry.scope);
      }
    }
    this.updateAgent(id, {});
    return true;
  }

  /** Change a credential's scope without re-sending the value. */
  setCredentialScope(id: string, key: string, scope: CredentialScope): boolean {
    if (!this.contexts.has(id)) return false;
    const ok = this.secrets.setScope(id, key, scope);
    if (ok) this.updateAgent(id, {});
    return ok;
  }

  /** Delete a single credential by key, then restart the agent. */
  deleteCredential(id: string, key: string): boolean {
    if (!this.contexts.has(id)) return false;
    this.secrets.deleteOne(id, key);
    this.updateAgent(id, {});
    return true;
  }

  /** Verify an agent's stored Slack bot token against Slack's `auth.test`. */
  async testSlackToken(
    id: string
  ): Promise<{ ok: boolean; team?: string; user?: string; error?: string }> {
    if (!this.contexts.has(id)) return { ok: false, error: "unknown agent" };
    const token = this.secrets.get(id).get("SLACK_BOT_TOKEN");
    if (!token) return { ok: false, error: "no SLACK_BOT_TOKEN set" };
    try {
      const res = await new WebClient(token).auth.test();
      return { ok: true, team: res.team as string, user: res.user as string };
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      return { ok: false, error: e.data?.error ?? e.message ?? "unknown error" };
    }
  }

  private restartAgents(): void {
    const profiles = this.listProfiles();
    for (const profile of profiles) {
      const ctx = this.contexts.get(profile.id);
      ctx?.close();
      this.contexts.delete(profile.id);
      this.runtimes.delete(profile.id);
    }
    for (const profile of profiles) {
      const fresh = this.startAgent(profile);
      if (profile.id === "coo") setDefaultContext(fresh);
    }
  }

  /**
   * Spawn an ephemeral subagent under `parentId` to pursue `goal`, run it to
   * completion, and return its findings. The subagent inherits the parent's
   * model + credentials, is tracked in `subagent_tasks`, and announces itself
   * (`spawn`) and its result (`report`) on the bus.
   */
  async spawnSubagent(
    parentId: string,
    goal: string,
    opts?: { modelId?: AgentProfile["model"]["chat"] }
  ): Promise<SpawnResult> {
    const parentCtx = this.contexts.get(parentId);
    if (!parentCtx) throw new Error(`Unknown agent: ${parentId}`);
    if (!parentCtx.profile.canSpawnSubagents) {
      throw new Error(`agent ${parentId} is not allowed to spawn subagents`);
    }
    const active = [...this.contexts.values()].filter(
      (c) => c.profile.parentId === parentId && c.profile.role === "subagent"
    ).length;
    if (active >= parentCtx.profile.subagentLimit) {
      throw new Error(`subagent limit (${parentCtx.profile.subagentLimit}) reached`);
    }

    const subId = `${parentId}__sub__${++this.subagentSeq}`;
    const taskId = nanoid();
    const now = new Date().toISOString();
    const subProfile = normalizeProfile({
      id: subId,
      displayName: `${parentCtx.profile.displayName} · sub ${this.subagentSeq}`,
      role: "subagent",
      persona:
        `You are a focused research subagent spawned by ${parentCtx.profile.displayName}. ` +
        `Pursue exactly the goal you are given, use your tools (search_memory, save_memory), ` +
        `and finish with a concise findings summary.`,
      model: {
        chat: opts?.modelId ?? parentCtx.profile.model.chat,
        embedding: parentCtx.profile.model.embedding,
      },
      transport: parentCtx.profile.transport,
      artwork: parentCtx.profile.artwork,
      parentId,
      canSpawnSubagents: false,
      createdAt: now,
    });
    this.profiles.create(subProfile);
    // Inherit the parent's secrets so the subagent reaches the same endpoints.
    this.secrets.set(subId, this.secrets.get(parentId));
    this.startAgent(subProfile);

    this.control.db
      .insert(controlSchema.subagentTasks)
      .values({
        id: taskId,
        rootId: taskId,
        parentTaskId: null,
        parentAgentId: parentId,
        subagentId: subId,
        goal,
        status: "running",
        resultSummary: null,
        createdAt: now,
        finishedAt: null,
      })
      .run();

    this.bus.publish({
      id: nanoid(),
      kind: "spawn",
      from: parentId,
      to: null,
      threadId: taskId,
      correlationId: null,
      rootSpawnId: taskId,
      body: `Spawned ${subId} for: ${goal}`,
      transport: parentCtx.profile.transport,
    });

    const runtime = this.runtimes.get(subId);
    let summary = "";
    let status: "done" | "failed" = "done";
    try {
      if (!runtime) throw new Error("subagent runtime failed to start");
      const res = await runtime.respond({
        conversationId: `spawn-${taskId}`,
        userMessage: goal,
        onChunk: () => {},
      });
      summary = res.finalText || "(no findings)";
    } catch (err) {
      status = "failed";
      summary = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    this.control.db
      .update(controlSchema.subagentTasks)
      .set({ status, resultSummary: summary, finishedAt: new Date().toISOString() })
      .where(eq(controlSchema.subagentTasks.id, taskId))
      .run();

    this.bus.publish({
      id: nanoid(),
      kind: "report",
      from: subId,
      to: parentId,
      threadId: taskId,
      correlationId: null,
      rootSpawnId: taskId,
      body: summary,
      transport: parentCtx.profile.transport,
    });

    return { subagentId: subId, taskId, summary };
  }

  /** All subagent spawn tasks, newest first. */
  listSubagentTasks(): Array<typeof controlSchema.subagentTasks.$inferSelect> {
    return this.control.db
      .select()
      .from(controlSchema.subagentTasks)
      .orderBy(desc(controlSchema.subagentTasks.createdAt))
      .all();
  }
}
