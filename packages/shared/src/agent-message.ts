import type { AgentStatus, TransportId } from "./agent.js";

/**
 * Kind of an agent-to-agent bus message.
 * - request:   task delegation / question expecting a response
 * - response:  reply to a request (correlationId set)
 * - broadcast: COO -> all, or a status announcement
 * - spawn:     a parent announces it created a subagent
 * - report:    subagent -> parent: findings / result
 * - status:    a status transition (status field set)
 * - tool:      a tool call surfaced for the activity feed
 * - error:     a failure surfaced for the activity feed
 */
export type AgentMsgKind =
  | "request"
  | "response"
  | "broadcast"
  | "spawn"
  | "report"
  | "status"
  | "tool"
  | "error";

/**
 * The canonical agent-to-agent message envelope. Every message is persisted to
 * the control DB `bus_messages` table so the UI can replay full history
 * regardless of which transport carried it.
 */
export interface AgentMessage {
  id: string;
  /** Server-assigned global monotonic counter; orders the activity feed. */
  seq: number;
  kind: AgentMsgKind;
  /** Sending agent id. */
  from: string;
  /** Target agent id, or null for a broadcast. */
  to: string | null;
  /** Groups a delegation conversation. */
  threadId: string;
  /** The request id this message responds to, if any. */
  correlationId: string | null;
  /** The root spawn-task id this message belongs to, if any. */
  rootSpawnId: string | null;
  /** Human-readable content. */
  body: string;
  /** Structured payload (findings, tool args, etc.). */
  payload?: unknown;
  /** Set when kind === "status". */
  status?: AgentStatus;
  transport: TransportId;
  createdAt: string;
}
