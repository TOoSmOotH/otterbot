import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Control-plane schema. A single shared `control.db` holds only cross-agent
 * records: the agent registry, the global agent-to-agent message log, the
 * subagent spawn-task tree, and cron schedules. Per-agent data (memories,
 * skills, conversations, vectors) lives in each agent's isolated `agent.db`.
 */

/** Registry of every agent profile known to the orchestrator. */
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["coo", "agent", "subagent"] }).notNull().default("agent"),
  profileDir: text("profile_dir").notNull(),
  status: text("status").notNull().default("idle"),
  parentId: text("parent_id"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Global agent-to-agent message log. Every bus message is written here first
 * so the UI can replay the full history regardless of transport.
 */
export const busMessages = sqliteTable("bus_messages", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  id: text("id").notNull(),
  kind: text("kind").notNull(),
  fromAgentId: text("from_agent_id").notNull(),
  toAgentId: text("to_agent_id"),
  threadId: text("thread_id").notNull(),
  correlationId: text("correlation_id"),
  rootSpawnId: text("root_spawn_id"),
  body: text("body").notNull().default(""),
  payload: text("payload", { mode: "json" }).$type<unknown>().default(null),
  status: text("status"),
  transport: text("transport").notNull().default("local"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Spawn-task tree: one row per subagent created to perform a unit of work. */
export const subagentTasks = sqliteTable("subagent_tasks", {
  id: text("id").primaryKey(),
  rootId: text("root_id").notNull(),
  parentTaskId: text("parent_task_id"),
  parentAgentId: text("parent_agent_id").notNull(),
  subagentId: text("subagent_id").notNull(),
  goal: text("goal").notNull(),
  status: text("status", {
    enum: ["queued", "running", "done", "failed", "cancelled"],
  })
    .notNull()
    .default("queued"),
  resultSummary: text("result_summary"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  finishedAt: text("finished_at"),
});

/**
 * Per-agent credentials (API keys, tokens, SMTP, model endpoints). Stored here
 * — encrypted at rest with the database key — instead of plaintext `.env`
 * files. One row per (agent, key).
 */
export const agentSecrets = sqliteTable("agent_secrets", {
  agentId: text("agent_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  /**
   * Exposure rule for this credential. Parsed by `parseCredentialScope`.
   * - "direct"             → never in shell env; direct-integration consumers only.
   * - "broad"              → injected into every shell exec.
   * - "cap:<id>,<id>,…"    → injected only when at least one listed capability
   *                          is currently enabled on the agent.
   */
  scope: text("scope").notNull().default("broad"),
});

/** App-level key/value settings (e.g. onboarding completion). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Instance-wide credentials shared by every agent — the global counterpart of
 * `agentSecrets` (no `agentId` dimension). Layered beneath per-agent secrets at
 * context-build time, so a per-agent key of the same name still wins. The same
 * `scope` exposure rules apply (see `agentSecrets.scope`). One row per key.
 */
export const globalSecrets = sqliteTable("global_secrets", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  /** Exposure rule — identical semantics to `agentSecrets.scope`. */
  scope: text("scope").notNull().default("broad"),
});

/**
 * A forge account (GitHub or Gitea) the instance can act as. Instance-wide,
 * not per-agent — projects reference one by id for clone/push/PR + monitoring.
 * The token is stored in the (optionally encrypted) control database.
 */
export const forgeAccounts = sqliteTable("forge_accounts", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["github", "gitea"] }).notNull(),
  label: text("label").notNull(),
  baseUrl: text("base_url").notNull(),
  token: text("token").notNull(),
  username: text("username").notNull().default(""),
  /** How git transport authenticates: tokenized HTTPS or a managed SSH key. */
  gitTransport: text("git_transport", { enum: ["https", "ssh"] }).notNull().default("https"),
  /** Commit author identity (for the Verified badge, email must match the account). */
  committerName: text("committer_name").notNull().default(""),
  committerEmail: text("committer_email").notNull().default(""),
  /** SSH-sign commits with the managed key (gitTransport must be ssh). */
  signCommits: integer("sign_commits", { mode: "boolean" }).notNull().default(false),
  /**
   * A reusable {@link sshKeys} key used for git-over-SSH (clone/push + signing),
   * chosen by the user. Null falls back to the legacy per-account managed key.
   */
  sshKeyId: text("ssh_key_id"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * A named, reusable SSH key the user generated or imported. Standalone (not tied
 * to one forge account) so it can be associated with a git account by id. The
 * `privateKey` lives encrypted at rest in this control database and is never
 * returned by the API; it is materialized to a 0600 file only at git time.
 */
export const sshKeys = sqliteTable("ssh_keys", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  /** OpenSSH public-key line (safe to display — for copying to the forge). */
  publicKey: text("public_key").notNull(),
  /** SHA256:… fingerprint, matching what GitHub displays. */
  fingerprint: text("fingerprint").notNull().default(""),
  /** PEM private key — encrypted at rest with the DB key; never sent to the API. */
  privateKey: text("private_key").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * A named, typed secret bundle (Slack tokens, a Matrix login, a GitHub token,
 * SMTP creds…). The secret *values* are not stored here — they live in
 * `global_secrets` under `cred:<id>:<KEY>`, encrypted at rest like every other
 * secret. A {@link connections} row references one of these by id.
 */
export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  /** Credential kind — see the server connection registry (slack/matrix/github/…). */
  type: text("type").notNull(),
  /**
   * Non-secret account fields (the secret half lives in `global_secrets` under
   * `cred:<id>:<KEY>`). Empty for simple secret bundles; holds account metadata
   * for absorbed types — a git account's provider/baseUrl/transport/committer,
   * an `ssh-key`'s public key + fingerprint, etc.
   */
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * A named connector: a type + non-secret config that references a
 * {@link credentials} row. Assigned to agents via {@link connectionAssignments}.
 * `config` holds the per-type non-secret fields (a `ChannelBotConfig` for chat,
 * an `McpServerConfig` for mcp, host/allowlist fields for others).
 */
export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  type: text("type").notNull(),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  /** References `credentials.id`; null when the connector needs no credential. */
  credentialId: text("credential_id"),
  /** When true, the binding applies to every agent (instance-wide), not just `connectionAssignments`. */
  allAgents: integer("all_agents", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Which agents a connection is assigned to. Many-to-many by design; the v1
 * "one chat connection per agent / per connection" rule is enforced in the
 * service layer (ConnectionStore), not by a DB constraint, so multi-agent chat
 * sharing later needs no schema change. One row per (connection, agent).
 */
export const connectionAssignments = sqliteTable("connection_assignments", {
  connectionId: text("connection_id").notNull(),
  agentId: text("agent_id").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * A collaborative project: a single git working tree that several agents share.
 * The tree lives at `repoPath` (under `data/projects/<id>/repo`) and is bound,
 * writable, into each member agent's sandbox at `/project`, so the members edit
 * one codebase while their own `/workspace` (and per-tool CLI credentials) stays
 * private. Phase 1 is local-only; remote/GitHub fields arrive in a later phase.
 */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * Absolute path to the project's *workspace* dir on the host, bound at
   * `/project` in member sandboxes. It holds each repo as a sibling subdir
   * (`<workspace>/<repo.name>`), so members can read/write across every repo in
   * one session. Null only on legacy rows until the startup backfill sets it.
   */
  workspacePath: text("workspace_path"),
  /**
   * Legacy: the single-repo working tree path. Superseded by `workspacePath` +
   * the `project_repos` table; retained so the backfill can seed the first repo
   * row. New code reads the primary `project_repos` row, not this column.
   */
  repoPath: text("repo_path").notNull(),
  /** Where the code lives: local-only, or a repo on a forge. */
  mode: text("mode", { enum: ["local", "existing", "new", "fork"] }).notNull().default("local"),
  /** Forge account id (forge_accounts.id) when mode != local. */
  forgeAccountId: text("forge_account_id"),
  /** owner/name of the upstream repo on the forge when mode != local. */
  forgeRepo: text("forge_repo"),
  /** owner/name of the bot's fork (clone/push target) when mode == fork. */
  forkRepo: text("fork_repo"),
  /** SSH clone/push URL captured from the forge (handles custom Gitea ports). */
  forgeSshUrl: text("forge_ssh_url"),
  /** Base/integration branch PRs target (default branch when blank). */
  baseBranch: text("base_branch"),
  /** Poll the forge for assigned issues to feed the pipeline. */
  monitorIssues: integer("monitor_issues", { mode: "boolean" }).notNull().default(false),
  /** Poll the forge for new unassigned issues and have the PM post/refine a plan. */
  triageIssues: integer("triage_issues", { mode: "boolean" }).notNull().default(false),
  /** Run remote-host (Proxmox/SSH VM) end-to-end tests in the tester stage. */
  remoteE2e: integer("remote_e2e", { mode: "boolean" }).notNull().default(false),
  /** Standing rules injected into every project member's system prompt. */
  rules: text("rules"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * A repo within a project. A project's workspace dir holds one subdir per repo
 * (`<workspace>/<name>`); this row carries that repo's on-disk path and its own
 * git/forge backing so each repo is branched/committed/pushed/PR'd
 * independently. Exactly one repo per project is `isPrimary` — it backs the
 * legacy single-repo surfaces (issue monitoring/triage, the project-level forge
 * route) until those become per-repo. One row per (project, name).
 */
export const projectRepos = sqliteTable("project_repos", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  /** Subdir name under the workspace and the repo's display label. */
  name: text("name").notNull(),
  /** Absolute path to this repo's working tree (`<workspace>/<name>`). */
  repoPath: text("repo_path").notNull(),
  /** Where the code lives: local-only, or a repo on a forge. */
  mode: text("mode", { enum: ["local", "existing", "new", "fork"] }).notNull().default("local"),
  /** Forge account id (forge_accounts.id) when mode != local. */
  forgeAccountId: text("forge_account_id"),
  /** owner/name of the upstream repo on the forge when mode != local. */
  forgeRepo: text("forge_repo"),
  /** owner/name of the bot's fork (clone/push target) when mode == fork. */
  forkRepo: text("fork_repo"),
  /** SSH clone/push URL captured from the forge (handles custom Gitea ports). */
  forgeSshUrl: text("forge_ssh_url"),
  /** Base/integration branch PRs target (default branch when blank). */
  baseBranch: text("base_branch"),
  /** Poll the forge for assigned issues to feed the pipeline. */
  monitorIssues: integer("monitor_issues", { mode: "boolean" }).notNull().default(false),
  /** Poll the forge for new unassigned issues and have the PM post/refine a plan. */
  triageIssues: integer("triage_issues", { mode: "boolean" }).notNull().default(false),
  /** The project's primary repo — backs legacy single-repo surfaces. */
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Which agents belong to which project. One row per (project, agent). */
export const projectMembers = sqliteTable("project_members", {
  projectId: text("project_id").notNull(),
  agentId: text("agent_id").notNull(),
  access: text("access", { enum: ["read", "write"] })
    .notNull()
    .default("read"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * The per-project coding team: maps a pipeline role (pm, coder, security,
 * test-writer, tester) to the agent that fills it for a given project. Doubles
 * as the pipeline's stage→agent lookup and the teardown list when a project is
 * deleted. One row per (project, role).
 */
export const projectTeam = sqliteTable("project_team", {
  projectId: text("project_id").notNull(),
  role: text("role").notNull(),
  agentId: text("agent_id").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * One run of a project's build pipeline. The PM starts a run with a goal; the
 * `PipelineManager` walks the stages (coder → security → test-writer → tester),
 * handing each to that project's specialist and recording the outcome.
 */
export const pipelineRuns = sqliteTable("pipeline_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  goal: text("goal").notNull(),
  status: text("status", {
    enum: ["running", "done", "failed", "cancelled"],
  })
    .notNull()
    .default("running"),
  /** The stage currently executing (or the last one, when finished). */
  currentStage: text("current_stage"),
  /** How many times the run has been kicked back to the coder. */
  attempt: integer("attempt").notNull().default(0),
  /** The forge issue this run was started from, if any (for monitoring dedupe). */
  issueNumber: integer("issue_number"),
  /** The feature branch the run pushed (forge-backed projects). */
  prBranch: text("pr_branch"),
  /** The opened PR/MR number + URL, once published. */
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** One stage execution within a pipeline run (history; multiple per stage on retry). */
export const pipelineStageResults = sqliteTable("pipeline_stage_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  stage: text("stage").notNull(),
  agentId: text("agent_id").notNull(),
  status: text("status", { enum: ["pass", "fail", "error"] }).notNull(),
  report: text("report").notNull().default(""),
  attempt: integer("attempt").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Per-issue triage state for a forge-backed project. One row per (project, issue):
 * the current candidate `plan` the PM posted, and `lastCommentId` — the highest
 * forge comment id already processed, so the poller only reacts to newer comments.
 */
export const issueTriage = sqliteTable("issue_triage", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  issueNumber: integer("issue_number").notNull(),
  plan: text("plan").notNull().default(""),
  lastCommentId: integer("last_comment_id").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Cron-scheduled prompts fired against an agent. */
export const scheduledTasks = sqliteTable("scheduled_tasks", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  cron: text("cron").notNull(),
  prompt: text("prompt").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  nextRunAt: text("next_run_at"),
});
