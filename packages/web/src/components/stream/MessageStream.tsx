import { useRef, useEffect, useState } from "react";
import { useMessageStore } from "../../stores/message-store";
import { useProjectStore } from "../../stores/project-store";
import { cn } from "../../lib/utils";
import type { BusMessage } from "@smoothbot/shared";

const ROLE_COLORS: Record<string, string> = {
  coo: "bg-violet-500/20 text-violet-400",
  team_lead: "bg-amber-500/20 text-amber-400",
  worker: "bg-cyan-500/20 text-cyan-400",
  ceo: "bg-emerald-500/20 text-emerald-400",
};

const TYPE_LABELS: Record<string, string> = {
  chat: "Chat",
  directive: "Directive",
  report: "Report",
  status: "Status",
};

function getAgentLabel(agentId: string | null, ceoName?: string, cooName?: string): { name: string; role: string } {
  if (agentId === null) return { name: ceoName || "CEO", role: "ceo" };
  if (agentId === "coo") return { name: cooName || "COO", role: "coo" };
  // For other agents, abbreviate the ID
  return { name: agentId.slice(0, 8), role: "worker" };
}

function MessageItem({ message, ceoName, cooName }: { message: BusMessage; ceoName?: string; cooName?: string }) {
  const from = getAgentLabel(message.fromAgentId, ceoName, cooName);
  const to = getAgentLabel(message.toAgentId, ceoName, cooName);

  return (
    <div className="group px-3 py-2 hover:bg-secondary/50 transition-colors">
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded",
            ROLE_COLORS[from.role] ?? "bg-muted text-muted-foreground",
          )}
        >
          {from.name}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span
          className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded",
            ROLE_COLORS[to.role] ?? "bg-muted text-muted-foreground",
          )}
        >
          {to.name}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {TYPE_LABELS[message.type] ?? message.type}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </div>
      <p className="text-xs text-foreground/80 leading-relaxed line-clamp-3 pl-1">
        {message.content}
      </p>
    </div>
  );
}

export function MessageStream({ userProfile }: { userProfile?: { name: string | null; cooName?: string } }) {
  const messages = useMessageStore((s) => s.messages);
  const agentFilter = useMessageStore((s) => s.agentFilter);
  const setAgentFilter = useMessageStore((s) => s.setAgentFilter);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  let filtered = agentFilter
    ? messages.filter(
        (m) =>
          m.fromAgentId === agentFilter || m.toAgentId === agentFilter,
      )
    : messages;

  if (activeProjectId) {
    filtered = filtered.filter((m) => m.projectId === activeProjectId);
  }

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold tracking-tight">Message Bus</h2>
        <div className="flex items-center gap-2">
          {agentFilter && (
            <button
              onClick={() => setAgentFilter(null)}
              className="text-[10px] bg-secondary px-2 py-0.5 rounded hover:bg-secondary/80"
            >
              Clear filter
            </button>
          )}
          <span className="text-[10px] text-muted-foreground">
            {filtered.length} msgs
          </span>
        </div>
      </div>

      {/* Stream */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto divide-y divide-border/50"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">
              No messages yet
            </p>
          </div>
        ) : (
          filtered.map((msg) => <MessageItem key={msg.id} message={msg} ceoName={userProfile?.name ?? undefined} cooName={userProfile?.cooName} />)
        )}
      </div>

      {/* Scroll lock indicator */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (containerRef.current) {
              containerRef.current.scrollTop =
                containerRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-2 right-2 text-[10px] bg-primary text-primary-foreground px-2 py-1 rounded-full shadow-lg"
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
