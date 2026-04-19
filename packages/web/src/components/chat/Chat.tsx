import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../../stores/chat-store";

export function Chat() {
  const connect = useChatStore((s) => s.connect);
  const messages = useChatStore((s) => s.messages);
  const toolEvents = useChatStore((s) => s.toolEvents);
  const streaming = useChatStore((s) => s.streaming);
  const connected = useChatStore((s) => s.connected);
  const send = useChatStore((s) => s.send);
  const reset = useChatStore((s) => s.reset);

  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, streaming]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    send(input);
    setInput("");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid rgb(var(--border))",
      }}
    >
      <header
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgb(var(--border))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>
          otterbot
          <span
            data-testid="connection-status"
            style={{ marginLeft: 8, color: connected ? "#4ade80" : "#f87171" }}
          >
            {connected ? "●" : "○"}
          </span>
        </h1>
        <button
          onClick={reset}
          style={{
            background: "transparent",
            color: "rgb(var(--muted))",
            border: "1px solid rgb(var(--border))",
            padding: "4px 10px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          New session
        </button>
      </header>

      <div
        ref={listRef}
        data-testid="message-list"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: "rgb(var(--muted))", fontSize: 13 }}>
            Say hello. Anything you tell otterbot about yourself is remembered across sessions.
          </div>
        )}
        {messages.map((m) => (
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
        ))}
        {toolEvents.length > 0 && (
          <details
            data-testid="tool-events"
            style={{ fontSize: 11, color: "rgb(var(--muted))" }}
          >
            <summary>Tool calls ({toolEvents.length})</summary>
            {toolEvents.map((e) => (
              <div key={e.id}>
                {e.name} {e.result ? "✓" : "…"}
              </div>
            ))}
          </details>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        style={{ padding: 12, borderTop: "1px solid rgb(var(--border))" }}
      >
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
          placeholder={streaming ? "otterbot is typing…" : "Message otterbot…"}
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
