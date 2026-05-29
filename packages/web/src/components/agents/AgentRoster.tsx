import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FolderGit2,
  Plus,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { AgentProfileSummary, AgentStatus, SubagentTask } from "@otterbot/shared";
import { useAgentsStore } from "../../stores/agents-store";
import { useActivityStore } from "../../stores/activity-store";
import { useChatStore } from "../../stores/chat-store";
import { useProjectsStore, type Project } from "../../stores/projects-store";
import { withToken } from "../../lib/api";
import { Icon } from "../ui/Icon";
import { statusColor, initials } from "./agent-visual";
import { type } from "../../lib/typography";

const PULSING_STATUSES = new Set<AgentStatus>(["working", "thinking"]);
const ACTIVE_TASK_STATUSES = new Set<SubagentTask["status"]>(["running", "queued"]);

/** Relative salience for rolling many member statuses up to one group dot. */
const STATUS_RANK: Record<AgentStatus, number> = {
  working: 5,
  thinking: 4,
  error: 3,
  waiting: 2,
  stopped: 1,
  idle: 0,
};

/** The single status to show on a project group's rollup dot. */
function rollupStatus(members: AgentProfileSummary[]): AgentStatus {
  let best: AgentStatus = "idle";
  for (const m of members) {
    if (STATUS_RANK[m.status] > STATUS_RANK[best]) best = m.status;
  }
  return best;
}

/**
 * Left-rail agent roster: the COO plus every agent, with a "New agent" action.
 * Each coding project's team is collapsed under one group header (collapsed by
 * default) to keep the list scannable; standalone and service agents stay at the
 * top level alongside the COO.
 */
export function AgentRoster({ onNewAgent }: { onNewAgent: () => void }) {
  const agents = useAgentsStore((s) => s.agents);
  const activeAgentId = useAgentsStore((s) => s.activeAgentId);
  const setActive = useAgentsStore((s) => s.setActive);
  const connected = useChatStore((s) => s.connected);
  const tasks = useActivityStore((s) => s.tasks);
  const projects = useProjectsStore((s) => s.projects);
  const loadProjects = useProjectsStore((s) => s.load);
  const bindProjectsSocket = useProjectsStore((s) => s.bindSocket);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // The roster is always mounted, so bootstrap project data here (idempotent)
  // rather than relying on the Projects tab being open.
  useEffect(() => {
    void loadProjects();
    bindProjectsSocket();
  }, [loadProjects, bindProjectsSocket]);

  const ordered = useMemo(
    () =>
      [...agents].sort((a, b) => {
        if (a.role === "coo") return -1;
        if (b.role === "coo") return 1;
        return a.displayName.localeCompare(b.displayName);
      }),
    [agents]
  );

  // Partition agents into the COO, top-level agents, and per-project groups.
  const { coo, topLevel, groups } = useMemo(() => {
    // agentId -> the first project that claims it as a member.
    const projectOf = new Map<string, Project>();
    for (const p of projects) {
      for (const { agentId: memberId } of p.members) {
        if (!projectOf.has(memberId)) projectOf.set(memberId, p);
      }
    }
    // Role order within a project, for sorting team members predictably.
    const roleIndex = new Map<string, Map<string, number>>();
    for (const p of projects) {
      const idx = new Map<string, number>();
      p.team.forEach((t, i) => idx.set(t.agentId, i));
      roleIndex.set(p.id, idx);
    }

    let cooAgent: AgentProfileSummary | null = null;
    const top: AgentProfileSummary[] = [];
    const byProject = new Map<string, AgentProfileSummary[]>();

    for (const a of ordered) {
      if (a.role === "coo") {
        cooAgent = a;
        continue;
      }
      const proj = projectOf.get(a.id);
      if (proj) {
        const list = byProject.get(proj.id);
        if (list) list.push(a);
        else byProject.set(proj.id, [a]);
      } else {
        top.push(a);
      }
    }

    // One group per project that actually has members in the roster, in the
    // project list's order. Members sorted by team-role order, else by name.
    const grouped = projects
      .filter((p) => byProject.has(p.id))
      .map((p) => {
        const idx = roleIndex.get(p.id);
        const members = [...(byProject.get(p.id) ?? [])].sort((a, b) => {
          const ia = idx?.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const ib = idx?.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          if (ia !== ib) return ia - ib;
          return a.displayName.localeCompare(b.displayName);
        });
        return { project: p, members };
      });

    return { coo: cooAgent, topLevel: top, groups: grouped };
  }, [ordered, projects]);

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

  const toggle = (projectId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  const cardProps = { activeAgentId, setActive, hoveredId, setHoveredId, activeTasksByAgent };

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
        {coo && <AgentCard key={coo.id} agent={coo} {...cardProps} />}
        {topLevel.map((a) => (
          <AgentCard key={a.id} agent={a} {...cardProps} />
        ))}
        {groups.map(({ project, members }) => {
          // Always keep the group holding the active agent open.
          const hasActive = members.some((m) => m.id === activeAgentId);
          const expanded = !collapsed.has(project.id) || hasActive;
          return (
            <div key={project.id} style={{ display: "flex", flexDirection: "column" }}>
              <ProjectGroupHeader
                project={project}
                members={members}
                expanded={expanded}
                onToggle={() => toggle(project.id)}
              />
              {expanded &&
                members.map((a) => <AgentCard key={a.id} agent={a} indented {...cardProps} />)}
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

interface AgentCardProps {
  agent: AgentProfileSummary;
  activeAgentId: string | null;
  setActive: (id: string) => void;
  hoveredId: string | null;
  setHoveredId: (fn: string | null | ((c: string | null) => string | null)) => void;
  activeTasksByAgent: Map<string, SubagentTask[]>;
  /** Nest the card one level under a project group header. */
  indented?: boolean;
}

/** A single roster row: avatar, name, model, status dot, and live subtasks. */
function AgentCard({
  agent: a,
  activeAgentId,
  setActive,
  hoveredId,
  setHoveredId,
  activeTasksByAgent,
  indented,
}: AgentCardProps) {
  const thumb = a.artwork.avatar;
  const active = a.id === activeAgentId;
  const hovered = hoveredId === a.id;
  const pulse = PULSING_STATUSES.has(a.status);
  const subtasks = activeTasksByAgent.get(a.id) ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
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
          padding: indented ? "7px 10px 7px 26px" : "8px 10px 8px 12px",
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
            width: indented ? 28 : 34,
            height: indented ? 28 : 34,
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
              width={indented ? 28 : 34}
              height={indented ? 28 : 34}
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
}

interface ProjectGroupHeaderProps {
  project: Project;
  members: AgentProfileSummary[];
  expanded: boolean;
  onToggle: () => void;
}

/** Collapsible header for a project's team; shows a rollup status dot + count. */
function ProjectGroupHeader({ project, members, expanded, onToggle }: ProjectGroupHeaderProps) {
  const [hovered, setHovered] = useState(false);
  const status = rollupStatus(members);
  const pulse = PULSING_STATUSES.has(status);

  return (
    <button
      data-testid={`project-group-${project.id}`}
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        textAlign: "left",
        padding: "7px 10px",
        borderRadius: 8,
        cursor: "pointer",
        background: hovered ? "rgb(var(--surface))" : "transparent",
        color: "rgb(var(--fg))",
        border: "1px solid transparent",
      }}
    >
      <Icon icon={expanded ? ChevronDown : ChevronRight} size={14} />
      <Icon icon={FolderGit2} size={15} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {project.name}
      </span>
      <span
        style={{
          ...type.micro,
          padding: "1px 6px",
          borderRadius: 999,
          background: "rgb(var(--surface-elevated))",
          color: "rgb(var(--subtle))",
          border: "1px solid rgb(var(--border))",
        }}
      >
        {members.length}
      </span>
      <span
        title={status}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          background: statusColor(status),
          animation: pulse ? "otter-pulse 1.5s ease-in-out infinite" : undefined,
          boxShadow: pulse ? `0 0 6px ${statusColor(status)}` : undefined,
        }}
      />
    </button>
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
