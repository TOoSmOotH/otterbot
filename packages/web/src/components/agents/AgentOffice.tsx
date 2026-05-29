import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Mail } from "lucide-react";
import type {
  AgentMessage,
  AgentMsgKind,
  AgentProfileSummary,
  AgentStatus,
} from "@otterbot/shared";
import { useAgentsStore } from "../../stores/agents-store";
import { useActivityStore } from "../../stores/activity-store";
import { statusColor, initials } from "./agent-visual";
import { withToken } from "../../lib/api";
import { type } from "../../lib/typography";
import { deskLayout, DESK_W, DESK_H, GAP_X, type DeskPlacement } from "./office-layout";

/**
 * A 2D "office" view of the roster: each top-level agent sits at a desk, its
 * status drives a live visual cue, and agent-to-agent bus messages fly between
 * desks as little envelopes. All data is live — agent status from the agents
 * store (socket `agent:status`) and messages from the activity store
 * (socket `bus:message`). Built with DOM + Motion only; no canvas/game lib.
 */

const STATUSES: AgentStatus[] = [
  "idle",
  "thinking",
  "working",
  "waiting",
  "error",
  "stopped",
];

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  waiting: "waiting",
  error: "error",
  stopped: "stopped",
};

/** Looping Motion props for a status dot. Returns nothing when reduced-motion. */
function dotAnim(status: AgentStatus, reduced: boolean) {
  if (reduced) return {};
  switch (status) {
    case "working": // energetic pulse — actively doing work
      return {
        animate: { scale: [1, 1.35, 1], opacity: [1, 0.6, 1] },
        transition: { duration: 0.9, repeat: Infinity, ease: "easeInOut" },
      };
    case "thinking": // gentle breathing — waiting on the model
      return {
        animate: { scale: [1, 1.18, 1], opacity: [0.7, 1, 0.7] },
        transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
      };
    case "waiting": // slow steady blink — blocked on a peer
      return {
        animate: { opacity: [1, 0.35, 1] },
        transition: { duration: 1.8, repeat: Infinity, ease: "easeInOut" },
      };
    case "error": // quick urgent pulse
      return {
        animate: { opacity: [1, 0.4, 1] },
        transition: { duration: 0.6, repeat: Infinity, ease: "easeInOut" },
      };
    case "idle":
      return {
        animate: { opacity: [0.55, 0.8, 0.55] },
        transition: { duration: 4, repeat: Infinity, ease: "easeInOut" },
      };
    default:
      return {};
  }
}

/** CSS var for the colored tone of a message kind (mirrors ActivityView). */
const KIND_VAR: Record<AgentMsgKind, string> = {
  request: "info",
  response: "success",
  broadcast: "accent",
  spawn: "warning",
  report: "success",
  status: "neutral",
  tool: "neutral",
  error: "danger",
};

/** Kinds that represent agent-to-agent traffic worth animating. */
const TRAFFIC_KINDS: Set<AgentMsgKind> = new Set([
  "request",
  "response",
  "broadcast",
  "spawn",
  "report",
]);

const MAX_ENVELOPES = 8;

interface Envelope {
  key: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
}

export function AgentOffice() {
  const agents = useAgentsStore((s) => s.agents);
  const messages = useActivityStore((s) => s.messages);
  const bindActivity = useActivityStore((s) => s.bindSocket);
  const loadActivity = useActivityStore((s) => s.load);
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    bindActivity();
    void loadActivity();
  }, [bindActivity, loadActivity]);

  // Top-level agents get desks; subagents are drawn as clusters at their parent.
  const deskAgents = useMemo(
    () => agents.filter((a) => a.role !== "subagent"),
    [agents]
  );
  const subagentsByParent = useMemo(() => {
    const m = new Map<string, AgentProfileSummary[]>();
    for (const a of agents) {
      if (a.role === "subagent" && a.parentId) {
        const list = m.get(a.parentId) ?? [];
        list.push(a);
        m.set(a.parentId, list);
      }
    }
    return m;
  }, [agents]);

  // Responsive column count driven by the floor container width.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setCols(Math.max(1, Math.floor((w - GAP_X) / (DESK_W + GAP_X))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout recomputes only when the agent set or column count actually changes,
  // never on a status tick (ordering is keyed by immutable id).
  const orderedKey = useMemo(
    () =>
      deskAgents
        .map((a) => a.id)
        .sort()
        .join(","),
    [deskAgents]
  );
  const floor = useMemo(
    () => deskLayout(deskAgents, cols),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderedKey, cols]
  );
  const byId = useMemo(() => {
    const m = new Map<string, AgentProfileSummary>();
    for (const a of deskAgents) m.set(a.id, a);
    return m;
  }, [deskAgents]);
  const centerOf = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const d of floor.desks) m.set(d.id, { x: d.cx, y: d.cy });
    return m;
  }, [floor]);

  // Animate envelopes for newly-arrived bus messages. Seed lastSeq to the
  // current max on mount so the 300-message backlog doesn't all fire at once.
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const lastSeqRef = useRef<number>(-1);
  useEffect(() => {
    if (messages.length === 0) return;
    const maxSeq = messages[messages.length - 1].seq;
    if (lastSeqRef.current < 0) {
      lastSeqRef.current = maxSeq;
      return;
    }
    const fresh = messages.filter((m) => m.seq > lastSeqRef.current);
    lastSeqRef.current = maxSeq;

    const flights: Envelope[] = [];
    for (const m of fresh) {
      if (!TRAFFIC_KINDS.has(m.kind)) continue;
      const from = centerOf.get(m.from);
      if (!from) continue;
      const color = `rgb(var(--${KIND_VAR[m.kind] ?? "border"}))`;
      const targets =
        m.to === null
          ? floor.desks.filter((d) => d.id !== m.from).map((d) => d.id)
          : [m.to];
      for (const targetId of targets) {
        const to = centerOf.get(targetId);
        if (!to) continue; // recipient not on the floor (e.g. a subagent)
        flights.push({
          key: `${m.seq}:${targetId}`,
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          color,
        });
      }
    }
    if (flights.length === 0) return;
    setEnvelopes((prev) => [...prev, ...flights].slice(-MAX_ENVELOPES));
  }, [messages, centerOf, floor]);

  const removeEnvelope = (key: string) =>
    setEnvelopes((prev) => prev.filter((e) => e.key !== key));

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
        <span style={{ ...type.h2 }}>Office</span>
        <Legend />
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          overflow: "auto",
          background: "rgb(var(--surface-sunken))",
        }}
      >
        {deskAgents.length === 0 ? (
          <div style={{ padding: 24, color: "rgb(var(--muted))", ...type.body }}>
            No agents yet. Create one to populate the office.
          </div>
        ) : (
          <div
            style={{
              position: "relative",
              width: floor.width,
              height: floor.height,
              margin: "24px auto",
            }}
          >
            {floor.desks.map((d) => {
              const agent = byId.get(d.id);
              if (!agent) return null;
              return (
                <Desk
                  key={d.id}
                  placement={d}
                  agent={agent}
                  subagents={subagentsByParent.get(d.id) ?? []}
                  reduced={reduced}
                />
              );
            })}

            <AnimatePresence>
              {envelopes.map((e) => (
                <motion.div
                  key={e.key}
                  initial={{ x: e.fromX, y: e.fromY, scale: 0.4, opacity: 0 }}
                  animate={{
                    x: e.toX,
                    y: e.toY,
                    scale: 1,
                    opacity: 1,
                  }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.9, ease: "easeInOut" }}
                  onAnimationComplete={() => removeEnvelope(e.key)}
                  style={{
                    position: "absolute",
                    left: -8,
                    top: -8,
                    color: e.color,
                    pointerEvents: "none",
                    filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))",
                    zIndex: 5,
                  }}
                >
                  <Mail size={16} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function Desk({
  placement,
  agent,
  subagents,
  reduced,
}: {
  placement: DeskPlacement;
  agent: AgentProfileSummary;
  subagents: AgentProfileSummary[];
  reduced: boolean;
}) {
  const color = statusColor(agent.status);
  const stopped = agent.status === "stopped";
  const thumb = agent.artwork.avatar;
  const shown = subagents.slice(0, 3);
  const extra = subagents.length - shown.length;

  return (
    <div
      style={{
        position: "absolute",
        left: placement.x,
        top: placement.y,
        width: placement.w,
        height: placement.h,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        filter: stopped ? "grayscale(1) opacity(0.55)" : undefined,
      }}
    >
      {/* Desk surface */}
      <div
        style={{
          position: "relative",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "10px 8px 12px",
          borderRadius: 12,
          background: "rgb(var(--surface-elevated))",
          border: `1px solid ${
            placement.isCoo ? "rgb(var(--accent) / 0.5)" : "rgb(var(--border))"
          }`,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {/* Avatar */}
        <span
          style={{
            position: "relative",
            width: 44,
            height: 44,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 600,
            background: "rgb(var(--surface))",
            border: `2px solid ${color}`,
            color: "rgb(var(--fg))",
            overflow: "hidden",
          }}
        >
          {thumb ? (
            <img
              src={withToken(thumb)}
              alt=""
              width={44}
              height={44}
              style={{ objectFit: "cover" }}
            />
          ) : (
            initials(agent.displayName)
          )}
        </span>

        {/* Name + COO badge */}
        <span
          style={{
            ...type.small,
            fontWeight: 600,
            color: "rgb(var(--fg))",
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {agent.displayName}
        </span>

        {/* Status row */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            ...type.micro,
            fontWeight: 500,
            letterSpacing: 0,
            color: "rgb(var(--muted))",
          }}
        >
          <motion.span
            {...dotAnim(agent.status, reduced)}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: color,
              display: "inline-block",
            }}
          />
          {STATUS_LABEL[agent.status]}
        </span>

        {placement.isCoo && (
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

        {/* Subagent cluster — small transient dots at the desk corner */}
        <div
          style={{
            position: "absolute",
            right: -6,
            bottom: -6,
            display: "flex",
            alignItems: "center",
          }}
        >
          <AnimatePresence>
            {shown.map((sub, i) => (
              <motion.span
                key={sub.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                title={`${sub.displayName} (subagent)`}
                style={{
                  width: 18,
                  height: 18,
                  marginLeft: i === 0 ? 0 : -7,
                  borderRadius: "50%",
                  background: "rgb(var(--surface))",
                  border: `1.5px solid ${statusColor(sub.status)}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 8,
                  fontWeight: 700,
                  color: "rgb(var(--fg))",
                  overflow: "hidden",
                }}
              >
                {sub.artwork.avatar ? (
                  <img
                    src={withToken(sub.artwork.avatar)}
                    alt=""
                    width={18}
                    height={18}
                    style={{ objectFit: "cover" }}
                  />
                ) : (
                  initials(sub.displayName)
                )}
              </motion.span>
            ))}
          </AnimatePresence>
          {extra > 0 && (
            <span
              style={{
                marginLeft: -7,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "rgb(var(--surface))",
                border: "1.5px solid rgb(var(--border))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 8,
                fontWeight: 700,
                color: "rgb(var(--muted))",
              }}
            >
              +{extra}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {STATUSES.map((s) => (
        <span
          key={s}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            ...type.small,
            color: "rgb(var(--muted))",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: statusColor(s),
              display: "inline-block",
            }}
          />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}
