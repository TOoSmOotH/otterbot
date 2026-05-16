import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../../stores/chat-store";
import { useAgentsStore } from "../../stores/agents-store";
import { statusColor } from "../agents/agent-visual";

/** Per-agent chat panel, bound to the currently active agent. */
export function AgentChat({ onEditAgent }: { onEditAgent: (id: string) => void }) {
  const connect = useChatStore((s) => s.connect);
  const join = useChatStore((s) => s.join);
  const send = useChatStore((s) => s.send);
  const reset = useChatStore((s) => s.reset);
  const byAgent = useChatStore((s) => s.byAgent);
  const streamingMap = useChatStore((s) => s.streaming);

  const agents = useAgentsStore((s) => s.agents);
  const activeAgentId = useAgentsStore((s) => s.activeAgentId);
  const agent = agents.find((a) => a.id === activeAgentId) ?? null;

  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (activeAgentId) join(activeAgentId);
  }, [activeAgentId, join]);

  const messages = activeAgentId ? (byAgent[activeAgentId] ?? []) : [];
  const streaming = activeAgentId ? Boolean(streamingMap[activeAgentId]) : false;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, streaming]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming || !activeAgentId) return;
    send(activeAgentId, input);
    setInput("");
  };

  if (!agent || !activeAgentId) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "rgb(var(--muted))",
          fontSize: 14,
        }}
      >
        Select an agent to start chatting.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgb(var(--border))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2 style={{ fontSize: 13, margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          {agent.displayName}
          <span
            title={agent.status}
            style={{ width: 9, height: 9, borderRadius: "50%", background: statusColor(agent.status) }}
          />
        </h2>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => onEditAgent(agent.id)} style={btnStyle}>
            Edit
          </button>
          <button onClick={() => reset(activeAgentId)} style={btnStyle}>
            New session
          </button>
        </div>
      </header>

      <div
        ref={listRef}
        data-testid="message-list"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: "rgb(var(--muted))", fontSize: 13 }}>
            Say hello. {agent.displayName} remembers things across sessions.
          </div>
        )}
        {messages.map((m) =>
          m.role === "tool" ? (
            <div
              key={m.id}
              data-testid="message-tool"
              style={{
                alignSelf: "flex-start",
                fontSize: 11,
                color: "rgb(var(--muted))",
                fontStyle: "italic",
                padding: "2px 8px",
                border: "1px dashed rgb(var(--border))",
                borderRadius: 6,
              }}
            >
              {m.content}
            </div>
          ) : (
            <div
              key={m.id}
              data-testid={`message-${m.role}`}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                padding: "8px 12px",
                borderRadius: 10,
                background: m.role === "user" ? "rgb(var(--accent))" : "rgb(var(--border))",
                color: m.role === "user" ? "white" : "rgb(var(--fg))",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {m.content}
              {m.error && <div style={{ color: "#f87171", marginTop: 4 }}>Error: {m.error}</div>}
            </div>
          )
        )}
      </div>

      <form onSubmit={onSubmit} style={{ padding: 12, borderTop: "1px solid rgb(var(--border))" }}>
        <textarea
          data-testid="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e);
            }
          }}
          placeholder={streaming ? `${agent.displayName} is typing…` : `Message ${agent.displayName}…`}
          disabled={streaming}
          rows={2}
          style={{
            width: "100%",
            background: "rgb(var(--bg))",
            color: "rgb(var(--fg))",
            border: "1px solid rgb(var(--border))",
            borderRadius: 8,
            padding: 8,
            resize: "none",
            fontFamily: "inherit",
            fontSize: 14,
          }}
        />
      </form>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--muted))",
  border: "1px solid rgb(var(--border))",
  padding: "4px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};
