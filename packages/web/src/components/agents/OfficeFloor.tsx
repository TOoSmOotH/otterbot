import { useAgentsStore } from "../../stores/agents-store";
import type { AgentStatus } from "@otterbot/shared";

const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "rgb(var(--success))",
  thinking: "rgb(var(--warning))",
  waiting: "rgb(var(--warning))",
  idle: "rgb(var(--subtle))",
  stopped: "rgb(var(--subtle))",
  error: "rgb(var(--danger))",
};

export function OfficeFloor({ onOpenOffice }: { onOpenOffice?: () => void }) {
  const agents = useAgentsStore((s) => s.agents);
  const setActive = useAgentsStore((s) => s.setActive);
  const working = agents.filter((a) => a.status === "working" || a.status === "thinking").length;

  return (
    <div
      data-testid="office-floor"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 76,
        padding: "0 16px",
        borderTop: "1px solid rgb(var(--border))",
        background: "rgb(var(--surface-sunken))",
        overflowX: "auto",
      }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.09em", color: "rgb(var(--subtle))", fontWeight: 700 }}>
        Office · {working} working
      </div>
      {agents.map((a) => (
        <button
          key={a.id}
          data-testid={`floor-station-${a.id}`}
          onClick={() => setActive(a.id)}
          title={`${a.displayName} · ${a.status}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 11px 7px 8px",
            borderRadius: 12,
            background: "rgb(var(--surface))",
            border: "1px solid rgb(var(--border))",
            cursor: "pointer",
            color: "rgb(var(--fg))",
            opacity: a.status === "idle" || a.status === "stopped" ? 0.55 : 1,
            flex: "none",
          }}
        >
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: "rgb(var(--surface-elevated))",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              fontWeight: 800,
              position: "relative",
            }}
          >
            {a.displayName.slice(0, 1).toUpperCase()}
            <span
              style={{
                position: "absolute",
                right: -3,
                bottom: -3,
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: STATUS_COLOR[a.status],
                border: "2px solid rgb(var(--surface))",
              }}
            />
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{a.displayName}</span>
            <span style={{ fontSize: 9, color: "rgb(var(--subtle))" }}>{a.status}</span>
          </span>
        </button>
      ))}
      {onOpenOffice && (
        <button
          onClick={onOpenOffice}
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontWeight: 600,
            color: "rgb(var(--accent))",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Open office ▸
        </button>
      )}
    </div>
  );
}
