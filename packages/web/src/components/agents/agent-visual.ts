import type { AgentStatus } from "@otterbot/shared";

/** Colour used for an agent's status dot and 3D animation cues. Theme-aware. */
export function statusColor(status: AgentStatus): string {
  switch (status) {
    case "working":
      return "rgb(var(--success))";
    case "thinking":
      return "rgb(var(--warning))";
    case "waiting":
      return "rgb(var(--info))";
    case "error":
      return "rgb(var(--danger))";
    case "stopped":
    case "idle":
    default:
      return "rgb(var(--neutral))";
  }
}

/** Two-letter initials fallback when an agent has no avatar artwork. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
