import { useRef, useEffect, useState, useMemo } from "react";
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
  return { name: agentId.slice(0, 8), role: "worker" };
}

// ---------------------------------------------------------------------------
// Grouping utilities
// ---------------------------------------------------------------------------

interface ConversationGroup {
  key: string;
  participantA: string | null;
  participantB: string | null;
  messages: BusMessage[];
  latestTimestamp: string;
}

/** Canonical key for a bidirectional pair so CEO->COO and COO->CEO land together */
function makePairKey(a: string | null, b: string | null): string {
  const sa = a ?? "__ceo__";
  const sb = b ?? "__ceo__";
  return sa < sb ? `${sa}::${sb}` : `${sb}::${sa}`;
}

function groupByConversationPair(messages: BusMessage[]): ConversationGroup[] {
  const map = new Map<string, ConversationGroup>();

  for (const msg of messages) {
    const key = makePairKey(msg.fromAgentId, msg.toAgentId);
    let group = map.get(key);
    if (!group) {
      // Determine canonical A/B order matching the key
      const sa = msg.fromAgentId ?? "__ceo__";
      const sb = msg.toAgentId ?? "__ceo__";
      const [pA, pB] = sa < sb
        ? [msg.fromAgentId, msg.toAgentId]
        : [msg.toAgentId, msg.fromAgentId];
      group = { key, participantA: pA, participantB: pB, messages: [], latestTimestamp: msg.timestamp };
      map.set(key, group);
    }
    group.messages.push(msg);
    if (msg.timestamp > group.latestTimestamp) {
      group.latestTimestamp = msg.timestamp;
    }
  }

  // Sort groups by latest timestamp descending (most recent first)
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

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

function ConversationGroupHeader({
  group,
  expanded,
  onToggle,
  ceoName,
  cooName,
}: {
  group: ConversationGroup;
  expanded: boolean;
  onToggle: () => void;
  ceoName?: string;
  cooName?: string;
}) {
  const a = getAgentLabel(group.participantA, ceoName, cooName);
  const b = getAgentLabel(group.participantB, ceoName, cooName);

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 transition-colors text-left"
    >
      {/* Rotating chevron */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={cn(
          "text-muted-foreground shrink-0 transition-transform duration-150",
          expanded && "rotate-90",
        )}
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>

      {/* Participant badges */}
      <span
        className={cn(
          "text-[10px] font-medium px-1.5 py-0.5 rounded",
          ROLE_COLORS[a.role] ?? "bg-muted text-muted-foreground",
        )}
      >
        {a.name}
      </span>
      <span className="text-[10px] text-muted-foreground">&harr;</span>
      <span
        className={cn(
          "text-[10px] font-medium px-1.5 py-0.5 rounded",
          ROLE_COLORS[b.role] ?? "bg-muted text-muted-foreground",
        )}
      >
        {b.name}
      </span>

      {/* Count + latest time */}
      <span className="text-[10px] text-muted-foreground ml-auto">
        {group.messages.length} msg{group.messages.length !== 1 ? "s" : ""}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {new Date(group.latestTimestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function MessageStream({
  userProfile,
  onCollapse,
}: {
  userProfile?: { name: string | null; cooName?: string };
  onCollapse?: () => void;
}) {
  const messages = useMessageStore((s) => s.messages);
  const agentFilter = useMessageStore((s) => s.agentFilter);
  const setAgentFilter = useMessageStore((s) => s.setAgentFilter);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  let filtered = agentFilter
    ? messages.filter(
        (m) =>
          m.fromAgentId === agentFilter || m.toAgentId === agentFilter,
      )
    : messages;

  if (activeProjectId) {
    filtered = filtered.filter((m) => m.projectId === activeProjectId);
  }

  const groups = useMemo(() => groupByConversationPair(filtered), [filtered]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [groups, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
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
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-secondary"
              title="Collapse panel"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
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
          groups.map((group) => (
            <div key={group.key}>
              <ConversationGroupHeader
                group={group}
                expanded={!!expandedGroups[group.key]}
                onToggle={() => toggleGroup(group.key)}
                ceoName={userProfile?.name ?? undefined}
                cooName={userProfile?.cooName}
              />
              {expandedGroups[group.key] && (
                <div className="divide-y divide-border/30 bg-secondary/20">
                  {group.messages.map((msg) => (
                    <MessageItem
                      key={msg.id}
                      message={msg}
                      ceoName={userProfile?.name ?? undefined}
                      cooName={userProfile?.cooName}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
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
