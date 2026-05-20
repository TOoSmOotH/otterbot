import type Database from "better-sqlite3-multiple-ciphers";
import type { Tool } from "ai";
import type { AgentProfile } from "@otterbot/shared";
import { openAgentDb, type AgentDb, type AgentDrizzle } from "../db/agent-db.js";
import { EmbeddingService, type Embedder } from "../embedding.js";
import { VecIndex } from "../vec-index.js";
import { MemoryService } from "../memory/memory-service.js";
import { SkillService } from "../skills/skill-service.js";
import { UserProfileService } from "../user-profile/user-profile-service.js";
import { buildShellSecrets } from "../secrets/shell-secrets.js";
import type { ScopedSecret } from "../secrets/secrets-store.js";

/**
 * Everything one agent needs at runtime: its profile, secrets, isolated
 * database, and the per-agent service instances bound to that database.
 * The orchestrator builds one `AgentContext` per profile.
 */
export interface AgentContext {
  profile: AgentProfile;
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
  /** The embedder resolved from the agent's embedding model. */
  embedder: Embedder;
  /** Database encryption key, if configured. */
  dbKey?: string | null;
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

  const ctx: AgentContext = {
    profile: input.profile,
    secrets: flatSecrets,
    shellSecrets: () => {
      // Recompute each call so capability toggles take effect live.
      const enabledCapabilityIds = new Set(skills.listEnabled().map((s) => s.id));
      return buildShellSecrets(input.scopedSecrets, enabledCapabilityIds);
    },
    contextWindow: input.contextWindow,
    workspaceDir: input.workspaceDir,
    agentDb,
    sqlite: agentDb.sqlite,
    db: agentDb.db,
    embedding,
    vec,
    memory,
    skills,
    userProfile,
    mcpTools: {},
    close: () => agentDb.close(),
  };
  return ctx;
}
