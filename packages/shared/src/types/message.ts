export enum MessageType {
  /** CEO ↔ COO chat messages */
  Chat = "chat",
  /** Superior → subordinate task assignment */
  Directive = "directive",
  /** Subordinate → superior progress/completion report */
  Report = "report",
  /** Agent status change broadcast */
  Status = "status",
}

export interface BusMessage {
  id: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  type: MessageType;
  content: string;
  metadata: Record<string, unknown>;
  projectId?: string;
  timestamp: string;
}
