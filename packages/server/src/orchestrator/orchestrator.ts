import { resolve } from "node:path";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  AgentProfile,
  AgentProfileSummary,
  AgentStatus,
  AgentRole,
  ChannelBotConfig,
  GlobalSettings,
  ProviderId,
} from "@otterbot/shared";
import type { Config } from "../config.js";
import { ProfileStore, normalizeProfile } from "../profiles/profile-store.js";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import { buildAgentContext, type AgentContext } from "../runtime/agent-context.js";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import type { AgentServices, SpawnResult } from "../runtime/agent-services.js";
import { resolveEmbedder } from "../providers/registry.js";
import { setDefaultContext } from "../runtime/default-agent.js";
import { MessageBus } from "../bus/bus.js";
import { createTransport } from "../bus/transports/factory.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { SecretsStore } from "../secrets/secrets-store.js";
import {
  type ChannelConnector,
  connectorSignature,
} from "../integrations/channel-connector.js";
import { SlackConnector } from "../integrations/slack-connector.js";
import { DiscordConnector } from "../integrations/discord-connector.js";

/** A live per-agent chat connector plus the signature it was started with. */
interface TrackedConnector<C extends ChannelConnector> {
  connector: C;
  signature: string;
}

/** Input for creating a new agent profile. */
export interface CreateAgentInput {
  displayName: string;
  role?: AgentRole;
  persona?: string;
  model?: AgentProfile["model"];
  allowedModels?: AgentProfile["allowedModels"];
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

const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  theme: "obsidian",
  defaultChatModel: { provider: "lmstudio", modelId: "local-model" },
  defaultEmbeddingModel: { provider: "lmstudio", modelId: "local-model" },
  providers: {
    anthropic: { baseUrl: "https://api.anthropic.com/v1", apiKeyConfigured: false },
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKeyConfigured: false,
      authMethod: "api-key",
    },
    lmstudio: { baseUrl: "http://localhost:1234/v1", apiKeyConfigured: false },
    ollama: { baseUrl: "http://localhost:11434/v1", apiKeyConfigured: false },
    // The built-in embedder is in-process — no endpoint, no credentials.
    builtin: { baseUrl: "", apiKeyConfigured: false },
  },
};

const API_KEY_NAMES: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  lmstudio: "LMSTUDIO_API_KEY",
  ollama: "OLLAMA_API_KEY",
  builtin: "BUILTIN_API_KEY",
};

const BASE_URL_NAMES: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_BASE_URL",
  openai: "OPENAI_BASE_URL",
  lmstudio: "LMSTUDIO_BASE_URL",
  ollama: "OLLAMA_BASE_URL",
  builtin: "BUILTIN_BASE_URL",
};

function normalizeGlobalSettings(input?: Partial<GlobalSettings> | null): GlobalSettings {
  const defaults = DEFAULT_GLOBAL_SETTINGS;
  const nextProviders = { ...defaults.providers };
  for (const provider of Object.keys(defaults.providers) as ProviderId[]) {
    const incoming = input?.providers?.[provider];
    nextProviders[provider] = {
      ...defaults.providers[provider],
      ...incoming,
      apiKeyConfigured: Boolean(incoming?.apiKey || incoming?.apiKeyConfigured),
    };
    if (provider === "openai" && nextProviders[provider].authMethod !== "oauth") {
      nextProviders[provider].authMethod = "api-key";
    }
  }
  return {
    theme: input?.theme ?? defaults.theme,
    defaultChatModel: input?.defaultChatModel ?? defaults.defaultChatModel,
    defaultEmbeddingModel: input?.defaultEmbeddingModel ?? defaults.defaultEmbeddingModel,
    providers: nextProviders,
  };
}

export function redactGlobalSettings(settings: GlobalSettings): GlobalSettings {
  const providers = { ...settings.providers };
  for (const provider of Object.keys(providers) as ProviderId[]) {
    const { apiKey, ...rest } = providers[provider];
    providers[provider] = {
      ...rest,
      apiKeyConfigured: Boolean(apiKey || rest.apiKeyConfigured),
    };
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
      settings.providers.lmstudio.baseUrl = this.cfg.lmstudioBaseUrl;
      settings.providers.lmstudio.apiKey = this.cfg.lmstudioApiKey ?? undefined;
      settings.providers.lmstudio.apiKeyConfigured = Boolean(this.cfg.lmstudioApiKey);
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
    const mergedProviders = { ...current.providers };
    for (const provider of Object.keys(settings.providers) as ProviderId[]) {
      const incoming = settings.providers[provider];
      mergedProviders[provider] = {
        ...current.providers[provider],
        ...incoming,
        apiKey:
          incoming.apiKey !== undefined
            ? incoming.apiKey
            : current.providers[provider].apiKey,
      };
      if (incoming.apiKey === "") delete mergedProviders[provider].apiKey;
      mergedProviders[provider].apiKeyConfigured = Boolean(mergedProviders[provider].apiKey);
    }
    const next = normalizeGlobalSettings({ ...settings, providers: mergedProviders });
    this.setSetting(GLOBAL_SETTINGS_KEY, JSON.stringify(next));
    this.restartAgents();
    return next;
  }

  getGlobalProviderSecrets(): Map<string, string> {
    const settings = this.getGlobalSettings();
    const secrets = new Map<string, string>();
    for (const provider of Object.keys(settings.providers) as ProviderId[]) {
      const cfg = settings.providers[provider];
      if (cfg.apiKey) secrets.set(API_KEY_NAMES[provider], cfg.apiKey);
      if (cfg.baseUrl) secrets.set(BASE_URL_NAMES[provider], cfg.baseUrl);
      if (provider === "openai" && cfg.authMethod) {
        secrets.set("OPENAI_AUTH_METHOD", cfg.authMethod);
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
    const secrets = new Map([...this.getGlobalProviderSecrets(), ...this.secrets.get(profile.id)]);
    const ctx = buildAgentContext({
      profile,
      secrets,
      agentDbPath: paths.agentDb,
      skillsDir: paths.skillsDir,
      embedder: resolveEmbedder(profile.model.embedding, secrets),
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
    ctx.skills.loadFromDisk();
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
        .catch((err) => console.warn(`[connector] start failed for ${agentId}:`, err))
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
    return [...this.runtimes.values()].map((r) => {
      const p = r.ctx.profile;
      return {
        id: p.id,
        displayName: p.displayName,
        role: p.role,
        status: r.status,
        chatModel: p.model.chat,
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
      chat: defaults.defaultChatModel,
      embedding: defaults.defaultEmbeddingModel,
    };
    const profile = normalizeProfile({
      id,
      displayName: input.displayName,
      role: input.role ?? "agent",
      persona: input.persona,
      model,
      allowedModels: input.allowedModels ?? [
        { provider: model.chat.provider, modelId: "*" },
        { provider: model.embedding.provider, modelId: "*" },
      ],
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

    ctx.close();
    this.contexts.delete(id);
    this.runtimes.delete(id);
    const fresh = this.startAgent(updated);
    if (id === "coo") setDefaultContext(fresh);
    this.reconcileConnectors(updated);
    return updated;
  }

  /** Delete an agent. The COO cannot be deleted. */
  async deleteAgent(id: string): Promise<boolean> {
    if (id === "coo") return false;
    const ctx = this.contexts.get(id);
    if (!ctx) return false;
    await this.stopConnectors(id);
    ctx.close();
    this.contexts.delete(id);
    this.runtimes.delete(id);
    this.control.db.delete(controlSchema.agents).where(eq(controlSchema.agents.id, id)).run();
    this.secrets.delete(id);
    this.profiles.delete(id);
    return true;
  }

  /** Store an agent's credentials in the encrypted DB and restart it. */
  setCredentials(id: string, secrets: Record<string, string>): boolean {
    if (!this.contexts.has(id)) return false;
    this.secrets.set(id, secrets);
    this.updateAgent(id, {});
    return true;
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
    opts?: { modelRef?: AgentProfile["model"]["chat"] }
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
        chat: opts?.modelRef ?? parentCtx.profile.model.chat,
        embedding: parentCtx.profile.model.embedding,
      },
      allowedModels: parentCtx.profile.allowedModels,
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
