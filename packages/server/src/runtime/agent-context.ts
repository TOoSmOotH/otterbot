import type Database from "better-sqlite3-multiple-ciphers";
import type { Tool } from "ai";
import type { AgentProfile, ModelRef } from "@otterbot/shared";
import { openAgentDb, type AgentDb, type AgentDrizzle } from "../db/agent-db.js";
import { EmbeddingService, type Embedder } from "../embedding.js";
import { VecIndex } from "../vec-index.js";
import { MemoryService } from "../memory/memory-service.js";
import { SkillService } from "../skills/skill-service.js";
import { UserProfileService } from "../user-profile/user-profile-service.js";
import { buildShellSecrets } from "../secrets/shell-secrets.js";
import type { ScopedSecret } from "../secrets/secrets-store.js";
import { browserEnvFor, closeBrowserSession } from "../integrations/browser.js";
import type { GitSshSetup } from "../integrations/shell.js";

/**
 * Everything one agent needs at runtime: its profile, secrets, isolated
 * database, and the per-agent service instances bound to that database.
 * The orchestrator builds one `AgentContext` per profile.
 */
export interface AgentContext {
  profile: AgentProfile;
  /**
   * The resolved chat {@link ModelRef} the runtime runs against. The profile
   * stores only a configured-model id; the orchestrator resolves it against
   * GlobalSettings.models when building the context.
   */
  chatModelRef: ModelRef;
  /**
   * The agent's complete credential bag, flattened to `key -> value`. Consumed
   * by direct integrations (`github.ts`, `email.ts`, `slack-connector.ts`,
   * model resolution, …) which trust the call site to use credentials
   * structurally — i.e., never piped to a shell.
   *
   * **Do not pass this to `runAgentShell` or `buildSandboxPlan`.** Use
   * `shellSecrets()` instead, which filters by each credential's `scope`
   * and the agent's currently enabled capabilities.
   */
  secrets: Map<string, string>;
  /**
   * The subset of credentials that may appear in the agent's shell env.
   * A thunk (not a static map) because capability enable/disable should
   * take effect live; recomputed per `shell_exec`.
   */
  shellSecrets: () => Map<string, string>;
  /**
   * The chat model's effective context window (tokens) — the agent's own
   * `model.contextWindow`, or the global default. Drives the history budget.
   */
  contextWindow: number;
  /** Sandboxed working directory for the agent's `shell_exec` tool. */
  workspaceDir: string;
  /**
   * The shared project *workspace* dir bound into this agent's sandbox at
   * `/project` — holding each of the project's repos as a subdir — or null when
   * the agent belongs to no project. A thunk so membership changes take effect
   * without rebuilding the context.
   */
  projectWorkspacePath: () => string | null;
  /**
   * The repos in this agent's project, each a subdir of the workspace. Used to
   * tell the agent which repos live under `/project`. Empty when the agent
   * belongs to no project. A thunk so membership/repo changes take effect on the
   * next turn without rebuilding the context.
   */
  projectRepos: () => Array<{ name: string; forgeRepo: string | null; mode: string }>;
  /**
   * The Git-account SSH identity to expose for in-sandbox git-over-SSH, or null.
   * Gated on the `gh-auth` capability so the key appears only when the token
   * does. A thunk so assignment/capability changes take effect next turn.
   */
  gitSsh: () => GitSshSetup | null;
  /**
   * The standing rules for this agent's project, or null when it belongs to no
   * project (or the project has none). A thunk so rule edits take effect on the
   * next turn without rebuilding the context.
   */
  projectRules: () => string | null;
  /**
   * The access level for this agent's project (`'read'` | `'write'`), or null
   * when it belongs to no project. A thunk so access changes take effect on the
   * next turn without rebuilding the context.
   */
  projectAccess: () => "read" | "write" | null;
  /** Persistent Chrome user-data dir for the agent's browser tools. */
  browserProfileDir: string;
  /** Effective per-call browser-command timeout (ms): profile override or global default. */
  browseTimeoutMs: number;
  /** Effective max model steps per turn: profile override or global default. */
  maxSteps: number;
  /** Directory where the agent's generated images are written and served from. */
  imagesDir: string;
  /** Directory where the agent's produced files (artifacts) are written/served. */
  filesDir: string;
  /** Directory holding the agent's managed SSH keypair and known_hosts (not in the sandbox). */
  sshDir: string;
  agentDb: AgentDb;
  sqlite: Database.Database;
  db: AgentDrizzle;
  embedding: EmbeddingService;
  vec: VecIndex;
  memory: MemoryService;
  skills: SkillService;
  userProfile: UserProfileService;
  /**
   * Tools discovered from the agent's MCP servers — populated asynchronously
   * by the MCP manager after the agent starts; merged into the agent's tools.
   */
  mcpTools: Record<string, Tool>;
  /** Close the agent's database handles. */
  close(): void;
}

export interface BuildAgentContextInput {
  profile: AgentProfile;
  /** Chat ModelRef resolved from the profile's configured-model id. */
  chatModelRef: ModelRef;
  /**
   * Per-credential scope map: every entry the agent can see, tagged with
   * its exposure rule. Provider keys are merged in upstream with implicit
   * `direct` scope so they never enter the shell.
   */
  scopedSecrets: Map<string, ScopedSecret>;
  /** The agent's effective chat-model context window in tokens. */
  contextWindow: number;
  /** Path to this agent's isolated `agent.db`. */
  agentDbPath: string;
  /** Path to this agent's `skills/` directory. */
  skillsDir: string;
  /** Path to this agent's sandboxed workspace directory. */
  workspaceDir: string;
  /**
   * Resolve the shared project tree bound into this agent's sandbox, or null
   * when it belongs to no project. Called live (membership can change).
   */
  resolveProjectWorkspacePath?: () => string | null;
  /** Resolve the repos in this agent's project (subdirs of /project). Called live. */
  resolveProjectRepos?: () => Array<{ name: string; forgeRepo: string | null; mode: string }>;
  /** Resolve the agent's Git-account SSH identity (subject to gh-auth gating). */
  resolveGitSsh?: () => GitSshSetup | null;
  /**
   * Resolve the standing rules for this agent's project, or null. Called live
   * (rules can change between turns).
   */
  resolveProjectRules?: () => string | null;
  /** Resolve the agent's project access level, or null. Called live. */
  resolveProjectAccess?: () => "read" | "write" | null;
  /** Path to this agent's persistent browser profile directory. */
  browserProfileDir: string;
  /** Path to this agent's generated-images directory. */
  imagesDir: string;
  /** Path to this agent's produced-files (artifacts) directory. */
  filesDir: string;
  /** Path to this agent's SSH key directory (keypair + known_hosts). */
  sshDir: string;
  /** The embedder resolved from the agent's embedding model. */
  embedder: Embedder;
  /** Database encryption key, if configured. */
  dbKey?: string | null;
  /** Global default per-call browser timeout (ms); profile may override. */
  defaultBrowseTimeoutMs: number;
  /** Global default max steps per turn; profile may override. */
  defaultMaxSteps: number;
}

/**
 * Effective per-turn limits. A finite, positive profile override wins; anything
 * else (null, 0, negative, NaN, Infinity) falls back to the global default —
 * so a stray value can never disable browsing or pin the step budget to 0.
 */
export function resolveTurnLimits(
  override: { browseTimeoutMs: number | null; maxSteps: number | null },
  defaults: { browseTimeoutMs: number; maxSteps: number }
): { browseTimeoutMs: number; maxSteps: number } {
  const pos = (v: number | null, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    browseTimeoutMs: pos(override.browseTimeoutMs, defaults.browseTimeoutMs),
    maxSteps: pos(override.maxSteps, defaults.maxSteps),
  };
}

/** Construct an agent's runtime context, opening its isolated database. */
export function buildAgentContext(input: BuildAgentContextInput): AgentContext {
  const agentDb = openAgentDb(input.agentDbPath, input.dbKey);
  const embedding = new EmbeddingService(input.embedder, agentDb);
  const vec = new VecIndex(agentDb.sqlite, embedding);
  const memory = new MemoryService(agentDb.db, agentDb.sqlite, vec);
  const skills = new SkillService(agentDb.db, input.skillsDir, memory);
  const userProfile = new UserProfileService(agentDb.db);

  // Flat value-only map for direct integrations (chat model resolution,
  // github.ts, email.ts, slack-connector.ts).
  const flatSecrets = new Map<string, string>();
  for (const [k, { value }] of input.scopedSecrets) flatSecrets.set(k, value);

  const limits = resolveTurnLimits(
    { browseTimeoutMs: input.profile.browseTimeoutMs, maxSteps: input.profile.maxSteps },
    { browseTimeoutMs: input.defaultBrowseTimeoutMs, maxSteps: input.defaultMaxSteps }
  );

  const ctx: AgentContext = {
    profile: input.profile,
    chatModelRef: input.chatModelRef,
    secrets: flatSecrets,
    shellSecrets: () => {
      // Recompute each call so capability toggles take effect live.
      const enabledCapabilityIds = new Set(skills.listEnabled().map((s) => s.id));
      return buildShellSecrets(input.scopedSecrets, enabledCapabilityIds);
    },
    contextWindow: input.contextWindow,
    workspaceDir: input.workspaceDir,
    projectWorkspacePath: input.resolveProjectWorkspacePath ?? (() => null),
    projectRepos: input.resolveProjectRepos ?? (() => []),
    gitSsh: () => {
      // Same gate as the GITHUB_TOKEN secret (cap:gh-auth): only expose the key
      // when the capability is enabled, so token and key appear together.
      const enabled = new Set(skills.listEnabled().map((s) => s.id));
      if (!enabled.has("gh-auth")) return null;
      return input.resolveGitSsh?.() ?? null;
    },
    projectRules: input.resolveProjectRules ?? (() => null),
    projectAccess: input.resolveProjectAccess ?? (() => null),
    browserProfileDir: input.browserProfileDir,
    browseTimeoutMs: limits.browseTimeoutMs,
    maxSteps: limits.maxSteps,
    imagesDir: input.imagesDir,
    filesDir: input.filesDir,
    sshDir: input.sshDir,
    agentDb,
    sqlite: agentDb.sqlite,
    db: agentDb.db,
    embedding,
    vec,
    memory,
    skills,
    userProfile,
    mcpTools: {},
    close: () => {
      // Best-effort: tear down the agent's browser daemon, then close the db.
      closeBrowserSession(browserEnvFor(input.profile.id, input.browserProfileDir));
      agentDb.close();
    },
  };
  return ctx;
}
