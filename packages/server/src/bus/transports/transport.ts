import type { AgentMessage, TransportId } from "@otterbot/shared";

/**
 * A transport carries agent-to-agent messages to/from the outside world.
 * The bus always delivers locally for UI observability; a transport is only
 * responsible for crossing a process/network boundary (e.g. Discord).
 */
export interface Transport {
  readonly id: TransportId;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Send an outbound message over the wire. Local transport is a no-op. */
  send(msg: AgentMessage): Promise<void>;
  /** Register a handler for messages arriving from the wire. */
  onReceive(handler: (msg: AgentMessage) => void): void;
}
