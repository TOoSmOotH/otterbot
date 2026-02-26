import type { Server, Socket } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@otterbot/shared";
import { MessageType, type Agent, type AgentActivityRecord, type BusMessage, type Conversation, type Project, type KanbanTask, type Todo, type CodingAgentSession, type CodingAgentMessage, type CodingAgentPart, type CodingAgentFileDiff, type CodingAgentType } from "@otterbot/shared";
import { nanoid } from "nanoid";
import { makeProjectId } from "../utils/slugify.js";
import { eq, or, desc, isNull } from "drizzle-orm";
import type { MessageBus } from "../bus/message-bus.js";
import type { COO } from "../agents/coo.js";
import type { Registry } from "../registry/registry.js";
import type { BaseAgent } from "../agents/agent.js";
import { getDb, schema } from "../db/index.js";
import { isTTSEnabled, getConfiguredTTSProvider, stripMarkdown } from "../tts/tts.js";
import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { SoulService } from "../memory/soul-service.js";
import { MemoryService } from "../memory/memory-service.js";
import { SoulAdvisor } from "../memory/soul-advisor.js";
import type { WorkspaceManager } from "../workspace/workspace.js";
import type { GitHubIssueMonitor } from "../github/issue-monitor.js";
import type { MergeQueue } from "../merge-queue/merge-queue.js";
import { cloneRepo, getRepoDefaultBranch } from "../github/github-service.js";
import { initGitRepo, createInitialCommit } from "../utils/git.js";
import { NO_REPORT_SENTINEL } from "../schedulers/custom-task-scheduler.js";
import { ProjectStatus, CharterStatus } from "@otterbot/shared";
import { existsSync, rmSync } from "node:fs";
import type { PtyClient } from "../agents/worker.js";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// Server-side part accumulator (mirrors client's partBuffers)
// Key: `${agentId}:${messageId}:${partId}`
const serverPartBuffers = new Map<string, { type: string; content: string; toolName?: string; toolState?: string }>();
// Track agentId → DB row ID for session updates
const sessionRowIds = new Map<string, string>();

/** Active PTY sessions keyed by agentId — registered by workers, used by socket handlers */
const activePtySessions = new Map<string, PtyClient>();

/** Saved replay buffers from completed PTY sessions — allows viewing terminal output after session ends */
const completedPtyBuffers = new Map<string, string>();

/** Register a PTY session so socket handlers can route terminal events to it */
export function registerPtySession(agentId: string, client: PtyClient): void {
  completedPtyBuffers.delete(agentId); // Clear any stale completed buffer
  activePtySessions.set(agentId, client);
}

/** Unregister a PTY session (called when process exits) — saves replay buffer for later viewing */
export function unregisterPtySession(agentId: string): void {
  const client = activePtySessions.get(agentId);
  if (client) {
    const buffer = client.getReplayBuffer();
    if (buffer) {
      completedPtyBuffers.set(agentId, buffer);
    }
  }
  activePtySessions.delete(agentId);
}

/** Reset module-level persistence state (for testing) */
export function resetCodingAgentPersistence() {
  serverPartBuffers.clear();
  sessionRowIds.clear();
}

/** @deprecated Use resetCodingAgentPersistence instead */
export const resetOpenCodePersistence = resetCodingAgentPersistence;

export interface SocketHooks {
  /** Intercept CEO messages before they reach the COO.
   *  Return true if the message was handled (e.g. permission response). */
  beforeCeoMessage?: (
    content: string,
    conversationId: string | undefined,
    callback?: (ack: { messageId: string; conversationId: string }) => void,
  ) => boolean;
}

export function setupSocketHandlers(
  io: TypedServer,
  bus: MessageBus,
  coo: COO,
  registry: Registry,
  hooks?: SocketHooks,
  deps?: { workspace?: WorkspaceManager; issueMonitor?: GitHubIssueMonitor; mergeQueue?: MergeQueue },
) {
  // Track conversation IDs used by background tasks so we can suppress
  // the COO's response in that same conversation.
  const backgroundConversationIds = new Set<string>();

  // Broadcast all bus messages to connected clients
  bus.onBroadcast(async (message: BusMessage) => {
    // Suppress background task inbound messages from chat
    if (message.metadata?.backgroundTask) {
      if (message.conversationId) {
        backgroundConversationIds.add(message.conversationId);
      }
      // Still deliver to COO (routing already happened), just don't emit to UI
      return;
    }

    // Suppress COO [NO_REPORT] responses from background checks
    if (
      message.fromAgentId === "coo" &&
      message.toAgentId === null &&
      message.content.trim() === NO_REPORT_SENTINEL
    ) {
      if (message.conversationId) {
        backgroundConversationIds.delete(message.conversationId);
      }
      return;
    }

    // Suppress COO responses to background conversations that contain nothing useful
    if (
      message.fromAgentId === "coo" &&
      message.toAgentId === null &&
      message.conversationId &&
      backgroundConversationIds.has(message.conversationId)
    ) {
      backgroundConversationIds.delete(message.conversationId);
      // If the response contains the sentinel anywhere, suppress it
      if (message.content.includes(NO_REPORT_SENTINEL)) {
        return;
      }
      // Otherwise fall through — COO found something to report
    }

    io.emit("bus:message", message);

    // If the message is from COO to CEO (null), also emit as coo:response
    if (message.fromAgentId === "coo" && message.toAgentId === null) {
      io.emit("coo:response", message);

      // TTS: synthesize and emit audio (best-effort, never blocks text)
      try {
        if (isTTSEnabled()) {
          const provider = getConfiguredTTSProvider();
          const plainText = message.content
            ? stripMarkdown(message.content)
            : "";
          if (provider && plainText) {
            const voice = getConfig("tts:voice") ?? "af_heart";
            const speed = parseFloat(getConfig("tts:speed") ?? "1");
            const { audio, contentType } = await provider.synthesize(
              plainText,
              voice,
              speed,
            );
            io.emit("coo:audio", {
              messageId: message.id,
              audio: audio.toString("base64"),
              contentType,
            });
          }
        }
      } catch (err) {
        console.error("TTS synthesis failed:", err);
      }
    }
  });

  io.on("connection", (socket: TypedSocket) => {
    console.log(`Client connected: ${socket.id}`);

    // CEO sends a message to the COO
    socket.on("ceo:message", (data, callback) => {
      console.log(`[Socket] ceo:message received: "${data.content.slice(0, 80)}"`);

      // Check if this message is a permission response (intercept before COO)
      if (hooks?.beforeCeoMessage?.(data.content, data.conversationId, callback)) {
        return;
      }

      const db = getDb();
      const projectId = data.projectId ?? null;
      let conversationId = data.conversationId ?? coo.getCurrentConversationId();

      // Lazy conversation creation: first message creates the conversation
      if (!conversationId) {
        conversationId = nanoid();
        const now = new Date().toISOString();
        const title = data.content.slice(0, 80);
        const conversation: Conversation = {
          id: conversationId,
          title,
          projectId,
          createdAt: now,
          updatedAt: now,
        };
        db.insert(schema.conversations).values(conversation).run();
        // Look up the project charter for new project chats
        let charter: string | null = null;
        if (projectId) {
          const project = db
            .select()
            .from(schema.projects)
            .where(eq(schema.projects.id, projectId))
            .get();
          charter = project?.charter ?? null;
        }
        coo.startNewConversation(conversationId, projectId, charter);
        io.emit("conversation:created", conversation);
      } else {
        // Update the conversation's updatedAt
        db.update(schema.conversations)
          .set({ updatedAt: new Date().toISOString() })
          .where(eq(schema.conversations.id, conversationId))
          .run();
      }

      const message = bus.send({
        fromAgentId: null, // CEO
        toAgentId: "coo",
        type: MessageType.Chat,
        content: data.content,
        conversationId,
        metadata: projectId ? { projectId } : undefined,
      });

      if (callback) {
        callback({ messageId: message.id, conversationId });
      }
    });

    // CEO starts a new chat (reset COO conversation)
    socket.on("ceo:new-chat", (callback) => {
      coo.resetConversation();
      if (callback) {
        callback({ ok: true });
      }
    });

    // List conversations (optionally filtered by projectId)
    socket.on("ceo:list-conversations", (data, callback) => {
      const db = getDb();
      const projectId = data?.projectId;
      let conversations;
      if (projectId) {
        conversations = db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.projectId, projectId))
          .orderBy(desc(schema.conversations.updatedAt))
          .all();
      } else {
        // Global conversations only (no project)
        conversations = db
          .select()
          .from(schema.conversations)
          .where(isNull(schema.conversations.projectId))
          .orderBy(desc(schema.conversations.updatedAt))
          .all();
      }
      callback(conversations as Conversation[]);
    });

    // Load a specific conversation
    socket.on("ceo:load-conversation", (data, callback) => {
      const db = getDb();
      const messages = bus.getConversationMessages(data.conversationId);
      // Look up conversation to get projectId and charter
      const conv = db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, data.conversationId))
        .get();
      let charter: string | null = null;
      const projectId = conv?.projectId ?? null;
      if (projectId) {
        const project = db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, projectId))
          .get();
        charter = project?.charter ?? null;
      }
      coo.loadConversation(data.conversationId, messages, projectId, charter);
      callback({ messages });
    });

    // Request registry entries
    socket.on("registry:list", (callback) => {
      const entries = registry.list();
      callback(entries);
    });

    // Inspect a specific agent
    socket.on("agent:inspect", (data, callback) => {
      const db = getDb();
      const agent = db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, data.agentId))
        .get();
      callback((agent as Agent | undefined) ?? null);
    });

    // List all projects
    socket.on("project:list", (callback) => {
      const db = getDb();
      const projects = db
        .select()
        .from(schema.projects)
        .orderBy(desc(schema.projects.createdAt))
        .all();
      callback(projects as unknown as Project[]);
    });

    // Get a single project
    socket.on("project:get", (data, callback) => {
      const db = getDb();
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, data.projectId))
        .get();
      callback((project as unknown as Project) ?? null);
    });

    // Enter a project (returns project + conversations + tasks)
    socket.on("project:enter", (data, callback) => {
      const db = getDb();
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, data.projectId))
        .get();
      if (!project) {
        callback({ project: null as any, conversations: [], tasks: [] });
        return;
      }
      const conversations = db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.projectId, data.projectId))
        .orderBy(desc(schema.conversations.updatedAt))
        .all();
      const tasks = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, data.projectId))
        .all();
      callback({
        project: project as unknown as Project,
        conversations: conversations as Conversation[],
        tasks: tasks as unknown as KanbanTask[],
      });
    });

    // List conversations for a project
    socket.on("project:conversations", (data, callback) => {
      const db = getDb();
      const conversations = db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.projectId, data.projectId))
        .orderBy(desc(schema.conversations.updatedAt))
        .all();
      callback(conversations as Conversation[]);
    });

    // Recover a stuck project (tear down old TL + workers, spawn fresh one)
    socket.on("project:recover", async (data, callback) => {
      const result = await coo.recoverLiveProject(data.projectId);
      callback?.(result);
    });

    // Delete a project (cascading cleanup)
    socket.on("project:delete", (data, callback) => {
      const db = getDb();
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, data.projectId))
        .get();
      if (!project) {
        callback?.({ ok: false, error: "Project not found" });
        return;
      }

      // Stop running agents and remove workspace
      coo.destroyProject(data.projectId);

      // Clear conversation contexts that reference this project
      coo.clearProjectConversations(data.projectId);

      // Cascade-delete related DB records
      db.delete(schema.kanbanTasks).where(eq(schema.kanbanTasks.projectId, data.projectId)).run();
      db.delete(schema.agentActivity).where(eq(schema.agentActivity.projectId, data.projectId)).run();
      db.delete(schema.messages).where(eq(schema.messages.projectId, data.projectId)).run();
      db.delete(schema.conversations).where(eq(schema.conversations.projectId, data.projectId)).run();
      db.delete(schema.agents).where(eq(schema.agents.projectId, data.projectId)).run();
      db.delete(schema.projects).where(eq(schema.projects.id, data.projectId)).run();

      // Broadcast deletion
      io.emit("project:deleted", { projectId: data.projectId });

      callback?.({ ok: true });
    });

    // Manual project creation (GitHub-linked or local-only)
    socket.on("project:create-manual", async (data, callback) => {
      try {
        const workspace = deps?.workspace;
        if (!workspace) {
          callback?.({ ok: false, error: "Workspace not available." });
          return;
        }

        const hasGithubRepo = !!data.githubRepo?.trim();

        if (hasGithubRepo) {
          // --- GitHub-linked path ---
          const ghToken = getConfig("github:token");
          const ghUsername = getConfig("github:username");
          if (!ghToken || !ghUsername) {
            callback?.({ ok: false, error: "GitHub is not configured. Set up your PAT and username in Settings first." });
            return;
          }

          if (!data.githubRepo!.includes("/")) {
            callback?.({ ok: false, error: "Invalid repo format. Use 'owner/repo'." });
            return;
          }

          let branch = data.githubBranch?.trim();
          if (!branch) {
            try {
              branch = await getRepoDefaultBranch(data.githubRepo!, ghToken);
            } catch {
              branch = "main";
            }
          }

          const name = data.name?.trim() || data.githubRepo!.split("/")[1] || data.githubRepo!;
          const description = data.description?.trim() || `GitHub project: ${data.githubRepo}`;
          const rules = data.rules ?? [];
          const issueMonitor = data.issueMonitor ?? false;

          const projectId = makeProjectId(name);
          const db = getDb();

          db.insert(schema.projects)
            .values({
              id: projectId,
              name,
              description,
              status: ProjectStatus.Active,
              charter: null,
              charterStatus: CharterStatus.Gathering,
              githubRepo: data.githubRepo!,
              githubBranch: branch,
              githubIssueMonitor: issueMonitor,
              rules,
              createdAt: new Date().toISOString(),
            })
            .run();

          workspace.createProject(projectId);

          const repoPath = workspace.repoPath(projectId);
          try {
            cloneRepo(data.githubRepo!, repoPath, branch);
          } catch (cloneErr) {
            try { rmSync(workspace.projectPath(projectId), { recursive: true, force: true }); } catch { /* best effort */ }
            db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
            const errMsg = cloneErr instanceof Error ? cloneErr.message : String(cloneErr);
            callback?.({ ok: false, error: `Failed to clone repository: ${errMsg}` });
            return;
          }

          setConfig(`project:${projectId}:github:repo`, data.githubRepo!);
          setConfig(`project:${projectId}:github:branch`, branch);
          setConfig(`project:${projectId}:github:rules`, JSON.stringify(rules));

          await coo.spawnTeamLeadForManualProject(projectId, data.githubRepo!, branch, rules);

          const project = db
            .select()
            .from(schema.projects)
            .where(eq(schema.projects.id, projectId))
            .get();
          if (project) {
            io.emit("project:created", project as unknown as Project);
          }

          if (deps?.issueMonitor) {
            deps.issueMonitor.watchProject(projectId, data.githubRepo!, ghUsername);
          }

          callback?.({ ok: true, projectId });
        } else {
          // --- Local-only path (no GitHub repo) ---
          const name = data.name?.trim();
          if (!name) {
            callback?.({ ok: false, error: "Project name is required when no GitHub repo is provided." });
            return;
          }

          const description = data.description?.trim() || `Local project: ${name}`;
          const rules = data.rules ?? [];

          const projectId = makeProjectId(name);
          const db = getDb();

          db.insert(schema.projects)
            .values({
              id: projectId,
              name,
              description,
              status: ProjectStatus.Active,
              charter: null,
              charterStatus: CharterStatus.Gathering,
              githubRepo: null,
              githubBranch: null,
              githubIssueMonitor: false,
              rules,
              createdAt: new Date().toISOString(),
            })
            .run();

          workspace.createProject(projectId);

          // Initialize local git repo instead of cloning
          const repoPath = workspace.repoPath(projectId);
          initGitRepo(repoPath);
          createInitialCommit(repoPath);

          setConfig(`project:${projectId}:github:rules`, JSON.stringify(rules));

          await coo.spawnTeamLeadForManualProject(projectId, null, null, rules);

          const project = db
            .select()
            .from(schema.projects)
            .where(eq(schema.projects.id, projectId))
            .get();
          if (project) {
            io.emit("project:created", project as unknown as Project);
          }

          callback?.({ ok: true, projectId });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[project:create-manual] Error:", err);
        callback?.({ ok: false, error: errMsg });
      }
    });

    // Stop a running agent (worker or team lead)
    socket.on("agent:stop", (data, callback) => {
      console.log(`[Socket] agent:stop received for ${data.agentId}`);
      const result = coo.stopAgent(data.agentId);
      callback?.({ ok: result, error: result ? undefined : "Agent not found" });
    });

    // Get per-project agent assignments
    socket.on("project:get-agent-assignments", (data, callback) => {
      const raw = getConfig(`project:${data.projectId}:agent-assignments`);
      try {
        callback(raw ? JSON.parse(raw) : {});
      } catch {
        callback({});
      }
    });

    // Set per-project agent assignments
    socket.on("project:set-agent-assignments", (data, callback) => {
      const allowedAgentIds = new Set([
        "builtin-coder",
        "builtin-opencode-coder",
        "builtin-claude-code-coder",
        "builtin-codex-coder",
        "builtin-gemini-cli-coder",
      ]);

      // Validate all agent IDs
      for (const [role, agentId] of Object.entries(data.assignments)) {
        if (agentId && !allowedAgentIds.has(agentId)) {
          callback?.({ ok: false, error: `Invalid agent ID "${agentId}" for role "${role}"` });
          return;
        }
      }

      // Remove empty assignments, then persist
      const cleaned: Record<string, string> = {};
      for (const [role, agentId] of Object.entries(data.assignments)) {
        if (agentId) cleaned[role] = agentId;
      }

      if (Object.keys(cleaned).length === 0) {
        // No assignments — delete the key
        deleteConfig(`project:${data.projectId}:agent-assignments`);
      } else {
        setConfig(`project:${data.projectId}:agent-assignments`, JSON.stringify(cleaned));
      }

      callback?.({ ok: true });
    });

    // Get per-project pipeline configuration
    socket.on("project:get-pipeline-config", (data, callback) => {
      const raw = getConfig(`project:${data.projectId}:pipeline-config`);
      try {
        callback(raw ? JSON.parse(raw) : null);
      } catch {
        callback(null);
      }
    });

    // Set per-project pipeline configuration
    socket.on("project:set-pipeline-config", (data, callback) => {
      try {
        setConfig(
          `project:${data.projectId}:pipeline-config`,
          JSON.stringify(data.config),
        );
        callback?.({ ok: true });
      } catch (err) {
        callback?.({ ok: false, error: err instanceof Error ? err.message : "Failed to save" });
      }
    });

    // Get target branch for a project
    socket.on("project:get-branch", (data, callback) => {
      const configBranch = getConfig(`project:${data.projectId}:github:branch`);
      if (configBranch) {
        callback({ branch: configBranch });
        return;
      }
      // Fall back to DB column
      const db = getDb();
      const project = db
        .select({ githubBranch: schema.projects.githubBranch })
        .from(schema.projects)
        .where(eq(schema.projects.id, data.projectId))
        .get();
      callback({ branch: project?.githubBranch ?? null });
    });

    // Set target branch for a project
    socket.on("project:set-branch", (data, callback) => {
      try {
        const branch = data.branch.trim();
        if (!branch) {
          callback?.({ ok: false, error: "Branch name cannot be empty" });
          return;
        }
        // Update config key (used at runtime by pipeline consumers)
        setConfig(`project:${data.projectId}:github:branch`, branch);
        // Update DB column to keep in sync
        const db = getDb();
        db.update(schema.projects)
          .set({ githubBranch: branch })
          .where(eq(schema.projects.id, data.projectId))
          .run();
        // Emit project:updated so UI refreshes
        const updated = db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, data.projectId))
          .get();
        if (updated) {
          io.emit("project:updated", updated as any);
        }
        callback?.({ ok: true });
      } catch (err) {
        callback?.({ ok: false, error: err instanceof Error ? err.message : "Failed to save branch" });
      }
    });

    // Retrieve agent activity (bus messages + persisted activity records)
    socket.on("agent:activity", (data, callback) => {
      const db = getDb();

      // Bus messages involving this agent
      const busMessages = db
        .select()
        .from(schema.messages)
        .where(
          or(
            eq(schema.messages.fromAgentId, data.agentId),
            eq(schema.messages.toAgentId, data.agentId),
          ),
        )
        .orderBy(desc(schema.messages.timestamp))
        .limit(50)
        .all();

      // Persisted activity records
      const activity = db
        .select()
        .from(schema.agentActivity)
        .where(eq(schema.agentActivity.agentId, data.agentId))
        .orderBy(desc(schema.agentActivity.timestamp))
        .limit(50)
        .all();

      callback({
        messages: busMessages.reverse() as BusMessage[],
        activity: activity.reverse() as unknown as AgentActivityRecord[],
      });
    });

    // ─── Soul Document CRUD ───────────────────────────────────────
    const soulService = new SoulService();

    socket.on("soul:list", (callback) => {
      callback(soulService.list());
    });

    socket.on("soul:get", (data, callback) => {
      callback(soulService.get(data.agentRole, data.registryEntryId));
    });

    socket.on("soul:save", (data, callback) => {
      try {
        const doc = soulService.save(data.agentRole, data.registryEntryId ?? null, data.content);
        callback?.({ ok: true, doc });
      } catch (err) {
        callback?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on("soul:delete", (data, callback) => {
      const ok = soulService.delete(data.id);
      callback?.({ ok });
    });

    // ─── Memory CRUD ────────────────────────────────────────────
    const memoryService = new MemoryService();

    socket.on("memory:list", (data, callback) => {
      const memories = memoryService.list(data ? {
        category: data.category as any,
        agentScope: data.agentScope,
        projectId: data.projectId,
        search: data.search,
      } : undefined);
      callback?.(memories);
    });

    socket.on("memory:save", (data, callback) => {
      try {
        const memory = memoryService.save({
          id: data.id,
          category: data.category as any,
          content: data.content,
          source: (data.source as any) ?? "user",
          agentScope: data.agentScope,
          projectId: data.projectId,
          importance: data.importance,
        });
        callback?.({ ok: true, memory });
      } catch (err) {
        callback?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on("memory:delete", (data, callback) => {
      const ok = memoryService.delete(data.id);
      callback?.({ ok });
    });

    socket.on("memory:clear-all", (callback) => {
      try {
        const deleted = memoryService.clearAll();
        // Also clear COO conversation contexts so the LLM doesn't reference stale data
        coo.clearAllConversations();
        callback?.({ ok: true, deleted });
      } catch (err) {
        callback?.({ ok: false, deleted: 0, error: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on("memory:search", async (data, callback) => {
      const memories = await memoryService.searchWithVectors({
        query: data.query,
        agentScope: data.agentScope,
        projectId: data.projectId,
        limit: data.limit,
      });
      callback(memories);
    });

    // ─── Soul Advisor ───────────────────────────────────────────
    socket.on("soul:suggest", async (callback) => {
      try {
        const advisor = new SoulAdvisor();
        const suggestions = await advisor.analyze();
        callback({ ok: true, suggestions });
      } catch (err) {
        callback({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    // ─── Terminal events (PTY sessions) ──────────────────────────
    socket.on("terminal:input", (data, callback) => {
      const client = activePtySessions.get(data.agentId);
      if (client) {
        client.writeInput(data.data);
        callback?.({ ok: true });
      } else {
        callback?.({ ok: false, error: "No active PTY session" });
      }
    });

    socket.on("terminal:resize", (data, callback) => {
      const client = activePtySessions.get(data.agentId);
      if (client) {
        client.resize(data.cols, data.rows);
        callback?.({ ok: true });
      } else {
        callback?.({ ok: false, error: "No active PTY session" });
      }
    });

    socket.on("terminal:subscribe", (data, callback) => {
      const client = activePtySessions.get(data.agentId);
      if (client) {
        const replay = client.getReplayBuffer();
        if (replay) {
          socket.emit("terminal:replay", { agentId: data.agentId, data: replay });
        }
        callback?.({ ok: true });
      } else {
        // Check in-memory completed buffers first, then fall back to DB
        let replayBuffer = completedPtyBuffers.get(data.agentId);
        if (!replayBuffer) {
          // Look up persisted terminal buffer from DB
          try {
            const db = getDb();
            const row = db.select({ terminalBuffer: schema.codingAgentSessions.terminalBuffer })
              .from(schema.codingAgentSessions)
              .where(eq(schema.codingAgentSessions.agentId, data.agentId))
              .orderBy(desc(schema.codingAgentSessions.startedAt))
              .get();
            console.log(`[terminal:subscribe] DB lookup for ${data.agentId}: buffer=${row?.terminalBuffer ? `${row.terminalBuffer.length} chars` : "null"}`);
            if (row?.terminalBuffer) {
              replayBuffer = row.terminalBuffer;
              // Cache in memory for subsequent requests
              completedPtyBuffers.set(data.agentId, replayBuffer);
            }
          } catch (err) {
            console.error("[terminal:subscribe] DB lookup failed:", err);
          }
        }
        if (replayBuffer) {
          socket.emit("terminal:replay", { agentId: data.agentId, data: replayBuffer });
          callback?.({ ok: true });
        } else {
          callback?.({ ok: false, error: "No active PTY session" });
        }
      }
    });

    socket.on("terminal:end", (data, callback) => {
      const client = activePtySessions.get(data.agentId);
      if (client) {
        // Gracefully terminate the process (typing /exit doesn't work reliably
        // because Claude Code's REPL autocomplete intercepts the input)
        client.gracefulExit();
        callback?.({ ok: true });
      } else {
        callback?.({ ok: false, error: "No active PTY session" });
      }
    });

    // ─── Merge queue handlers ───────────────────────────────────────
    if (deps?.mergeQueue) {
      const mq = deps.mergeQueue;

      socket.on("merge-queue:approve", (data, callback) => {
        try {
          const entry = mq.approveForMerge(data.taskId);
          if (entry) {
            callback?.({ ok: true, entry });
          } else {
            callback?.({ ok: false, error: "Task not eligible for merge queue (missing PR number or branch)" });
          }
        } catch (err) {
          callback?.({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
        }
      });

      socket.on("merge-queue:remove", (data, callback) => {
        const removed = mq.removeFromQueue(data.taskId);
        callback?.({ ok: removed, error: removed ? undefined : "Task not found in queue" });
      });

      socket.on("merge-queue:list", (data, callback) => {
        const entries = mq.getQueue(data?.projectId);
        callback?.(entries);
      });

      socket.on("merge-queue:reorder", (data, callback) => {
        const reordered = mq.reorderEntry(data.entryId, data.newPosition);
        callback?.({ ok: reordered, error: reordered ? undefined : "Entry not found" });
      });
    }

    // ─── SSH session events ────────────────────────────────────
    socket.on("ssh:connect", async (data, callback) => {
      try {
        const { SshService } = await import("../ssh/ssh-service.js");
        const { SshPtyClient } = await import("../ssh/ssh-pty-client.js");
        const sshService = new SshService();

        // Validate key and host
        const key = sshService.get(data.keyId);
        if (!key) {
          callback?.({ ok: false, error: "SSH key not found" });
          return;
        }

        const hostCheck = sshService.validateHost(data.keyId, data.host);
        if (!hostCheck.ok) {
          callback?.({ ok: false, error: hostCheck.error });
          return;
        }

        // Create session record
        const sessionId = sshService.createSession({
          sshKeyId: data.keyId,
          host: data.host,
          initiatedBy: "user",
        });

        // Use sessionId as the agentId key for PTY routing
        const agentId = `ssh-${sessionId}`;

        const ptyClient = new SshPtyClient({
          keyId: data.keyId,
          host: data.host,
          sshService,
          onData: (chunk) => {
            io.emit("terminal:data", { agentId, data: chunk });
          },
          onExit: (exitCode) => {
            unregisterPtySession(agentId);
            const status = exitCode === 0 ? "completed" : "error";
            const buffer = ptyClient.getReplayBuffer();
            sshService.updateSession(sessionId, {
              status,
              completedAt: new Date().toISOString(),
              terminalBuffer: buffer || undefined,
            });
            io.emit("ssh:session-end", { sessionId, agentId, status });
          },
        });

        await ptyClient.connect();
        registerPtySession(agentId, ptyClient);

        io.emit("ssh:session-start", {
          sessionId,
          keyId: data.keyId,
          host: data.host,
          username: key.username,
          agentId,
        });

        callback?.({ ok: true, sessionId, agentId });
      } catch (err) {
        callback?.({ ok: false, error: err instanceof Error ? err.message : "Failed to connect" });
      }
    });

    socket.on("ssh:disconnect", async (data, callback) => {
      try {
        const { SshService } = await import("../ssh/ssh-service.js");
        const sshService = new SshService();

        const agentId = `ssh-${data.sessionId}`;
        const client = activePtySessions.get(agentId);
        if (client) {
          client.gracefulExit();
          // The onExit handler in ssh:connect will handle cleanup
          callback?.({ ok: true });
        } else {
          // Session may have already ended — just update DB
          sshService.updateSession(data.sessionId, {
            status: "completed",
            completedAt: new Date().toISOString(),
          });
          callback?.({ ok: true });
        }
      } catch (err) {
        callback?.({ ok: false, error: err instanceof Error ? err.message : "Failed to disconnect" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

/** Emit agent lifecycle events to all clients */
export function emitAgentSpawned(
  io: TypedServer,
  agent: BaseAgent,
) {
  io.emit("agent:spawned", agent.toData());
}

export function emitAgentStatus(
  io: TypedServer,
  agentId: string,
  status: string,
) {
  io.emit("agent:status", { agentId, status: status as any });
}

export function emitAgentDestroyed(io: TypedServer, agentId: string) {
  io.emit("agent:destroyed", { agentId });
}

export function emitCooStream(
  io: TypedServer,
  token: string,
  messageId: string,
  conversationId: string | null,
) {
  io.emit("coo:stream", { token, messageId, conversationId });
}

export function emitCooThinking(
  io: TypedServer,
  token: string,
  messageId: string,
  conversationId: string | null,
) {
  io.emit("coo:thinking", { token, messageId, conversationId });
}

export function emitCooThinkingEnd(io: TypedServer, messageId: string, conversationId: string | null) {
  io.emit("coo:thinking-end", { messageId, conversationId });
}

export function emitProjectCreated(io: TypedServer, project: Project) {
  io.emit("project:created", project);
}

export function emitProjectUpdated(io: TypedServer, project: Project) {
  io.emit("project:updated", project);
}

export function emitProjectDeleted(io: TypedServer, projectId: string) {
  io.emit("project:deleted", { projectId });
}

export function emitKanbanTaskCreated(io: TypedServer, task: KanbanTask) {
  io.emit("kanban:task-created", task);
}

export function emitKanbanTaskUpdated(io: TypedServer, task: KanbanTask) {
  io.emit("kanban:task-updated", task);
}

export function emitKanbanTaskDeleted(io: TypedServer, taskId: string, projectId: string) {
  io.emit("kanban:task-deleted", { taskId, projectId });
}

export function emitTodoCreated(io: TypedServer, todo: Todo) {
  io.emit("todo:created", todo);
}

export function emitTodoUpdated(io: TypedServer, todo: Todo) {
  io.emit("todo:updated", todo);
}

export function emitTodoDeleted(io: TypedServer, todoId: string) {
  io.emit("todo:deleted", { todoId });
}

export function emitAgentStream(io: TypedServer, agentId: string, token: string, messageId: string) {
  io.emit("agent:stream", { agentId, token, messageId });
}

export function emitAgentThinking(io: TypedServer, agentId: string, token: string, messageId: string) {
  io.emit("agent:thinking", { agentId, token, messageId });
}

export function emitAgentThinkingEnd(io: TypedServer, agentId: string, messageId: string) {
  io.emit("agent:thinking-end", { agentId, messageId });
}

export function emitAgentToolCall(io: TypedServer, agentId: string, toolName: string, args: Record<string, unknown>) {
  io.emit("agent:tool-call", { agentId, toolName, args });
}

/**
 * Parse and emit coding agent SSE events as structured Socket.IO events.
 * Handles internal __session-start/__session-end markers plus raw events.
 */
export function emitCodingAgentEvent(
  io: TypedServer,
  agentId: string,
  sessionId: string,
  event: { type: string; properties: Record<string, unknown> },
) {
  const { type, properties } = event;

  // Internal markers emitted by Worker
  if (type === "__session-start") {
    const now = new Date().toISOString();
    const agentType = (properties.agentType as CodingAgentType) || "opencode";
    const session: CodingAgentSession = {
      id: sessionId,
      agentId,
      projectId: (properties.projectId as string) || null,
      task: (properties.task as string) || "",
      agentType,
      status: "active",
      startedAt: now,
    };
    io.emit("codeagent:session-start", session);

    // Persist session row
    try {
      const db = getDb();
      const rowId = nanoid();
      db.insert(schema.codingAgentSessions)
        .values({
          id: rowId,
          agentId,
          sessionId: sessionId || "",
          projectId: session.projectId,
          task: session.task,
          agentType,
          status: "active",
          startedAt: now,
        })
        .run();
      sessionRowIds.set(agentId, rowId);
    } catch (err) {
      console.error("Failed to persist coding agent session:", err);
    }
    return;
  }

  if (type === "__awaiting-input") {
    io.emit("codeagent:awaiting-input", {
      agentId,
      sessionId,
      prompt: (properties.prompt as string) || "",
    });
    return;
  }

  if (type === "__permission-request") {
    const permission = properties.permission as { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> } | undefined;
    if (permission) {
      io.emit("codeagent:permission-request", {
        agentId,
        sessionId,
        permission,
      });
    }
    return;
  }

  if (type === "__session-end") {
    const rawDiff = properties.diff as Array<{ path: string; additions: number; deletions: number }> | null;
    const endStatus = (properties.status as string) || "completed";
    io.emit("codeagent:session-end", {
      agentId,
      sessionId,
      status: endStatus,
      diff: rawDiff?.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })) ?? null,
    });

    // Persist session end + diffs
    try {
      const db = getDb();
      const rowId = sessionRowIds.get(agentId);
      if (rowId) {
        // Save terminal buffer from PTY sessions for replay after restart
        const terminalBuffer = completedPtyBuffers.get(agentId) ?? null;
        console.log(`[session-end] Saving terminal buffer for ${agentId}: ${terminalBuffer ? `${terminalBuffer.length} chars` : "null"}`);

        db.update(schema.codingAgentSessions)
          .set({
            status: endStatus as CodingAgentSession["status"],
            completedAt: new Date().toISOString(),
            sessionId: sessionId || undefined,
            terminalBuffer,
          })
          .where(eq(schema.codingAgentSessions.id, rowId))
          .run();

        // Insert diff rows
        const resolvedSessionId = sessionId || db.select().from(schema.codingAgentSessions).where(eq(schema.codingAgentSessions.id, rowId)).get()?.sessionId || "";
        if (rawDiff) {
          for (const f of rawDiff) {
            db.insert(schema.codingAgentDiffs)
              .values({
                id: nanoid(),
                sessionId: resolvedSessionId,
                path: f.path,
                additions: f.additions,
                deletions: f.deletions,
              })
              .run();
          }
        }

        sessionRowIds.delete(agentId);
      }

      // Clean up serverPartBuffers for this agent
      for (const key of serverPartBuffers.keys()) {
        if (key.startsWith(`${agentId}:`)) {
          serverPartBuffers.delete(key);
        }
      }
    } catch (err) {
      console.error("Failed to persist coding agent session end:", err);
    }
    return;
  }

  // Forward raw event for debugging / generic listeners
  io.emit("codeagent:event", { agentId, sessionId, type, properties });

  // Parse specific event types into structured events

  // Handle streaming deltas — message.part.delta carries incremental text chunks
  // Shape: { sessionID, messageID, partID, field: "text"|"reasoning"|..., delta: "chunk" }
  if (type === "message.part.delta") {
    const delta = properties.delta as string | undefined;
    const partId = (properties.partID || "") as string;
    const messageId = (properties.messageID || "") as string;
    // "field" indicates which part field is being streamed (text, reasoning, etc.)
    const field = (properties.field || "text") as string;
    // Map field names to our part types
    const partType = field === "reasoning" ? "reasoning" : "text";

    if (delta && partId && messageId) {
      io.emit("codeagent:part-delta", {
        agentId,
        sessionId,
        messageId,
        partId,
        type: partType,
        delta,
        toolName: undefined,
        toolState: undefined,
      });

      // Accumulate into server-side buffer
      const bufKey = `${agentId}:${messageId}:${partId}`;
      const existing = serverPartBuffers.get(bufKey);
      serverPartBuffers.set(bufKey, {
        type: partType,
        content: (existing?.content ?? "") + delta,
        toolName: existing?.toolName,
        toolState: existing?.toolState,
      });
    }
  }

  // SDK shape: EventMessagePartUpdated = { type, properties: { part: Part, delta?: string } }
  // Part has: id, sessionID, messageID, type, and type-specific fields.
  //
  // Two modes:
  // 1. properties.delta is present → incremental delta (append to buffer, emit as delta)
  // 2. properties.delta is absent → full snapshot in part.text / toolState.output
  //    Use replacement semantics to avoid doubling content already delivered via
  //    message.part.delta events. Only emit the portion the frontend hasn't seen.
  if (type === "message.part.updated") {
    const part = properties.part as Record<string, unknown> | undefined;
    const explicitDelta = properties.delta as string | undefined;

    if (part) {
      const partId = (part.id ?? "") as string;
      const messageId = (part.messageID ?? "") as string;
      const partType = (part.type ?? "text") as string;

      // Extract tool name from ToolPart (type: "tool")
      const toolName = (part.tool ?? "") as string;
      // ToolPart.state is an object { status, input, output, ... } — extract status string
      const toolStateObj = part.state as Record<string, unknown> | undefined;
      const toolState = (typeof toolStateObj === "object" && toolStateObj !== null)
        ? (toolStateObj.status as string | undefined)
        : undefined;

      if (partId && messageId) {
        const bufKey = `${agentId}:${messageId}:${partId}`;
        const existing = serverPartBuffers.get(bufKey);

        if (explicitDelta) {
          // Mode 1: explicit delta — append like message.part.delta does
          io.emit("codeagent:part-delta", {
            agentId,
            sessionId,
            messageId,
            partId,
            type: partType,
            delta: explicitDelta,
            toolName: toolName || undefined,
            toolState,
          });

          serverPartBuffers.set(bufKey, {
            type: partType,
            content: (existing?.content ?? "") + explicitDelta,
            toolName: toolName || existing?.toolName,
            toolState: toolState ?? existing?.toolState,
          });
        } else {
          // Mode 2: no explicit delta — part.text / tool output is a FULL snapshot
          let fullContent = "";
          if (typeof part.text === "string") {
            fullContent = part.text;
          }
          if (partType === "tool" && toolStateObj) {
            if (typeof toolStateObj.output === "string") {
              fullContent = toolStateObj.output;
            } else if (toolStateObj.input) {
              fullContent = JSON.stringify(toolStateObj.input);
            }
          }

          // Replace the buffer with the snapshot content, but keep existing
          // content if it's already longer (deltas may have delivered more)
          const newContent = (existing?.content && existing.content.length >= fullContent.length)
            ? existing.content
            : fullContent;

          serverPartBuffers.set(bufKey, {
            type: partType,
            content: newContent,
            toolName: toolName || existing?.toolName,
            toolState: toolState ?? existing?.toolState,
          });

          // Emit a part-delta ONLY for content the frontend hasn't seen yet
          const existingLen = existing?.content?.length ?? 0;
          if (fullContent.length > existingLen) {
            const missingDelta = fullContent.slice(existingLen);
            io.emit("codeagent:part-delta", {
              agentId,
              sessionId,
              messageId,
              partId,
              type: partType,
              delta: missingDelta,
              toolName: toolName || undefined,
              toolState,
            });
          } else if (toolState && toolState !== existing?.toolState) {
            // Tool state changed but no new content — emit empty delta for state update
            io.emit("codeagent:part-delta", {
              agentId,
              sessionId,
              messageId,
              partId,
              type: partType,
              delta: "",
              toolName: toolName || undefined,
              toolState,
            });
          }
        }
      }
    }
  }

  // SDK shape: EventMessageUpdated = { type, properties: { info: Message } }
  // Message = UserMessage | AssistantMessage (has role, id, sessionID, but NO parts)
  if (type === "message.updated") {
    const info = properties.info as Record<string, unknown> | undefined;

    if (info) {
      const msgId = (info.id ?? "") as string;
      const role = info.role as string | undefined;
      const msgSessionId = (info.sessionID ?? sessionId) as string;

      if (msgId && role) {
        // Build parts from accumulated serverPartBuffers so the full message includes them
        const accumulatedParts: CodingAgentPart[] = [];
        for (const [key, buf] of serverPartBuffers.entries()) {
          if (key.startsWith(`${agentId}:${msgId}:`)) {
            const partId = key.split(":").slice(2).join(":");
            accumulatedParts.push({
              id: partId,
              messageId: msgId,
              type: buf.type as CodingAgentPart["type"],
              content: buf.content,
              toolName: buf.toolName,
              toolState: buf.toolState as CodingAgentPart["toolState"],
            });
          }
        }

        const message: CodingAgentMessage = {
          id: msgId,
          sessionId: msgSessionId,
          role: role as "user" | "assistant",
          parts: accumulatedParts,
          createdAt: new Date().toISOString(),
        };
        io.emit("codeagent:message", { agentId, sessionId, message });

        // Persist message with accumulated parts to DB
        try {
          const db = getDb();
          const now = new Date().toISOString();
          // Upsert: try insert, on conflict update parts
          const existing = db.select().from(schema.codingAgentMessages).where(eq(schema.codingAgentMessages.id, msgId)).get();
          if (existing) {
            db.update(schema.codingAgentMessages)
              .set({ parts: accumulatedParts, sessionId: msgSessionId })
              .where(eq(schema.codingAgentMessages.id, msgId))
              .run();
          } else {
            db.insert(schema.codingAgentMessages)
              .values({
                id: msgId,
                sessionId: msgSessionId,
                agentId,
                role: role as "user" | "assistant",
                parts: accumulatedParts,
                createdAt: now,
              })
              .run();
          }

          // If this is the first event with a real sessionId, update session row
          if (msgSessionId) {
            const rowId = sessionRowIds.get(agentId);
            if (rowId) {
              const sessionRow = db.select().from(schema.codingAgentSessions).where(eq(schema.codingAgentSessions.id, rowId)).get();
              if (sessionRow && !sessionRow.sessionId) {
                db.update(schema.codingAgentSessions)
                  .set({ sessionId: msgSessionId })
                  .where(eq(schema.codingAgentSessions.id, rowId))
                  .run();
              }
            }
          }
        } catch (err) {
          console.error("Failed to persist coding agent message:", err);
        }
      }
    }
  }
}

/** @deprecated Use emitCodingAgentEvent instead */
export const emitOpenCodeEvent = emitCodingAgentEvent;

/** Emit raw terminal data from a PTY session to all connected clients */
export function emitTerminalData(io: TypedServer, agentId: string, data: string) {
  io.emit("terminal:data", { agentId, data });
}
