import { useMemo, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  type Node,
  type Edge,
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

/** Map every AgentRole to a layout tier so we can compute Y positions. */
const ROLE_TIER: Record<string, number> = {
  coo: 1,
  admin_assistant: 2,
  scheduler: 2,
  team_lead: 2,
  worker: 3,
  module_agent: 3,
};

const TIER_Y = [0, 150, 320, 490]; // CEO, COO, middle, bottom

function buildLayout(
  agents: Map<string, Agent>,
  userProfile?: { name: string | null; avatar: string | null; cooName?: string },
  onNodeClick?: (agentId: string) => void,
): {
  nodes: Node[];
  edges: Edge[];
  activeCount: number;
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Always show CEO node at the top
  const ceoLabel = userProfile?.name ?? "CEO (You)";
  nodes.push({
    id: "ceo",
    type: "agent",
    position: { x: 300, y: TIER_Y[0] },
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

  // Group agents by tier for horizontal spacing
  const tierAgents: Agent[][] = [[], [], [], []];
  for (const agent of activeAgents) {
    const tier = ROLE_TIER[agent.role] ?? 3;
    tierAgents[tier].push(agent);
  }

  for (let tier = 1; tier < tierAgents.length; tier++) {
    const group = tierAgents[tier];
    const count = group.length;
    if (count === 0) continue;

    const spacing = 220;
    const totalWidth = count * spacing;
    const startX = 300 - totalWidth / 2 + spacing / 2;

    for (let i = 0; i < count; i++) {
      const agent = group[i];
      nodes.push({
        id: agent.id,
        type: "agent",
        position: { x: startX + i * spacing, y: TIER_Y[tier] },
        data: {
          label: getRoleLabel(agent, userProfile?.cooName),
          role: agent.role,
          status: agent.status,
          onClick: onNodeClick ? () => onNodeClick(agent.id) : undefined,
        },
      });

      // Edge from parent — auto-link COO→CEO, schedulers/admin→COO
      const parentId = agent.parentId
        ?? (agent.role === "coo" ? "ceo" : null)
        ?? (agent.role === "scheduler" || agent.role === "admin_assistant" ? "coo" : null);
      if (parentId) {
        edges.push({
          id: `${parentId}-${agent.id}`,
          source: parentId,
          target: agent.id,
          animated: agent.status === "thinking" || agent.status === "acting" || agent.status === "awaiting_input",
          style: { stroke: "hsl(var(--muted-foreground))" },
        });
      }
    }
  }

  return { nodes, edges, activeCount: activeAgents.length };
}

function getRoleLabel(agent: Agent, cooName?: string): string {
  if (agent.role === "coo") return cooName ?? "COO";
  if (agent.role === "team_lead") return agent.name ?? "Team Lead";
  if (agent.role === "scheduler") return agent.name ?? "Scheduler";
  if (agent.role === "admin_assistant") return agent.name ?? "Admin Assistant";
  if (agent.role === "module_agent") return agent.name ?? "Specialist";
  return agent.name ?? `Worker ${agent.id.slice(0, 6)}`;
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

  const { nodes, edges, activeCount } = useMemo(
    () => buildLayout(agents, userProfile, handleNodeClick),
    [agents, userProfile, handleNodeClick],
  );

  const { fitView } = useReactFlow();
  const initializedRef = useRef(false);
  const prevAgentCountRef = useRef(-1);

  const fitViewOptions = useMemo(() => ({ padding: 0.25 }), []);

  const handleInit = useCallback(() => {
    initializedRef.current = true;
    prevAgentCountRef.current = activeCount;
    fitView(fitViewOptions);
  }, [fitView, fitViewOptions, activeCount]);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (prevAgentCountRef.current !== activeCount) {
      prevAgentCountRef.current = activeCount;
      requestAnimationFrame(() => fitView(fitViewOptions));
    }
  }, [activeCount, fitView, fitViewOptions]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold tracking-tight">Agent Graph</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {activeCount} agents
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
      <div className="flex-1 relative min-h-0">
        <div className="absolute inset-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            onInit={handleInit}
            zoomOnScroll={true}
            panOnScroll={false}
            panOnDrag={true}
            minZoom={0.2}
            maxZoom={1.5}
          >
            <Controls showInteractive={false} className="!bg-secondary !border-border !shadow-md [&>button]:!bg-secondary [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted" />
          </ReactFlow>
        </div>
        {selectedAgentId && <AgentDetailPanel />}
      </div>
    </div>
  );
}
