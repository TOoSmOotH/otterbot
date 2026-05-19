import type { AgentPeerAccess } from "@otterbot/shared";

interface PeerAgent {
  id: string;
  displayName: string;
}

/**
 * Editor for an agent's peer access — which other agents it may message and
 * whose memory it may read. Shared by the new-agent form and the Settings
 * "Agent communication" section.
 */
export function PeerAccessEditor({
  peers,
  peerAgents,
  onChange,
  isCoo = false,
}: {
  peers: AgentPeerAccess[];
  peerAgents: PeerAgent[];
  onChange: (next: AgentPeerAccess[]) => void;
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

  if (isCoo) {
    return <p style={hintStyle}>The COO can message and read the memory of every agent.</p>;
  }
  if (peerAgents.length === 0) {
    return <p style={hintStyle}>No other agents to grant access to yet.</p>;
  }
  return (
    <>
      <p style={hintStyle}>
        Choose which agents this agent may message. Reading a peer's memory (read-only) requires
        message permission.
      </p>
      {peerAgents.map((a) => {
        const peer = peers.find((p) => p.agentId === a.id);
        const canMessage = peer !== undefined;
        return (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ flex: 1 }}>{a.displayName}</span>
            <label style={checkboxRow}>
              <input
                type="checkbox"
                checked={canMessage}
                onChange={(e) => setPeerMessage(a.id, e.target.checked)}
              />
              Can message
            </label>
            <label style={{ ...checkboxRow, opacity: canMessage ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={peer?.shareMemory ?? false}
                disabled={!canMessage}
                onChange={(e) => setPeerMemory(a.id, e.target.checked)}
              />
              Can read memory
            </label>
          </div>
        );
      })}
    </>
  );
}

const checkboxRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
};

const hintStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "rgb(var(--muted))",
};
