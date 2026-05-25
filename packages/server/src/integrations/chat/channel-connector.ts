import type { ChannelBotConfig, ConnectorState } from "@otterbot/shared";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";
import type { ChatClient, InboundChatMessage, MessageHandle } from "./chat-client.js";

/** Placeholder posted while the agent works, when the client supports edits. */
export const THINKING_PLACEHOLDER = "💭 _Thinking…_";

/**
 * Connects one agent to a single chat channel via a ChatClient so humans there
 * can talk to it. The `publicBot` gate decides who may talk to the agent; the
 * gate is evaluated per message and can be updated in place without
 * reconnecting. Messages run one agent turn at a time (serial queue).
 */
export class ChannelConnector {
  private cfg: ChannelBotConfig;
  private queue: Promise<unknown> = Promise.resolve();
  private connState: ConnectorState = "connecting";
  private connError: string | null = null;

  constructor(
    /** Prefix for the runtime conversation id, e.g. "slack". */
    private readonly platform: string,
    private readonly agentId: string,
    cfg: ChannelBotConfig,
    private readonly client: ChatClient,
    private readonly getRuntime: () => AgentRuntime | undefined
  ) {
    this.cfg = cfg;
  }

  async start(): Promise<void> {
    this.client.onMessage((m) => this.onInbound(m));
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  /** Update the gate (publicBot / allowedUserIds) without reconnecting. */
  updateGate(cfg: ChannelBotConfig): void {
    this.cfg = cfg;
  }

  /** Resolves once the currently-queued messages have been handled (tests). */
  async whenIdle(): Promise<void> {
    await this.queue;
  }

  getStatus(): { state: ConnectorState; error: string | null; channelId: string } {
    return { state: this.connState, error: this.connError, channelId: this.cfg.channelId };
  }
  markConnected(): void {
    this.connState = "connected";
    this.connError = null;
  }
  markError(message: string): void {
    this.connState = "error";
    this.connError = message;
  }

  private passesGate(userId: string): boolean {
    if (this.cfg.publicBot) return true;
    return this.cfg.allowedUserIds.includes(userId);
  }

  private onInbound(m: InboundChatMessage): void {
    if (m.channelId !== this.cfg.channelId) return;
    if (m.fromSelf) return;
    if (this.cfg.mentionOnly && !m.mentioned) return;
    const body = m.text.trim();
    if (!body || !this.passesGate(m.senderId)) return;
    this.queue = this.queue.then(async () => {
      const runtime = this.getRuntime();
      if (!runtime) return;
      let placeholder: MessageHandle | null = null;
      if (this.client.canEdit) {
        try {
          placeholder = await this.client.sendText(this.cfg.channelId, THINKING_PLACEHOLDER);
        } catch (err) {
          console.warn(`[${this.platform}] thinking placeholder failed for ${this.agentId}:`, err);
        }
      }
      let reply: string;
      try {
        const res = await runtime.respond({
          conversationId: `${this.platform}-${this.cfg.channelId}`,
          userMessage: body,
          onChunk: () => {},
        });
        reply = res.finalText || "(no response)";
      } catch (err) {
        reply = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      try {
        if (placeholder != null) {
          await this.client.edit(placeholder, reply);
        } else {
          await this.client.sendText(this.cfg.channelId, reply);
        }
      } catch (err) {
        console.warn(`[${this.platform}] post failed for ${this.agentId}:`, err);
      }
    });
  }
}

/** Stable signature used to decide when a connector must reconnect. */
export function connectorSignature(cfg: ChannelBotConfig | null, tokens: string[]): string {
  if (!cfg?.enabled) return "disabled";
  return JSON.stringify([cfg.channelId, cfg.mentionOnly, tokens]);
}
