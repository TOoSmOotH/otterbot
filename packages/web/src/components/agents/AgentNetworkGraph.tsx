import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  type Node,
  type NodeProps,
  type Edge,
  type Connection,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentPeerAccess, AgentProfile, AgentProfileSummary } from "@otterbot/shared";
import { apiFetch } from "../../lib/api";
import { withToken } from "../../lib/api";
import { useAgentsStore } from "../../stores/agents-store";
import { useProjectsStore, type Project } from "../../stores/projects-store";
import { statusColor, initials } from "./agent-visual";
import { type } from "../../lib/typography";

/**
 * Roster-wide, editable view of agent-to-agent permissions. Each agent is a
 * node; a directed arrow A→B means "A may message B". A bold accent arrow means
 * A may also read B's memory. Editing:
 *   - drag from one node's bottom handle to another's top handle → grant message
 *   - click an arrow → cycle message → message+memory → none (revoke)
 *   - select an arrow + Delete → revoke
 * Edits are local; the Save bar PATCHes only the agents whose peers changed,
 * because each PATCH restarts that agent's runtime on the server.
 *
 * The COO can reach every agent implicitly (server-side bypass), so its arrows
 * are shown dashed and non-editable.
 */

type PeerMap = Record<string, AgentPeerAccess[]>;

interface NodeData extends Record<string, unknown> {
  agent: AgentProfileSummary;
  isCoo: boolean;
}
type AgentNode = Node<NodeData, "agent">;

interface GroupNodeData extends Record<string, unknown> {
  label: string;
  w: number;
  h: number;
}
type GroupNode = Node<GroupNodeData, "group">;

/** Agent nodes and the (non-interactive) project-boundary backdrops behind them. */
type FlowNode = AgentNode | GroupNode;

const MSG_COLOR = "rgb(var(--border-strong))";
const MEM_COLOR = "rgb(var(--accent))";
const COO_COLOR = "rgb(var(--muted))";

// Approximate footprint of an agent node, plus spacing used to pack clusters.
const NODE_W = 184;
const NODE_H = 58;
const COL_GAP = 28;
const ROW_GAP = 26;
const GROUP_PAD = 22;
const GROUP_TITLE = 28;
const GROUP_GAP = 52;
const MAX_ROW_WIDTH = 1500;

interface GroupBox {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GroupedLayout {
  positions: Record<string, { x: number; y: number }>;
  groups: GroupBox[];
}

/**
 * Lay agents out by project: each project's members cluster inside a labeled
 * boundary, agents with no project sit in a trailing "Standalone" cluster, and
 * the COO is pinned to the top, centered over everything (it reaches all agents
 * implicitly). Each agent is claimed by the first project that lists it as a
 * member — mirroring the roster's grouping.
 */
function groupedLayout(
  agents: AgentProfileSummary[],
  projects: Project[],
  cooId: string | null
): GroupedLayout {
  const idSet = new Set(agents.map((a) => a.id));
  const projectOf = new Map<string, Project>();
  for (const p of projects) {
    for (const m of p.members) {
      if (idSet.has(m.agentId) && !projectOf.has(m.agentId)) projectOf.set(m.agentId, p);
    }
  }

  // Partition non-COO agents into per-project buckets + a standalone bucket.
  const byProject = new Map<string, AgentProfileSummary[]>();
  const standalone: AgentProfileSummary[] = [];
  for (const a of agents) {
    if (a.id === cooId) continue;
    const p = projectOf.get(a.id);
    if (p) {
      const list = byProject.get(p.id) ?? [];
      list.push(a);
      byProject.set(p.id, list);
    } else {
      standalone.push(a);
    }
  }

  const clusters: { key: string; label: string | null; members: AgentProfileSummary[] }[] = [];
  for (const p of projects) {
    const members = byProject.get(p.id);
    if (!members || members.length === 0) continue;
    const order = new Map(p.team.map((t, i) => [t.agentId, i] as const));
    members.sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.displayName.localeCompare(b.displayName)
    );
    clusters.push({ key: p.id, label: p.name, members });
  }
  if (standalone.length) {
    standalone.sort((a, b) => a.displayName.localeCompare(b.displayName));
    clusters.push({ key: "__standalone", label: null, members: standalone });
  }

  const positions: Record<string, { x: number; y: number }> = {};
  const groups: GroupBox[] = [];
  const cellW = NODE_W + COL_GAP;
  const cellH = NODE_H + ROW_GAP;

  let curX = 0;
  let rowY = NODE_H + 90; // leave room for the COO above the first row
  let rowMaxH = 0;
  for (const c of clusters) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(c.members.length)));
    const rows = Math.ceil(c.members.length / cols);
    const innerW = cols * cellW - COL_GAP;
    const innerH = rows * cellH - ROW_GAP;
    const titleH = c.label ? GROUP_TITLE : 0;
    const boxW = innerW + GROUP_PAD * 2;
    const boxH = innerH + GROUP_PAD * 2 + titleH;
    if (curX > 0 && curX + boxW > MAX_ROW_WIDTH) {
      curX = 0;
      rowY += rowMaxH + GROUP_GAP;
      rowMaxH = 0;
    }
    const boxX = curX;
    const boxY = rowY;
    c.members.forEach((m, i) => {
      const cc = i % cols;
      const rr = Math.floor(i / cols);
      positions[m.id] = {
        x: boxX + GROUP_PAD + cc * cellW,
        y: boxY + GROUP_PAD + titleH + rr * cellH,
      };
    });
    if (c.label) groups.push({ id: `grp-${c.key}`, label: c.label, x: boxX, y: boxY, w: boxW, h: boxH });
    curX += boxW + GROUP_GAP;
    rowMaxH = Math.max(rowMaxH, boxH);
  }

  // Center the COO horizontally over the widest extent.
  if (cooId) {
    let maxRight = NODE_W;
    for (const pos of Object.values(positions)) maxRight = Math.max(maxRight, pos.x + NODE_W);
    for (const g of groups) maxRight = Math.max(maxRight, g.x + g.w);
    positions[cooId] = { x: maxRight / 2 - NODE_W / 2, y: 0 };
  }

  return { positions, groups };
}

function AgentGraphNode({ data }: NodeProps<AgentNode>) {
  const { agent, isCoo } = data;
  const thumb = agent.artwork.avatar;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px 8px 8px",
        borderRadius: 12,
        background: "rgb(var(--surface-elevated))",
        border: `1px solid ${isCoo ? "rgb(var(--accent) / 0.5)" : "rgb(var(--border))"}`,
        boxShadow: "var(--shadow-sm)",
        minWidth: 150,
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
          background: "rgb(var(--surface))",
          border: "1px solid rgb(var(--border))",
          color: "rgb(var(--fg))",
          overflow: "hidden",
        }}
      >
        {thumb ? (
          <img src={withToken(thumb)} alt="" width={32} height={32} style={{ objectFit: "cover" }} />
        ) : (
          initials(agent.displayName)
        )}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.005em",
              color: "rgb(var(--fg))",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.displayName}
          </span>
          {isCoo && (
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
      </span>
      <span
        title={agent.status}
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          marginLeft: "auto",
          background: statusColor(agent.status),
        }}
      />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
}

const handleStyle = {
  width: 9,
  height: 9,
  background: "rgb(var(--accent))",
  border: "2px solid rgb(var(--bg))",
};

/** A non-interactive labeled boundary drawn behind a project's agents. */
function ProjectGroupNode({ data }: NodeProps<GroupNode>) {
  return (
    <div
      style={{
        width: data.w,
        height: data.h,
        borderRadius: 16,
        border: "1px dashed rgb(var(--border-strong))",
        background: "rgb(var(--accent) / 0.04)",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          ...type.micro,
          position: "absolute",
          top: 8,
          left: 14,
          color: "rgb(var(--muted))",
          textTransform: "uppercase",
        }}
      >
        {data.label}
      </span>
    </div>
  );
}

const nodeTypes = { agent: AgentGraphNode, group: ProjectGroupNode };

export function AgentNetworkGraph() {
  const summaries = useAgentsStore((s) => s.agents);
  const reloadRoster = useAgentsStore((s) => s.load);
  const projects = useProjectsStore((s) => s.projects);
  const loadProjects = useProjectsStore((s) => s.load);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Agents shown in the graph: everything except subagents.
  const graphAgents = useMemo(
    () => summaries.filter((a) => a.role !== "subagent"),
    [summaries]
  );
  const validIds = useMemo(() => new Set(graphAgents.map((a) => a.id)), [graphAgents]);
  const cooId = useMemo(() => graphAgents.find((a) => a.role === "coo")?.id ?? null, [graphAgents]);

  // Editable outbound peers, keyed by source agent id (COO excluded — implicit).
  const [peers, setPeers] = useState<PeerMap>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  // Tracks the structural composition (agents + project membership) the current
  // layout was built for. Re-layout when it changes; otherwise preserve drags.
  const layoutKeyRef = useRef<string | null>(null);

  // Fetch each non-COO agent's full profile to read its allowedPeers.
  useEffect(() => {
    let cancelled = false;
    const editable = graphAgents.filter((a) => a.role !== "coo");
    if (editable.length === 0 && graphAgents.length === 0) return;
    setLoading(true);
    void Promise.all(
      editable.map((a) =>
        apiFetch(`/api/agents/${a.id}`)
          .then((r) => (r.ok ? (r.json() as Promise<AgentProfile>) : null))
          .catch(() => null)
      )
    ).then((profiles) => {
      if (cancelled) return;
      const next: PeerMap = {};
      for (const p of profiles) {
        if (!p) continue;
        // Drop peers pointing at agents no longer in the graph.
        next[p.id] = (p.allowedPeers ?? []).filter((peer) => validIds.has(peer.agentId));
      }
      setPeers(next);
      setDirty(new Set());
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // Refetch when the set of agents changes.
  }, [graphAgents, validIds]);

  // Lay nodes out by project group; re-layout only when the structure changes
  // (agents added/removed, project membership changes), preserving dragged
  // positions across mere status/name ticks.
  useEffect(() => {
    if (graphAgents.length === 0) return;
    const structureKey =
      graphAgents
        .map((a) => a.id)
        .sort()
        .join(",") +
      "|" +
      projects
        .map(
          (p) =>
            `${p.id}:${p.members
              .map((m) => m.agentId)
              .sort()
              .join(",")}`
        )
        .join(";") +
      "|" +
      (cooId ?? "");

    if (layoutKeyRef.current === structureKey) {
      // Same structure: refresh agent node data (status/name) in place.
      setNodes((cur) =>
        cur.map((n) => {
          if (n.type !== "agent") return n;
          const agent = graphAgents.find((a) => a.id === n.id);
          return agent ? { ...n, data: { agent, isCoo: agent.id === cooId } } : n;
        })
      );
      return;
    }
    layoutKeyRef.current = structureKey;

    const { positions, groups } = groupedLayout(graphAgents, projects, cooId);
    const groupNodes: FlowNode[] = groups.map((g) => ({
      id: g.id,
      type: "group" as const,
      position: { x: g.x, y: g.y },
      data: { label: g.label, w: g.w, h: g.h },
      draggable: false,
      selectable: false,
      deletable: false,
      zIndex: -1,
      style: { width: g.w, height: g.h },
    }));
    const agentNodes: FlowNode[] = graphAgents.map((a) => ({
      id: a.id,
      type: "agent" as const,
      position: positions[a.id] ?? { x: 0, y: 0 },
      data: { agent: a, isCoo: a.id === cooId },
    }));
    // Group backdrops first so they paint behind the agent nodes.
    setNodes([...groupNodes, ...agentNodes]);
  }, [graphAgents, projects, cooId, setNodes]);

  // Derive edges from the current peer map plus the COO's implicit reach.
  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    for (const [source, list] of Object.entries(peers)) {
      for (const peer of list) {
        const memory = peer.shareMemory;
        out.push({
          id: `${source}->${peer.agentId}`,
          source,
          target: peer.agentId,
          data: { level: memory ? "memory" : "message", readonly: false },
          label: memory ? "memory" : undefined,
          labelStyle: { fill: MEM_COLOR, fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "rgb(var(--bg))" },
          style: {
            stroke: memory ? MEM_COLOR : MSG_COLOR,
            strokeWidth: memory ? 2.5 : 1.5,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: memory ? MEM_COLOR : MSG_COLOR,
            width: 18,
            height: 18,
          },
        });
      }
    }
    // COO reaches everyone — implicit, non-editable.
    if (cooId) {
      for (const a of graphAgents) {
        if (a.id === cooId) continue;
        out.push({
          id: `${cooId}=>${a.id}`,
          source: cooId,
          target: a.id,
          deletable: false,
          data: { level: "coo", readonly: true },
          style: { stroke: COO_COLOR, strokeWidth: 1, strokeDasharray: "4 4", opacity: 0.55 },
          markerEnd: { type: MarkerType.Arrow, color: COO_COLOR, width: 16, height: 16 },
        });
      }
    }
    return out;
  }, [peers, cooId, graphAgents]);

  const markDirty = useCallback((agentId: string) => {
    setDirty((d) => new Set(d).add(agentId));
    setSaved(false);
  }, []);

  // Drag from A to B → grant A the right to message B.
  const onConnect = useCallback(
    (c: Connection) => {
      const { source, target } = c;
      if (!source || !target || source === target || source === cooId) return;
      if (!validIds.has(source) || !validIds.has(target)) return;
      setPeers((prev) => {
        const list = prev[source] ?? [];
        if (list.some((p) => p.agentId === target)) return prev;
        return { ...prev, [source]: [...list, { agentId: target, shareMemory: false }] };
      });
      markDirty(source);
    },
    [cooId, validIds, markDirty]
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) =>
      !!c.source && !!c.target && c.source !== c.target && c.source !== cooId,
    [cooId]
  );

  // Click an arrow → message → message+memory → none.
  const onEdgeClick = useCallback<EdgeMouseHandler<Edge>>(
    (_evt, edge) => {
      if (edge.data?.readonly) return;
      const { source, target } = edge;
      setPeers((prev) => {
        const list = prev[source] ?? [];
        const cur = list.find((p) => p.agentId === target);
        if (!cur) return prev;
        if (!cur.shareMemory) {
          return {
            ...prev,
            [source]: list.map((p) =>
              p.agentId === target ? { ...p, shareMemory: true } : p
            ),
          };
        }
        return { ...prev, [source]: list.filter((p) => p.agentId !== target) };
      });
      markDirty(source);
    },
    [markDirty]
  );

  const onEdgesDelete = useCallback(
    (removed: Edge[]) => {
      setPeers((prev) => {
        const next = { ...prev };
        for (const edge of removed) {
          if (edge.data?.readonly) continue;
          next[edge.source] = (next[edge.source] ?? []).filter((p) => p.agentId !== edge.target);
          markDirty(edge.source);
        }
        return next;
      });
    },
    [markDirty]
  );

  const save = useCallback(async () => {
    if (dirty.size === 0) return;
    setSaving(true);
    try {
      const results = await Promise.all(
        [...dirty].map((id) =>
          apiFetch(`/api/agents/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ allowedPeers: peers[id] ?? [] }),
          })
        )
      );
      if (results.every((r) => r.ok)) {
        setDirty(new Set());
        setSaved(true);
        void reloadRoster();
      }
    } finally {
      setSaving(false);
    }
  }, [dirty, peers, reloadRoster]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "10px 16px",
          borderBottom: "1px solid rgb(var(--border))",
        }}
      >
        <span style={{ ...type.h2 }}>Agent network</span>
        <Legend />
        <div style={{ flex: 1 }} />
        {dirty.size > 0 && (
          <span style={{ ...type.small, color: "rgb(var(--warning))" }}>
            {dirty.size} agent{dirty.size === 1 ? "" : "s"} changed
          </span>
        )}
        {saved && dirty.size === 0 && (
          <span style={{ ...type.small, color: "rgb(var(--success))" }}>Saved</span>
        )}
        <button
          data-testid="network-save"
          onClick={save}
          disabled={dirty.size === 0 || saving}
          style={{
            background: dirty.size === 0 ? "rgb(var(--surface-elevated))" : "rgb(var(--accent))",
            color: dirty.size === 0 ? "rgb(var(--muted))" : "rgb(var(--accent-fg))",
            border: "none",
            padding: "6px 14px",
            borderRadius: 7,
            cursor: dirty.size === 0 || saving ? "default" : "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {loading && nodes.length === 0 ? (
          <div style={{ padding: 16, color: "rgb(var(--muted))", fontSize: 13 }}>
            Loading agents…
          </div>
        ) : (
          <ReactFlow<FlowNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            onEdgesDelete={onEdgesDelete}
            isValidConnection={isValidConnection}
            connectionRadius={40}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            style={{ background: "rgb(var(--surface-sunken))" }}
          >
            <Background color="rgb(var(--border))" gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, ...type.small }}>
      <LegendItem color={MSG_COLOR} width={2} label="can message" />
      <LegendItem color={MEM_COLOR} width={3} label="message + read memory" />
      <LegendItem color={COO_COLOR} width={2} dashed label="COO (always)" />
    </div>
  );
}

function LegendItem({
  color,
  width,
  dashed,
  label,
}: {
  color: string;
  width: number;
  dashed?: boolean;
  label: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "rgb(var(--muted))" }}>
      <svg width={26} height={10} aria-hidden>
        <line
          x1={1}
          y1={5}
          x2={20}
          y2={5}
          stroke={color}
          strokeWidth={width}
          strokeDasharray={dashed ? "3 3" : undefined}
        />
        <polygon points="20,1 26,5 20,9" fill={color} />
      </svg>
      {label}
    </span>
  );
}
