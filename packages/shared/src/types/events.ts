import type { Agent, AgentStatus, AgentActivityRecord } from "./agent.js";
import type { BusMessage, Conversation } from "./message.js";
import type { RegistryEntry, Project } from "./registry.js";
import type { KanbanTask } from "./kanban.js";

/** Events emitted from server to client */
export interface ServerToClientEvents {
  "agent:spawned": (agent: Agent) => void;
  "agent:status": (data: { agentId: string; status: AgentStatus }) => void;
  "agent:destroyed": (data: { agentId: string }) => void;
  "bus:message": (message: BusMessage) => void;
  "coo:response": (message: BusMessage) => void;
  "coo:stream": (data: { token: string; messageId: string }) => void;
  "coo:thinking": (data: { token: string; messageId: string }) => void;
  "coo:thinking-end": (data: { messageId: string }) => void;
  "coo:audio": (data: { messageId: string; audio: string; contentType: string }) => void;
  "conversation:created": (conversation: Conversation) => void;
  "project:created": (project: Project) => void;
  "project:updated": (project: Project) => void;
  "project:deleted": (data: { projectId: string }) => void;
  "kanban:task-created": (task: KanbanTask) => void;
  "kanban:task-updated": (task: KanbanTask) => void;
  "kanban:task-deleted": (data: { taskId: string; projectId: string }) => void;
  "agent:stream": (data: { agentId: string; token: string; messageId: string }) => void;
  "agent:thinking": (data: { agentId: string; token: string; messageId: string }) => void;
  "agent:thinking-end": (data: { agentId: string; messageId: string }) => void;
  "agent:tool-call": (data: { agentId: string; toolName: string; args: Record<string, unknown> }) => void;
}

/** Events emitted from client to server */
export interface ClientToServerEvents {
  "ceo:message": (
    data: { content: string; conversationId?: string; projectId?: string },
    callback?: (ack: { messageId: string; conversationId: string }) => void,
  ) => void;
  "ceo:new-chat": (
    callback?: (ack: { ok: boolean }) => void,
  ) => void;
  "ceo:list-conversations": (
    data: { projectId?: string } | undefined,
    callback: (conversations: Conversation[]) => void,
  ) => void;
  "ceo:load-conversation": (
    data: { conversationId: string },
    callback: (result: { messages: BusMessage[] }) => void,
  ) => void;
  "project:list": (
    callback: (projects: Project[]) => void,
  ) => void;
  "project:get": (
    data: { projectId: string },
    callback: (project: Project | null) => void,
  ) => void;
  "project:enter": (
    data: { projectId: string },
    callback: (result: { project: Project; conversations: Conversation[]; tasks: KanbanTask[] }) => void,
  ) => void;
  "project:delete": (
    data: { projectId: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "project:conversations": (
    data: { projectId: string },
    callback: (conversations: Conversation[]) => void,
  ) => void;
  "registry:list": (
    callback: (entries: RegistryEntry[]) => void,
  ) => void;
  "agent:inspect": (
    data: { agentId: string },
    callback: (agent: Agent | null) => void,
  ) => void;
  "agent:activity": (
    data: { agentId: string },
    callback: (result: { messages: BusMessage[]; activity: AgentActivityRecord[] }) => void,
  ) => void;
}
