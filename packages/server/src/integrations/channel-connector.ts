import type { ChannelBotConfig, ConnectorState } from "@otterbot/shared";
import type { AgentRuntime } from "../runtime/agent-runtime.js";

/** Placeholder text posted in-channel while the agent works on a reply. */
export const THINKING_PLACEHOLDER = "💭 _Thinking…_";

/**
 * Base class for a per-agent chat connector (Slack, Discord). It connects an
 * agent to a single chat channel so humans there can talk to it.
 *
 * The `publicBot` gate decides who may talk to the agent: when on, anyone in
 * the channel; when off, only the listed platform user IDs. The gate is
 * evaluated per message, so it can be updated in place without reconnecting.
 *
 * Subclasses implement the platform SDK plumbing (`start`/`stop`/`post`) and
 * call `handleInbound` for each human message arriving in the channel.
 */
export abstract class ChannelConnector {
  /** Live gate config — mutated in place by `updateGate`. */
  protected cfg: ChannelBotConfig;
  /** Serial queue — process one channel message at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Live connection state, surfaced to the Channels UI. */
  private connState: ConnectorState = "connecting";
  private connError: string | null = null;

  constructor(
    /** Prefix for the runtime conversation id, e.g. "slack" or "discord". */
    protected readonly platform: string,
    protected readonly agentId: string,
    cfg: ChannelBotConfig,
    /** Resolves the agent's current runtime — never capture it, it is replaced on update. */
    protected readonly getRuntime: () => AgentRuntime | undefined
  ) {
    this.cfg = cfg;
  }

  /** Connect to the platform and start listening for channel messages. */
  abstract start(): Promise<void>;

  /** Cleanly disconnect from the platform. */
  abstract stop(): Promise<void>;

  /**
   * Post a message into the agent's channel. When `replace` is the handle
   * returned by an earlier `postThinking`, the connector edits that message
   * in place instead of posting a new one.
   */
  protected abstract post(text: string, replace?: unknown): Promise<void>;

  /**
   * Post a "thinking" placeholder so the channel shows the agent is working,
   * and return an opaque handle `post` can later use to replace it. Connectors
   * that cannot edit messages leave this as a no-op (returns null).
   */
  protected async postThinking(): Promise<unknown> {
    return null;
  }

  /** Update the gate (publicBot / allowedUserIds) without reconnecting. */
  updateGate(cfg: ChannelBotConfig): void {
    this.cfg = cfg;
  }

  /** Live connection status for the Channels UI. */
  getStatus(): { state: ConnectorState; error: string | null; channelId: string } {
    return { state: this.connState, error: this.connError, channelId: this.cfg.channelId };
  }

  /** Mark the connector as successfully connected. */
  markConnected(): void {
    this.connState = "connected";
    this.connError = null;
  }

  /** Mark the connector as failed, with a human-readable reason. */
  markError(message: string): void {
    this.connState = "error";
    this.connError = message;
  }

  /** True when `userId` is allowed to talk to the agent. */
  protected passesGate(userId: string): boolean {
    if (this.cfg.publicBot) return true;
    return this.cfg.allowedUserIds.includes(userId);
  }

  /**
   * Handle a human message from the channel: apply the gate, run one agent
   * turn (serialized), and post the reply. Errors are logged, never thrown.
   */
  protected handleInbound(userId: string, text: string): void {
    const body = text.trim();
    if (!body || !this.passesGate(userId)) return;
    this.queue = this.queue.then(async () => {
      const runtime = this.getRuntime();
      if (!runtime) return;
      // Post a placeholder right away so the channel shows the agent received
      // the message and is working, rather than looking offline while it thinks.
      let placeholder: unknown = null;
      try {
        placeholder = await this.postThinking();
      } catch (err) {
        console.warn(`[${this.platform}] thinking placeholder failed for ${this.agentId}:`, err);
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
        await this.post(reply, placeholder ?? undefined);
      } catch (err) {
        console.warn(`[${this.platform}] post failed for ${this.agentId}:`, err);
      }
    });
  }
}

/** Stable signature used to decide when a connector must reconnect. */
export function connectorSignature(
  cfg: ChannelBotConfig | null,
  tokens: string[]
): string {
  if (!cfg?.enabled) return "disabled";
  // `mentionOnly` changes which channel events the connector subscribes to,
  // so a change to it must force a reconnect.
  return JSON.stringify([cfg.channelId, cfg.mentionOnly, tokens]);
}
