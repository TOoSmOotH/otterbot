import { useEffect } from "react";
import { useChatStore } from "../../stores/chat-store";

/** Compact relative-time label, e.g. "3m", "2h", "5d". */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/** Browsable list of an agent's past conversations. Selecting one resumes it. */
export function ConversationList({ agentId }: { agentId: string }) {
  const conversations = useChatStore((s) => s.conversations[agentId] ?? []);
  const current = useChatStore((s) => s.currentConversation[agentId] ?? null);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const openConversation = useChatStore((s) => s.openConversation);
  const newConversation = useChatStore((s) => s.newConversation);

  useEffect(() => {
    void loadConversations(agentId);
  }, [agentId, loadConversations]);

  return (
    <div
      data-testid="conversation-list"
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: "1px solid rgb(var(--border))",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      <button
        onClick={() => newConversation(agentId)}
        style={{
          margin: 8,
          padding: "6px 10px",
          background: "rgb(var(--accent))",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        + New conversation
      </button>
      {conversations.length === 0 && (
        <div style={{ padding: "4px 12px", color: "rgb(var(--muted))", fontSize: 12 }}>
          No past conversations yet.
        </div>
      )}
      {conversations.map((c) => (
        <button
          key={c.id}
          data-testid="conversation-item"
          onClick={() => openConversation(agentId, c.id)}
          style={{
            textAlign: "left",
            padding: "8px 12px",
            background: c.id === current ? "rgb(var(--border))" : "transparent",
            color: "rgb(var(--fg))",
            border: "none",
            borderBottom: "1px solid rgb(var(--border))",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {c.title || "Untitled conversation"}
          </div>
          <div style={{ fontSize: 11, color: "rgb(var(--muted))" }}>
            {c.messageCount} msg{c.messageCount === 1 ? "" : "s"} · {relativeTime(c.updatedAt)}
            {c.closedAt ? " · closed" : ""}
          </div>
        </button>
      ))}
    </div>
  );
}
