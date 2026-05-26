import { useMemo, useState } from "react";
import { CornerDownRight, Plus, Wifi, WifiOff } from "lucide-react";
import type { SubagentTask } from "@otterbot/shared";
import { useAgentsStore } from "../../stores/agents-store";
import { useActivityStore } from "../../stores/activity-store";
import { useChatStore } from "../../stores/chat-store";
import { withToken } from "../../lib/api";
import { Icon } from "../ui/Icon";
import { statusColor, initials } from "./agent-visual";
import { type } from "../../lib/typography";

const PULSING_STATUSES = new Set(["working", "thinking"]);
const ACTIVE_TASK_STATUSES = new Set<SubagentTask["status"]>(["running", "queued"]);

/** Left-rail agent roster: the COO plus every agent, with a "New agent" action. */
export function AgentRoster({ onNewAgent }: { onNewAgent: () => void }) {
  const agents = useAgentsStore((s) => s.agents);
  const activeAgentId = useAgentsStore((s) => s.activeAgentId);
  const setActive = useAgentsStore((s) => s.setActive);
  const connected = useChatStore((s) => s.connected);
  const tasks = useActivityStore((s) => s.tasks);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const ordered = [...agents].sort((a, b) => {
    if (a.role === "coo") return -1;
    if (b.role === "coo") return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  // Live subagent tasks grouped under the agent that delegated them.
  const activeTasksByAgent = useMemo(() => {
    const map = new Map<string, SubagentTask[]>();
    for (const t of tasks) {
      if (!ACTIVE_TASK_STATUSES.has(t.status)) continue;
      const list = map.get(t.parentAgentId);
      if (list) list.push(t);
      else map.set(t.parentAgentId, [t]);
    }
    return map;
  }, [tasks]);

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
          padding: "12px 14px",
          borderBottom: "1px solid rgb(var(--border))",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <img src="/logo.jpeg" alt="" width={24} height={24} style={{ borderRadius: 6 }} />
        <h1
          style={{
            ...type.h1,
            fontSize: 15,
            margin: 0,
            flex: 1,
            letterSpacing: "-0.01em",
          }}
        >
          otterbot
        </h1>
        <span
          title={connected ? "Connected" : "Disconnected"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            color: connected ? "rgb(var(--success))" : "rgb(var(--danger))",
          }}
        >
          <Icon icon={connected ? Wifi : WifiOff} size={14} />
        </span>
      </header>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {ordered.map((a) => {
          const thumb = a.artwork.avatar;
          const active = a.id === activeAgentId;
          const hovered = hoveredId === a.id;
          const pulse = PULSING_STATUSES.has(a.status);
          const subtasks = activeTasksByAgent.get(a.id) ?? [];

          return (
            <div key={a.id} style={{ display: "flex", flexDirection: "column" }}>
            <button
              data-testid={`agent-card-${a.id}`}
              onClick={() => setActive(a.id)}
              onMouseEnter={() => setHoveredId(a.id)}
              onMouseLeave={() => setHoveredId((c) => (c === a.id ? null : c))}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
                padding: "8px 10px 8px 12px",
                borderRadius: 8,
                cursor: "pointer",
                background: active
                  ? "rgb(var(--surface-elevated))"
                  : hovered
                    ? "rgb(var(--surface))"
                    : "transparent",
                color: "rgb(var(--fg))",
                border: "1px solid transparent",
              }}
            >
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 2,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: "rgb(var(--accent))",
                    borderRadius: 2,
                  }}
                />
              )}
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "rgb(var(--surface-elevated))",
                  border: "1px solid rgb(var(--border))",
                  color: "rgb(var(--fg))",
                  overflow: "hidden",
                }}
              >
                {thumb ? (
                  <img
                    src={withToken(thumb)}
                    alt=""
                    width={34}
                    height={34}
                    style={{ objectFit: "cover" }}
                  />
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
                      letterSpacing: "-0.005em",
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
                        ...type.micro,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: "rgb(var(--accent) / 0.18)",
                        color: "rgb(var(--accent))",
                        border: "1px solid rgb(var(--accent) / 0.3)",
                      }}
                    >
                      COO
                    </span>
                  )}
                </span>
                <span
                  style={{
                    ...type.monoSm,
                    color: "rgb(var(--subtle))",
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 1,
                  }}
                >
                  {a.chatModel.provider}/{a.chatModel.modelId}
                </span>
              </span>
              <span
                title={a.status}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: statusColor(a.status),
                  animation: pulse ? "otter-pulse 1.5s ease-in-out infinite" : undefined,
                  boxShadow: pulse ? `0 0 6px ${statusColor(a.status)}` : undefined,
                }}
              />
            </button>
            {subtasks.map((t) => (
              <SubtaskRow key={t.id} task={t} />
            ))}
            </div>
          );
        })}
        {ordered.length === 0 && (
          <div style={{ color: "rgb(var(--muted))", fontSize: 12, padding: 10 }}>
            Loading agents…
          </div>
        )}
      </div>

      <div style={{ padding: 10, borderTop: "1px solid rgb(var(--border))" }}>
        <button
          data-testid="new-agent"
          onClick={onNewAgent}
          style={{
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: "rgb(var(--accent))",
            color: "rgb(var(--accent-fg))",
            border: "none",
            padding: "8px 10px",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <Icon icon={Plus} size={14} strokeWidth={2.25} />
          New agent
        </button>
      </div>
    </div>
  );
}

/** A single live subagent task delegated by the agent above it. */
function SubtaskRow({ task }: { task: SubagentTask }) {
  const running = task.status === "running";
  const color = running ? "rgb(var(--warning))" : "rgb(var(--info))";
  return (
    <div
      data-testid={`subtask-row-${task.id}`}
      title={`${task.status}: ${task.goal}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px 4px 22px",
        color: "rgb(var(--subtle))",
      }}
    >
      <Icon icon={CornerDownRight} size={14} />
      <span
        style={{
          ...type.monoSm,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {task.goal}
      </span>
      <span
        title={task.status}
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          background: color,
          animation: running ? "otter-pulse 1.5s ease-in-out infinite" : undefined,
          boxShadow: running ? `0 0 6px ${color}` : undefined,
        }}
      />
    </div>
  );
}
