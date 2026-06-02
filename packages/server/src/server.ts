import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { resolve, extname } from "node:path";
import { existsSync, createReadStream } from "node:fs";
import type { Config } from "./config.js";
import type { Orchestrator, CreateAgentInput } from "./orchestrator/orchestrator.js";
import {
  extractToken,
  TOKEN_COOKIE,
  labelFromUserAgent,
  type AuthStore,
} from "./auth/api-token.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth hook — the session id that authenticated this request, or "env" for env-pinned mode. */
    sessionId?: string;
  }
}
import { providerCatalogInfo, findProvider } from "./providers/catalog.js";
import { getSkillService } from "./skills/skill-service.js";
import { getMemoryService } from "./memory/memory-service.js";
import { getUserProfileService } from "./user-profile/user-profile-service.js";
import { importSkillFromRaw, importSkillFromUrl, exportAllSkills } from "./skills/skill-hub.js";
import { initOpenAiAuth, getOpenAiAuth } from "./auth/openai-auth-store.js";
import { builtinModelStatus, downloadBuiltinModel } from "./embedders/builtin-embedder.js";
import { BUILTIN_CAPABILITIES, getCatalogCapability } from "./skills/builtin-catalog.js";
import { isCodingTool } from "./integrations/coding-cli.js";
import { installSharedCodingCli } from "./integrations/coding-cli-install.js";
import { generateText } from "ai";
import { resolveChatModel, listProviderModels } from "./providers/registry.js";
import { eq, asc, desc, like } from "drizzle-orm";
import * as schema from "./db/schema.js";
import { contextStatus, compactConversation } from "./runtime/context-manager.js";
import { nanoid } from "nanoid";
import type {
  AgentProfile,
  ProviderId,
  MemoryCategory,
  GlobalSettings,
  ConversationSummary,
  ChatMessage,
  ToolCallRecord,
  AgentMemoryExport,
} from "@otterbot/shared";
import { redactGlobalSettings } from "./orchestrator/orchestrator.js";

/** Validate a credential-scope string from API input — see `CredentialScope`. */
function isValidScope(scope: string): boolean {
  if (scope === "direct" || scope === "broad") return true;
  if (!scope.startsWith("cap:")) return false;
  const ids = scope.slice(4).split(",").map((s) => s.trim());
  return ids.length > 0 && ids.every((id) => /^[a-z0-9][a-z0-9-]*$/i.test(id));
}

/** Optional knobs supplied by the boot process; tests omit these. */
export interface BuildServerOpts {
  /**
   * Auth store consulted per request. Omit (or pass null) to disable auth
   * entirely — tests do this so `app.inject()` calls don't need headers.
   */
  auth?: AuthStore | null;
}

/** MIME types accepted by the chat file-upload endpoint. */
const UPLOAD_ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

/**
 * Build the Fastify HTTP API over a booted `Orchestrator`. Does not call
 * `listen()` — `index.ts` does that for the real process, while tests use
 * `app.inject()`.
 */
export async function buildServer(
  orch: Orchestrator,
  cfg: Config,
  opts: BuildServerOpts = {}
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: cfg.logLevel } });

  // Same-origin only. The web app is served from this server; the CLI is a
  // non-browser client (CORS does not apply). Anything cross-origin must be
  // an explicit choice — flip this back on with care.
  await app.register(fastifyCors, { origin: false });
  // Avatar and chat file uploads.
  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  const auth = opts.auth ?? null;
  if (auth) registerAuth(app, auth);

  // Instance-wide ChatGPT OAuth store, backed by control.db app_settings. The
  // real process initialises this before `orch.boot()` so agent runtimes and
  // API routes share the same token owner; this fallback covers tests/tools
  // that build the server around an already-booted orchestrator.
  if (!getOpenAiAuth()) {
    initOpenAiAuth({
      getSetting: (k) => orch.getSetting(k),
      setSetting: (k, v) => orch.setSetting(k, v),
    });
  }

  // --- Providers (for the model picker) ---
  app.get("/api/providers", async () => providerCatalogInfo());

  app.get("/api/settings/global", async () => redactGlobalSettings(orch.getGlobalSettings()));

  app.put<{ Body: GlobalSettings }>("/api/settings/global", async (req, reply) => {
    if (!Array.isArray(req.body?.models) || !req.body?.providers) {
      reply.code(400);
      return { error: "models and providers are required" };
    }
    return redactGlobalSettings(orch.setGlobalSettings(req.body));
  });

  // --- Setup / onboarding ---
  app.get("/api/setup-state", async () => ({
    onboardingComplete: orch.getSetting("onboarding_complete") === "true",
    agentCount: orch.listSummaries().length,
  }));

  app.post("/api/setup-state/complete", async () => {
    orch.setSetting("onboarding_complete", "true");
    return { ok: true };
  });

  // Verify a provider/model/credential combination before saving it.
  app.post<{
    Body: { provider?: ProviderId; modelId?: string; secrets?: Record<string, string> };
  }>("/api/test-model", async (req, reply) => {
    const { provider, modelId, secrets } = req.body ?? {};
    if (!provider || !modelId) {
      reply.code(400);
      return { ok: false, error: "provider and modelId are required" };
    }
    try {
      const mergedSecrets = new Map([
        ...orch.getGlobalProviderSecrets(),
        ...Object.entries(secrets ?? {}),
      ]);
      // test-model bypasses the account lookup — the caller supplies the
      // credential directly in `secrets`, so the account label is irrelevant.
      const model = resolveChatModel(
        { provider, account: "default", modelId },
        mergedSecrets
      );
      const { text } = await generateText({
        model,
        prompt: "Reply with exactly the word: ready",
        maxTokens: 24,
      });
      return { ok: true, sample: text.trim().slice(0, 120) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // List the models a provider currently serves (for the model picker and the
  // Providers-tab "Test" button). When `account` is given, the named account's
  // stored credentials are the base; `secrets` layers unsaved overrides on top.
  app.post<{
    Body: { provider?: ProviderId; account?: string; secrets?: Record<string, string> };
  }>("/api/provider-models", async (req, reply) => {
    const { provider, account, secrets } = req.body ?? {};
    if (!provider) {
      reply.code(400);
      return { ok: false, error: "provider is required" };
    }
    try {
      const base = account
        ? orch.getAccountSecrets(provider, account)
        : orch.getGlobalProviderSecrets();
      const mergedSecrets = new Map([...base, ...Object.entries(secrets ?? {})]);
      const models = await listProviderModels(provider, mergedSecrets);
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Every model across all configured chat providers, as opencode `provider/model`
  // ids — for the coding-model preset picker. Best-effort: unreachable providers
  // are skipped. opencode-go and local providers appear like any other.
  app.get("/api/coding/opencode-models", async () => {
    const settings = orch.getGlobalSettings();
    const jobs: Promise<{ provider: string; label: string; id: string }[]>[] = [];
    for (const [provider, accounts] of Object.entries(settings.providers)) {
      const def = findProvider(provider);
      if (!def?.supportsChat || !def.endpoint) continue;
      // Only providers actually bridged into opencode (same rule as the config
      // generator): a usable base URL, plus a key if the provider needs one.
      // Otherwise we'd offer models that can't run.
      const account = (accounts ?? []).find((a) => {
        const ep = def.endpoint!(orch.getAccountSecrets(provider, a.account));
        return ep.baseUrl && (!def.needsApiKey || ep.apiKey);
      });
      if (!account) continue;
      // listModels can throw synchronously (e.g. no base URL) — guard both paths.
      jobs.push(
        (async () => {
          try {
            const models = await listProviderModels(
              provider,
              orch.getAccountSecrets(provider, account.account)
            );
            return models.map((m) => ({ provider, label: def.label, id: `${provider}/${m}` }));
          } catch {
            return [];
          }
        })()
      );
    }
    const groups = await Promise.all(jobs);
    const seen = new Set<string>();
    const models: { provider: string; label: string; id: string }[] = [];
    for (const g of groups)
      for (const m of g)
        if (!seen.has(m.id)) {
          seen.add(m.id);
          models.push(m);
        }
    return { ok: true, models };
  });

  // --- ChatGPT subscription (OpenAI OAuth) ---
  app.get("/api/auth/openai/status", async () => {
    return getOpenAiAuth()?.status() ?? { connected: false, accountId: null, expiresAt: null };
  });

  // Start the browser login flow; returns the URL for the client to open.
  app.post("/api/auth/openai/login", async (_req, reply) => {
    const auth = getOpenAiAuth();
    if (!auth) {
      reply.code(500);
      return { error: "auth store not initialised" };
    }
    try {
      return auth.beginLogin();
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Complete a login by pasting the redirect URL — for when the loopback
  // callback is unreachable from the browser (otterbot on a remote box).
  app.post<{ Body: { url?: string } }>("/api/auth/openai/complete", async (req, reply) => {
    const auth = getOpenAiAuth();
    if (!auth) {
      reply.code(500);
      return { ok: false, error: "auth store not initialised" };
    }
    try {
      await auth.completeManual(req.body?.url ?? "");
      return { ok: true, status: auth.status() };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/auth/openai/signout", async () => {
    getOpenAiAuth()?.signOut();
    return { ok: true };
  });

  // --- Built-in embedder model ---
  // The in-process CPU embedder's model is downloaded only on explicit
  // request — never bundled, never auto-downloaded.
  app.get("/api/embedder/builtin/status", async () => builtinModelStatus());

  app.post("/api/embedder/builtin/download", async () => {
    // Runs in the background; the client polls the status endpoint.
    void downloadBuiltinModel();
    return builtinModelStatus();
  });

  // --- Code reference (instance-wide cloned repos) ---
  app.get("/api/code-reference/status", async () => orch.getCodeReference().status());

  app.get("/api/code-reference/repos", async () => orch.getCodeReference().listRepos());

  app.post<{ Body: { url?: string; ref?: string } }>(
    "/api/code-reference/repos",
    async (req, reply) => {
      const url = req.body?.url?.trim();
      if (!url) {
        reply.code(400);
        return { error: "url is required" };
      }
      try {
        // Clone + index runs in the background; the client polls /status.
        return await orch.getCodeReference().addRepo({ url, ref: req.body?.ref });
      } catch (err) {
        reply.code(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/code-reference/repos/:id",
    async (req, reply) => {
      const ok = await orch.getCodeReference().removeRepo(req.params.id);
      if (!ok) {
        reply.code(404);
        return { error: "not found" };
      }
      return { ok };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/code-reference/repos/:id/refresh",
    async (req) => {
      // Pull + re-index in the background; the client polls /status.
      void orch.getCodeReference().refresh(req.params.id);
      return { ok: true };
    }
  );

  app.get("/api/code-reference/config", async () => ({
    pullCron: orch.getCodeReference().status().pullCron,
  }));

  app.put<{ Body: { pullCron?: string } }>(
    "/api/code-reference/config",
    async (req) => {
      if (typeof req.body?.pullCron === "string") {
        orch.getCodeReference().setPullCron(req.body.pullCron);
      }
      return { pullCron: orch.getCodeReference().status().pullCron };
    }
  );

  // --- Projects (shared coding working trees) ---
  app.get("/api/projects", async () => orch.listProjects());

  app.post<{
    Body: {
      name?: string;
      team?: Record<string, {
        enabled?: boolean;
        modelId?: string;
        tool?: string;
        displayName?: string;
        persona?: string;
        appendPersona?: boolean;
      }>;
      rules?: string;
      remoteE2e?: boolean;
    };
  }>("/api/projects", async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) {
      reply.code(400);
      return { error: "name is required" };
    }
    try {
      const project = orch.createProject(name);
      const rules = req.body?.rules?.trim() || null;
      if (rules) orch.setProjectRules(project.id, rules);
      const remoteE2e = Boolean(req.body?.remoteE2e);
      if (remoteE2e) orch.setProjectRemoteE2e(project.id, true);
      // The wizard may provision a customized team in the same call.
      if (req.body?.team) orch.provisionProjectTeam(project.id, req.body.team);
      return { ...project, rules, remoteE2e, team: orch.getProjectTeam(project.id) };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- Shared service agents (Proxmox / SSH) ---
  app.get("/api/service-agents", async () => orch.listServiceAgents());

  app.post<{ Body: { kind?: "proxmox" | "ssh"; modelId?: string } }>(
    "/api/service-agents",
    async (req, reply) => {
      const kind = req.body?.kind;
      if (kind !== "proxmox" && kind !== "ssh") {
        reply.code(400);
        return { error: "kind must be 'proxmox' or 'ssh'" };
      }
      try {
        const profile = orch.createServiceAgent(kind, { modelId: req.body?.modelId });
        return { id: profile.id, displayName: profile.displayName };
      } catch (err) {
        reply.code(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req) => {
    await orch.deleteProject(req.params.id);
    return { ok: true };
  });

  // (Re)provision a project's specialist team. Creating a project does this
  // automatically; this is for re-running it after a change.
  app.post<{
    Params: { id: string };
    Body: {
      team?: Record<string, {
        enabled?: boolean;
        modelId?: string;
        tool?: string;
        displayName?: string;
        persona?: string;
        appendPersona?: boolean;
      }>;
    };
  }>("/api/projects/:id/team", async (req, reply) => {
    try {
      orch.provisionProjectTeam(req.params.id, req.body?.team ?? {});
      return { ok: true, team: orch.getProjectTeam(req.params.id) };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Launch / inspect a project's build pipeline.
  app.post<{ Params: { id: string }; Body: { goal?: string } }>(
    "/api/projects/:id/pipeline",
    async (req, reply) => {
      const goal = req.body?.goal?.trim();
      if (!goal) {
        reply.code(400);
        return { error: "goal is required" };
      }
      try {
        return { ok: true, runId: orch.startPipeline(req.params.id, goal) };
      } catch (err) {
        reply.code(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  app.get<{ Params: { id: string } }>("/api/projects/:id/pipeline-runs", async (req) =>
    orch.listPipelineRuns(req.params.id)
  );

  app.get<{ Params: { runId: string } }>("/api/pipeline-runs/:runId", async (req, reply) => {
    const run = orch.getPipelineRun(req.params.runId);
    if (!run) {
      reply.code(404);
      return { error: "not found" };
    }
    return run;
  });

  // --- Forge accounts (GitHub / Gitea) ---
  app.get("/api/forge-accounts", async () => orch.listForgeAccounts());

  app.post<{
    Body: {
      provider?: "github" | "gitea";
      label?: string;
      baseUrl?: string;
      token?: string;
      username?: string;
      gitTransport?: "https" | "ssh";
      committerName?: string;
      committerEmail?: string;
      signCommits?: boolean;
    };
  }>("/api/forge-accounts", async (req, reply) => {
    const b = req.body ?? {};
    if ((b.provider !== "github" && b.provider !== "gitea") || !b.token) {
      reply.code(400);
      return { error: "provider (github|gitea) and token are required" };
    }
    try {
      return orch.addForgeAccount({
        provider: b.provider,
        label: b.label ?? b.provider,
        baseUrl: b.baseUrl,
        token: b.token,
        username: b.username,
        gitTransport: b.gitTransport,
        committerName: b.committerName,
        committerEmail: b.committerEmail,
        signCommits: b.signCommits,
      });
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // The managed SSH public key to add on the forge (auth + signing key).
  app.get<{ Params: { id: string } }>("/api/forge-accounts/:id/public-key", async (req, reply) => {
    const publicKey = orch.forgeAccountPublicKey(req.params.id);
    if (!publicKey) {
      reply.code(404);
      return { error: "no managed key for this account (HTTPS transport?)" };
    }
    return { publicKey };
  });

  app.delete<{ Params: { id: string } }>("/api/forge-accounts/:id", async (req) => {
    orch.deleteForgeAccount(req.params.id);
    return { ok: true };
  });

  // --- Named credentials + Connections (Settings → Connections) -------------

  app.get("/api/connection-types", async () => orch.listConnectionTypes());
  app.get("/api/credential-types", async () => orch.listCredentialTypes());

  app.get("/api/credentials", async () => orch.listNamedCredentials());

  app.get<{ Params: { id: string } }>("/api/credentials/:id", async (req, reply) => {
    const cred = orch.getNamedCredential(req.params.id);
    if (!cred) {
      reply.code(404);
      return { error: "unknown credential" };
    }
    return cred;
  });

  app.post<{ Body: { type?: string; label?: string; secrets?: Record<string, string> } }>(
    "/api/credentials",
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.type || !b.label) {
        reply.code(400);
        return { error: "type and label are required" };
      }
      try {
        return orch.createNamedCredential({ type: b.type, label: b.label, secrets: b.secrets ?? {} });
      } catch (err) {
        reply.code(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  app.put<{ Params: { id: string }; Body: { label?: string; secrets?: Record<string, string> } }>(
    "/api/credentials/:id",
    async (req, reply) => {
      const updated = orch.updateNamedCredential(req.params.id, req.body ?? {});
      if (!updated) {
        reply.code(404);
        return { error: "unknown credential" };
      }
      return updated;
    }
  );

  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    "/api/credentials/:id",
    async (req, reply) => {
      const res = orch.deleteNamedCredential(req.params.id, req.query?.force === "true");
      if (!res.ok) {
        reply.code(409);
        return { error: res.error ?? "could not delete" };
      }
      return { ok: true };
    }
  );

  app.get("/api/connections", async () => orch.listConnections());

  app.get<{ Params: { id: string } }>("/api/connections/:id", async (req, reply) => {
    const conn = orch.getConnection(req.params.id);
    if (!conn) {
      reply.code(404);
      return { error: "unknown connection" };
    }
    return conn;
  });

  app.post<{
    Body: { type?: string; label?: string; config?: Record<string, unknown>; credentialId?: string | null };
  }>("/api/connections", async (req, reply) => {
    const b = req.body ?? {};
    if (!b.type || !b.label) {
      reply.code(400);
      return { error: "type and label are required" };
    }
    try {
      return orch.createConnection({
        type: b.type,
        label: b.label,
        config: b.config,
        credentialId: b.credentialId ?? null,
      });
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.put<{
    Params: { id: string };
    Body: { label?: string; config?: Record<string, unknown>; credentialId?: string | null };
  }>("/api/connections/:id", async (req, reply) => {
    const updated = orch.updateConnection(req.params.id, req.body ?? {});
    if (!updated) {
      reply.code(404);
      return { error: "unknown connection" };
    }
    return updated;
  });

  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    "/api/connections/:id",
    async (req, reply) => {
      const res = orch.deleteConnection(req.params.id, req.query?.force === "true");
      if (!res.ok) {
        reply.code(409);
        return { error: res.error ?? "could not delete" };
      }
      return { ok: true };
    }
  );

  // Per-agent assignment.
  app.get<{ Params: { id: string } }>("/api/agents/:id/connections", async (req) =>
    orch.connectionsForAgent(req.params.id)
  );

  app.post<{ Params: { id: string }; Body: { connectionId?: string } }>(
    "/api/agents/:id/connections",
    async (req, reply) => {
      const connectionId = req.body?.connectionId;
      if (!connectionId) {
        reply.code(400);
        return { error: "connectionId is required" };
      }
      const res = orch.assignConnection(connectionId, req.params.id);
      if (!res.ok) {
        reply.code(409);
        return { error: res.error ?? "could not assign" };
      }
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string; connectionId: string } }>(
    "/api/agents/:id/connections/:connectionId",
    async (req) => orch.unassignConnection(req.params.connectionId, req.params.id)
  );

  // Configure a project's forge backing (clones/creates the repo as needed).
  app.put<{
    Params: { id: string };
    Body: {
      mode?: "local" | "existing" | "new" | "fork";
      accountId?: string | null;
      repo?: string | null;
      baseBranch?: string | null;
      monitorIssues?: boolean;
      triageIssues?: boolean;
      remoteE2e?: boolean;
    };
  }>("/api/projects/:id/forge", async (req, reply) => {
    const mode = req.body?.mode ?? "local";
    const result = await orch.setProjectForge(req.params.id, { ...req.body, mode });
    if (!result.ok) {
      reply.code(400);
      return { error: result.error };
    }
    return result;
  });

  // Set (or clear) a project's standing rules, injected into members' prompts.
  app.put<{
    Params: { id: string };
    Body: { rules?: string | null };
  }>("/api/projects/:id/rules", async (req) => {
    const rules = (req.body?.rules ?? "").trim() || null;
    orch.setProjectRules(req.params.id, rules);
    return { ok: true, rules };
  });

  // Manually publish a run (push branch + open PR/MR).
  app.post<{ Params: { runId: string } }>("/api/pipeline-runs/:runId/publish", async (req, reply) => {
    const result = await orch.publishRun(req.params.runId);
    if (!result.ok) {
      reply.code(400);
      return { error: result.error };
    }
    return result;
  });

  app.post<{ Params: { id: string }; Body: { agentId?: string; access?: "read" | "write" } }>(
    "/api/projects/:id/members",
    async (req, reply) => {
      const agentId = req.body?.agentId;
      if (!agentId) {
        reply.code(400);
        return { error: "agentId is required" };
      }
      const access = req.body?.access ?? "read";
      if (access !== "read" && access !== "write") {
        reply.code(400);
        return { error: "access must be 'read' or 'write'" };
      }
      try {
        orch.addProjectMember(req.params.id, agentId, access);
        return { ok: true, members: orch.listProjects().find((p) => p.id === req.params.id)?.members ?? [] };
      } catch (err) {
        reply.code(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  app.delete<{ Params: { id: string; agentId: string } }>(
    "/api/projects/:id/members/:agentId",
    async (req) => {
      orch.removeProjectMember(req.params.id, req.params.agentId);
      return { ok: true };
    }
  );

  app.patch<{ Params: { id: string; agentId: string }; Body: { access?: "read" | "write" } }>(
    "/api/projects/:id/members/:agentId",
    async (req, reply) => {
      const access = req.body?.access;
      if (access !== "read" && access !== "write") {
        reply.code(400);
        return { error: "access must be 'read' or 'write'" };
      }
      orch.setProjectMemberAccess(req.params.id, req.params.agentId, access);
      return { ok: true };
    }
  );

  // --- Agents ---
  app.get("/api/agents", async () => orch.listSummaries());

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    return ctx.profile;
  });

  app.post<{ Body: CreateAgentInput }>("/api/agents", async (req, reply) => {
    if (!req.body?.displayName) {
      reply.code(400);
      return { error: "displayName is required" };
    }
    return orch.createAgent(req.body);
  });

  app.patch<{ Params: { id: string }; Body: Partial<AgentProfile> }>(
    "/api/agents/:id",
    async (req, reply) => {
      const updated = orch.updateAgent(req.params.id, req.body ?? {});
      if (!updated) {
        reply.code(404);
        return { error: "not found" };
      }
      return updated;
    }
  );

  // Live Slack/Discord connector status for an agent.
  app.get<{ Params: { id: string } }>("/api/agents/:id/connectors", async (req, reply) => {
    const status = orch.getConnectorStatus(req.params.id);
    if (!status) {
      reply.code(404);
      return { error: "not found" };
    }
    return status;
  });

  // Live MCP server status for an agent.
  app.get<{ Params: { id: string } }>("/api/agents/:id/mcp", async (req, reply) => {
    const status = orch.getMcpStatus(req.params.id);
    if (!status) {
      reply.code(404);
      return { error: "not found" };
    }
    return status;
  });

  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const ok = await orch.deleteAgent(req.params.id);
    if (!ok) {
      reply.code(req.params.id === "coo" ? 400 : 404);
      return { error: req.params.id === "coo" ? "the COO cannot be deleted" : "not found" };
    }
    return { ok: true };
  });

  // --- Agent avatars ---
  const AVATAR_EXT: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const AVATAR_MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };

  app.post<{ Params: { id: string } }>("/api/agents/:id/avatar", async (req, reply) => {
    let file;
    try {
      file = await req.file();
    } catch {
      reply.code(400);
      return { error: "expected a multipart image upload" };
    }
    if (!file) {
      reply.code(400);
      return { error: "no image uploaded" };
    }
    const ext = AVATAR_EXT[file.mimetype];
    if (!ext) {
      reply.code(400);
      return { error: "unsupported image type — use PNG, JPG, WebP or GIF" };
    }
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch {
      reply.code(413);
      return { error: "image is too large (max 4 MB)" };
    }
    const updated = orch.setAgentAvatar(req.params.id, data, ext);
    if (!updated) {
      reply.code(404);
      return { error: "not found" };
    }
    return updated;
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/avatar", async (req, reply) => {
    const file = orch.agentAvatarPath(req.params.id);
    if (!file) {
      reply.code(404);
      return { error: "no avatar" };
    }
    reply.header("content-type", AVATAR_MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
    reply.header("cache-control", "no-cache");
    return reply.send(createReadStream(file));
  });

  // Serve an agent's generated images (from the `generate_image` tool).
  app.get<{ Params: { id: string; file: string } }>(
    "/api/agents/:id/images/:file",
    async (req, reply) => {
      const file = orch.agentImagePath(req.params.id, req.params.file);
      if (!file) {
        reply.code(404);
        return { error: "not found" };
      }
      reply.header("content-type", "image/png");
      // Filenames are unique per image, so they can be cached aggressively.
      reply.header("cache-control", "public, max-age=31536000, immutable");
      return reply.send(createReadStream(file));
    }
  );

  // Serve an agent's produced files (artifacts of any type). Images are shown
  // inline by the client; other types are offered as a download.
  app.get<{ Params: { id: string; file: string } }>(
    "/api/agents/:id/files/:file",
    async (req, reply) => {
      const resolved = orch.agentFilePath(req.params.id, req.params.file);
      if (!resolved) {
        reply.code(404);
        return { error: "not found" };
      }
      reply.header("content-type", resolved.mimeType);
      // Names are unique per file, so they can be cached aggressively.
      reply.header("cache-control", "public, max-age=31536000, immutable");
      if (!resolved.mimeType.startsWith("image/")) {
        reply.header("content-disposition", `attachment; filename="${req.params.file}"`);
      }
      return reply.send(createReadStream(resolved.path));
    }
  );

  // Accept a user file upload for an agent to process; returns its Artifact ref.
  app.post<{ Params: { id: string } }>("/api/agents/:id/files", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "expected a multipart file upload" };
    }
    const mimeType = file.mimetype || "application/octet-stream";
    if (!UPLOAD_ALLOWED.has(mimeType)) {
      reply.code(415);
      return { error: `unsupported file type: ${mimeType}` };
    }
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch {
      // @fastify/multipart throws when the file exceeds the configured limit.
      reply.code(413);
      return { error: "file too large" };
    }
    const art = orch.saveAgentUpload(req.params.id, data, file.filename || "upload", mimeType);
    if (!art) {
      reply.code(404);
      return { error: "unknown agent" };
    }
    return art;
  });

  app.delete<{ Params: { id: string } }>("/api/agents/:id/avatar", async (req, reply) => {
    const updated = orch.clearAgentAvatar(req.params.id);
    if (!updated) {
      reply.code(404);
      return { error: "not found" };
    }
    return updated;
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/memories", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    return ctx.memory.list(100);
  });

  // Manually add a memory to an agent (the user curating the agent's memory).
  app.post<{
    Params: { id: string };
    Body: { content?: string; category?: MemoryCategory; importance?: number };
  }>("/api/agents/:id/memories", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    const content = (req.body?.content ?? "").trim();
    if (!content) {
      reply.code(400);
      return { error: "content is required" };
    }
    return ctx.memory.save({
      content,
      category: req.body?.category ?? "fact",
      importance: req.body?.importance ?? 7,
      source: "user",
    });
  });

  // Export an agent's full learned state (memories + session summaries + user
  // profile) as a single downloadable JSON file. Embeddings are omitted — they
  // are regenerated on import using the target agent's own model.
  app.get<{ Params: { id: string } }>("/api/agents/:id/memory/export", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    const sessionSummaries = ctx.db
      .select()
      .from(schema.sessionSummaries)
      .orderBy(asc(schema.sessionSummaries.createdAt))
      .all();
    const payload: AgentMemoryExport = {
      otterbotMemoryExport: 1,
      exportedAt: new Date().toISOString(),
      sourceAgent: { id: ctx.profile.id, name: ctx.profile.displayName },
      memories: ctx.memory.exportAll(),
      sessionSummaries,
      userProfile: ctx.userProfile.get(),
    };
    const slug = ctx.profile.displayName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "agent";
    reply.header("content-disposition", `attachment; filename="${slug}-memory.json"`);
    return payload;
  });

  // Merge-import a memory export into an agent. Never wipes existing state;
  // memories get fresh ids, profile facts are deduped, and summaries already
  // present (by conversation) are skipped.
  app.post<{ Params: { id: string } }>("/api/agents/:id/memory/import", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    let raw: string;
    try {
      const file = await req.file();
      if (!file) {
        reply.code(400);
        return { error: "expected a JSON file upload" };
      }
      raw = (await file.toBuffer()).toString("utf8");
    } catch {
      reply.code(413);
      return { error: "file is too large (max 4 MB)" };
    }

    let data: AgentMemoryExport;
    try {
      data = JSON.parse(raw);
    } catch {
      reply.code(400);
      return { error: "not valid JSON" };
    }
    if (data?.otterbotMemoryExport !== 1 || !Array.isArray(data.memories)) {
      reply.code(400);
      return { error: "not a valid Otterbot memory export" };
    }

    const memories = await ctx.memory.importMany(data.memories);

    let summaries = 0;
    const existingConvos = new Set(
      ctx.db
        .select({ conversationId: schema.sessionSummaries.conversationId })
        .from(schema.sessionSummaries)
        .all()
        .map((r) => r.conversationId)
    );
    for (const s of data.sessionSummaries ?? []) {
      if (existingConvos.has(s.conversationId)) continue;
      const sid = nanoid();
      ctx.db
        .insert(schema.sessionSummaries)
        .values({
          id: sid,
          conversationId: s.conversationId,
          summary: s.summary,
          keyPoints: s.keyPoints ?? [],
          createdAt: s.createdAt,
        })
        .run();
      ctx.memory.indexFts({
        kind: "session_summary",
        refId: sid,
        title: `Session ${s.conversationId.slice(0, 8)}`,
        body: [s.summary, ...(s.keyPoints ?? [])].join("\n"),
        tags: "",
      });
      existingConvos.add(s.conversationId);
      summaries++;
    }

    let profileMerged = false;
    if (data.userProfile) {
      ctx.userProfile.merge(data.userProfile);
      profileMerged = true;
    }

    return { memories, summaries, profileMerged };
  });

  // --- Conversations: chat history + context management --------------------

  // List an agent's web conversations, most-recently-updated first. Restricted
  // to `conv-` ids so bus/scheduled/connector conversations don't surface here.
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/agents/:id/conversations",
    async (req, reply) => {
      const ctx = orch.getContext(req.params.id);
      if (!ctx) {
        reply.code(404);
        return { error: "not found" };
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const rows = ctx.db
        .select()
        .from(schema.conversations)
        .where(like(schema.conversations.id, "conv-%"))
        .orderBy(desc(schema.conversations.updatedAt))
        .limit(limit)
        .all();
      return rows.map(
        (c): ConversationSummary => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          closedAt: c.closedAt,
          messageCount: c.messageCount,
        })
      );
    }
  );

  // Fetch one conversation's transcript + its compacted recap, if any.
  app.get<{ Params: { id: string; conversationId: string } }>(
    "/api/agents/:id/conversations/:conversationId",
    async (req, reply) => {
      const ctx = orch.getContext(req.params.id);
      if (!ctx) {
        reply.code(404);
        return { error: "not found" };
      }
      const conv = ctx.db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, req.params.conversationId))
        .get();
      if (!conv) {
        reply.code(404);
        return { error: "not found" };
      }
      const messages = ctx.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, req.params.conversationId))
        .orderBy(asc(schema.messages.createdAt))
        .all();
      const recap = ctx.db
        .select()
        .from(schema.conversationRecaps)
        .where(eq(schema.conversationRecaps.conversationId, req.params.conversationId))
        .get();
      return {
        conversation: conv,
        messages: messages
          .filter((m) => m.role !== "system")
          .map(
            (m): ChatMessage => ({
              id: m.id,
              conversationId: m.conversationId,
              role: m.role,
              content: m.content,
              toolCalls: (m.toolCalls as ToolCallRecord[] | null) ?? undefined,
              attachments: m.attachments ?? undefined,
              createdAt: m.createdAt,
            })
          ),
        recap: recap
          ? {
              recap: recap.recap,
              keyPoints: recap.keyPoints,
              coveredMessageCount: recap.coveredMessageCount,
              updatedAt: recap.updatedAt,
            }
          : null,
      };
    }
  );

  // Token-budget accounting for a conversation's live context window.
  app.get<{ Params: { id: string; conversationId: string } }>(
    "/api/agents/:id/conversations/:conversationId/context",
    async (req, reply) => {
      const ctx = orch.getContext(req.params.id);
      if (!ctx) {
        reply.code(404);
        return { error: "not found" };
      }
      return contextStatus(ctx, req.params.conversationId);
    }
  );

  // Compact a conversation now — folds the oldest turns into the recap.
  app.post<{
    Params: { id: string; conversationId: string };
    Body: { force?: boolean };
  }>("/api/agents/:id/conversations/:conversationId/compact", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    return compactConversation(ctx, req.params.conversationId, {
      force: req.body?.force ?? true,
    });
  });

  // Full reset (danger zone): wipe the agent's long-term memory and clear the
  // given conversation's history. Skills/credentials are untouched. Exposed only
  // here (web app) — the chat `!reset` command is informational, never destructive.
  app.post<{
    Params: { id: string };
    Body: { conversationId?: string };
  }>("/api/agents/:id/reset", async (req, reply) => {
    const runtime = orch.getRuntime(req.params.id);
    if (!runtime) {
      reply.code(404);
      return { error: "not found" };
    }
    const conversationId = req.body?.conversationId;
    if (conversationId) {
      runtime.fullReset(conversationId);
    } else {
      const ctx = orch.getContext(req.params.id);
      ctx?.memory.clear();
    }
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/skills", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    return ctx.skills.list();
  });

  app.post<{
    Params: { id: string };
    Body: { raw?: string; name?: string; description?: string; body?: string; tags?: string[] };
  }>("/api/agents/:id/skills", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    const b = req.body ?? {};
    try {
      if (b.raw) {
        const { meta, body } = ctx.skills.parseSkillFile(b.raw);
        if (!meta.name || !body) {
          reply.code(400);
          return { error: "skill markdown needs frontmatter `name` and a body" };
        }
        return ctx.skills.create({ meta, body, source: "imported" });
      }
      if (b.name && b.body) {
        return ctx.skills.create({
          meta: {
            name: b.name,
            description: b.description ?? "",
            version: "1.0.0",
            author: ctx.profile.id,
            tools: [],
            capabilities: [],
            parameters: {},
            tags: b.tags ?? [],
          },
          body: b.body,
          source: "authored",
        });
      }
      reply.code(400);
      return { error: "provide `raw` markdown, or `name` + `body`" };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // The first-party capability catalog — fully bundled, no network fetch.
  app.get("/api/skill-catalog", async () => BUILTIN_CAPABILITIES);

  // Install a catalog capability onto an agent: copy the bundled markdown into
  // the agent's skills/ dir + DB. The capability is already tool-equipped.
  app.post<{ Params: { id: string }; Body: { catalogId?: string } }>(
    "/api/agents/:id/skills/install",
    async (req, reply) => {
      const ctx = orch.getContext(req.params.id);
      if (!ctx) {
        reply.code(404);
        return { error: "not found" };
      }
      const entry = getCatalogCapability(req.body?.catalogId ?? "");
      if (!entry) {
        reply.code(400);
        return { error: "unknown catalog capability" };
      }
      const { meta, body, enabled } = ctx.skills.parseSkillFile(entry.markdown);
      const skill = ctx.skills.create(
        { meta, body, enabled, source: "builtin" },
        { id: entry.id }
      );
      // A newly-installed capability may carry MCP servers — reconcile now.
      void orch.reloadAgentMcp(req.params.id);
      return skill;
    }
  );

  app.delete<{ Params: { id: string; skillId: string } }>(
    "/api/agents/:id/skills/:skillId",
    async (req, reply) => {
      const ctx = orch.getContext(req.params.id);
      if (!ctx) {
        reply.code(404);
        return { error: "not found" };
      }
      const ok = ctx.skills.delete(req.params.skillId);
      void orch.reloadAgentMcp(req.params.id);
      return { ok };
    }
  );

  // Toggle a capability's `enabled` flag and/or edit its customization body.
  app.patch<{
    Params: { id: string; skillId: string };
    Body: { enabled?: boolean; body?: string };
  }>("/api/agents/:id/skills/:skillId", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    const b = req.body ?? {};
    const updated = ctx.skills.update(req.params.skillId, {
      enabled: b.enabled,
      body: b.body,
    });
    if (!updated) {
      reply.code(404);
      return { error: "skill not found" };
    }
    // An enable/disable may change the agent's MCP server set — reconcile.
    void orch.reloadAgentMcp(req.params.id);
    return updated;
  });

  // Which coding CLIs (claude/codex/gemini/opencode) are installed + (best-
  // effort) logged in, plus cached "update available" info. Both install and
  // login are SHARED across all agents, so this is instance-wide, not per agent.
  app.get("/api/coding-cli/status", async () => orch.codingCliStatus());

  // Force a fresh npm-registry check (the daily check runs in the background);
  // returns refreshed status with latest versions + update-available flags.
  app.post("/api/coding-cli/check-updates", async () => orch.refreshCodingCliUpdates());

  // Install (or update to latest) one coding CLI into the shared store for all
  // agents, then return refreshed status. Login stays a manual interactive step
  // (run the tool's login from any agent's terminal — it logs in everyone).
  app.post<{ Body: { tool?: string } }>("/api/coding-cli/install", async (req, reply) => {
    const tool = req.body?.tool ?? "";
    if (!isCodingTool(tool)) {
      reply.code(400);
      return { error: "tool must be one of claude, codex, gemini, opencode" };
    }
    const result = await installSharedCodingCli(tool);
    return { ...result, status: orch.codingCliStatus() };
  });

  // A skill's config form: its schema + current values (secrets masked).
  app.get<{ Params: { id: string; skillId: string } }>(
    "/api/agents/:id/skills/:skillId/config",
    async (req, reply) => {
      const config = orch.getSkillConfig(req.params.id, req.params.skillId);
      if (!config) {
        reply.code(404);
        return { error: "no config for this skill" };
      }
      return config;
    }
  );

  // Save a skill's config form — maps fields onto the agent's credentials.
  app.post<{
    Params: { id: string; skillId: string };
    Body: Record<string, unknown>;
  }>("/api/agents/:id/skills/:skillId/config", async (req, reply) => {
    const ok = orch.applySkillConfig(req.params.id, req.params.skillId, req.body ?? {});
    if (!ok) {
      reply.code(404);
      return { error: "no config for this skill" };
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string; memId: string } }>(
    "/api/agents/:id/memories/:memId",
    async (req, reply) => {
      const ctx = orch.getContext(req.params.id);
      if (!ctx) {
        reply.code(404);
        return { error: "not found" };
      }
      ctx.memory.delete(req.params.memId);
      return { ok: true };
    }
  );

  // The names + scopes of an agent's stored credentials — values are never returned.
  app.get<{ Params: { id: string } }>(
    "/api/agents/:id/credentials",
    async (req, reply) => {
      const keys = orch.listCredentials(req.params.id);
      if (!keys) {
        reply.code(404);
        return { error: "not found" };
      }
      return { keys };
    }
  );

  // Merge specific credentials without replacing the rest — add or update keys.
  // Body is `Record<string, string | { value: string; scope?: CredentialScope }>`.
  // Legacy plain-string values inherit the existing scope (or `broad` for new keys).
  app.patch<{
    Params: { id: string };
    Body: Record<string, string | { value: string; scope?: string }>;
  }>("/api/agents/:id/credentials", async (req, reply) => {
    const ok = orch.mergeCredentials(req.params.id, (req.body ?? {}) as never);
    if (!ok) {
      reply.code(404);
      return { error: "not found" };
    }
    return { ok: true };
  });

  // Change a credential's scope without re-sending the value.
  app.patch<{
    Params: { id: string; key: string };
    Body: { scope?: string };
  }>("/api/agents/:id/credentials/:key/scope", async (req, reply) => {
    const scope = (req.body?.scope ?? "").trim();
    if (!isValidScope(scope)) {
      reply.code(400);
      return { error: "invalid scope" };
    }
    const ok = orch.setCredentialScope(
      req.params.id,
      decodeURIComponent(req.params.key),
      scope as never,
    );
    if (!ok) {
      reply.code(404);
      return { error: "not found" };
    }
    return { ok: true };
  });

  // Delete a single credential by key, leaving the agent's other secrets intact.
  app.delete<{ Params: { id: string; key: string } }>(
    "/api/agents/:id/credentials/:key",
    async (req, reply) => {
      const ok = orch.deleteCredential(req.params.id, req.params.key);
      if (!ok) {
        reply.code(404);
        return { error: "not found" };
      }
      return { ok: true };
    }
  );

  // --- Instance-wide (global) credentials, shared by every agent ----------
  // Mirror the per-agent credential routes above, minus the `:id`. Values are
  // never returned; every write restarts all agents.

  // The names + scopes of the global credentials — values are never returned.
  app.get("/api/secrets", async () => ({ keys: orch.listGlobalCredentials() }));

  // Merge global credentials without replacing the rest — add or update keys.
  app.patch<{
    Body: Record<string, string | { value: string; scope?: string }>;
  }>("/api/secrets", async (req) => {
    orch.mergeGlobalCredentials((req.body ?? {}) as never);
    return { ok: true };
  });

  // Change a global credential's scope without re-sending the value.
  app.patch<{ Params: { key: string }; Body: { scope?: string } }>(
    "/api/secrets/:key/scope",
    async (req, reply) => {
      const scope = (req.body?.scope ?? "").trim();
      if (!isValidScope(scope)) {
        reply.code(400);
        return { error: "invalid scope" };
      }
      const ok = orch.setGlobalCredentialScope(decodeURIComponent(req.params.key), scope as never);
      if (!ok) {
        reply.code(404);
        return { error: "not found" };
      }
      return { ok: true };
    }
  );

  // Delete a single global credential by key.
  app.delete<{ Params: { key: string } }>("/api/secrets/:key", async (req) => {
    orch.deleteGlobalCredential(decodeURIComponent(req.params.key));
    return { ok: true };
  });

  // Structured global config form for a builtin capability (schema + non-secret
  // values + secret-present flags) — e.g. proxmox, ssh.
  app.get<{ Params: { capId: string } }>("/api/secrets/capability/:capId", async (req, reply) => {
    const view = orch.getGlobalCapabilityConfig(req.params.capId);
    if (!view) {
      reply.code(404);
      return { error: "not found" };
    }
    return view;
  });

  // Apply a submitted global capability config form.
  app.put<{ Params: { capId: string }; Body: Record<string, unknown> }>(
    "/api/secrets/capability/:capId",
    async (req, reply) => {
      const ok = orch.setGlobalCapabilityConfig(req.params.capId, (req.body ?? {}) as Record<string, unknown>);
      if (!ok) {
        reply.code(404);
        return { error: "not found" };
      }
      return { ok: true };
    }
  );

  // Verify an agent's stored Slack bot token against Slack's auth.test.
  app.post<{ Params: { id: string } }>(
    "/api/agents/:id/credentials/test-slack",
    async (req) => orch.testSlackToken(req.params.id)
  );

  // --- Agent-to-agent bus + subagent tasks ---
  app.get<{ Querystring: { limit?: string } }>("/api/bus/messages", async (req) =>
    orch.getBus().history(Number(req.query.limit ?? 200))
  );
  app.get("/api/subagent-tasks", async () => orch.listSubagentTasks());

  // --- Scheduled tasks ---
  app.get<{ Params: { id: string } }>("/api/agents/:id/scheduled-tasks", async (req) =>
    orch.getScheduler().list(req.params.id)
  );

  app.post<{ Params: { id: string }; Body: { cron: string; prompt: string } }>(
    "/api/agents/:id/scheduled-tasks",
    async (req, reply) => {
      const { cron, prompt } = req.body ?? {};
      if (!cron || !prompt) {
        reply.code(400);
        return { error: "cron and prompt are required" };
      }
      const task = orch.getScheduler().add(req.params.id, cron, prompt);
      if (!task) {
        reply.code(400);
        return { error: "invalid cron expression" };
      }
      return task;
    }
  );

  app.delete<{ Params: { taskId: string } }>("/api/scheduled-tasks/:taskId", async (req, reply) => {
    const ok = orch.getScheduler().cancel(req.params.taskId);
    if (!ok) {
      reply.code(404);
      return { error: "not found" };
    }
    return { ok: true };
  });

  // --- Skills (COO-scoped legacy surface) ---
  app.get("/api/skills", async () => getSkillService().list());

  app.post<{ Body: { url?: string; raw?: string } }>("/api/skills/import", async (req, reply) => {
    const { url, raw } = req.body;
    try {
      if (url) return await importSkillFromUrl(url);
      if (raw) return importSkillFromRaw(raw);
      reply.code(400);
      return { error: "Provide `url` or `raw`" };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get("/api/skills/export-all", async () => exportAllSkills());

  app.get<{ Params: { id: string } }>("/api/skills/:id/export", async (req, reply) => {
    const md = getSkillService().exportAsMarkdown(req.params.id);
    if (!md) {
      reply.code(404);
      return { error: "not found" };
    }
    reply.header("content-type", "text/markdown");
    return md;
  });

  // --- Memory + Profile (COO-scoped legacy surface) ---
  app.get("/api/memories", async () => getMemoryService().list(100));
  app.get("/api/user-profile", async () => getUserProfileService().get());

  // --- Built web app (single-port production) ---
  if (existsSync(resolve(cfg.webDistDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: cfg.webDistDir,
      prefix: "/",
      decorateReply: true,
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      if (shouldServeWebApp(req.method, req.url)) {
        return reply.sendFile("index.html");
      }
      reply.code(404);
      return { error: "not found" };
    });
  } else {
    app.log.info(
      `web build not found (${cfg.webDistDir}); serving API only. Run pnpm --filter @otterbot/web build for single-port mode.`
    );
  }

  return app;
}

/**
 * Gate every `/api/*` request on the API token. The web shell, SPA fallback
 * and the bootstrap auth endpoints (status / setup / login) stay open so a
 * fresh client can load the UI, complete first-run setup, and exchange a
 * password for a session token. The token is accepted as
 * `Authorization: Bearer …`, `?token=…`, or the `otterbot_token` cookie.
 *
 * On valid tokens the matching session id is attached to `req.sessionId`
 * so per-session handlers (logout, session list) know which session is
 * making the call. In env-pinned mode the id is `"env"`.
 */
function registerAuth(app: FastifyInstance, auth: AuthStore): void {
  const openPaths = new Set([
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/setup",
  ]);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = (req.raw.url ?? "").split("?")[0] || "/";
    if (!url.startsWith("/api/")) return; // static web shell + SPA fallback
    if (openPaths.has(url)) return;

    if (!auth.hasPassword()) {
      reply.code(503);
      return { error: "needs-setup" };
    }
    const token = extractToken({ headers: req.headers, query: req.query });
    if (!token) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    const result = auth.validateToken(token);
    if (!result) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    req.sessionId = result.sessionId;
  });

  app.get("/api/auth/status", async () => ({
    authRequired: true,
    needsSetup: !auth.hasPassword(),
    mode: auth.mode(),
  }));

  app.post<{ Body: { password?: string; label?: string } }>(
    "/api/auth/setup",
    async (req, reply) => {
      const password = req.body?.password ?? "";
      const label = (req.body?.label ?? "").trim() ||
        labelFromUserAgent(asHeaderString(req.headers["user-agent"]));
      const result = auth.setupPassword(password, label);
      if (!result.ok) {
        reply.code(400);
        return result;
      }
      reply.header("set-cookie", sessionCookie(result.token));
      return { ok: true, token: result.token, sessionId: result.sessionId };
    }
  );

  app.post<{ Body: { password?: string; token?: string; label?: string } }>(
    "/api/auth/login",
    async (req, reply) => {
      if (!auth.hasPassword()) {
        reply.code(503);
        return { ok: false, error: "needs-setup" };
      }
      // `token` is accepted for back-compat with older clients; new clients send `password`.
      const password = (req.body?.password ?? req.body?.token ?? "").trim();
      const label = (req.body?.label ?? "").trim() ||
        labelFromUserAgent(asHeaderString(req.headers["user-agent"]));
      const result = auth.login(password, label);
      if (!result.ok) {
        reply.code(401);
        return result;
      }
      reply.header("set-cookie", sessionCookie(result.token));
      return { ok: true, token: result.token, sessionId: result.sessionId };
    }
  );

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.sessionId && req.sessionId !== "env") {
      auth.revokeSession(req.sessionId);
    }
    reply.header("set-cookie", `${TOKEN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return { ok: true };
  });

  app.get("/api/auth/sessions", async (req) => ({
    mode: auth.mode(),
    sessions: auth.listSessions(req.sessionId ?? null),
  }));

  app.delete<{ Params: { id: string } }>(
    "/api/auth/sessions/:id",
    async (req, reply) => {
      if (auth.mode() === "env") {
        reply.code(400);
        return { ok: false, error: "sessions are disabled in env-pinned mode" };
      }
      const ok = auth.revokeSession(req.params.id);
      if (!ok) {
        reply.code(404);
        return { ok: false, error: "session not found" };
      }
      // If the caller revoked their own session, clear the cookie too.
      if (req.sessionId === req.params.id) {
        reply.header("set-cookie", `${TOKEN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      }
      return { ok: true };
    }
  );

  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    "/api/auth/change-password",
    async (req, reply) => {
      if (auth.mode() === "env") {
        reply.code(400);
        return { ok: false, error: "password change not available in env-pinned mode" };
      }
      const current = (req.body?.currentPassword ?? "").trim();
      const next = (req.body?.newPassword ?? "").trim();
      const result = auth.changePassword(current, next, req.sessionId ?? null);
      if (!result.ok) {
        reply.code(400);
        return result;
      }
      // Rotate the caller's cookie to the new session token.
      reply.header("set-cookie", sessionCookie(result.token));
      return { ok: true, token: result.token, sessionId: result.sessionId };
    }
  );
}

function asHeaderString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

/**
 * Build the session cookie. HttpOnly so JS on the page can't read the value;
 * SameSite=Lax keeps it off cross-site requests. Not Secure — the server
 * runs over plain HTTP on the LAN; flipping Secure on would break LAN
 * access entirely.
 */
function sessionCookie(value: string): string {
  const oneYear = 60 * 60 * 24 * 365;
  return `${TOKEN_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${oneYear}`;
}

function shouldServeWebApp(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const path = url.split("?")[0] || "/";
  if (
    path.startsWith("/api/") ||
    path === "/api" ||
    path.startsWith("/socket.io/") ||
    path === "/socket.io"
  ) {
    return false;
  }
  return !path.split("/").pop()?.includes(".");
}
