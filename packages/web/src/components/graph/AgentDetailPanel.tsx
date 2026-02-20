import { useEffect, useRef, useState, useCallback } from "react";
import { useAgentActivityStore } from "../../stores/agent-activity-store";
import { useAgentStore } from "../../stores/agent-store";
import { getSocket } from "../../lib/socket";
import { cn } from "../../lib/utils";

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  coo: { label: "COO", className: "bg-violet-500/20 text-violet-300" },
  team_lead: { label: "Team Lead", className: "bg-amber-500/20 text-amber-300" },
  worker: { label: "Worker", className: "bg-cyan-500/20 text-cyan-300" },
};

const STATUS_DOT: Record<string, string> = {
  idle: "bg-zinc-500",
  thinking: "bg-blue-500 animate-pulse",
  acting: "bg-emerald-500 animate-pulse",
  awaiting_input: "bg-orange-500 animate-pulse",
  done: "bg-zinc-600",
  error: "bg-red-500",
};

export function AgentDetailPanel() {
  const selectedAgentId = useAgentActivityStore((s) => s.selectedAgentId);
  const clearSelection = useAgentActivityStore((s) => s.clearSelection);
  const agentStreams = useAgentActivityStore((s) => s.agentStreams);
  const agentToolCalls = useAgentActivityStore((s) => s.agentToolCalls);
  const agentMessages = useAgentActivityStore((s) => s.agentMessages);
  const agentActivity = useAgentActivityStore((s) => s.agentActivity);
  const loadAgentActivity = useAgentActivityStore((s) => s.loadAgentActivity);
  const agents = useAgentStore((s) => s.agents);
  const [activeTab, setActiveTab] = useState<"activity" | "tools" | "messages">("activity");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(280);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Load agent activity when an agent is selected
  useEffect(() => {
    if (!selectedAgentId) return;
    const socket = getSocket();
    socket.emit("agent:activity", { agentId: selectedAgentId }, (result) => {
      loadAgentActivity(selectedAgentId, result);
    });
  }, [selectedAgentId, loadAgentActivity]);

  // Auto-scroll to bottom of activity
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startY.current = e.clientY;
    startHeight.current = panelHeight;
    e.preventDefault();
  }, [panelHeight]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - e.clientY;
      setPanelHeight(Math.max(150, Math.min(600, startHeight.current + delta)));
    };
    const onMouseUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  if (!selectedAgentId) return null;

  const agent = agents.get(selectedAgentId);
  const stream = agentStreams.get(selectedAgentId);
  const toolCalls = agentToolCalls.get(selectedAgentId) ?? [];
  const messages = agentMessages.get(selectedAgentId) ?? [];
  const activity = agentActivity.get(selectedAgentId) ?? [];

  const badge = agent ? ROLE_BADGE[agent.role] ?? { label: agent.role, className: "bg-zinc-500/20 text-zinc-300" } : null;
  const statusDot = agent ? STATUS_DOT[agent.status] ?? STATUS_DOT.idle : STATUS_DOT.idle;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 bg-background border-t border-border z-50 flex flex-col"
      style={{ height: panelHeight }}
    >
      {/* Resize handle */}
      <div
        className="h-1.5 cursor-ns-resize bg-border hover:bg-primary/50 transition-colors flex-shrink-0"
        onMouseDown={onDragStart}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          {badge && (
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", badge.className)}>
              {badge.label}
            </span>
          )}
          <span className="text-xs font-medium">{selectedAgentId === "coo" ? "COO" : (agent?.name ?? selectedAgentId.slice(0, 10))}</span>
          <div className={cn("w-2 h-2 rounded-full", statusDot)} />
          {agent && (
            <span className="text-[10px] text-muted-foreground capitalize">{agent.status}</span>
          )}
        </div>
        <button
          onClick={clearSelection}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-secondary"
          title="Close"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border flex-shrink-0">
        {(["activity", "tools", "messages"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-3 py-1.5 text-[11px] font-medium transition-colors capitalize",
              activeTab === tab
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "tools" ? `Tools (${toolCalls.length})` : tab === "messages" ? `Messages (${messages.length})` : tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 text-xs">
        {activeTab === "activity" && (
          <ActivityTab stream={stream} activity={activity} />
        )}
        {activeTab === "tools" && (
          <ToolCallsTab toolCalls={toolCalls} />
        )}
        {activeTab === "messages" && (
          <MessagesTab messages={messages} />
        )}
      </div>
    </div>
  );
}

function ActivityTab({
  stream,
  activity,
}: {
  stream?: { tokens: string; thinking: string; isThinking: boolean };
  activity: Array<{ type: string; content: string; timestamp: string }>;
}) {
  // Show live stream first, then persisted activity
  const hasLiveContent = stream && (stream.thinking || stream.tokens);

  return (
    <div className="space-y-2">
      {/* Persisted activity */}
      {activity
        .filter((a) => a.type === "thinking" || a.type === "response")
        .map((a, i) => (
          <div key={i} className="space-y-0.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {a.type === "thinking" ? "Thinking" : "Response"}
            </div>
            <pre className={cn(
              "whitespace-pre-wrap text-xs leading-relaxed",
              a.type === "thinking" ? "text-blue-400/70 italic" : "text-foreground",
            )}>
              {a.content}
            </pre>
          </div>
        ))}

      {/* Live thinking stream */}
      {stream?.isThinking && stream.thinking && (
        <div className="space-y-0.5">
          <div className="text-[10px] text-blue-400 uppercase tracking-wider animate-pulse">
            Thinking...
          </div>
          <pre className="whitespace-pre-wrap text-xs text-blue-400/70 italic leading-relaxed">
            {stream.thinking}
          </pre>
        </div>
      )}

      {/* Live response stream */}
      {stream?.tokens && (
        <div className="space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Response (streaming)
          </div>
          <pre className="whitespace-pre-wrap text-xs text-foreground leading-relaxed">
            {stream.tokens}
          </pre>
        </div>
      )}

      {!hasLiveContent && activity.length === 0 && (
        <div className="text-muted-foreground text-center py-4">No activity yet</div>
      )}
    </div>
  );
}

function ToolCallsTab({
  toolCalls,
}: {
  toolCalls: Array<{ toolName: string; args: Record<string, unknown>; timestamp: string }>;
}) {
  if (toolCalls.length === 0) {
    return <div className="text-muted-foreground text-center py-4">No tool calls</div>;
  }

  return (
    <div className="space-y-2">
      {toolCalls.map((tc, i) => (
        <div key={i} className="border border-border rounded p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-mono text-emerald-400 text-[11px]">{tc.toolName}</span>
            <span className="text-[10px] text-muted-foreground">
              {new Date(tc.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap overflow-hidden max-h-24">
            {JSON.stringify(tc.args, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function MessagesTab({ messages }: { messages: Array<{ fromAgentId: string | null; toAgentId: string | null; type: string; content: string; timestamp: string }> }) {
  if (messages.length === 0) {
    return <div className="text-muted-foreground text-center py-4">No messages</div>;
  }

  return (
    <div className="space-y-2">
      {messages.map((m, i) => (
        <div key={i} className="border border-border rounded p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px]">
              <span className="text-muted-foreground">{m.fromAgentId ?? "CEO"}</span>
              <span className="text-muted-foreground mx-1">&rarr;</span>
              <span className="text-muted-foreground">{m.toAgentId ?? "CEO"}</span>
            </span>
            <span className={cn(
              "text-[10px] font-medium px-1 rounded",
              m.type === "directive" ? "text-amber-400" :
              m.type === "report" ? "text-emerald-400" :
              m.type === "chat" ? "text-blue-400" :
              "text-muted-foreground"
            )}>
              {m.type}
            </span>
          </div>
          <pre className="text-[11px] text-foreground whitespace-pre-wrap overflow-hidden max-h-32">
            {m.content}
          </pre>
          <div className="text-[10px] text-muted-foreground">
            {new Date(m.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  );
}
