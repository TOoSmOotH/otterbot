import { nanoid } from "nanoid";
import type { AgentMessage, TransportId } from "@otterbot/shared";
import type { ChatClient, InboundChatMessage } from "../../integrations/chat/chat-client.js";
import type { Transport } from "./transport.js";

/**
 * Routes agent-to-agent messages through a shared chat room via a ChatClient.
 * Each agent message is rendered by the provider (Discord embed / Matrix notice
 * / Slack formatted text). A human message typed in the room becomes a request
 * routed to the COO, letting a person talk to the swarm.
 */
export class ChatProviderTransport implements Transport {
  private receiveHandler: (msg: AgentMessage) => void = () => {};

  constructor(
    readonly id: TransportId,
    private readonly client: ChatClient,
    private readonly roomId: string
  ) {}

  async start(): Promise<void> {
    this.client.onMessage((m) => this.onInbound(m));
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async send(msg: AgentMessage): Promise<void> {
    // A failed post must not break bus delivery — warn and move on, as the
    // per-provider transports this generalises did.
    try {
      await this.client.sendRich(this.roomId, {
        author: msg.from,
        kind: msg.kind,
        to: msg.to ?? "all",
        body: msg.body,
        id: msg.id,
      });
    } catch (err) {
      console.warn(`[${this.id}] transport send failed:`, err);
    }
  }

  onReceive(handler: (msg: AgentMessage) => void): void {
    this.receiveHandler = handler;
  }

  private onInbound(m: InboundChatMessage): void {
    if (m.channelId !== this.roomId || m.fromSelf) return;
    const body = m.text.trim();
    if (!body) return;
    this.receiveHandler({
      id: nanoid(),
      seq: 0,
      kind: "request",
      from: `${this.id}-user`,
      to: "coo",
      threadId: nanoid(),
      correlationId: null,
      rootSpawnId: null,
      body,
      transport: this.id,
      createdAt: new Date().toISOString(),
    });
  }
}
