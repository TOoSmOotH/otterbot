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

const MSG_COLOR = "rgb(var(--border-strong))";
const MEM_COLOR = "rgb(var(--accent))";
const COO_COLOR = "rgb(var(--muted))";

/** Arrange agents around a circle, COO pinned to the top. */
function circleLayout(ids: string[]): Record<string, { x: number; y: number }> {
  const cx = 460;
  const cy = 340;
  const n = Math.max(ids.length, 1);
  const radius = Math.max(200, n * 58);
  const out: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out[id] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  return out;
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
        borderRadius: 10,
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
          borderRadius: 8,
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

const nodeTypes = { agent: AgentGraphNode };

export function AgentNetworkGraph() {
  const summaries = useAgentsStore((s) => s.agents);
  const reloadRoster = useAgentsStore((s) => s.load);

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

  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNode>([]);
  const positionsSet = useRef(false);

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

  // Lay nodes out once the agents are known; preserve dragged positions after.
  useEffect(() => {
    if (graphAgents.length === 0) return;
    if (positionsSet.current) {
      // Keep positions, just refresh node data (status/name changes).
      setNodes((cur) =>
        cur.map((n) => {
          const agent = graphAgents.find((a) => a.id === n.id);
          return agent ? { ...n, data: { agent, isCoo: agent.id === cooId } } : n;
        })
      );
      return;
    }
    const ordered = [...graphAgents].sort((a, b) =>
      a.role === "coo" ? -1 : b.role === "coo" ? 1 : a.displayName.localeCompare(b.displayName)
    );
    const pos = circleLayout(ordered.map((a) => a.id));
    setNodes(
      ordered.map((a) => ({
        id: a.id,
        type: "agent" as const,
        position: pos[a.id],
        data: { agent: a, isCoo: a.id === cooId },
      }))
    );
    positionsSet.current = true;
  }, [graphAgents, cooId, setNodes]);

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
          <ReactFlow<AgentNode>
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
