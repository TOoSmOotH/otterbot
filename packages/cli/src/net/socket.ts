/** Socket.IO client wired to the Otterbot chat event contract. */
import { io, type Socket } from "socket.io-client";
import type { StreamChunk, AgentStatus } from "@otterbot/shared";

/** Events the server emits to us. */
interface ServerToClient {
  "chat:joined": (p: { agentId: string; conversationId: string }) => void;
  "chat:stream": (p: { agentId: string; chunk: StreamChunk }) => void;
  "chat:done": (p: { agentId: string; conversationId: string }) => void;
  "agent:status": (p: { agentId: string; status: AgentStatus }) => void;
}

/** Events we emit to the server. */
interface ClientToServer {
  "chat:join": (p: { agentId?: string; conversationId?: string }) => void;
  "chat:message": (p: { agentId?: string; text: string }) => void;
  "chat:close": (p: { agentId?: string }) => void;
}

export type OtterSocket = Socket<ServerToClient, ClientToServer>;

/**
 * Create a (not-yet-connected) socket to the given server URL. The optional
 * token is sent in the Socket.IO handshake; without it, a server that has
 * auth enabled will reject the connection. Defaults to `OTTERBOT_API_TOKEN`
 * in the environment.
 */
export function createSocket(serverUrl: string, apiToken?: string): OtterSocket {
  const token = apiToken ?? process.env.OTTERBOT_API_TOKEN ?? "";
  return io(serverUrl, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    withCredentials: true,
    reconnection: true,
    autoConnect: false,
    auth: { token },
  });
}
