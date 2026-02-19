import type { Server, Socket } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@otterbot/shared";
import { MessageType, type Agent, type AgentActivityRecord, type BusMessage, type Conversation, type Project, type KanbanTask, type OpenCodeSession, type OpenCodeMessage, type OpenCodePart, type OpenCodeFileDiff } from "@otterbot/shared";
import { nanoid } from "nanoid";
import { eq, or, desc, isNull } from "drizzle-orm";
import type { MessageBus } from "../bus/message-bus.js";
import type { COO } from "../agents/coo.js";
import type { Registry } from "../registry/registry.js";
import type { BaseAgent } from "../agents/agent.js";
import { getDb, schema } from "../db/index.js";
import { isTTSEnabled, getConfiguredTTSProvider, stripMarkdown } from "../tts/tts.js";
import { getConfig } from "../auth/auth.js";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function setupSocketHandlers(
  io: TypedServer,
  bus: MessageBus,
  coo: COO,
  registry: Registry,
) {
  // Broadcast all bus messages to connected clients
  bus.onBroadcast(async (message: BusMessage) => {
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
 * Parse and emit OpenCode SSE events as structured Socket.IO events.
 * Handles internal __session-start/__session-end markers plus raw OpenCode events.
 */
export function emitOpenCodeEvent(
  io: TypedServer,
  agentId: string,
  sessionId: string,
  event: { type: string; properties: Record<string, unknown> },
) {
  const { type, properties } = event;

  // Internal markers emitted by Worker
  if (type === "__session-start") {
    const session: OpenCodeSession = {
      id: sessionId,
      agentId,
      projectId: (properties.projectId as string) || null,
      task: (properties.task as string) || "",
      status: "active",
      startedAt: new Date().toISOString(),
    };
    io.emit("opencode:session-start", session);
    return;
  }

  if (type === "__awaiting-input") {
    io.emit("opencode:awaiting-input", {
      agentId,
      sessionId,
      prompt: (properties.prompt as string) || "",
    });
    return;
  }

  if (type === "__session-end") {
    const rawDiff = properties.diff as Array<{ path: string; additions: number; deletions: number }> | null;
    io.emit("opencode:session-end", {
      agentId,
      sessionId,
      status: (properties.status as string) || "completed",
      diff: rawDiff?.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })) ?? null,
    });
    return;
  }

  // Forward raw event for debugging / generic listeners
  io.emit("opencode:event", { agentId, sessionId, type, properties });

  // Parse specific event types into structured events
  // SDK shape: EventMessagePartUpdated = { type, properties: { part: Part, delta?: string } }
  // Part has: id, sessionID, messageID, type, and type-specific fields
  if (type === "message.part.updated") {
    const part = properties.part as Record<string, unknown> | undefined;
    const delta = properties.delta as string | undefined;

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

      // Build delta text: use explicit delta if present, else extract from part type
      let deltaText = delta;
      if (!deltaText) {
        // For text/reasoning parts, use the text field as initial content
        if (typeof part.text === "string") {
          deltaText = part.text;
        }
        // For tool parts, stringify the input or output
        if (partType === "tool" && toolStateObj) {
          if (typeof toolStateObj.output === "string") {
            deltaText = toolStateObj.output;
          } else if (toolStateObj.input) {
            deltaText = JSON.stringify(toolStateObj.input);
          }
        }
      }

      if (deltaText && partId && messageId) {
        io.emit("opencode:part-delta", {
          agentId,
          sessionId,
          messageId,
          partId,
          type: partType,
          delta: deltaText,
          toolName: toolName || undefined,
          toolState,
        });
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
        // message.updated carries message metadata, not parts — emit with empty parts
        const message: OpenCodeMessage = {
          id: msgId,
          sessionId: msgSessionId,
          role: role as "user" | "assistant",
          parts: [],
          createdAt: new Date().toISOString(),
        };
        io.emit("opencode:message", { agentId, sessionId, message });
      }
    }
  }
}
