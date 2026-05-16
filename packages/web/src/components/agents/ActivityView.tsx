import { useEffect, useRef } from "react";
import type { AgentMessage, AgentMsgKind, SubagentTask } from "@otterbot/shared";
import { useActivityStore } from "../../stores/activity-store";
import { useAgentsStore } from "../../stores/agents-store";

const KIND_COLOR: Record<AgentMsgKind, string> = {
  request: "#6b8cff",
  response: "#4ade80",
  broadcast: "#a78bfa",
  spawn: "#fbbf24",
  report: "#4ade80",
  status: "#5a5a64",
  tool: "#5a5a64",
  error: "#f87171",
};

/** The agent-to-agent communication view: a live message feed + the spawn tree. */
export function ActivityView() {
  const messages = useActivityStore((s) => s.messages);
  const tasks = useActivityStore((s) => s.tasks);
  const load = useActivityStore((s) => s.load);
  const bindSocket = useActivityStore((s) => s.bindSocket);
  const agents = useAgentsStore((s) => s.agents);

  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bindSocket();
    void load();
  }, [bindSocket, load]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  const name = (id: string | null) => {
    if (!id) return "all";
    return agents.find((a) => a.id === id)?.displayName ?? id;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", height: "100%", minHeight: 0 }}>
      {/* Live message feed */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid rgb(var(--border))" }}>
        <header style={headerStyle}>Agent communication</header>
        <div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {messages.length === 0 && (
            <div style={{ color: "rgb(var(--muted))", fontSize: 13 }}>
              No agent-to-agent messages yet. Ask the COO to delegate something.
            </div>
          )}
          {messages.map((m) => (
            <MessageRow key={`${m.seq}`} msg={m} from={name(m.from)} to={name(m.to)} />
          ))}
        </div>
      </div>

      {/* Spawn tree */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <header style={headerStyle}>Subagent tasks</header>
        <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {tasks.length === 0 && (
            <div style={{ color: "rgb(var(--muted))", fontSize: 13 }}>No subagents spawned yet.</div>
          )}
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} parentName={name(t.parentAgentId)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageRow({ msg, from, to }: { msg: AgentMessage; from: string; to: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          color: "white",
          background: KIND_COLOR[msg.kind] ?? "#5a5a64",
          borderRadius: 4,
          padding: "2px 5px",
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {msg.kind}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "rgb(var(--muted))" }}>
          {from} → {to}
        </span>
        <span style={{ display: "block", color: "rgb(var(--fg))", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {msg.body.length > 600 ? msg.body.slice(0, 600) + "…" : msg.body}
        </span>
      </span>
    </div>
  );
}

function TaskCard({ task, parentName }: { task: SubagentTask; parentName: string }) {
  const color =
    task.status === "done" ? "#4ade80" : task.status === "failed" ? "#f87171" : "#fbbf24";
  return (
    <div style={{ border: "1px solid rgb(var(--border))", borderRadius: 8, padding: 8, fontSize: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontWeight: 600 }}>{parentName}</span>
        <span style={{ color, fontWeight: 600 }}>{task.status}</span>
      </div>
      <div style={{ color: "rgb(var(--muted))", marginTop: 2 }}>↳ {task.subagentId}</div>
      <div style={{ marginTop: 4, color: "rgb(var(--fg))" }}>{task.goal}</div>
      {task.resultSummary && (
        <div style={{ marginTop: 4, color: "rgb(var(--muted))", whiteSpace: "pre-wrap" }}>
          {task.resultSummary.length > 240
            ? task.resultSummary.slice(0, 240) + "…"
            : task.resultSummary}
        </div>
      )}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid rgb(var(--border))",
  fontSize: 13,
  fontWeight: 600,
};
