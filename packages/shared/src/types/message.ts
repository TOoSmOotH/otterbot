export enum MessageType {
  /** CEO ↔ COO chat messages */
  Chat = "chat",
  /** Superior → subordinate task assignment */
  Directive = "directive",
  /** Subordinate → superior progress/completion report */
  Report = "report",
  /** Agent status change broadcast */
  Status = "status",
  /** Request current status from an agent */
  StatusRequest = "status_request",
  /** Response to a status request */
  StatusResponse = "status_response",
}

export interface BusMessage {
  id: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  type: MessageType;
  content: string;
  metadata: Record<string, unknown>;
  projectId?: string;
  conversationId?: string;
  correlationId?: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
