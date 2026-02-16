import { useMemo, useEffect, useCallback } from "react";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAgentStore } from "../../stores/agent-store";
import { useAgentActivityStore } from "../../stores/agent-activity-store";
import { AgentNode } from "./AgentNode";
import { AgentDetailPanel } from "./AgentDetailPanel";
import type { Agent } from "@otterbot/shared";

const nodeTypes = { agent: AgentNode };

function buildLayout(
  agents: Map<string, Agent>,
  userProfile?: { name: string | null; avatar: string | null; cooName?: string },
  onNodeClick?: (agentId: string) => void,
): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Always show CEO node at the top
  const ceoLabel = userProfile?.name ?? "CEO (You)";
  nodes.push({
    id: "ceo",
    type: "agent",
    position: { x: 300, y: 0 },
    data: {
      label: ceoLabel,
      role: "ceo",
      status: "idle",
      avatarUrl: userProfile?.avatar ?? undefined,
    },
  });

  // Filter out "done" agents (defense-in-depth, API already filters)
  const activeAgents = Array.from(agents.values()).filter(
    (a) => a.status !== "done",
  );

  // Group agents by parent for hierarchical layout
  const byParent = new Map<string | null, Agent[]>();
  for (const agent of activeAgents) {
    const parentId = agent.parentId;
    if (!byParent.has(parentId)) {
      byParent.set(parentId, []);
    }
    byParent.get(parentId)!.push(agent);
  }

  // Position agents in levels
  const levelY: Record<string, number> = {
    coo: 100,
    team_lead: 220,
    worker: 340,
  };

  // Count agents per level for horizontal spacing
  const levelCounts: Record<string, number> = { coo: 0, team_lead: 0, worker: 0 };
  for (const agent of activeAgents) {
    levelCounts[agent.role] = (levelCounts[agent.role] || 0) + 1;
  }

  const levelIndex: Record<string, number> = { coo: 0, team_lead: 0, worker: 0 };

  for (const agent of activeAgents) {
    const count = levelCounts[agent.role] || 1;
    const idx = levelIndex[agent.role]++;
    const totalWidth = count * 180;
    const startX = 300 - totalWidth / 2 + 90;
    const x = startX + idx * 180;

    nodes.push({
      id: agent.id,
      type: "agent",
      position: { x, y: levelY[agent.role] ?? 340 },
      data: {
        label: getRoleLabel(agent, userProfile?.cooName),
        role: agent.role,
        status: agent.status,
        onClick: onNodeClick ? () => onNodeClick(agent.id) : undefined,
      },
    });

    // Edge from parent
    const parentId = agent.parentId ?? (agent.role === "coo" ? "ceo" : null);
    if (parentId) {
      edges.push({
        id: `${parentId}-${agent.id}`,
        source: parentId,
        target: agent.id,
        animated: agent.status === "thinking" || agent.status === "acting",
        style: { stroke: "hsl(var(--muted-foreground))" },
      });
    }
  }

  return { nodes, edges };
}

function getRoleLabel(agent: Agent, cooName?: string): string {
  if (agent.role === "coo") return cooName ?? "COO";
  if (agent.role === "team_lead") return `Team Lead`;
  return `Worker ${agent.id.slice(0, 6)}`;
}

export function AgentGraph({
  userProfile,
  onToggleView,
}: {
  userProfile?: { name: string | null; avatar: string | null; cooName?: string };
  onToggleView?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <AgentGraphInner userProfile={userProfile} onToggleView={onToggleView} />
    </ReactFlowProvider>
  );
}

function AgentGraphInner({
  userProfile,
  onToggleView,
}: {
  userProfile?: { name: string | null; avatar: string | null; cooName?: string };
  onToggleView?: () => void;
}) {
  const agents = useAgentStore((s) => s.agents);
  const selectAgent = useAgentActivityStore((s) => s.selectAgent);
  const selectedAgentId = useAgentActivityStore((s) => s.selectedAgentId);

  const handleNodeClick = useCallback((agentId: string) => {
    selectAgent(agentId);
  }, [selectAgent]);

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => buildLayout(agents, userProfile, handleNodeClick),
    [agents, userProfile, handleNodeClick],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
    // Re-fit the view after nodes change so all agents are visible
    requestAnimationFrame(() => fitView());
  }, [layoutNodes, layoutEdges, setNodes, setEdges, fitView]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold tracking-tight">Agent Graph</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {agents.size} agents
          </span>
          {onToggleView && (
            <button
              onClick={onToggleView}
              title="Switch to Live View"
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-secondary"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Graph */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnScroll={false}
          panOnScroll
          minZoom={0.5}
          maxZoom={1.5}
        >
          <Background color="hsl(var(--secondary))" gap={20} size={1} />
        </ReactFlow>
        {selectedAgentId && <AgentDetailPanel />}
      </div>
    </div>
  );
}
