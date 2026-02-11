import type { Agent, AgentStatus } from "./agent.js";
import type { BusMessage } from "./message.js";
import type { RegistryEntry } from "./registry.js";

/** Events emitted from server to client */
export interface ServerToClientEvents {
  "agent:spawned": (agent: Agent) => void;
  "agent:status": (data: { agentId: string; status: AgentStatus }) => void;
  "agent:destroyed": (data: { agentId: string }) => void;
  "bus:message": (message: BusMessage) => void;
  "coo:response": (message: BusMessage) => void;
  "coo:stream": (data: { token: string; messageId: string }) => void;
}

/** Events emitted from client to server */
export interface ClientToServerEvents {
  "ceo:message": (
    data: { content: string },
    callback?: (ack: { messageId: string }) => void,
  ) => void;
  "registry:list": (
    callback: (entries: RegistryEntry[]) => void,
  ) => void;
  "agent:inspect": (
    data: { agentId: string },
    callback: (agent: Agent | null) => void,
  ) => void;
}
