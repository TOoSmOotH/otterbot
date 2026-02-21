import type { Agent, AgentStatus, AgentActivityRecord } from "./agent.js";
import type { BusMessage, Conversation } from "./message.js";
import type { RegistryEntry, Project, ProjectAgentAssignments } from "./registry.js";
import type { KanbanTask } from "./kanban.js";
import type { SceneZone } from "./environment.js";
import type { CodingAgentSession, CodingAgentMessage, CodingAgentFileDiff, CodingAgentPermission } from "./coding-agent.js";

/** Events emitted from server to client */
export interface ServerToClientEvents {
  "agent:spawned": (agent: Agent) => void;
  "agent:status": (data: { agentId: string; status: AgentStatus }) => void;
  "agent:destroyed": (data: { agentId: string }) => void;
  "bus:message": (message: BusMessage) => void;
  "coo:response": (message: BusMessage) => void;
  "coo:stream": (data: { token: string; messageId: string; conversationId: string | null }) => void;
  "coo:thinking": (data: { token: string; messageId: string; conversationId: string | null }) => void;
  "coo:thinking-end": (data: { messageId: string; conversationId: string | null }) => void;
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
  "agent:move": (data: { agentId: string; fromZoneId: string | null; toZoneId: string | null }) => void;
  "world:zone-added": (data: { zone: SceneZone }) => void;
  "world:zone-removed": (data: { projectId: string }) => void;
  "admin-assistant:stream": (data: { token: string; messageId: string }) => void;
  "admin-assistant:thinking": (data: { token: string; messageId: string }) => void;
  "admin-assistant:thinking-end": (data: { messageId: string }) => void;
  "codeagent:session-start": (data: CodingAgentSession) => void;
  "codeagent:session-end": (data: { agentId: string; sessionId: string; status: string; diff: CodingAgentFileDiff[] | null }) => void;
  "codeagent:event": (data: { agentId: string; sessionId: string; type: string; properties: Record<string, unknown> }) => void;
  "codeagent:message": (data: { agentId: string; sessionId: string; message: CodingAgentMessage }) => void;
  "codeagent:part-delta": (data: { agentId: string; sessionId: string; messageId: string; partId: string; type: string; delta: string; toolName?: string; toolState?: string }) => void;
  "codeagent:awaiting-input": (data: { agentId: string; sessionId: string; prompt: string }) => void;
  "codeagent:permission-request": (data: { agentId: string; sessionId: string; permission: CodingAgentPermission }) => void;
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
  "project:recover": (
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
  "codeagent:respond": (
    data: { agentId: string; sessionId: string; content: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "codeagent:permission-respond": (
    data: { agentId: string; sessionId: string; permissionId: string; response: "once" | "always" | "reject" },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "project:create-manual": (
    data: {
      name: string;
      description: string;
      githubRepo: string;
      githubBranch?: string;
      rules?: string[];
      issueMonitor?: boolean;
    },
    callback?: (ack: { ok: boolean; projectId?: string; error?: string }) => void,
  ) => void;
  "agent:stop": (
    data: { agentId: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "project:get-agent-assignments": (
    data: { projectId: string },
    callback: (assignments: ProjectAgentAssignments) => void,
  ) => void;
  "project:set-agent-assignments": (
    data: { projectId: string; assignments: ProjectAgentAssignments },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
}
