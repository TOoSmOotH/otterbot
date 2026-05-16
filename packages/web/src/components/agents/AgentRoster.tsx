import { useEffect } from "react";
import { useAgentsStore } from "../../stores/agents-store";
import { useModelPacksStore, packThumbnail } from "../../stores/model-packs-store";
import { useChatStore } from "../../stores/chat-store";
import { statusColor, initials } from "./agent-visual";

/** Left-rail agent roster: the COO plus every agent, with a "New agent" action. */
export function AgentRoster({ onNewAgent }: { onNewAgent: () => void }) {
  const agents = useAgentsStore((s) => s.agents);
  const activeAgentId = useAgentsStore((s) => s.activeAgentId);
  const setActive = useAgentsStore((s) => s.setActive);
  const packs = useModelPacksStore((s) => s.packs);
  const connected = useChatStore((s) => s.connected);

  const loadPacks = useModelPacksStore((s) => s.load);
  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  // COO pinned to the top, then the rest alphabetically.
  const ordered = [...agents].sort((a, b) => {
    if (a.role === "coo") return -1;
    if (b.role === "coo") return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid rgb(var(--border))",
        background: "rgb(var(--bg))",
      }}
    >
      <header
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid rgb(var(--border))",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <img src="/logo.jpeg" alt="" width={22} height={22} style={{ borderRadius: 5 }} />
        <h1 style={{ fontSize: 13, margin: 0, fontWeight: 600, flex: 1 }}>otterbot</h1>
        <span title={connected ? "connected" : "disconnected"} style={{ color: connected ? "#4ade80" : "#f87171" }}>
          {connected ? "●" : "○"}
        </span>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {ordered.map((a) => {
          const thumb = packThumbnail(packs, a.artwork.modelPack);
          const active = a.id === activeAgentId;
          return (
            <button
              key={a.id}
              data-testid={`agent-card-${a.id}`}
              onClick={() => setActive(a.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
                padding: 8,
                borderRadius: 8,
                cursor: "pointer",
                background: active ? "rgb(var(--accent))" : "transparent",
                color: active ? "white" : "rgb(var(--fg))",
                border: `1px solid ${active ? "rgb(var(--accent))" : "rgb(var(--border))"}`,
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 7,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "rgb(var(--border))",
                  color: "rgb(var(--fg))",
                  overflow: "hidden",
                }}
              >
                {thumb ? (
                  <img src={thumb} alt="" width={34} height={34} style={{ objectFit: "cover" }} />
                ) : (
                  initials(a.displayName)
                )}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.displayName}
                  </span>
                  {a.role === "coo" && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: active ? "rgba(255,255,255,0.25)" : "rgb(var(--accent))",
                        color: "white",
                      }}
                    >
                      COO
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    opacity: 0.7,
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.chatModel.provider}/{a.chatModel.modelId}
                </span>
              </span>
              <span
                title={a.status}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: statusColor(a.status),
                }}
              />
            </button>
          );
        })}
        {ordered.length === 0 && (
          <div style={{ color: "rgb(var(--muted))", fontSize: 12, padding: 8 }}>Loading agents…</div>
        )}
      </div>

      <div style={{ padding: 8, borderTop: "1px solid rgb(var(--border))" }}>
        <button
          data-testid="new-agent"
          onClick={onNewAgent}
          style={{
            width: "100%",
            background: "rgb(var(--accent))",
            color: "white",
            border: "none",
            padding: "8px 10px",
            borderRadius: 7,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          + New agent
        </button>
      </div>
    </div>
  );
}
