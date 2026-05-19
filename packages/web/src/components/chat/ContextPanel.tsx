import { useEffect, useState } from "react";
import { useChatStore } from "../../stores/chat-store";

/** Token-budget readout for the current conversation, with a manual compact. */
export function ContextPanel({ agentId }: { agentId: string }) {
  const status = useChatStore((s) => s.contextStatus[agentId] ?? null);
  const compact = useChatStore((s) => s.compact);
  const refreshContext = useChatStore((s) => s.refreshContext);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshContext(agentId);
  }, [agentId, refreshContext]);

  if (!status) {
    return (
      <div
        data-testid="context-panel"
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgb(var(--border))",
          color: "rgb(var(--muted))",
          fontSize: 12,
        }}
      >
        Send a message to start tracking context.
      </div>
    );
  }

  const pct = Math.min(100, Math.round((status.usedTokens / status.budgetTokens) * 100));
  const barColor = status.overBudget ? "#f87171" : "rgb(var(--accent))";

  const onCompact = async () => {
    setBusy(true);
    try {
      await compact(agentId, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="context-panel"
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid rgb(var(--border))",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Context</span>
        <button
          data-testid="compact-button"
          onClick={onCompact}
          disabled={busy}
          style={{
            background: "transparent",
            color: "rgb(var(--muted))",
            border: "1px solid rgb(var(--border))",
            padding: "3px 8px",
            borderRadius: 6,
            cursor: busy ? "default" : "pointer",
            fontSize: 11,
          }}
        >
          {busy ? "Compacting…" : "Compact now"}
        </button>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "rgb(var(--border))",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: barColor }} />
      </div>
      <div style={{ fontSize: 11, color: "rgb(var(--muted))" }}>
        {status.usedTokens.toLocaleString()} / {status.budgetTokens.toLocaleString()} tokens ({pct}
        %) · recap {status.recapTokens.toLocaleString()} · recent{" "}
        {status.verbatimTokens.toLocaleString()}
      </div>
      {status.compactedMessageCount > 0 && (
        <div style={{ fontSize: 11, color: "rgb(var(--muted))" }}>
          {status.compactedMessageCount} earlier message
          {status.compactedMessageCount === 1 ? "" : "s"} summarized into the recap.
        </div>
      )}
    </div>
  );
}
