import type { Agent, AgentStatus } from "./agent.js";
import type { BusMessage, Conversation } from "./message.js";
import type { RegistryEntry } from "./registry.js";

/** Events emitted from server to client */
export interface ServerToClientEvents {
  "agent:spawned": (agent: Agent) => void;
  "agent:status": (data: { agentId: string; status: AgentStatus }) => void;
  "agent:destroyed": (data: { agentId: string }) => void;
  "bus:message": (message: BusMessage) => void;
  "coo:response": (message: BusMessage) => void;
  "coo:stream": (data: { token: string; messageId: string }) => void;
  "coo:audio": (data: { messageId: string; audio: string; contentType: string }) => void;
  "conversation:created": (conversation: Conversation) => void;
}

/** Events emitted from client to server */
export interface ClientToServerEvents {
  "ceo:message": (
    data: { content: string; conversationId?: string },
    callback?: (ack: { messageId: string; conversationId: string }) => void,
  ) => void;
  "ceo:new-chat": (
    callback?: (ack: { ok: boolean }) => void,
  ) => void;
  "ceo:list-conversations": (
    callback: (conversations: Conversation[]) => void,
  ) => void;
  "ceo:load-conversation": (
    data: { conversationId: string },
    callback: (result: { messages: BusMessage[] }) => void,
  ) => void;
  "registry:list": (
    callback: (entries: RegistryEntry[]) => void,
  ) => void;
  "agent:inspect": (
    data: { agentId: string },
    callback: (agent: Agent | null) => void,
  ) => void;
}
