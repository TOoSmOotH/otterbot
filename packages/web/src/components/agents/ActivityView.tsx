import { useEffect, useRef, useState } from "react";
import type { AgentMessage, AgentMsgKind, CodingSessionInfo, SubagentTask } from "@otterbot/shared";
import { ArrowRight, Terminal as TerminalIcon } from "lucide-react";
import { useActivityStore } from "../../stores/activity-store";
import { useAgentsStore } from "../../stores/agents-store";
import { useCodingSessionsStore } from "../../stores/coding-sessions-store";
import { CODING_TOOL_LABELS, type CodingTool } from "../../lib/coding-cli";
import { TerminalView } from "./TerminalView";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { fonts, type } from "../../lib/typography";

type Tone = "neutral" | "accent" | "success" | "warning" | "info" | "danger";

const KIND_TONE: Record<AgentMsgKind, Tone> = {
  request: "info",
  response: "success",
  broadcast: "accent",
  spawn: "warning",
  report: "success",
  status: "neutral",
  tool: "neutral",
  error: "danger",
};

const TASK_TONE: Record<SubagentTask["status"], Tone> = {
  queued: "info",
  running: "warning",
  done: "success",
  failed: "danger",
  cancelled: "neutral",
};

const TONE_VAR: Record<Tone, string> = {
  neutral: "border",
  accent: "accent",
  success: "success",
  warning: "warning",
  info: "info",
  danger: "danger",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

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
    <div className="grid h-full min-h-0" style={{ gridTemplateColumns: "1fr 340px" }}>
      <div className="flex flex-col min-h-0 border-r border-border">
        <SectionHeader>Agent communication</SectionHeader>
        <div
          ref={feedRef}
          className="flex-1 overflow-y-auto py-2"
          style={{ background: "rgb(var(--surface-sunken))" }}
        >
          {messages.length === 0 && (
            <div className="text-body text-muted px-4 py-3">
              No agent-to-agent messages yet. Ask the COO to delegate something.
            </div>
          )}
          {messages.map((m) => (
            <MessageRow key={`${m.seq}`} msg={m} from={name(m.from)} to={name(m.to)} />
          ))}
        </div>
      </div>

      <div className="flex flex-col min-h-0">
        <CodingSessionsPanel name={name} />
        <SectionHeader>Subagent tasks</SectionHeader>
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {tasks.length === 0 && (
            <div className="text-body text-muted">No subagents spawned yet.</div>
          )}
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} parentName={name(t.parentAgentId)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CodingSessionsPanel({ name }: { name: (id: string | null) => string }) {
  const sessions = useCodingSessionsStore((s) => s.sessions);
  const load = useCodingSessionsStore((s) => s.load);
  const bindSocket = useCodingSessionsStore((s) => s.bindSocket);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    bindSocket();
    void load();
  }, [bindSocket, load]);

  return (
    <div className="flex flex-col border-b border-border" style={{ maxHeight: "55%", minHeight: 0 }}>
      <SectionHeader>
        <Icon icon={TerminalIcon} size={14} />
        Live coding sessions
        {sessions.length > 0 && <Badge tone="success">{sessions.length}</Badge>}
      </SectionHeader>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
        {sessions.length === 0 && (
          <div className="text-body text-muted">No coding sessions running.</div>
        )}
        {sessions.map((s) => (
          <CodingSessionRow
            key={s.agentId}
            session={s}
            agentName={name(s.agentId)}
            open={expanded === s.agentId}
            onToggle={() => setExpanded((cur) => (cur === s.agentId ? null : s.agentId))}
          />
        ))}
      </div>
    </div>
  );
}

function CodingSessionRow({
  session,
  agentName,
  open,
  onToggle,
}: {
  session: CodingSessionInfo;
  agentName: string;
  open: boolean;
  onToggle: () => void;
}) {
  const toolLabel = CODING_TOOL_LABELS[session.tool as CodingTool] ?? session.tool;
  const interactive = session.mode === "interactive";
  const modeLabel = interactive ? "interactive" : "autonomous";
  return (
    <div className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-surface/60"
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "rgb(var(--success))" }}
          aria-hidden
        />
        <span className="font-semibold text-fg text-body">{agentName}</span>
        <span className="text-small text-subtle" style={{ fontFamily: fonts.mono }}>
          {toolLabel}
        </span>
        <span className="flex-1" />
        <Badge tone={interactive ? "success" : "info"}>{modeLabel}</Badge>
        <span className="text-small text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ height: 280, background: "rgb(var(--surface-sunken))", borderTop: "1px solid rgb(var(--border))", padding: 6 }}>
          {/* All coding sessions are live PTYs now — watchable and typeable. */}
          <TerminalView agentId={session.agentId} kind="coding" interactive />
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="px-4 py-2.5 border-b border-border text-h2 flex items-center gap-2">
      {children}
    </header>
  );
}

function MessageRow({ msg, from, to }: { msg: AgentMessage; from: string; to: string }) {
  const tone = KIND_TONE[msg.kind] ?? "neutral";
  const body = msg.body.length > 600 ? msg.body.slice(0, 600) + "…" : msg.body;
  return (
    <div
      className="grid items-start gap-x-3 px-4 py-1.5 border-l-2 hover:bg-surface/40"
      style={{
        gridTemplateColumns: "auto 76px 1fr",
        borderLeftColor: `rgb(var(--${TONE_VAR[tone]}))`,
      }}
    >
      <span style={{ ...type.monoSm, color: "rgb(var(--subtle))", paddingTop: 4 }}>
        {fmtTime(msg.createdAt)}
      </span>
      <span style={{ paddingTop: 2 }}>
        <Badge tone={tone}>{msg.kind}</Badge>
      </span>
      <div className="min-w-0">
        <div
          className="flex items-center gap-1.5 text-small text-subtle"
          style={{ fontFamily: fonts.mono, marginBottom: 2 }}
        >
          <span className="text-fg">{from}</span>
          <Icon icon={ArrowRight} size={14} />
          <span className="text-fg">{to}</span>
        </div>
        <div
          className="text-body text-fg whitespace-pre-wrap break-words"
          style={{ fontFamily: fonts.mono, fontSize: 12 }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task, parentName }: { task: SubagentTask; parentName: string }) {
  const tone = TASK_TONE[task.status] ?? "neutral";
  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-body shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-fg">{parentName}</span>
        <Badge tone={tone}>{task.status}</Badge>
      </div>
      <div
        className="mt-1 text-small text-subtle flex items-center gap-1.5"
        style={{ fontFamily: fonts.mono }}
      >
        <Icon icon={ArrowRight} size={14} />
        {task.subagentId}
      </div>
      <div className="mt-2 text-body text-fg">{task.goal}</div>
      {task.resultSummary && (
        <div className="mt-2 text-small text-muted whitespace-pre-wrap leading-relaxed">
          {task.resultSummary.length > 240
            ? task.resultSummary.slice(0, 240) + "…"
            : task.resultSummary}
        </div>
      )}
    </div>
  );
}
