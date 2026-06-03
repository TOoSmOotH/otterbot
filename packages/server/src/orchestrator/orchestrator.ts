import { basename, join, resolve } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  AgentProfile,
  AgentProfileSummary,
  AgentStatus,
  AgentRole,
  AgentConnectorStatus,
  AgentMessage,
  ChannelBotConfig,
  ChannelConnectorStatus,
  Connection,
  ConfiguredModel,
  CodingModelPreset,
  GlobalSettings,
  McpServerConfig,
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
import { AgentRuntime, withAttachmentRefs } from "../runtime/agent-runtime.js";
import type { AgentServices, SpawnResult } from "../runtime/agent-services.js";
import { resolveEmbedder } from "../providers/registry.js";
import { PROVIDER_CATALOG, findProvider } from "../providers/catalog.js";
import {
  writeOpencodeConfig,
  type OpencodeProviderEntry,
} from "../integrations/opencode-config.js";
import { sharedCodingAuthDir, type GitSshSetup } from "../integrations/shell.js";
import { setDefaultContext } from "../runtime/default-agent.js";
import { MessageBus } from "../bus/bus.js";
import { createTransport } from "../bus/transports/factory.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { ProjectStore, type GitContext } from "../projects/project-store.js";
import {
  PipelineManager,
  DEFAULT_STAGES,
  type PipelineRunView,
} from "../pipeline/pipeline-manager.js";
import { ForgeService } from "../forge/forge-service.js";
import { SshKeyStore } from "../ssh-keys/ssh-key-store.js";
import { parseRepoInput, splitRepo, type ForgeAccount, type ForgeProvider, type ForgeIssue, type ForgeComment } from "../forge/forge.js";
import { ForgeMonitor } from "../forge/forge-monitor.js";
import {
  CodingCliUpdateChecker,
  refreshLatestVersions,
  sharedCodingStatus,
} from "../integrations/coding-cli-install.js";
import { IssueTriageStore } from "../projects/issue-triage-store.js";
import { SecretsStore, type ScopedSecret } from "../secrets/secrets-store.js";
import { GlobalSecretsStore } from "../secrets/global-secrets-store.js";
import { CredentialStore } from "../connections/credential-store.js";
import { ConnectionStore } from "../connections/connection-store.js";
import { IntegrationStore } from "../connections/integration-store.js";
import {
  migrateLegacyCapabilities,
  migrateForgeAndSshKeysToAccounts,
} from "../connections/legacy-migration.js";
import {
  listConnectionTypes,
  listCredentialTypes,
  getConnectionTypeDef,
  isChatConnectionType,
} from "../integrations/connection-registry.js";
import { layerScopedSecrets } from "../secrets/layer-secrets.js";
import {
  readSkillConfig,
  buildSkillConfigPayload,
  deriveSkillCredentials,
  type SkillConfigView,
} from "../skills/skill-config.js";
import { BUILTIN_CAPABILITIES, getCatalogCapability } from "../skills/builtin-catalog.js";
import {
  SERVICE_AGENTS,
  SVC_PROXMOX_ID,
  SVC_SSH_ID,
  TEAM_ROLES,
  teamAgentId,
  serviceSpecForKind,
  type TeamConfig,
} from "../teams/team-template.js";
import { suggestScopeForKey } from "../secrets/shell-secrets.js";
import type { CredentialScope } from "@otterbot/shared";
import {
  ChannelConnector,
  connectorSignature,
} from "../integrations/chat/channel-connector.js";
import type { OutboundFile } from "../integrations/chat/chat-client.js";
import { WebClient } from "@slack/web-api";
import { PROVIDERS, type ChatProviderId, type ChatProvider } from "../integrations/chat/providers.js";
import { McpManager } from "../integrations/mcp.js";
import { mimeFromName, persistArtifact } from "../integrations/artifacts.js";
import type { Artifact } from "@otterbot/shared";

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

/** Coerce a chat connection's stored config JSON into a {@link ChannelBotConfig}. */
function toChannelConfig(config: Record<string, unknown>): ChannelBotConfig {
  const allowed = config.allowedUserIds;
  return {
    // An assigned chat connection is implicitly enabled.
    enabled: true,
    channelId: typeof config.channelId === "string" ? config.channelId : "",
    publicBot: config.publicBot === true,
    allowedUserIds: Array.isArray(allowed)
      ? allowed.map((u) => (typeof u === "string" ? u : String((u as { id?: string })?.id ?? ""))).filter(Boolean)
      : [],
    mentionOnly: config.mentionOnly === true,
  };
}

/** Input for creating a new agent profile. */
export interface CreateAgentInput {
  displayName: string;
  /** Explicit id (e.g. for provisioned singletons/teams). Slugged from name if omitted. */
  id?: string;
  role?: AgentRole;
  persona?: string;
  canRunShell?: boolean;
  canWebSearch?: boolean;
  model?: AgentProfile["model"];
  allowedChatServices?: AgentProfile["allowedChatServices"];
  transport?: AgentProfile["transport"];
  slack?: ChannelBotConfig | null;
  discord?: ChannelBotConfig | null;
  matrix?: ChannelBotConfig | null;
  allowedPeers?: AgentProfile["allowedPeers"];
  email?: string | null;
  artwork?: AgentProfile["artwork"];
  canSpawnSubagents?: boolean;
  subagentLimit?: number;
  dispatchToSubagent?: boolean;
  parentId?: string | null;
}

const GLOBAL_SETTINGS_KEY = "global_settings";

/** The auto-created first account for every provider. */
const DEFAULT_ACCOUNT = "default";

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

/**
 * Seed coding-CLI model presets. Cover the common claude/codex reasoning knobs
 * out of the box; opencode presets are user-created (their provider/model is
 * sourced from the configured registry, which is install-specific).
 */
const DEFAULT_CODING_PRESETS: CodingModelPreset[] = [
  { id: "claude-opus-high", label: "Claude Opus · High", tool: "claude", model: "opus", effort: "high" },
  { id: "claude-sonnet", label: "Claude Sonnet", tool: "claude", model: "sonnet" },
  { id: "codex-high", label: "Codex · High effort", tool: "codex", effort: "high" },
];

/** Per-provider default settings, derived from the provider catalog. */
const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  theme: "obsidian",
  models: DEFAULT_MODELS.map((m) => ({ ...m })),
  defaultChatModelId: DEFAULT_CHAT_MODEL_ID,
  defaultEmbeddingModelId: DEFAULT_EMBEDDING_MODEL_ID,
  providers: Object.fromEntries(PROVIDER_CATALOG.map((p) => [p.id, [defaultAccountFor(p)]])),
  codingModelPresets: DEFAULT_CODING_PRESETS.map((p) => ({ ...p })),
};

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

const CODING_TOOL_IDS = ["claude", "codex", "gemini", "opencode"] as const;

/** Normalize one coding-model preset; returns null if it can't be salvaged. */
function normalizeCodingModelPreset(raw: unknown): CodingModelPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<CodingModelPreset>;
  if (typeof p.id !== "string" || !p.id.trim()) return null;
  if (!CODING_TOOL_IDS.includes(p.tool as (typeof CODING_TOOL_IDS)[number])) return null;
  const out: CodingModelPreset = {
    id: p.id,
    label: typeof p.label === "string" && p.label.trim() ? p.label : p.id,
    tool: p.tool as CodingModelPreset["tool"],
  };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  if (str(p.model)) out.model = str(p.model);
  if (str(p.effort)) out.effort = str(p.effort);
  if (str(p.providerModel)) out.providerModel = str(p.providerModel);
  if (str(p.registryModelId)) out.registryModelId = str(p.registryModelId);
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
  // Resolve the model registry. Two cases:
  //  - new shape: `models` is an array (may be empty if the user cleared it).
  //  - nothing supplied: ship the built-in defaults.
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
  } else {
    models = defaults.models.map((m) => ({ ...m }));
    defaultChatModelId = defaults.defaultChatModelId;
    defaultEmbeddingModelId = defaults.defaultEmbeddingModelId;
  }
  // A default id must point at a real entry, else clear it.
  if (defaultChatModelId && !models.some((m) => m.id === defaultChatModelId)) defaultChatModelId = "";
  if (defaultEmbeddingModelId && !models.some((m) => m.id === defaultEmbeddingModelId))
    defaultEmbeddingModelId = "";
  // Coding-model presets: new shape is an array (may be empty if cleared);
  // nothing supplied ships the built-in defaults. Dedupe by id.
  let codingModelPresets: CodingModelPreset[];
  if (Array.isArray(input?.codingModelPresets)) {
    const seen = new Set<string>();
    codingModelPresets = [];
    for (const raw of input.codingModelPresets) {
      const p = normalizeCodingModelPreset(raw);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      codingModelPresets.push(p);
    }
  } else {
    codingModelPresets = defaults.codingModelPresets.map((p) => ({ ...p }));
  }
  return {
    theme: input?.theme ?? defaults.theme,
    models,
    defaultChatModelId,
    defaultEmbeddingModelId,
    providers: nextProviders,
    codingModelPresets,
  };
}

/** Mask an API key to a short, identifiable hint — e.g. `sk-or…a1b2`. */
function maskApiKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return `${k.slice(0, 2)}…`;
  return `${k.slice(0, 5)}…${k.slice(-4)}`;
}

export function redactGlobalSettings(settings: GlobalSettings): GlobalSettings {
  const providers: Record<ProviderId, ProviderAccount[]> = {};
  for (const provider of Object.keys(settings.providers) as ProviderId[]) {
    providers[provider] = (settings.providers[provider] ?? []).map((acc) => {
      const { apiKey, ...rest } = acc;
      return {
        ...rest,
        apiKeyConfigured: Boolean(apiKey || rest.apiKeyConfigured),
        // A non-sensitive preview so the UI can show which key is assigned.
        apiKeyHint: apiKey ? maskApiKey(apiKey) : undefined,
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

/** Coding stages can run a CLI for a long time; give a stage a generous budget. */
const STAGE_TIMEOUT_MS = 45 * 60_000;

/** Build the prompt handed to a pipeline stage's agent. */
function buildStagePrompt(
  stage: string,
  goal: string,
  priorReports: Array<{ stage: string; report: string }>
): string {
  const gate = stage === "security-reviewer" || stage === "tester";
  const prior = priorReports.length
    ? `\n\nReports from earlier stages:\n${priorReports
        .map((r) => `### ${r.stage}\n${r.report}`)
        .join("\n\n")}`
    : "";
  const verdict = gate
    ? `\n\nThis is a gate stage. End your reply with a line "VERDICT: PASS" or ` +
      `"VERDICT: FAIL" so the pipeline knows whether to proceed or send the work ` +
      `back to the coder.`
    : "";
  return (
    `You are the **${stage}** stage of the build pipeline for this project. Work in ` +
    `the shared /project tree (each of the project's repos is a subdir — \`cd\` into ` +
    `the one the goal concerns). Project goal:\n\n${goal}${prior}${verdict}`
  );
}

/** Prefix on PM-authored issue comments so they're recognizable in the thread. */
const TRIAGE_MARKER = "🦦 **otterbot plan**";

/** Prompt for the PM to draft or revise a candidate plan for a forge issue. */
function buildTriagePrompt(
  issue: ForgeIssue,
  instructionComments: ForgeComment[],
  currentPlan: string | null
): string {
  const comments = instructionComments.length
    ? `\n\nClarifying comments to address:\n${instructionComments.map((c) => `- @${c.author}: ${c.body}`).join("\n")}`
    : "";
  const prior = currentPlan ? `\n\nYour current plan (revise it):\n${currentPlan}` : "";
  return (
    `Triage GitHub/Gitea issue #${issue.number}: "${issue.title}"\n\n${issue.body}${comments}${prior}\n\n` +
    `Produce a concise candidate implementation plan: which files/areas change, the ` +
    `phases, and the approach. Consult the Coder for grounding, but plan ONLY — do not ` +
    `edit code and do not launch the build pipeline. Reply with just the plan text; it ` +
    `will be posted as a comment on the issue.`
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
  /** Listeners notified when an agent starts a live coding-CLI session. */
  private readonly codingListeners = new Set<(agentId: string, tool: string) => void>();
  /** Background embedding-init promises, awaited on shutdown. */
  private readonly pendingInits: Promise<void>[] = [];
  private readonly bus: MessageBus;
  private readonly scheduler: Scheduler;
  private readonly projects: ProjectStore;
  private readonly forge: ForgeService;
  private readonly sshKeys: SshKeyStore;
  private readonly issueTriage: IssueTriageStore;
  private readonly forgeMonitor: ForgeMonitor;
  private readonly codingCliUpdates: CodingCliUpdateChecker;
  private readonly pipeline: PipelineManager;
  private readonly pipelineListeners = new Set<(run: PipelineRunView) => void>();
  /** Run ids already published (PR opened) — guards the publish-on-done hook. */
  private readonly publishedRuns = new Set<string>();
  private readonly secrets: SecretsStore;
  /** Instance-wide credentials shared by every agent (Settings → Secrets). */
  private readonly globalSecrets: GlobalSecretsStore;
  /** Named, reusable credential bundles (Settings → Credentials). */
  private readonly credentials: CredentialStore;
  /** Named connectors that reference a credential (Settings → Connections). */
  private readonly connectionStore: ConnectionStore;
  /** Unified facade over accounts + bindings (Settings → Integrations). */
  private readonly integrations: IntegrationStore;
  private readonly services: AgentServices;
  /** Per-agent chat connectors, keyed by `${agentId}:${service}`. */
  private readonly connectors = new Map<string, TrackedConnector<ChannelConnector>>();
  /** Per-agent MCP server connections. */
  private readonly mcp = new McpManager();
  private subagentSeq = 0;
  /** subId -> pending teardown timer for an ephemeral subagent in its grace window. */
  private readonly subagentTeardowns = new Map<string, NodeJS.Timeout>();
  /**
   * parentId -> FIFO of delegated requests waiting for a dispatch-subagent slot.
   * A service agent (`dispatchToSubagent`) queues bursts past `subagentLimit`
   * here instead of rejecting; entries drain as subagents tear down.
   */
  private readonly dispatchQueues = new Map<string, AgentMessage[]>();

  constructor(
    private readonly profiles: ProfileStore,
    private readonly control: ControlDb,
    private readonly cfg: Config
  ) {
    this.bus = new MessageBus(control, createTransport(cfg));
    this.scheduler = new Scheduler(control, (id) => this.runtimes.get(id));
    this.projects = new ProjectStore(control, resolve(cfg.dataDir, "projects"));
    this.globalSecrets = new GlobalSecretsStore(control);
    this.credentials = new CredentialStore(control, this.globalSecrets);
    this.connectionStore = new ConnectionStore(control);
    this.integrations = new IntegrationStore(this.credentials, this.connectionStore);
    // SSH keys + forge accounts are now unified accounts, backed by the credential
    // store (see Settings → Integrations); both read/write `credentials`.
    this.sshKeys = new SshKeyStore(this.credentials, resolve(cfg.dataDir, "ssh-keys"));
    this.forge = new ForgeService(this.credentials, resolve(cfg.dataDir, "forge-keys"), fetch, this.sshKeys);
    this.issueTriage = new IssueTriageStore(control);
    this.pipeline = new PipelineManager({
      control,
      resolveAgent: (projectId, role) => this.projects.agentForRole(projectId, role),
      resolveStages: (projectId) =>
        DEFAULT_STAGES.filter((s) => this.projects.agentForRole(projectId, s) != null),
      runStage: async ({ projectId, runId, stage, agentId, goal, priorReports }) => {
        const fromId = this.projects.agentForRole(projectId, "pm") ?? "coo";
        // The tester always gets local unit/integration test instructions; when
        // the project enables remote e2e and the service agents exist, it also
        // pushes the run branch and gets VM/SSH delegation guidance.
        const testerContext = stage === "tester" ? this.prepareTesterContext(projectId, runId) : "";
        const res = await this.bus.request(
          {
            id: nanoid(),
            kind: "request",
            from: fromId,
            to: agentId,
            threadId: nanoid(),
            correlationId: null,
            rootSpawnId: null,
            body: buildStagePrompt(stage, goal, priorReports) + testerContext,
            transport: "local",
          },
          STAGE_TIMEOUT_MS
        );
        return { report: res.body };
      },
      onUpdate: (run) => {
        // Publish (push branch + open PR) once, when a forge-backed run finishes.
        if (run.status === "done" && !this.publishedRuns.has(run.id)) {
          this.publishedRuns.add(run.id);
          void this.publishRun(run.id).catch((err) =>
            console.error(`[pipeline] publish failed for run ${run.id}:`, err)
          );
        }
        for (const listener of this.pipelineListeners) listener(run);
      },
    });
    this.forgeMonitor = new ForgeMonitor({
      listMonitoredProjects: () =>
        this.projects.listMonitored().map((p) => ({ id: p.id, forgeRepo: p.forgeRepo! })),
      forgeForProject: (projectId) => {
        const p = this.projects.get(projectId);
        return p ? this.forge.forgeForAccount(p.forgeAccountId) : null;
      },
      hasRunForIssue: (projectId, issueNumber) =>
        this.pipeline.findRunByIssue(projectId, issueNumber) !== null,
      startRunFromIssue: (projectId, issue) => {
        const triage = this.issueTriage.get(projectId, issue.number);
        const base = `Resolve issue #${issue.number}: ${issue.title}\n\n${issue.body}`;
        const goal = triage?.plan ? `${base}\n\nAgreed plan:\n${triage.plan}` : base;
        return this.pipeline.startRun(projectId, goal, { issueNumber: issue.number });
      },
      watchableRuns: (projectId) =>
        this.pipeline
          .listForProject(projectId)
          .filter((r) => r.status === "done" && r.prNumber != null)
          .map((r) => ({ id: r.id, prNumber: r.prNumber, status: r.status })),
      resumeRun: (runId, feedback) => {
        // Allow the run to re-publish (push the updated branch) after rework.
        this.publishedRuns.delete(runId);
        return this.pipeline.resume(runId, feedback);
      },
      listTriageProjects: () =>
        this.projects.listTriageEnabled().map((p) => ({ id: p.id, forgeRepo: p.forgeRepo! })),
      getTriage: (projectId, issueNumber) => this.issueTriage.get(projectId, issueNumber),
      triageInitial: (projectId, issue, instr) => this.triageInitialPlan(projectId, issue, instr),
      refinePlan: (projectId, issue, plan, instr) => this.refineIssuePlan(projectId, issue, plan, instr),
      advanceWatermark: (projectId, issueNumber, lastCommentId) =>
        this.issueTriage.advanceWatermark(projectId, issueNumber, lastCommentId),
    });
    this.codingCliUpdates = new CodingCliUpdateChecker(this);
    this.secrets = new SecretsStore(control);
    migrateForgeAndSshKeysToAccounts(control, this.credentials);
    migrateLegacyCapabilities(this.integrations, this.globalSecrets);
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
      dispatchToSubagent: ({ parentId, request }) =>
        this.dispatchDelegateToSubagent(parentId, request),
      scheduleTask: (agentId, cron, prompt) => this.scheduler.add(agentId, cron, prompt),
      listScheduledTasks: (agentId) => this.scheduler.list(agentId),
      cancelScheduledTask: (id) => this.scheduler.cancel(id),
      searchPeerMemory: async (targetAgentId, query, limit) => {
        const targetCtx = this.contexts.get(targetAgentId);
        if (!targetCtx) return [];
        return targetCtx.memory.search(query, { limit });
      },
      readArtifact: (agentId, file) => this.readArtifact(agentId, file),
      readArtifactBinary: (agentId, dir, name) => this.readArtifactBinary(agentId, dir, name),
      notifyCodingSession: (agentId, tool) => {
        for (const listener of this.codingListeners) listener(agentId, tool);
      },
      codingModelPresets: () => this.getGlobalSettings().codingModelPresets,
      projectIdForAgent: (agentId) => this.projects.projectsForAgent(agentId)[0]?.id ?? null,
      startPipeline: (projectId, goal) => this.startPipeline(projectId, goal),
      getPipelineRun: (runId) => {
        const v = this.pipeline.view(runId);
        if (!v) return null;
        return {
          id: v.id,
          projectId: v.projectId,
          goal: v.goal,
          status: v.status,
          currentStage: v.currentStage,
          attempt: v.attempt,
          stages: v.stages.map((s) => ({
            stage: s.stage,
            agentId: s.agentId,
            status: s.status,
            report: s.report,
            attempt: s.attempt,
          })),
        };
      },
    };
  }

  /** Raw bytes of an agent's file or generated image, traversal-guarded. */
  readArtifactBinary(
    agentId: string,
    dir: "files" | "images",
    name: string
  ): { data: Buffer; mimeType: string } | null {
    if (!this.contexts.has(agentId)) return null;
    const base = basename(name);
    if (base !== name || base.includes("..") || !/^[\w.-]+$/.test(base)) return null;
    const paths = this.profiles.pathsFor(agentId);
    const path = join(dir === "images" ? paths.images : paths.files, base);
    if (!existsSync(path)) return null;
    return { data: readFileSync(path), mimeType: mimeFromName(base) };
  }

  /**
   * Read the text contents of an agent's produced file (artifact). Resolves and
   * traversal-guards via {@link agentFilePath}; refuses binary types and caps
   * the returned text. Backs the `read_file` tool.
   */
  readArtifact(
    agentId: string,
    file: string
  ): { ok: boolean; content?: string; mimeType?: string; truncated?: boolean; error?: string } {
    const resolved = this.agentFilePath(agentId, file);
    if (!resolved) return { ok: false, error: "file not found" };
    const isText =
      resolved.mimeType.startsWith("text/") ||
      resolved.mimeType === "application/json" ||
      resolved.mimeType === "application/xml";
    if (!isText) {
      return {
        ok: false,
        error: `cannot read ${resolved.mimeType} as text; reference it by URL instead`,
      };
    }
    const MAX_BYTES = 256 * 1024;
    const buf = readFileSync(resolved.path);
    const truncated = buf.byteLength > MAX_BYTES;
    return {
      ok: true,
      mimeType: resolved.mimeType,
      content: buf.subarray(0, MAX_BYTES).toString("utf8"),
      truncated,
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

  /** Shared coding-CLI install/login status + cached update-available info. */
  codingCliStatus() {
    return sharedCodingStatus(this);
  }

  /** Force a fresh registry check of the coding CLIs; returns refreshed status. */
  async refreshCodingCliUpdates() {
    await refreshLatestVersions(this);
    return this.codingCliStatus();
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
    // Provider endpoints/keys may have changed — refresh opencode's config.
    this.regenerateOpencodeConfig();
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
   * Merge an agent's effective credential bag, low→high precedence:
   *   1. global provider keys — implicit `direct` scope (they power
   *      chat/embedder calls and never need to be in the shell env);
   *   2. instance-wide global secrets (Settings → Secrets) — their stored scope;
   *   3. the agent's own credentials — their stored scope.
   * Later layers win on key collision, so a per-agent secret overrides a global
   * one of the same name, which overrides a provider key.
   */
  private buildScopedSecrets(profile: AgentProfile): Map<string, ScopedSecret> {
    const providerScoped = new Map<string, ScopedSecret>();
    for (const [k, v] of this.getProviderSecretsForProfile(profile)) {
      providerScoped.set(k, { value: v, scope: "direct" });
    }
    return layerScopedSecrets([
      providerScoped,
      // Bare instance-wide secrets only; `cred:<id>:…` account rows are resolved
      // per-binding below (prefix-stripped) so they never leak raw into the env.
      this.globalSecrets.instanceScoped(),
      // Secrets from this agent's non-chat bindings (GitHub, SMTP, SSH, Proxmox…):
      // those explicitly assigned plus every instance-wide (`allAgents`) binding,
      // at each account's stored scope. Chat binding secrets are deliberately
      // excluded — they're consumed only by reconcileConnectors and stay out of
      // the shell/LLM env.
      this.connectionSecretsForAgent(profile.id),
      this.secrets.getScoped(profile.id),
    ]);
  }

  /** Scoped secrets contributed by an agent's non-chat bindings (assigned + allAgents). */
  private connectionSecretsForAgent(agentId: string): Map<string, ScopedSecret> {
    const out = new Map<string, ScopedSecret>();
    for (const conn of this.integrations.bindingsForAgent(agentId)) {
      if (isChatConnectionType(conn.type)) continue;
      // Git-account-backed github connections are resolved once, after the loop,
      // so the token and SSH key always come from the same account.
      if (conn.type === "github" && typeof conn.config.gitAccountId === "string") continue;
      if (!conn.credentialId) continue;
      for (const [key, entry] of this.credentials.scopedSecretsFor(conn.credentialId)) {
        out.set(key, entry);
      }
    }
    const account = this.gitAccountForAgent(agentId);
    if (account?.token) out.set("GITHUB_TOKEN", { value: account.token, scope: "cap:gh-auth" });
    return out;
  }

  /**
   * The forge account backing an agent's GitHub identity: the account referenced
   * by the agent's FIRST git-account-backed github connection, or null. Warns
   * when several such connections exist (the first wins for both token and key,
   * so we never split one agent's identity across two GitHub accounts).
   */
  private gitAccountForAgent(agentId: string): ForgeAccount | null {
    const refs = this.integrations
      .bindingsForAgent(agentId)
      .filter((c) => c.type === "github" && typeof c.config.gitAccountId === "string")
      .map((c) => c.config.gitAccountId as string);
    if (refs.length === 0) return null;
    if (refs.length > 1) {
      console.warn(
        `[connections] agent ${agentId} has ${refs.length} git-account github connections; using the first.`
      );
    }
    return this.forge.getAccount(refs[0]) ?? null;
  }

  /**
   * The SSH identity for the account backing an agent's GitHub connection,
   * materialized for in-sandbox git-over-SSH, or null. Only ssh-transport
   * accounts with a usable key qualify; token-only/HTTPS accounts return null.
   */
  private gitSshForAgent(agentId: string): GitSshSetup | null {
    const account = this.gitAccountForAgent(agentId);
    if (!account || account.gitTransport !== "ssh") return null;
    const gc = this.forge.gitContextFor(account);
    if (!gc.sshKeyPath) return null;
    return {
      keyPath: gc.sshKeyPath,
      knownHostsPath: gc.knownHostsPath,
      committer: gc.committer,
      signingKeyPath: gc.signingKeyPath,
    };
  }

  /** @internal Test-only accessors for the connection→identity resolution. */
  gitSshForAgentTest(agentId: string): GitSshSetup | null {
    return this.gitSshForAgent(agentId);
  }
  scopedSecretsForAgentTest(agentId: string): Map<string, ScopedSecret> {
    return this.connectionSecretsForAgent(agentId);
  }

  /** MCP server configs from an agent's assigned `mcp` connections. */
  private mcpConnectionsForAgent(agentId: string): McpServerConfig[] {
    const servers: McpServerConfig[] = [];
    for (const conn of this.integrations.bindingsForAgent(agentId)) {
      if (conn.type !== "mcp") continue;
      const c = conn.config;
      servers.push({
        name: typeof c.name === "string" && c.name ? c.name : conn.label,
        transport: c.transport === "sse" ? "sse" : "stdio",
        enabled: c.enabled !== false,
        command: typeof c.command === "string" ? c.command : undefined,
        args: Array.isArray(c.args) ? (c.args as string[]) : undefined,
        url: typeof c.url === "string" ? c.url : undefined,
      });
    }
    return servers;
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
   * Every configured provider resolved to an OpenAI-compatible endpoint, for
   * bridging into opencode. One entry per provider id (first account with a
   * usable base URL); skips providers with no HTTP endpoint (anthropic) and
   * key-requiring providers whose key isn't set.
   */
  private collectOpencodeProviders(): OpencodeProviderEntry[] {
    const settings = this.getGlobalSettings();
    const entries: OpencodeProviderEntry[] = [];
    const seen = new Set<string>();
    for (const [providerId, accounts] of Object.entries(settings.providers)) {
      const def = findProvider(providerId);
      if (!def?.supportsChat || !def.endpoint || seen.has(providerId)) continue;
      for (const acc of accounts ?? []) {
        const ep = def.endpoint(this.getAccountSecrets(providerId, acc.account));
        if (!ep.baseUrl || (def.needsApiKey && !ep.apiKey)) continue;
        entries.push({ id: providerId, label: def.label, baseUrl: ep.baseUrl, apiKey: ep.apiKey });
        seen.add(providerId);
        break;
      }
    }
    return entries;
  }

  /** (Re)write opencode's provider config from the configured providers. */
  private regenerateOpencodeConfig(): void {
    try {
      writeOpencodeConfig(this.collectOpencodeProviders());
    } catch (err) {
      console.warn("[opencode] failed to write provider config:", err);
    }
  }

  /**
   * One-time migration: if opencode was logged into the Zen gateway via
   * `opencode auth login`, lift that key into the `opencode-go` provider so it's
   * managed like every other provider (and no native login is needed). No-op
   * once the provider has a key.
   */
  private migrateOpencodeGoKey(): void {
    const authPath = join(sharedCodingAuthDir(), "opencode", "auth.json");
    if (!existsSync(authPath)) return;
    let key: string | undefined;
    try {
      const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, { key?: string }>;
      key = auth["opencode-go"]?.key;
    } catch {
      return;
    }
    if (!key) return;
    const settings = this.getGlobalSettings();
    const existing = settings.providers["opencode-go"] ?? [];
    if (existing.some((a) => a.apiKeyConfigured)) return;
    // Persist directly (no agent restart) — runs before agents boot.
    const next = normalizeGlobalSettings({
      ...settings,
      providers: {
        ...settings.providers,
        "opencode-go": [
          {
            account: DEFAULT_ACCOUNT,
            baseUrl: "https://opencode.ai/zen/go/v1",
            apiKey: key,
            apiKeyConfigured: true,
          },
        ],
      },
    });
    this.setSetting(GLOBAL_SETTINGS_KEY, JSON.stringify(next));
    console.log("[opencode] migrated gateway key into the opencode-go provider");
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
    this.forgeMonitor.stop();
    this.codingCliUpdates.stop();
    for (const timer of this.subagentTeardowns.values()) clearTimeout(timer);
    this.subagentTeardowns.clear();
    await this.bus.stop();
    await Promise.allSettled([...this.connectors.values()].map((t) => t.connector.stop()));
    this.connectors.clear();
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

  /** Load (scaffolding the COO on first run) every profile and start its runtime. */
  async boot(): Promise<void> {
    this.profiles.ensureCooProfile();

    // Lift any opencode gateway login into a provider before agents start, so
    // they boot with it configured.
    this.migrateOpencodeGoKey();

    for (const profile of this.profiles.list()) {
      this.startAgent(profile);
    }

    // One-time cleanup: the removed `code-reference` capability left orphaned
    // skill rows on agents that had it installed, and a stale `code_reference`
    // app-setting. Drop them so nothing dangles.
    for (const ctx of this.contexts.values()) {
      if (ctx.skills.get("code-reference")) ctx.skills.delete("code-reference");
    }
    this.control.db
      .delete(controlSchema.appSettings)
      .where(eq(controlSchema.appSettings.key, "code_reference"))
      .run();

    const coo = this.contexts.get("coo");
    if (!coo) throw new Error("COO profile failed to load");
    setDefaultContext(coo);

    for (const profile of this.listProfiles()) {
      this.reconcileConnectors(profile);
    }

    // Generate opencode's provider config from the configured providers.
    this.regenerateOpencodeConfig();

    await this.bus.start();
    this.scheduler.start();
    // Ensure the shared infra service agents (proxmox, ssh) exist.
    // Poll forges for assigned issues + PR/CI signals every 5 minutes.
    this.forgeMonitor.start(5 * 60_000);
    // Refresh coding-CLI latest versions on startup, then daily.
    this.codingCliUpdates.start(24 * 60 * 60_000);
  }

  /** Build and register a runtime + context for a profile. */
  private startAgent(profile: AgentProfile): AgentContext {
    const paths = this.profiles.pathsFor(profile.id);
    // A subagent shares its parent's SSH key: the user installs one public key
    // per agent, and the parent's dir is persistent (the subagent's own profile
    // dir is removed on teardown). Subagents never nest, so the parent is always
    // a top-level agent.
    const sshDir = profile.parentId
      ? this.profiles.pathsFor(profile.parentId).ssh
      : paths.ssh;
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
      resolveProjectWorkspacePath: () => this.projects.workspacePathForAgent(profile.id),
      resolveProjectRepos: () =>
        this.projects
          .reposForAgent(profile.id)
          .map((r) => ({ name: r.name, forgeRepo: r.forgeRepo, mode: r.mode })),
      resolveGitSsh: () => this.gitSshForAgent(profile.id),
      resolveProjectRules: () => this.projects.rulesForAgent(profile.id),
      resolveProjectAccess: () => this.projects.accessForAgent(profile.id),
      browserProfileDir: paths.browser,
      imagesDir: paths.images,
      filesDir: paths.files,
      sshDir,
      embedder: resolveEmbedder(embeddingRef, secrets),
      dbKey: this.cfg.dbKey,
      defaultBrowseTimeoutMs: this.cfg.browseTimeoutMs,
      defaultMaxSteps: this.cfg.agentMaxSteps,
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
    // Backfill config schemas onto capabilities installed before the schema
    // existed, so older installs gain their Configure panel.
    ctx.skills.reconcileBuiltinConfig(BUILTIN_CAPABILITIES);
    // Connect the agent's MCP servers in the background; their tools merge in
    // once available. A failing server never blocks the agent. The set is the
    // union of the profile's servers and those carried by enabled capabilities.
    this.pendingInits.push(
      this.mcp
        .connect(
          profile.id,
          [
            ...profile.mcpServers,
            ...this.mcpConnectionsForAgent(profile.id),
            ...ctx.skills.effectiveMcpServers(),
          ],
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
   * Bring an agent's Slack, Discord, and Matrix chat connectors in line with its profile
   * and credentials. Connectors are deliberately decoupled from agent context
   * lifecycle: a connector only reconnects when its channel/tokens actually
   * change; a gate-only change (publicBot / allowedUserIds) is applied in place.
   */
  /** Live Slack/Discord/Matrix connector status for an agent. */
  getConnectorStatus(id: string): AgentConnectorStatus | null {
    const ctx = this.contexts.get(id);
    if (!ctx) return null;
    const resolved = this.resolveChatConnections(id);
    const matrixEntry = resolved.get("matrix");
    const matrix = channelStatus(matrixEntry?.cfg ?? null, this.connectors.get(`${id}:matrix`));
    // Surface the non-secret Matrix connection values so the UI can show what's
    // configured; never expose the password (only whether one is stored).
    if (matrixEntry) {
      matrix.homeserverUrl = matrixEntry.secrets.get("MATRIX_HOMESERVER_URL") ?? null;
      matrix.username = matrixEntry.secrets.get("MATRIX_USER") ?? null;
      matrix.hasPassword = Boolean(matrixEntry.secrets.get("MATRIX_PASSWORD"));
    }
    return {
      slack: channelStatus(resolved.get("slack")?.cfg ?? null, this.connectors.get(`${id}:slack`)),
      discord: channelStatus(resolved.get("discord")?.cfg ?? null, this.connectors.get(`${id}:discord`)),
      matrix,
    };
  }

  /**
   * Resolve an agent's assigned chat connections into a per-service view: the
   * connection, its config coerced to a {@link ChannelBotConfig}, the
   * referenced credential id, and that credential's secrets. v1 allows at most
   * one chat connection per service per agent.
   */
  private resolveChatConnections(
    agentId: string
  ): Map<ChatProviderId, { connection: Connection; cfg: ChannelBotConfig; credentialId: string | null; secrets: Map<string, string> }> {
    const out = new Map<
      ChatProviderId,
      { connection: Connection; cfg: ChannelBotConfig; credentialId: string | null; secrets: Map<string, string> }
    >();
    for (const conn of this.connectionStore.chatConnectionsForAgent(agentId)) {
      const service = conn.type as ChatProviderId;
      if (out.has(service)) continue; // v1: first one wins
      out.set(service, {
        connection: conn,
        cfg: toChannelConfig(conn.config),
        credentialId: conn.credentialId,
        secrets: conn.credentialId ? this.credentials.secretsFor(conn.credentialId) : new Map(),
      });
    }
    return out;
  }

  private reconcileConnectors(profile: AgentProfile): void {
    const resolved = this.resolveChatConnections(profile.id);
    for (const provider of Object.values(PROVIDERS)) {
      const entry = resolved.get(provider.id);
      const tokens = provider.connectorTokenKeys.map((k) => entry?.secrets.get(k) ?? "");
      this.reconcileOne(
        provider,
        profile.id,
        entry?.cfg ?? null,
        tokens,
        entry?.secrets ?? new Map(),
        entry?.connection.id ?? null,
        entry?.credentialId ?? null
      );
    }
  }

  private reconcileOne(
    provider: ChatProvider,
    agentId: string,
    cfg: ChannelBotConfig | null,
    tokens: string[],
    secrets: Map<string, string>,
    connId: string | null,
    credentialId: string | null
  ): void {
    const key = `${agentId}:${provider.id}`;
    const existing = this.connectors.get(key);
    if (!cfg?.enabled || tokens.some((t) => !t)) {
      if (existing) {
        void existing.connector.stop();
        this.connectors.delete(key);
      }
      return;
    }
    const signature = connectorSignature(cfg, tokens);
    if (existing && existing.signature === signature) {
      existing.connector.updateGate(cfg);
      return;
    }
    if (existing) void existing.connector.stop();
    // Key the Matrix crypto store on the connection id so it survives the
    // connection being reassigned between agents.
    const storeKey = connId ?? agentId;
    const client = provider.connectorClient(
      secrets,
      {
        storagePath: join(this.cfg.dataDir, "matrix", `connector-${storeKey}.json`),
        cryptoStoragePath: join(this.cfg.dataDir, "matrix", `crypto-connector-${storeKey}`),
      },
      {
        // Persist credentials the client mints at runtime (e.g. the Matrix device
        // token) back onto the referenced credential, so a connection moved
        // between agents keeps its session. "direct" keeps it out of the shell env.
        persistSecret: (k, value) => {
          if (credentialId) this.credentials.upsertSecret(credentialId, k, value, "direct");
          else this.secrets.upsert(agentId, k, value, "direct");
        },
      }
    );
    if (!client) return;
    const connector = new ChannelConnector(
      provider.id,
      agentId,
      cfg,
      client,
      () => this.runtimes.get(agentId),
      (artifact) => this.loadArtifactFile(artifact)
    );
    this.connectors.set(key, { connector, signature });
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
    const prefix = `${agentId}:`;
    const stops: Promise<void>[] = [];
    for (const [key, tracked] of this.connectors) {
      if (key.startsWith(prefix)) {
        stops.push(tracked.connector.stop());
        this.connectors.delete(key);
      }
    }
    await Promise.allSettled(stops);
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
        canRunShell: p.canRunShell,
      };
    });
  }

  onStatusChange(listener: (id: string, status: AgentStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Subscribe to "an agent started a live coding session" events. */
  onCodingSession(listener: (agentId: string, tool: string) => void): () => void {
    this.codingListeners.add(listener);
    return () => this.codingListeners.delete(listener);
  }

  // --- Projects ------------------------------------------------------------

  /** A project plus its current member agents (with access) and role→agent team map. */
  listProjects(): Array<{
    id: string;
    name: string;
    repoPath: string;
    createdAt: string;
    repos: ReturnType<ProjectStore["listRepos"]>;
    members: Array<{ agentId: string; access: "read" | "write" }>;
    team: Array<{ role: string; agentId: string }>;
  }> {
    return this.projects.list().map((p) => ({
      ...p,
      repos: this.projects.listRepos(p.id),
      members: this.projects.listMembersDetailed(p.id),
      team: this.projects.getTeam(p.id),
    }));
  }

  /**
   * Create a project (an empty shared git tree). The specialist team is NOT
   * auto-provisioned — the create-team wizard calls `provisionProjectTeam` with
   * the user's chosen per-role models/tools.
   */
  createProject(name: string) {
    return this.projects.create(name);
  }

  /** Set (or clear, with null) a project's standing rules. */
  setProjectRules(projectId: string, rules: string | null): void {
    this.projects.setRules(projectId, rules);
  }

  /** Enable/disable the tester's remote-host (Proxmox/SSH VM) e2e phase. */
  setProjectRemoteE2e(projectId: string, on: boolean): void {
    this.projects.setForge(projectId, { remoteE2e: on });
  }

  async deleteProject(id: string): Promise<void> {
    // Tear down the project's dedicated specialists first.
    for (const { agentId } of this.projects.getTeam(id)) {
      await this.deleteAgent(agentId);
    }
    this.projects.clearTeam(id);
    this.projects.delete(id);
  }

  /** The project's role → agent mapping (pipeline stage executors). */
  getProjectTeam(projectId: string): Array<{ role: string; agentId: string }> {
    return this.projects.getTeam(projectId);
  }

  /** The agent that fills a pipeline role for a project, or null. */
  agentForRole(projectId: string, role: string): string | null {
    return this.projects.agentForRole(projectId, role);
  }

  // --- Pipeline ------------------------------------------------------------

  /** Start a build-pipeline run for a project; returns the run id immediately. */
  startPipeline(projectId: string, goal: string): string {
    if (!this.projects.get(projectId)) throw new Error(`Unknown project: ${projectId}`);
    return this.pipeline.startRun(projectId, goal);
  }

  /** One-shot PM response over the bus (the PM consults the coder per its persona). */
  private async askPm(pmAgentId: string, prompt: string): Promise<string> {
    const res = await this.bus.request(
      {
        id: nanoid(),
        kind: "request",
        from: "coo",
        to: pmAgentId,
        threadId: nanoid(),
        correlationId: null,
        rootSpawnId: null,
        body: prompt,
        transport: "local",
      },
      STAGE_TIMEOUT_MS
    );
    return res.body;
  }

  /** PM (with coder) drafts the first plan for an issue and posts it as a comment. */
  private async triageInitialPlan(
    projectId: string,
    issue: ForgeIssue,
    instructionComments: ForgeComment[]
  ): Promise<void> {
    const pmId = this.projects.agentForRole(projectId, "pm");
    const project = this.projects.get(projectId);
    const forge = project ? this.forge.forgeForAccount(project.forgeAccountId) : null;
    if (!pmId || !project?.forgeRepo || !forge) return;
    const plan = await this.askPm(pmId, buildTriagePrompt(issue, instructionComments, null));
    const commentId = await forge.commentIssue(project.forgeRepo, issue.number, `${TRIAGE_MARKER}\n\n${plan}`);
    this.issueTriage.upsert(projectId, issue.number, plan, commentId);
  }

  /** PM (with coder) revises an issue's plan from new instruction comments. */
  private async refineIssuePlan(
    projectId: string,
    issue: ForgeIssue,
    currentPlan: string,
    instructionComments: ForgeComment[]
  ): Promise<void> {
    const pmId = this.projects.agentForRole(projectId, "pm");
    const project = this.projects.get(projectId);
    const forge = project ? this.forge.forgeForAccount(project.forgeAccountId) : null;
    if (!pmId || !project?.forgeRepo || !forge) return;
    const plan = await this.askPm(pmId, buildTriagePrompt(issue, instructionComments, currentPlan));
    const commentId = await forge.commentIssue(project.forgeRepo, issue.number, `${TRIAGE_MARKER}\n\n${plan}`);
    this.issueTriage.upsert(projectId, issue.number, plan, commentId);
  }

  getPipelineRun(runId: string): PipelineRunView | null {
    return this.pipeline.view(runId);
  }

  listPipelineRuns(projectId: string) {
    return this.pipeline.listForProject(projectId);
  }

  cancelPipeline(runId: string): void {
    this.pipeline.cancel(runId);
  }

  /** Subscribe to pipeline run state changes (for sockets/UI). */
  onPipelineUpdate(listener: (run: PipelineRunView) => void): () => void {
    this.pipelineListeners.add(listener);
    return () => this.pipelineListeners.delete(listener);
  }

  // --- Forge (GitHub / Gitea) ---------------------------------------------

  listForgeAccounts() {
    return this.forge.listAccountsMasked();
  }

  addForgeAccount(input: {
    provider: ForgeProvider;
    label: string;
    baseUrl?: string;
    token: string;
    username?: string;
    gitTransport?: "https" | "ssh";
    committerName?: string;
    committerEmail?: string;
    signCommits?: boolean;
    sshKeyId?: string | null;
  }) {
    const account = this.forge.addAccount(input);
    const { token: _t, ...masked } = account;
    // Surface the public key (linked reusable key or legacy managed key) so the
    // user can add it to the forge.
    return { ...masked, publicKey: this.forge.publicKeyForId(account.id) };
  }

  deleteForgeAccount(id: string): void {
    this.forge.deleteAccount(id);
  }

  /** The SSH public key for an account (to add on the forge), or null. */
  forgeAccountPublicKey(id: string): string | null {
    return this.forge.publicKeyForId(id);
  }

  // --- SSH keys (standalone, reusable) ------------------------------------

  listSshKeys() {
    return this.sshKeys.list();
  }

  /** Generate or import a reusable SSH key; returns the masked record. */
  addSshKey(input: { label: string; mode: "generate" | "import"; privateKey?: string }) {
    if (input.mode === "import") {
      if (!input.privateKey?.trim()) throw new Error("A private key is required to import.");
      return this.sshKeys.import(input.label, input.privateKey);
    }
    return this.sshKeys.generate(input.label);
  }

  deleteSshKey(id: string, force = false) {
    return this.sshKeys.delete(id, force);
  }

  /**
   * Configure a project's forge backing. For "existing", clones the repo into
   * the project's tree now; for "new", creates the repo on the forge then
   * clones it. "local" clears forge config and keeps the local git tree.
   */
  async setProjectForge(
    projectId: string,
    input: {
      mode: "local" | "existing" | "new" | "fork";
      accountId?: string | null;
      repo?: string | null;
      baseBranch?: string | null;
      monitorIssues?: boolean;
      triageIssues?: boolean;
      remoteE2e?: boolean;
    }
  ): Promise<{ ok: boolean; error?: string; repo?: string; defaultBranch?: string }> {
    const project = this.projects.get(projectId);
    if (!project) return { ok: false, error: "Unknown project" };
    // remoteE2e is project-wide; the forge config targets the primary repo.
    if (input.remoteE2e !== undefined) this.projects.setForge(projectId, { remoteE2e: input.remoteE2e });
    const primary = this.projects.primaryRepo(projectId);
    if (!primary) return { ok: false, error: "Project has no repo" };
    return this.setProjectRepoForge(primary.id, input);
  }

  /**
   * Configure one repo's forge backing. For "existing"/"fork" clones the repo
   * into that repo's subdir now; for "new" creates it on the forge then clones;
   * "local" clears the forge config and keeps the local git tree. Each repo in a
   * project is configured independently.
   */
  async setProjectRepoForge(
    repoId: string,
    input: {
      mode: "local" | "existing" | "new" | "fork";
      accountId?: string | null;
      repo?: string | null;
      baseBranch?: string | null;
      monitorIssues?: boolean;
      triageIssues?: boolean;
    }
  ): Promise<{ ok: boolean; error?: string; repo?: string; defaultBranch?: string }> {
    const repo = this.projects.getRepo(repoId);
    if (!repo) return { ok: false, error: "Unknown repo" };

    if (input.mode === "local") {
      this.projects.setRepoForge(repoId, {
        mode: "local",
        forgeAccountId: null,
        forgeRepo: null,
        forkRepo: null,
        forgeSshUrl: null,
        monitorIssues: false,
        triageIssues: false,
      });
      return { ok: true };
    }

    const account = input.accountId ? this.forge.getAccount(input.accountId) : null;
    if (!account) return { ok: false, error: "Unknown or missing forge account" };
    if (!input.repo) return { ok: false, error: "A repo (owner/name) is required" };
    const forge = this.forge.forgeFor(account);

    try {
      // Accept "owner/name" or a full repo URL (e.g. https://gitea.somehost.com/org/repo).
      const repoRef = parseRepoInput(input.repo);
      // `upstream` backs the PR base + issue monitoring; `cloneRepo` is what we
      // actually clone/push. For "fork" they differ (clone the bot's fork,
      // contribute back to the upstream); otherwise they're the same repo.
      const upstream =
        input.mode === "new" ? await forge.createRepo(repoRef) : await forge.getRepo(repoRef);
      const cloneRepo = input.mode === "fork" ? await forge.forkRepo(repoRef) : upstream;
      const fullRepo = `${upstream.owner}/${upstream.name}`;
      const cloneFullRepo = `${cloneRepo.owner}/${cloneRepo.name}`;
      const useSsh = account.gitTransport === "ssh";
      if (useSsh && !cloneRepo.sshUrl) {
        return { ok: false, error: "The forge did not provide an SSH URL for this repo." };
      }
      const ctx = this.forge.gitContextFor(account);
      const cloneUrl = useSsh ? cloneRepo.sshUrl! : forge.authedCloneUrl(cloneFullRepo);
      const plainUrl = useSsh ? cloneRepo.sshUrl! : cloneRepo.cloneUrl;
      const clone = this.projects.cloneInto(repo.repoPath, cloneUrl, plainUrl, ctx);
      if (!clone.ok) {
        return {
          ok: false,
          error:
            `clone failed: ${clone.output}` +
            (useSsh ? " (is the managed SSH key added to the forge as a deploy/auth key?)" : ""),
        };
      }
      this.projects.setRepoForge(repoId, {
        mode: input.mode,
        forgeAccountId: input.accountId ?? null,
        forgeRepo: fullRepo,
        forkRepo: input.mode === "fork" ? cloneFullRepo : null,
        forgeSshUrl: cloneRepo.sshUrl ?? null,
        baseBranch: input.baseBranch ?? upstream.defaultBranch,
        monitorIssues: input.monitorIssues ?? false,
        triageIssues: input.triageIssues ?? false,
      });
      return { ok: true, repo: fullRepo, defaultBranch: upstream.defaultBranch };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Add a repo (local) to a project. Configure its forge with {@link setProjectRepoForge}. */
  addProjectRepo(projectId: string, name?: string) {
    return this.projects.addRepo(projectId, { name });
  }

  /** Remove a repo from a project (and its on-disk subdir). */
  removeProjectRepo(repoId: string): void {
    this.projects.removeRepo(repoId);
  }

  /** Make a repo its project's primary (backs the legacy single-repo surfaces). */
  setPrimaryProjectRepo(repoId: string): void {
    this.projects.setPrimaryRepo(repoId);
  }

  /** A project's repos (primary first). */
  listProjectRepos(projectId: string) {
    return this.projects.listRepos(projectId);
  }

  /**
   * The push/clone URL + transport context for a forge-backed project: the
   * SSH URL + managed key when the account uses SSH, else a tokenized HTTPS URL.
   * Returns null when the project isn't forge-backed or config is missing.
   */
  private gitTargetFor(
    project: {
      forgeAccountId: string | null;
      forgeRepo: string | null;
      forkRepo: string | null;
      forgeSshUrl: string | null;
    }
  ): { url: string; ctx: GitContext } | null {
    if (!project.forgeRepo || !project.forgeAccountId) return null;
    const account = this.forge.getAccount(project.forgeAccountId);
    if (!account) return null;
    const ctx = this.forge.gitContextFor(account);
    // Push to the fork when forked; forgeSshUrl already holds the fork's URL.
    const pushRepo = project.forkRepo ?? project.forgeRepo;
    if (account.gitTransport === "ssh") {
      if (!project.forgeSshUrl) return null;
      return { url: project.forgeSshUrl, ctx };
    }
    return { url: this.forge.forgeFor(account).authedCloneUrl(pushRepo), ctx };
  }

  /**
   * Build the tester stage's appended context. The tester always runs the
   * project's unit/integration suite locally in /project; when the project's
   * `remoteE2e` flag is on AND both the Proxmox and SSH service agents exist, it
   * additionally pushes the run branch and delegates a remote-VM end-to-end run.
   * When the flag is on but the service agents are missing, e2e is noted as
   * skipped. Best-effort: git failures are reported in the returned text, not
   * thrown, so the stage can still proceed.
   */
  private prepareTesterContext(projectId: string, runId: string): string {
    const project = this.projects.get(projectId);
    if (!project) return "";

    // The local phase always runs: build/install and run the project's unit and
    // integration suite in the shared /project tree.
    const local =
      `\n\n## Testing\n### Unit & integration tests (always)\nRun the project's ` +
      `unit/integration suite locally with your shell (shell_exec): the code lives in ` +
      `the repo subdir(s) under /project — \`cd\` into each repo the change touched, ` +
      `detect and run its build/install and test commands, then report results. ` +
      `Your VERDICT must be based at minimum on this local run.`;

    // The remote e2e phase is opt-in (per-project toggle) and needs both shared
    // service agents present to delegate to.
    const haveInfra = this.contexts.has(SVC_PROXMOX_ID) && this.contexts.has(SVC_SSH_ID);
    if (!project.remoteE2e) {
      return local + `\n\nEnd with VERDICT: PASS or VERDICT: FAIL.`;
    }
    if (!haveInfra) {
      return (
        local +
        `\n\n### End-to-end tests (skipped)\nRemote end-to-end testing is enabled ` +
        `for this project, but the Proxmox/SSH service agents are not set up, so ` +
        `e2e was skipped. Note this in your report and base the verdict on the ` +
        `local run. End with VERDICT: PASS or VERDICT: FAIL.`
      );
    }

    // Infra present: delegate a remote-VM run. For a forge-backed project, push
    // the run branch first so the VM can fetch it.
    let e2e: string;
    if (project.mode === "local" || !project.forgeRepo) {
      e2e =
        `\n\n### End-to-end tests (remote)\nThis is a local-only project; the code ` +
        `lives at /project. Delegate to the Proxmox Service agent to prepare a clean ` +
        `VM and to the SSH Service agent to run the test suite against a checkout of ` +
        `/project (the code is not on a remote, so the VM must reach it by a means ` +
        `your SSH host is configured for). Fold the e2e result into your verdict.`;
    } else {
      const branch = `otterbot/run-${runId.slice(0, 8)}`;
      const target = this.gitTargetFor(project);
      let pushNote = "not pushed";
      if (target) {
        const ensure = this.projects.ensureBranch(project.repoPath, branch);
        if (ensure.ok) {
          this.projects.commitAll(
            project.repoPath,
            `otterbot: pipeline run ${runId.slice(0, 8)}`,
            target.ctx
          );
          const push = this.projects.push(project.repoPath, target.url, branch, target.ctx);
          pushNote = push.ok ? "pushed" : `push failed (${push.output})`;
          if (push.ok) this.pipeline.setPrInfo(runId, { branch });
        } else {
          pushNote = `branch failed (${ensure.output})`;
        }
      }
      const codeRepo = project.forkRepo ?? project.forgeRepo;
      const repoKind =
        project.mode === "new"
          ? "new repo"
          : project.mode === "fork"
            ? "fork of " + project.forgeRepo
            : "existing repo";
      e2e =
        `\n\n### End-to-end tests (remote)\nThe project code is on ${codeRepo} ` +
        `(${repoKind}), branch \`${branch}\` (${pushNote}). Delegate to the Proxmox ` +
        `Service agent to roll back to a clean snapshot and start the test VM, then ` +
        `to the SSH Service agent to fetch branch \`${branch}\` of ${codeRepo}, ` +
        `install, and run the test suite, and report results. (The VM needs its own ` +
        `access to clone the repo.) Fold the e2e result into your verdict.`;
    }

    return local + e2e + `\n\nEnd with VERDICT: PASS or VERDICT: FAIL.`;
  }

  /**
   * Publish a completed pipeline run: for every forge-backed repo in the project
   * that the run actually changed, commit the work onto a shared run branch,
   * push it, and open a PR/MR — so each repo is contributed independently. The
   * primary repo's PR is recorded on the run (the forge-monitor's CI-feedback
   * loop tracks it); additional repos' PR URLs are returned. Repos with no
   * changes are skipped. Called when a run completes; safe to call manually.
   */
  async publishRun(
    runId: string
  ): Promise<{ ok: boolean; error?: string; prUrl?: string; prs?: Array<{ repo: string; url: string }> }> {
    const run = this.pipeline.get(runId);
    if (!run) return { ok: false, error: "Unknown run" };
    const project = this.projects.get(run.projectId);
    if (!project) return { ok: false, error: "Unknown project" };

    const repos = this.projects.listRepos(project.id);
    const forgeBacked = repos.filter((r) => r.mode !== "local" && r.forgeRepo && r.forgeAccountId);
    if (forgeBacked.length === 0) return { ok: false, error: "Project has no forge-backed repos" };

    const branch = run.prBranch ?? `otterbot/run-${runId.slice(0, 8)}`;
    const prs: Array<{ repo: string; url: string }> = [];
    const errors: string[] = [];
    let primaryRecorded = false;

    for (const repo of forgeBacked) {
      // Only publish repos the run actually touched.
      if (!this.projects.hasChanges(repo.repoPath)) continue;
      const forge = this.forge.forgeForAccount(repo.forgeAccountId);
      const target = this.gitTargetFor(repo);
      if (!forge || !target) {
        errors.push(`${repo.name}: could not resolve a git push target`);
        continue;
      }
      const ensure = this.projects.ensureBranch(repo.repoPath, branch);
      if (!ensure.ok) {
        errors.push(`${repo.name}: branch failed (${ensure.output})`);
        continue;
      }
      this.projects.commitAll(repo.repoPath, `otterbot: ${run.goal}`.slice(0, 72), target.ctx);
      const push = this.projects.push(repo.repoPath, target.url, branch, target.ctx);
      if (!push.ok) {
        errors.push(`${repo.name}: push failed (${push.output})`);
        continue;
      }
      if (repo.isPrimary && !primaryRecorded) {
        this.pipeline.setPrInfo(runId, { branch });
        primaryRecorded = true;
      }
      try {
        const base = repo.baseBranch || (await forge.getRepo(repo.forgeRepo!)).defaultBranch;
        // For a fork, the branch lives on the fork: open a cross-fork PR into the
        // upstream with a "forkOwner:branch" head.
        const head = repo.forkRepo ? `${splitRepo(repo.forkRepo).owner}:${branch}` : branch;
        const pr = await forge.openPullRequest({
          repo: repo.forgeRepo!,
          title: `otterbot: ${run.goal}`.slice(0, 120),
          body: `Automated by the otterbot pipeline (run ${runId}).\n\nGoal:\n${run.goal}`,
          head,
          base,
        });
        prs.push({ repo: repo.forgeRepo!, url: pr.htmlUrl });
        if (repo.isPrimary) this.pipeline.setPrInfo(runId, { number: pr.number, url: pr.htmlUrl });
      } catch (err) {
        // The branch is pushed even if PR creation fails (e.g. one already open).
        errors.push(`${repo.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (prs.length === 0) {
      return {
        ok: false,
        error: errors.length ? errors.join("; ") : "No repos changed by this run",
      };
    }
    // Prefer the primary repo's PR as the headline URL.
    const primaryRepo = forgeBacked.find((r) => r.isPrimary)?.forgeRepo;
    const headline = prs.find((p) => p.repo === primaryRepo) ?? prs[0];
    return { ok: true, prUrl: headline.url, prs };
  }

  // --- Team provisioning ---------------------------------------------------

  /** Install a built-in catalog capability onto an agent. Idempotent-ish. */
  installCapability(agentId: string, catalogId: string): boolean {
    const ctx = this.getContext(agentId);
    if (!ctx) return false;
    const entry = getCatalogCapability(catalogId);
    if (!entry) return false; // e.g. a capability that doesn't exist yet
    if (ctx.skills.get(entry.id)) return true; // already installed
    const { meta, body, enabled } = ctx.skills.parseSkillFile(entry.markdown);
    ctx.skills.create({ meta, body, enabled, source: "builtin" }, { id: entry.id });
    void this.reloadAgentMcp(agentId);
    return true;
  }

  /** The shared service agents (proxmox/ssh) that currently exist. */
  listServiceAgents(): Array<{ id: string; kind: string; displayName: string }> {
    return SERVICE_AGENTS.filter((s) => this.contexts.has(s.id)).map((s) => ({
      id: s.id,
      kind: s.capabilities[0]?.catalogId ?? "",
      displayName: s.displayName,
    }));
  }

  /**
   * Create a shared, instance-wide service agent on demand (from the wizard).
   * Idempotent: returns the existing agent if already present.
   */
  createServiceAgent(kind: "proxmox" | "ssh", opts: { modelId?: string } = {}): AgentProfile {
    const spec = serviceSpecForKind(kind);
    if (!spec) throw new Error(`Unknown service kind: ${kind}`);
    const existing = this.contexts.get(spec.id);
    if (existing) return existing.profile;
    const model = this.modelConfigFor(opts.modelId);
    const profile = this.createAgent({
      id: spec.id,
      displayName: spec.displayName,
      persona: spec.persona,
      canRunShell: spec.canRunShell,
      model,
    });
    for (const cap of spec.capabilities) {
      if (this.installCapability(spec.id, cap.catalogId) && cap.config) {
        this.applySkillConfig(spec.id, cap.catalogId, cap.config);
      }
    }
    return profile;
  }

  /**
   * Provision a project's dedicated specialist team (idempotent per role). The
   * optional `config` lets the wizard set each role's chat model, pinned coding
   * CLI, custom display name/persona, and whether the role is created at all
   * (pm + coder are always created; other roles can be disabled). The tester is
   * wired to whichever shared service agents already exist (create them via the
   * wizard first to enable e2e).
   */
  provisionProjectTeam(projectId: string, config: TeamConfig = {}): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    // pm + coder are mandatory; any other role is provisioned unless the config
    // explicitly disables it.
    const included = new Set(
      TEAM_ROLES.filter(
        (spec) =>
          spec.role === "pm" || spec.role === "coder" || config[spec.role]?.enabled !== false
      ).map((spec) => spec.role)
    );
    for (const spec of TEAM_ROLES) {
      if (!included.has(spec.role)) continue;
      const id = teamAgentId(projectId, spec.role);
      if (this.profiles.exists(id) || this.contexts.has(id)) {
        this.projects.setTeamRole(projectId, spec.role, id);
        continue;
      }
      const rc = config[spec.role] ?? {};
      // "normal agent (no CLI)": the role skips its coding CLI and edits /project
      // directly via shell_exec, driven by just its chat model.
      const modelOnly = rc.tool === "none";
      const peerIds = new Set<string>();
      // Only wire peers to service agents that actually exist right now.
      for (const svc of spec.peerServices ?? []) {
        if (this.contexts.has(svc)) peerIds.add(svc);
      }
      // PM-style roles reach every other agent in the project. Their ids are
      // deterministic, so it's fine to reference teammates not yet created in
      // this loop — the runtime resolves peers against the live directory.
      if (spec.peerAllTeam) {
        for (const other of TEAM_ROLES) {
          if (other.role === spec.role) continue;
          if (!included.has(other.role)) continue;
          peerIds.add(teamAgentId(projectId, other.role));
        }
      }
      const allowedPeers = [...peerIds].map((agentId) => ({ agentId, shareMemory: false }));
      const basePersona = modelOnly && spec.personaModelOnly ? spec.personaModelOnly : spec.persona;
      // A custom persona either appends to the role's default (the wizard default,
      // and the undefined back-compat case) or fully replaces it when appendPersona
      // is explicitly false. Blank custom persona always falls back to the default.
      const customPersona = rc.persona?.trim();
      const persona = customPersona
        ? rc.appendPersona === false
          ? customPersona
          : `${basePersona}\n\n${customPersona}`
        : basePersona;
      this.createAgent({
        id,
        displayName: rc.displayName?.trim() || `${project.name} · ${spec.displayNameSuffix}`,
        persona,
        canRunShell: spec.canRunShell,
        allowedPeers,
        model: this.modelConfigFor(rc.modelId),
      });
      for (const cap of spec.capabilities) {
        // Model-only roles drop the coding CLI but keep shell + /project access.
        if (modelOnly && cap.catalogId === "coding-cli") continue;
        if (!this.installCapability(id, cap.catalogId)) continue;
        // Coding roles: merge the wizard's pinned tool + model preset over the
        // spec default, so a whole team can be stamped with per-role models
        // (e.g. coder→Kimi, security-reviewer→Qwen) in one provisioning call.
        const capConfig =
          cap.catalogId === "coding-cli"
            ? {
                ...(cap.config ?? {}),
                ...(rc.tool ? { pinnedTool: rc.tool } : {}),
                ...(rc.preset ? { pinnedPreset: rc.preset } : {}),
              }
            : cap.config;
        if (capConfig) this.applySkillConfig(id, cap.catalogId, capConfig);
      }
      this.projects.addMember(projectId, id, "write");
      this.projects.setTeamRole(projectId, spec.role, id);
    }
  }

  /** Build a model config from a chat model id, inheriting the default embedding. */
  private modelConfigFor(chatModelId?: string): AgentProfile["model"] | undefined {
    if (!chatModelId) return undefined;
    return { chat: chatModelId, embedding: this.getGlobalSettings().defaultEmbeddingModelId };
  }

  /** Add an agent to a project with optional access (default read-only). Throws if the project or agent is unknown. */
  addProjectMember(projectId: string, agentId: string, access: "read" | "write" = "read"): void {
    if (!this.contexts.has(agentId)) throw new Error(`Unknown agent: ${agentId}`);
    this.projects.addMember(projectId, agentId, access);
  }

  /** Change a project member's access level. */
  setProjectMemberAccess(projectId: string, agentId: string, access: "read" | "write"): void {
    this.projects.setMemberAccess(projectId, agentId, access);
  }

  removeProjectMember(projectId: string, agentId: string): void {
    this.projects.removeMember(projectId, agentId);
  }

  // --- Mutations -----------------------------------------------------------

  /** Create a new agent profile, scaffold its directory, and start it. */
  createAgent(input: CreateAgentInput): AgentProfile {
    let id = input.id ?? slugify(input.displayName);
    if (input.id && (this.profiles.exists(id) || this.contexts.has(id))) {
      throw new Error(`Agent id already exists: ${id}`);
    }
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
      matrix: input.matrix ?? null,
      allowedPeers: input.allowedPeers,
      email: input.email ?? null,
      artwork: input.artwork,
      canRunShell: input.canRunShell,
      canWebSearch: input.canWebSearch,
      canSpawnSubagents: input.canSpawnSubagents,
      subagentLimit: input.subagentLimit,
      dispatchToSubagent: input.dispatchToSubagent,
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
        [
          ...ctx.profile.mcpServers,
          ...this.mcpConnectionsForAgent(id),
          ...ctx.skills.effectiveMcpServers(),
        ],
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

  /**
   * Absolute path to one of an agent's generated images, or null. Accepts only
   * a bare `.png` basename within the agent's images dir — guards traversal.
   */
  agentImagePath(id: string, file: string): string | null {
    if (!this.contexts.has(id)) return null;
    const name = basename(file);
    if (name !== file || !/^[\w.-]+\.png$/i.test(name)) return null;
    const path = join(this.profiles.pathsFor(id).images, name);
    return existsSync(path) ? path : null;
  }

  /** Resolve a turn artifact to bytes for upload to a chat channel. */
  private loadArtifactFile(artifact: Artifact): OutboundFile | null {
    const m = artifact.url.match(/\/agents\/([^/]+)\/(images|files)\/([^/?#]+)/);
    if (!m) return null;
    const [, agentId, kind, id] = m;
    if (kind === "images") {
      const path = this.agentImagePath(agentId, id);
      if (!path) return null;
      return { data: readFileSync(path), filename: artifact.name, mimeType: artifact.mimeType };
    }
    const resolved = this.agentFilePath(agentId, id);
    if (!resolved) return null;
    return { data: readFileSync(resolved.path), filename: artifact.name, mimeType: artifact.mimeType };
  }

  /**
   * Absolute path + MIME for one of an agent's produced files, or null. Accepts
   * any extension but only a bare basename within the agent's files dir — same
   * traversal guard as {@link agentImagePath}.
   */
  agentFilePath(id: string, file: string): { path: string; mimeType: string } | null {
    if (!this.contexts.has(id)) return null;
    const name = basename(file);
    if (name !== file || name.includes("..") || !/^[\w.-]+$/.test(name)) return null;
    const path = join(this.profiles.pathsFor(id).files, name);
    if (!existsSync(path)) return null;
    return { path, mimeType: mimeFromName(name) };
  }

  /**
   * Store a user-uploaded file in an agent's `files/` dir and return its
   * {@link Artifact} reference. Backs `POST /api/agents/:id/files`.
   */
  saveAgentUpload(id: string, data: Buffer, name: string, mimeType: string): Artifact | null {
    if (!this.contexts.has(id)) return null;
    return persistArtifact({
      filesDir: this.profiles.pathsFor(id).files,
      agentId: id,
      data,
      name,
      mimeType,
    });
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
    // Cancel any pending grace-window teardown so it can't fire after we delete.
    const pending = this.subagentTeardowns.get(id);
    if (pending) {
      clearTimeout(pending);
      this.subagentTeardowns.delete(id);
    }
    const ctx = this.contexts.get(id);
    if (!ctx) return false;
    await this.stopConnectors(id);
    this.connectionStore.clearAgent(id);
    await this.mcp.disconnect(id);
    ctx.close();
    this.contexts.delete(id);
    this.runtimes.delete(id);
    this.control.db.delete(controlSchema.agents).where(eq(controlSchema.agents.id, id)).run();
    this.secrets.delete(id);
    // Drop the agent from any project it belonged to.
    for (const p of this.projects.projectsForAgent(id)) this.projects.removeMember(p.id, id);
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
    const existingKeys = new Set(this.secrets.listScopes(id).map((s) => s.key));
    for (const [rawKey, entry] of Object.entries(secrets)) {
      const key = rawKey.trim();
      if (!key) continue;
      if (typeof entry === "string") {
        // New keys get their suggested scope (so connector secrets like
        // MATRIX_PASSWORD are "direct", not injected into the shell env);
        // existing keys keep whatever scope they already have.
        if (existingKeys.has(key)) this.secrets.upsert(id, key, entry);
        else this.secrets.upsert(id, key, entry, suggestScopeForKey(key));
      } else {
        this.secrets.upsert(id, key, entry.value, entry.scope);
      }
    }
    this.updateAgent(id, {});
    return true;
  }

  /**
   * Read a skill's config form values for an agent. Non-secret fields return
   * their parsed value; secret fields return only a "present" flag, never the
   * value. Returns null if the agent or skill is unknown, or the skill has no
   * config schema.
   */
  getSkillConfig(id: string, skillId: string): SkillConfigView | null {
    const ctx = this.getContext(id);
    const skill = ctx?.skills.get(skillId);
    const schema = skill?.meta.configSchema;
    if (!schema) return null;
    const { values, secretsPresent } = readSkillConfig(schema, this.secrets.get(id));
    return { schema, values, secretsPresent };
  }

  /**
   * Persist a submitted skill config form. Maps schema fields onto credential
   * keys (lists are JSON-encoded), adds any skill-derived keys (e.g. proxmox's
   * derived vmid allowlist), then merges + restarts the agent. Secret fields
   * left blank are preserved. Returns false if the agent/skill is unknown.
   */
  applySkillConfig(
    id: string,
    skillId: string,
    formValues: Record<string, unknown>,
  ): boolean {
    const ctx = this.getContext(id);
    const skill = ctx?.skills.get(skillId);
    const schema = skill?.meta.configSchema;
    if (!schema) return false;
    const payload = {
      ...buildSkillConfigPayload(schema, formValues),
      ...deriveSkillCredentials(skillId, formValues),
    };
    return this.mergeCredentials(id, payload);
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

  // --- Instance-wide (global) credentials --------------------------------
  //
  // The global counterpart of the per-agent credential methods above. Each
  // write touches credentials every agent shares, so they all restart via
  // `restartAgents()` (not the single-agent `updateAgent`).

  /** Stored global credentials, masked: only `key` and `scope`. */
  listGlobalCredentials(): Array<{ key: string; scope: CredentialScope }> {
    return this.globalSecrets.listScopes().sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Merge credentials into the global bag, then restart all agents. Each entry
   * may be a plain string (new keys get their suggested scope; existing keys
   * keep theirs) or `{ value, scope }`. Empty/whitespace keys are dropped.
   */
  mergeGlobalCredentials(
    secrets: Record<string, string | { value: string; scope?: CredentialScope }>,
  ): boolean {
    const existingKeys = new Set(this.globalSecrets.listScopes().map((s) => s.key));
    for (const [rawKey, entry] of Object.entries(secrets)) {
      const key = rawKey.trim();
      if (!key) continue;
      if (typeof entry === "string") {
        if (existingKeys.has(key)) this.globalSecrets.upsert(key, entry);
        else this.globalSecrets.upsert(key, entry, suggestScopeForKey(key));
      } else {
        this.globalSecrets.upsert(key, entry.value, entry.scope);
      }
    }
    this.restartAgents();
    return true;
  }

  /** Change a global credential's scope without re-sending the value. */
  setGlobalCredentialScope(key: string, scope: CredentialScope): boolean {
    const ok = this.globalSecrets.setScope(key, scope);
    if (ok) this.restartAgents();
    return ok;
  }

  /** Delete a single global credential by key, then restart all agents. */
  deleteGlobalCredential(key: string): boolean {
    this.globalSecrets.deleteOne(key);
    this.restartAgents();
    return true;
  }

  /**
   * Read a builtin capability's global config form (non-secret values +
   * secret-present flags), driven by that capability's config schema. Used by
   * the structured Settings → Credentials forms (e.g. Proxmox, SSH). Null if the
   * capability is unknown or has no config schema.
   */
  getGlobalCapabilityConfig(capId: string): SkillConfigView | null {
    const schema = getCatalogCapability(capId)?.configSchema;
    if (!schema) return null;
    const { values, secretsPresent } = readSkillConfig(schema, this.globalSecrets.get());
    return { schema, values, secretsPresent };
  }

  /**
   * Persist a submitted global capability config form: maps schema fields onto
   * credential keys, adds any skill-derived keys (e.g. proxmox's
   * `PROXMOX_ALLOWED_VMIDS`), then merges + restarts all agents. Blank secret
   * fields are preserved. Returns false if the capability has no schema.
   */
  setGlobalCapabilityConfig(capId: string, formValues: Record<string, unknown>): boolean {
    const schema = getCatalogCapability(capId)?.configSchema;
    if (!schema) return false;
    const payload = {
      ...buildSkillConfigPayload(schema, formValues),
      ...deriveSkillCredentials(capId, formValues),
    };
    return this.mergeGlobalCredentials(payload);
  }

  // --- named credentials + connections (Settings → Connections) -------------

  /** Registry descriptors for the connection/credential type pickers. */
  listConnectionTypes() {
    return listConnectionTypes();
  }
  listCredentialTypes() {
    return listCredentialTypes();
  }

  listNamedCredentials() {
    return this.credentials.list();
  }
  getNamedCredential(id: string) {
    return this.credentials.get(id);
  }
  createNamedCredential(input: { type: string; label: string; secrets: Record<string, string> }) {
    return this.credentials.create(input);
  }
  updateNamedCredential(id: string, patch: { label?: string; secrets?: Record<string, string> }) {
    return this.credentials.update(id, patch);
  }
  /** Delete a credential; refuses (returns false) while a connection references it unless forced. */
  deleteNamedCredential(id: string, force = false): { ok: boolean; error?: string } {
    return this.integrations.deleteAccount(id, { force });
  }

  listConnections() {
    return this.connectionStore.list();
  }
  getConnection(id: string) {
    return this.connectionStore.get(id);
  }
  createConnection(input: {
    type: string;
    label: string;
    config?: Record<string, unknown>;
    credentialId?: string | null;
    allAgents?: boolean;
  }) {
    const created = this.connectionStore.create(input);
    if (created.allAgents) this.restartAgents();
    return created;
  }
  updateConnection(
    id: string,
    patch: { label?: string; config?: Record<string, unknown>; credentialId?: string | null; allAgents?: boolean }
  ) {
    const before = this.connectionStore.get(id);
    const updated = this.connectionStore.update(id, patch);
    if (updated) {
      // An instance-wide binding (before or after) affects every agent; an
      // ordinary one only its explicit assignees.
      if (before?.allAgents || updated.allAgents) this.restartAgents();
      else this.reconcileAssignees(id);
    }
    return updated;
  }
  /** Delete a connection; refuses while assigned unless forced (then reconciles those agents). */
  deleteConnection(id: string, force = false): { ok: boolean; error?: string } {
    const existing = this.connectionStore.get(id);
    const assignees = this.connectionStore.assigneesOf(id);
    if (assignees.length > 0 && !force) {
      return { ok: false, error: `Assigned to ${assignees.length} agent(s).` };
    }
    const ok = this.connectionStore.delete(id);
    if (existing?.allAgents) this.restartAgents();
    else for (const agentId of assignees) this.reconcileAgentConnections(agentId);
    return { ok };
  }

  /** Connections currently assigned to an agent (for the Agent Studio picker). */
  connectionsForAgent(agentId: string) {
    return this.connectionStore.connectionsForAgent(agentId);
  }

  /**
   * Assign a connection to an agent. v1 rule: a chat connection may belong to
   * exactly one agent, and an agent may hold at most one chat connection per
   * service. Non-chat connections can be shared freely.
   */
  assignConnection(connectionId: string, agentId: string): { ok: boolean; error?: string } {
    const conn = this.connectionStore.get(connectionId);
    if (!conn) return { ok: false, error: "unknown connection" };
    if (isChatConnectionType(conn.type)) {
      const others = this.connectionStore.assigneesOf(connectionId).filter((a) => a !== agentId);
      if (others.length > 0) {
        return { ok: false, error: "This chat connection is already assigned to another agent." };
      }
      const sameService = this.connectionStore
        .chatConnectionsForAgent(agentId)
        .find((c) => c.type === conn.type && c.id !== connectionId);
      if (sameService) {
        return { ok: false, error: `This agent already has a ${conn.type} connection.` };
      }
    }
    this.connectionStore.assign(connectionId, agentId);
    this.reconcileAgentConnections(agentId);
    return { ok: true };
  }

  unassignConnection(connectionId: string, agentId: string): { ok: boolean } {
    const ok = this.connectionStore.unassign(connectionId, agentId);
    if (ok) this.reconcileAgentConnections(agentId);
    return { ok };
  }

  /** Reconcile every agent a connection is assigned to (after an edit). */
  private reconcileAssignees(connectionId: string): void {
    for (const agentId of this.connectionStore.assigneesOf(connectionId)) {
      this.reconcileAgentConnections(agentId);
    }
  }

  /**
   * Re-apply an agent's connections. Non-chat connection secrets and MCP servers
   * are baked into the agent context at startAgent, so rebuild the context; chat
   * connectors are then reconciled against the fresh context.
   */
  private reconcileAgentConnections(agentId: string): void {
    const existing = this.contexts.get(agentId);
    if (!existing) return;
    const profile = existing.profile;
    existing.close();
    this.contexts.delete(agentId);
    this.runtimes.delete(agentId);
    const fresh = this.startAgent(profile);
    if (agentId === "coo") setDefaultContext(fresh);
    this.reconcileConnectors(profile);
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
   *
   * The subagent is short-lived: once its task finishes it lingers for a grace
   * window (`config.subagentGraceMs`) and is then fully removed — runtime,
   * profile dir, secrets, and registry row. Its audit trail (the `subagent_tasks`
   * row and `spawn`/`report` bus messages) is kept.
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
    const subProfile = buildSubagentProfile(parentCtx.profile, {
      id: subId,
      displayName: `${parentCtx.profile.displayName} · sub ${this.subagentSeq}`,
      modelId: opts?.modelId,
      createdAt: now,
    });
    this.profiles.create(subProfile);
    // Copy the parent's skills (capabilities) so the subagent loads the same
    // tools/MCP servers via loadFromDisk in startAgent. Each skill's enabled
    // state is preserved in its frontmatter.
    const parentSkills = this.profiles.pathsFor(parentId).skillsDir;
    const subSkills = this.profiles.pathsFor(subId).skillsDir;
    if (existsSync(parentSkills)) {
      cpSync(parentSkills, subSkills, { recursive: true });
    }
    // Inherit the parent's secrets (scope preserved) so the subagent reaches the
    // same endpoints and cap-scoped credentials stay gated from the shell.
    this.secrets.set(subId, this.secrets.getScoped(parentId));
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
      payload: { subagentId: subId },
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

    // The subagent exists only for this one task. Keep it briefly (grace
    // window) so it stays inspectable, then remove it entirely — its audit
    // trail (task row + bus messages) remains.
    const grace = this.cfg.subagentGraceMs;
    if (grace <= 0) {
      await this.teardownSubagent(subId);
    } else {
      const timer = setTimeout(() => void this.teardownSubagent(subId), grace);
      timer.unref?.(); // a pending teardown shouldn't keep the process alive
      this.subagentTeardowns.set(subId, timer);
    }

    return { subagentId: subId, taskId, summary };
  }

  /** Fully remove an ephemeral subagent. Best-effort — never surfaces to the parent. */
  private async teardownSubagent(subId: string): Promise<void> {
    this.subagentTeardowns.delete(subId);
    try {
      await this.deleteAgent(subId);
    } catch (err) {
      console.warn(`[subagent] teardown failed for ${subId}:`, err);
    }
  }

  /**
   * Service-agent dispatch (non-blocking). Handle a delegated `request` on
   * behalf of an agent flagged `dispatchToSubagent` by spawning an ephemeral
   * subagent that inherits the service agent's skills + credentials. The
   * subagent's result is published as a `response` carrying the ORIGINAL
   * request's correlationId, addressed to the original requester — so the
   * requester's pending `bus.request` resolves with the subagent's output and
   * artifacts, without ever touching the service agent's serial queue. Returns
   * immediately; the reply arrives later over the bus.
   */
  private dispatchDelegateToSubagent(parentId: string, request: AgentMessage): void {
    void this.runDispatchedSubagent(parentId, request).catch((err) => {
      // An orchestrator-side fault (profile create, runtime start, limit) must
      // still resolve the requester rather than leave it to time out.
      this.replyToRequester(request, parentId, {
        body: `Service agent error: ${err instanceof Error ? err.message : String(err)}`,
        artifacts: [],
      });
    });
  }

  private async runDispatchedSubagent(parentId: string, request: AgentMessage): Promise<void> {
    const parentCtx = this.contexts.get(parentId);
    if (!parentCtx) throw new Error(`Unknown agent: ${parentId}`);
    if (!parentCtx.profile.canSpawnSubagents) {
      throw new Error(`agent ${parentId} is not allowed to spawn subagents`);
    }
    // Concurrency gate: queue bursts past the limit and drain them as slots free
    // (a service agent should absorb load, not reject it). The requester keeps
    // waiting on its bus.request until a slot opens or the request times out.
    if (this.activeSubagentCount(parentId) >= parentCtx.profile.subagentLimit) {
      const q = this.dispatchQueues.get(parentId) ?? [];
      q.push(request);
      this.dispatchQueues.set(parentId, q);
      return;
    }

    const subId = `${parentId}__sub__${++this.subagentSeq}`;
    const taskId = nanoid();
    const now = new Date().toISOString();
    const subProfile = buildSubagentProfile(parentCtx.profile, {
      id: subId,
      displayName: `${parentCtx.profile.displayName} · svc ${this.subagentSeq}`,
      createdAt: now,
    });
    this.profiles.create(subProfile);
    // Inherit the parent's skills + secrets, exactly as spawnSubagent does, so
    // the subagent loads the same tools (e.g. image-gen) and reaches the same
    // endpoints.
    const parentSkills = this.profiles.pathsFor(parentId).skillsDir;
    const subSkills = this.profiles.pathsFor(subId).skillsDir;
    if (existsSync(parentSkills)) cpSync(parentSkills, subSkills, { recursive: true });
    this.secrets.set(subId, this.secrets.getScoped(parentId));
    this.startAgent(subProfile);

    this.control.db
      .insert(controlSchema.subagentTasks)
      .values({
        id: taskId,
        rootId: taskId,
        parentTaskId: null,
        parentAgentId: parentId,
        subagentId: subId,
        goal: request.body,
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
      payload: { subagentId: subId },
      body: `Dispatched ${subId} to serve a request from ${request.from}`,
      transport: parentCtx.profile.transport,
    });

    const runtime = this.runtimes.get(subId);
    let body = "";
    let artifacts: Artifact[] = [];
    let status: "done" | "failed" = "done";
    try {
      if (!runtime) throw new Error("subagent runtime failed to start");
      const res = await runtime.respond({
        conversationId: `dispatch-${taskId}`,
        userMessage: withAttachmentRefs(request.body, request.payload),
        onChunk: () => {},
      });
      body = res.finalText || "(no response)";
      // Re-home produced files into the parent (persistent) before teardown —
      // the subagent's directory is about to be deleted.
      artifacts = this.rehomeArtifacts(subId, parentId, res.artifacts);
    } catch (err) {
      status = "failed";
      body = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    this.control.db
      .update(controlSchema.subagentTasks)
      .set({ status, resultSummary: body, finishedAt: new Date().toISOString() })
      .where(eq(controlSchema.subagentTasks.id, taskId))
      .run();

    // Announce completion with a `report` (mirrors spawnSubagent). The correlated
    // `response` below resolves the requester, but the UI only refreshes its task
    // list on spawn/report — without this the active-subagent indicator lingers
    // until a manual page refresh. Runtimes ignore non-`request` messages, so this
    // is purely a UI/audit signal.
    this.bus.publish({
      id: nanoid(),
      kind: "report",
      from: subId,
      to: parentId,
      threadId: taskId,
      correlationId: null,
      rootSpawnId: taskId,
      body,
      transport: parentCtx.profile.transport,
    });

    // Resolve the ORIGINAL requester's pending delegate, carrying any artifacts.
    this.replyToRequester(request, subId, { body, artifacts });

    // Free the slot immediately (artifacts are already re-homed), then pull the
    // next queued request for this parent, if any.
    await this.teardownSubagent(subId);
    this.drainDispatchQueue(parentId);
  }

  /**
   * Publish the correlated `response` that resolves the original requester's
   * pending `bus.request`. The bus matches a response purely by correlationId
   * (ignoring `from`), so the subagent can satisfy the delegate the requester
   * addressed to the service agent.
   */
  private replyToRequester(
    request: AgentMessage,
    fromId: string,
    out: { body: string; artifacts: Artifact[] }
  ): void {
    this.bus.publish({
      id: nanoid(),
      kind: "response",
      from: fromId,
      to: request.from,
      threadId: request.threadId,
      correlationId: request.id,
      rootSpawnId: request.rootSpawnId,
      body: out.body,
      payload: out.artifacts.length ? { artifacts: out.artifacts } : undefined,
      transport: this.contexts.get(request.from)?.profile.transport ?? "local",
    });
  }

  /** Count an agent's live ephemeral subagents (incl. any in a grace window). */
  private activeSubagentCount(parentId: string): number {
    return [...this.contexts.values()].filter(
      (c) => c.profile.parentId === parentId && c.profile.role === "subagent"
    ).length;
  }

  /** Start the next queued dispatch for a parent if a subagent slot is free. */
  private drainDispatchQueue(parentId: string): void {
    const q = this.dispatchQueues.get(parentId);
    if (!q?.length) return;
    const parentCtx = this.contexts.get(parentId);
    if (!parentCtx) {
      this.dispatchQueues.delete(parentId);
      return;
    }
    if (this.activeSubagentCount(parentId) >= parentCtx.profile.subagentLimit) return;
    const next = q.shift()!;
    if (!q.length) this.dispatchQueues.delete(parentId);
    this.dispatchDelegateToSubagent(parentId, next);
  }

  /**
   * Copy each artifact's bytes from `fromId`'s images/files dir into `toId`'s
   * and rewrite its URL to point at `toId`. Used so a dispatched subagent's
   * output survives the subagent's teardown by living in the persistent parent.
   * Artifacts that don't resolve are passed through unchanged.
   */
  private rehomeArtifacts(fromId: string, toId: string, artifacts: Artifact[]): Artifact[] {
    return artifacts.map((a) => {
      const m = a.url.match(/\/agents\/([^/]+)\/(images|files)\/([^/?#]+)/);
      if (!m) return a;
      const [, , kind, file] = m;
      const name = basename(file);
      const srcDir = kind === "images"
        ? this.profiles.pathsFor(fromId).images
        : this.profiles.pathsFor(fromId).files;
      const dstDir = kind === "images"
        ? this.profiles.pathsFor(toId).images
        : this.profiles.pathsFor(toId).files;
      const src = join(srcDir, name);
      if (!existsSync(src)) return a;
      mkdirSync(dstDir, { recursive: true });
      cpSync(src, join(dstDir, name));
      return { ...a, url: `/api/agents/${toId}/${kind}/${name}` };
    });
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

/**
 * Build the normalized profile for an ephemeral subagent spawned under `parent`.
 * The subagent inherits the parent's capability-bearing fields so it can do the
 * work it's delegated, but never spawns its own subagents (no nested recursion).
 */
export function buildSubagentProfile(
  parent: AgentProfile,
  args: {
    id: string;
    displayName: string;
    modelId?: AgentProfile["model"]["chat"];
    createdAt: string;
  }
): AgentProfile {
  return normalizeProfile({
    id: args.id,
    displayName: args.displayName,
    role: "subagent",
    persona:
      `You are a focused research subagent spawned by ${parent.displayName}. ` +
      `Pursue exactly the goal you are given, use your available tools, ` +
      `and finish with a concise findings summary.`,
    model: {
      chat: args.modelId ?? parent.model.chat,
      embedding: parent.model.embedding,
    },
    transport: parent.transport,
    artwork: parent.artwork,
    // Inherit the parent's capability-bearing profile fields so the subagent
    // can actually do the work it's delegated, not just touch memory.
    canRunShell: parent.canRunShell,
    canWebSearch: parent.canWebSearch,
    browseTimeoutMs: parent.browseTimeoutMs,
    maxSteps: parent.maxSteps,
    mcpServers: parent.mcpServers,
    allowedPeers: parent.allowedPeers,
    parentId: parent.id,
    // Subagents never spawn their own subagents — no nested recursion. They
    // also never re-dispatch: a dispatched subagent does the work itself.
    canSpawnSubagents: false,
    dispatchToSubagent: false,
    createdAt: args.createdAt,
  });
}
