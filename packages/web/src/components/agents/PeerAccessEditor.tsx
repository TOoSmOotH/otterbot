import type { AgentPeerAccess } from "@otterbot/shared";
import { ArrowRight } from "lucide-react";
import { Icon } from "../ui/Icon";

interface PeerAgent {
  id: string;
  displayName: string;
}

/** An agent that may message the agent being edited (shown read-only). */
export interface IncomingPeer {
  agentId: string;
  displayName: string;
  /** "always" = the COO, which can reach every agent. */
  level: "message" | "memory" | "always";
}

/**
 * Editor for an agent's peer access. The "Outgoing" section is editable — which
 * other agents this agent may message and whose memory it may read. The optional
 * "Incoming" section shows, read-only, which agents may message *this* agent
 * (controlled by those agents). Every row spells out the direction with the
 * agent's name and an arrow so "who can talk to whom" is unambiguous.
 *
 * Shared by the new-agent form (no incoming section) and the Agent Studio
 * "Peers" tab (with incoming).
 */
export function PeerAccessEditor({
  agentName,
  peers,
  peerAgents,
  onChange,
  incoming,
  isCoo = false,
}: {
  agentName: string;
  peers: AgentPeerAccess[];
  peerAgents: PeerAgent[];
  onChange: (next: AgentPeerAccess[]) => void;
  /** When provided, renders the read-only "Incoming" section. */
  incoming?: IncomingPeer[];
  isCoo?: boolean;
}) {
  const setPeerMessage = (peerId: string, on: boolean) =>
    onChange(
      on
        ? peers.some((p) => p.agentId === peerId)
          ? peers
          : [...peers, { agentId: peerId, shareMemory: false }]
        : peers.filter((p) => p.agentId !== peerId)
    );

  const setPeerMemory = (peerId: string, on: boolean) =>
    onChange(peers.map((p) => (p.agentId === peerId ? { ...p, shareMemory: on } : p)));

  const name = agentName || "this agent";

  return (
    <>
      <section>
        <p style={sectionLabel}>Outgoing — agents {name} can reach</p>
        {isCoo ? (
          <p style={hintStyle}>The COO can message and read the memory of every agent.</p>
        ) : peerAgents.length === 0 ? (
          <p style={hintStyle}>No other agents to grant access to yet.</p>
        ) : (
          peerAgents.map((a) => {
            const peer = peers.find((p) => p.agentId === a.id);
            const canMessage = peer !== undefined;
            return (
              <div key={a.id} style={rowStyle}>
                <span style={dirLabel}>
                  <span style={selfName}>{name}</span>
                  <Icon icon={ArrowRight} size={14} />
                  <span>{a.displayName}</span>
                </span>
                <label style={checkboxRow}>
                  <input
                    type="checkbox"
                    checked={canMessage}
                    onChange={(e) => setPeerMessage(a.id, e.target.checked)}
                  />
                  message
                </label>
                <label style={{ ...checkboxRow, opacity: canMessage ? 1 : 0.5 }}>
                  <input
                    type="checkbox"
                    checked={peer?.shareMemory ?? false}
                    disabled={!canMessage}
                    onChange={(e) => setPeerMemory(a.id, e.target.checked)}
                  />
                  read memory
                </label>
              </div>
            );
          })
        )}
      </section>

      {incoming !== undefined && (
        <section style={{ marginTop: 16 }}>
          <p style={sectionLabel}>Incoming — who can reach {name}</p>
          {incoming.length === 0 ? (
            <p style={hintStyle}>No agents can message {name} yet.</p>
          ) : (
            <>
              {incoming.map((p) => {
                const canReadMemory = p.level === "memory" || p.level === "always";
                return (
                  <div key={p.agentId} style={rowStyle}>
                    <span style={dirLabel}>
                      <span style={selfName}>{p.displayName}</span>
                      {p.level === "always" && <span style={alwaysTag}>always</span>}
                    </span>
                    <label style={checkboxRow}>
                      <input type="checkbox" checked disabled readOnly />
                      can message
                    </label>
                    <label style={{ ...checkboxRow, opacity: canReadMemory ? 1 : 0.5 }}>
                      <input type="checkbox" checked={canReadMemory} disabled readOnly />
                      read my memory
                    </label>
                  </div>
                );
              })}
              <p style={hintStyle}>
                Controlled by the other agent — change these on that agent's Peers tab.
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: 13,
  padding: "3px 0",
};

const dirLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flex: 1,
  minWidth: 0,
  color: "rgb(var(--fg))",
};

const selfName: React.CSSProperties = {
  fontWeight: 600,
};

const alwaysTag: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "rgb(var(--muted))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 4,
  padding: "0 5px",
};

const checkboxRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  color: "rgb(var(--muted))",
};

const sectionLabel: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: 12,
  fontWeight: 600,
  color: "rgb(var(--fg))",
};

const hintStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "rgb(var(--muted))",
};
