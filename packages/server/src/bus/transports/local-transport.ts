import type { AgentMessage } from "@otterbot/shared";
import type { Transport } from "./transport.js";

/**
 * The default transport. Agent-to-agent delivery happens entirely in-process
 * via the bus, so this transport carries nothing across a boundary — `send` is
 * a no-op and no messages are ever received from a wire.
 */
export class LocalTransport implements Transport {
  readonly id = "local" as const;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_msg: AgentMessage): Promise<void> {}
  onReceive(_handler: (msg: AgentMessage) => void): void {}
}
