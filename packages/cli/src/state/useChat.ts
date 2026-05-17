/** React hook that owns the chat socket and mirrors it into UI state. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamChunk } from "@otterbot/shared";
import { createSocket, type OtterSocket } from "../net/socket.js";
import type { ChatState, ConnectionState, UiMessage } from "../types.js";

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

/** Apply one stream chunk to the message list, returning a new array. */
function appendChunk(messages: UiMessage[], chunk: StreamChunk): UiMessage[] {
  const next = messages.slice();
  const last = next[next.length - 1];
  const pendingAssistant =
    last && last.kind === "assistant" && last.pending ? last : undefined;

  switch (chunk.kind) {
    case "token":
      if (pendingAssistant) {
        next[next.length - 1] = {
          ...pendingAssistant,
          text: pendingAssistant.text + chunk.text,
        };
      } else {
        next.push({
          kind: "assistant",
          id: nextId("a"),
          text: chunk.text,
          thinking: "",
          pending: true,
        });
      }
      return next;

    case "thinking":
      if (pendingAssistant) {
        next[next.length - 1] = {
          ...pendingAssistant,
          thinking: pendingAssistant.thinking + chunk.text,
        };
      } else {
        next.push({
          kind: "assistant",
          id: nextId("a"),
          text: "",
          thinking: chunk.text,
          pending: true,
        });
      }
      return next;

    case "tool_start":
      next.push({
        kind: "tool",
        id: `tool-${chunk.id}`,
        name: chunk.name,
        status: "running",
      });
      return next;

    case "tool_end": {
      const idx = next.findIndex((m) => m.id === `tool-${chunk.id}`);
      if (idx >= 0) {
        const tool = next[idx];
        if (tool.kind === "tool") {
          next[idx] = { ...tool, status: "done", summary: summarize(chunk.result) };
        }
      }
      return next;
    }

    case "error":
      if (pendingAssistant) {
        next[next.length - 1] = {
          ...pendingAssistant,
          error: chunk.message,
          pending: false,
        };
      } else {
        next.push({
          kind: "assistant",
          id: nextId("e"),
          text: "",
          thinking: "",
          pending: false,
          error: chunk.message,
        });
      }
      return next;

    default:
      return next;
  }
}

/** Compact a tool result into a single short line. */
function summarize(result: unknown): string | undefined {
  if (result == null) return undefined;
  const text = typeof result === "string" ? result : JSON.stringify(result);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? oneLine.slice(0, 79) + "…" : oneLine;
}

export interface UseChatResult extends ChatState {
  /** Send a message to the agent. No-op while a response is streaming. */
  send: (text: string) => void;
}

/** Connect to `serverUrl`, join `agentId`, and expose live chat state. */
export function useChat(serverUrl: string, agentId: string): UseChatResult {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<ChatState["agentStatus"]>("idle");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [streaming, setStreaming] = useState(false);
  const socketRef = useRef<OtterSocket | null>(null);

  useEffect(() => {
    const socket = createSocket(serverUrl);
    socketRef.current = socket;

    const join = () => socket.emit("chat:join", { agentId });

    socket.on("connect", () => {
      setConnection("online");
      join();
    });
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.io.on("reconnect_attempt", () => setConnection("reconnecting"));

    socket.on("chat:stream", ({ agentId: id, chunk }) => {
      if (id !== agentId) return;
      setMessages((prev) => appendChunk(prev, chunk));
    });

    socket.on("chat:done", ({ agentId: id }) => {
      if (id !== agentId) return;
      setStreaming(false);
      setMessages((prev) =>
        prev.map((m) => (m.kind === "assistant" && m.pending ? { ...m, pending: false } : m))
      );
    });

    socket.on("agent:status", ({ agentId: id, status }) => {
      if (id === agentId) setAgentStatus(status);
    });

    socket.connect();

    return () => {
      try {
        socket.emit("chat:close", { agentId });
      } catch {
        /* socket may already be closed */
      }
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl, agentId]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const socket = socketRef.current;
      if (!trimmed || !socket || streaming) return;
      setMessages((prev) => [...prev, { kind: "user", id: nextId("u"), text: trimmed }]);
      setStreaming(true);
      socket.emit("chat:message", { agentId, text: trimmed });
    },
    [agentId, streaming]
  );

  return { messages, agentStatus, connection, streaming, send };
}
