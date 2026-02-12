import { useMemo, useEffect } from "react";
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
import { AgentNode } from "./AgentNode";
import type { Agent } from "@smoothbot/shared";

const nodeTypes = { agent: AgentNode };

function buildLayout(
  agents: Map<string, Agent>,
  userProfile?: { name: string | null; avatar: string | null },
): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Always show CEO node at the top
  const ceoLabel = userProfile?.name ? `${userProfile.name} (CEO)` : "CEO (You)";
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
        label: getRoleLabel(agent),
        role: agent.role,
        status: agent.status,
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
        style: { stroke: "hsl(0 0% 30%)" },
      });
    }
  }

  return { nodes, edges };
}

function getRoleLabel(agent: Agent): string {
  if (agent.role === "coo") return "COO";
  if (agent.role === "team_lead") return `Team Lead`;
  return `Worker ${agent.id.slice(0, 6)}`;
}

export function AgentGraph({
  userProfile,
}: {
  userProfile?: { name: string | null; avatar: string | null };
}) {
  return (
    <ReactFlowProvider>
      <AgentGraphInner userProfile={userProfile} />
    </ReactFlowProvider>
  );
}

function AgentGraphInner({
  userProfile,
}: {
  userProfile?: { name: string | null; avatar: string | null };
}) {
  const agents = useAgentStore((s) => s.agents);
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => buildLayout(agents, userProfile),
    [agents, userProfile],
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
        <span className="text-[10px] text-muted-foreground">
          {agents.size} agents
        </span>
      </div>

      {/* Graph */}
      <div className="flex-1">
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
          <Background color="hsl(0 0% 15%)" gap={20} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
}
