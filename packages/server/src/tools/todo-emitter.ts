import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, Todo } from "@otterbot/shared";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

let io: TypedServer | null = null;

export function setTodoEmitterIO(server: TypedServer) {
  io = server;
}

export function emitTodoEvent(event: "created" | "updated", todo: Todo): void;
export function emitTodoEvent(event: "deleted", data: { todoId: string }): void;
export function emitTodoEvent(event: "created" | "updated" | "deleted", data: Todo | { todoId: string }) {
  if (!io) return;
  switch (event) {
    case "created":
      io.emit("todo:created", data as Todo);
      break;
    case "updated":
      io.emit("todo:updated", data as Todo);
      break;
    case "deleted":
      io.emit("todo:deleted", data as { todoId: string });
      break;
  }
}
