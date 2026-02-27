import type { Agent, AgentStatus, AgentActivityRecord } from "./agent.js";
import type { BusMessage, Conversation } from "./message.js";
import type { RegistryEntry, Project, ProjectAgentAssignments, ProjectPipelineConfig } from "./registry.js";
import type { KanbanTask } from "./kanban.js";
import type { SceneZone } from "./environment.js";
import type { CodingAgentSession, CodingAgentMessage, CodingAgentFileDiff, CodingAgentPermission } from "./coding-agent.js";
import type { SoulDocument, Memory, MemoryEpisode, SoulSuggestion } from "./memory.js";
import type { Todo } from "./todo.js";
import type { MergeQueueEntry } from "./merge-queue.js";
import type { McpServerRuntime } from "./mcp-server.js";
import type { SshSessionStatus } from "./ssh.js";

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
  "conversation:switched": (data: { conversationId: string; messages: BusMessage[] }) => void;
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
  "terminal:data": (data: { agentId: string; data: string }) => void;
  "terminal:replay": (data: { agentId: string; data: string }) => void;
  "todo:created": (todo: Todo) => void;
  "todo:updated": (todo: Todo) => void;
  "todo:deleted": (data: { todoId: string }) => void;
  "reminder:fired": (data: { todoId: string; title: string }) => void;
  "discord:pairing-request": (data: { code: string; discordUserId: string; discordUsername: string }) => void;
  "discord:status": (data: { status: "connected" | "disconnected" | "error"; botUsername?: string }) => void;
  "matrix:pairing-request": (data: { code: string; matrixUserId: string; matrixUsername: string }) => void;
  "matrix:status": (data: { status: "connected" | "disconnected" | "error"; userId?: string }) => void;
  "irc:pairing-request": (data: { code: string; ircUserId: string; ircUsername: string }) => void;
  "irc:status": (data: { status: "connected" | "disconnected" | "error"; nickname?: string }) => void;
  "teams:pairing-request": (data: { code: string; teamsUserId: string; teamsUsername: string }) => void;
  "teams:status": (data: { status: "connected" | "disconnected" | "error" }) => void;
  "slack:pairing-request": (data: { code: string; slackUserId: string; slackUsername: string }) => void;
  "slack:status": (data: { status: "connected" | "disconnected" | "error"; botUsername?: string }) => void;
  "mattermost:pairing-request": (data: { code: string; mattermostUserId: string; mattermostUsername: string }) => void;
  "mattermost:status": (data: { status: "connected" | "disconnected" | "error"; botUsername?: string }) => void;
  "telegram:pairing-request": (data: { code: string; telegramUserId: string; telegramUsername: string }) => void;
  "telegram:status": (data: { status: "connected" | "disconnected" | "error"; botUsername?: string }) => void;
  "whatsapp:status": (data: { status: "connected" | "disconnected" | "qr" | "authenticated" | "auth_failure"; qr?: string }) => void;
  "signal:pairing-request": (data: { code: string; signalNumber: string }) => void;
  "signal:status": (data: { status: "connected" | "disconnected" | "error"; phoneNumber?: string }) => void;
  "nextcloud-talk:pairing-request": (data: { code: string; nextcloudUserId: string; nextcloudDisplayName: string }) => void;
  "nextcloud-talk:status": (data: { status: "connected" | "disconnected" | "error"; botUsername?: string }) => void;
  "merge-queue:updated": (data: { entries: MergeQueueEntry[] }) => void;
  "merge-queue:entry-updated": (entry: MergeQueueEntry) => void;
  "mcp:status": (runtime: McpServerRuntime) => void;
  "ssh:session-start": (data: { sessionId: string; keyId: string; host: string; username: string; agentId: string }) => void;
  "ssh:session-end": (data: { sessionId: string; agentId: string; status: SshSessionStatus }) => void;
  "ssh:chat-stream": (data: { sessionId: string; token: string; messageId: string }) => void;
  "ssh:chat-response": (data: { sessionId: string; messageId: string; content: string; command?: string }) => void;
  "ssh:chat-analyzing": (data: { sessionId: string; command: string }) => void;
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
  "ceo:cancel-tts": (
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
  "terminal:input": (
    data: { agentId: string; data: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "terminal:resize": (
    data: { agentId: string; cols: number; rows: number },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "terminal:subscribe": (
    data: { agentId: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "terminal:end": (
    data: { agentId: string },
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

  // Pipeline configuration
  "project:get-pipeline-config": (
    data: { projectId: string },
    callback: (config: ProjectPipelineConfig | null) => void,
  ) => void;
  "project:set-pipeline-config": (
    data: { projectId: string; config: ProjectPipelineConfig },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;

  // Soul document CRUD
  "soul:list": (
    callback: (docs: SoulDocument[]) => void,
  ) => void;
  "soul:get": (
    data: { agentRole: string; registryEntryId?: string | null },
    callback: (doc: SoulDocument | null) => void,
  ) => void;
  "soul:save": (
    data: { agentRole: string; registryEntryId?: string | null; content: string },
    callback?: (ack: { ok: boolean; doc?: SoulDocument; error?: string }) => void,
  ) => void;
  "soul:delete": (
    data: { id: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;

  // Memory CRUD
  "memory:list": (
    data?: { category?: string; agentScope?: string; projectId?: string; search?: string },
    callback?: (memories: Memory[]) => void,
  ) => void;
  "memory:save": (
    data: { id?: string; category: string; content: string; source?: string; agentScope?: string | null; projectId?: string | null; importance?: number },
    callback?: (ack: { ok: boolean; memory?: Memory; error?: string }) => void,
  ) => void;
  "memory:delete": (
    data: { id: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "memory:clear-all": (
    callback?: (ack: { ok: boolean; deleted: number; error?: string }) => void,
  ) => void;
  "memory:search": (
    data: { query: string; agentScope?: string; projectId?: string; limit?: number },
    callback: (memories: Memory[]) => void,
  ) => void;

  // Soul advisor
  "soul:suggest": (
    callback: (ack: { ok: boolean; suggestions?: SoulSuggestion[]; error?: string }) => void,
  ) => void;

  // Merge queue
  "merge-queue:approve": (
    data: { taskId: string },
    callback?: (ack: { ok: boolean; entry?: MergeQueueEntry; error?: string }) => void,
  ) => void;
  "merge-queue:remove": (
    data: { taskId: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "merge-queue:list": (
    data?: { projectId?: string },
    callback?: (entries: MergeQueueEntry[]) => void,
  ) => void;
  "merge-queue:reorder": (
    data: { entryId: string; newPosition: number },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;

  // Target branch
  "project:get-branch": (
    data: { projectId: string },
    callback: (result: { branch: string | null }) => void,
  ) => void;
  "project:set-branch": (
    data: { projectId: string; branch: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;

  // SSH sessions
  "ssh:connect": (
    data: { keyId: string; host: string },
    callback?: (ack: { ok: boolean; sessionId?: string; agentId?: string; error?: string }) => void,
  ) => void;
  "ssh:disconnect": (
    data: { sessionId: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
  "ssh:chat": (
    data: { sessionId: string; message: string },
    callback?: (ack: { ok: boolean; messageId?: string; error?: string }) => void,
  ) => void;
  "ssh:chat-confirm": (
    data: { sessionId: string; messageId: string; command: string },
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ) => void;
}
