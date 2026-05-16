import type { AgentStatus } from "@otterbot/shared";

/** Colour used for an agent's status dot and 3D animation cues. */
export function statusColor(status: AgentStatus): string {
  switch (status) {
    case "working":
      return "#4ade80";
    case "thinking":
      return "#fbbf24";
    case "waiting":
      return "#6b8cff";
    case "error":
      return "#f87171";
    case "stopped":
    case "idle":
    default:
      return "#5a5a64";
  }
}

/** Two-letter initials fallback when an agent has no avatar artwork. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
