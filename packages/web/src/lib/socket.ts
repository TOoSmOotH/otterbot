import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@smoothbot/shared";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;

export function getSocket(): TypedSocket {
  if (!socket) {
    socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    }) as TypedSocket;

    socket.on("connect_error", (err) => {
      if (err.message === "Authentication required") {
        // Session expired or invalid — reload to trigger auth check
        window.location.reload();
      }
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
