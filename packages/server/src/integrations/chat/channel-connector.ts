import type { Artifact, ChannelBotConfig, ConnectorState } from "@otterbot/shared";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";
import { handleChatCommand, parseChatCommand } from "../../runtime/chat-commands.js";
import type { ChatClient, InboundChatMessage, MessageHandle, OutboundFile } from "./chat-client.js";

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
  /**
   * Canonical channel id used for matching inbound messages and sending. Starts
   * as the configured id and is replaced with the client-resolved id after
   * start() (Matrix: a room alias resolves to its internal `!id:hs`). A channel
   * change forces a reconnect, so this is only refreshed on (re)start.
   */
  private channelId: string;
  private queue: Promise<unknown> = Promise.resolve();
  private connState: ConnectorState = "connecting";
  private connError: string | null = null;

  constructor(
    /** Prefix for the runtime conversation id, e.g. "slack". */
    private readonly platform: string,
    private readonly agentId: string,
    cfg: ChannelBotConfig,
    private readonly client: ChatClient,
    private readonly getRuntime: () => AgentRuntime | undefined,
    private readonly loadArtifact: (a: Artifact) => OutboundFile | null = () => null
  ) {
    this.cfg = cfg;
    this.channelId = cfg.channelId;
  }

  async start(): Promise<void> {
    this.client.onMessage((m) => this.onInbound(m));
    await this.client.start();
    // Resolve the configured channel to its canonical id (e.g. a Matrix room
    // alias → internal id) so inbound matching and sending agree.
    if (this.client.resolveChannelId) {
      try {
        this.channelId = await this.client.resolveChannelId(this.cfg.channelId);
      } catch (err) {
        console.warn(
          `[${this.platform}] could not resolve channel "${this.cfg.channelId}" for ${this.agentId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
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

  /** Live connection status for the Channels UI. */
  getStatus(): { state: ConnectorState; error: string | null; channelId: string } {
    return { state: this.connState, error: this.connError, channelId: this.channelId };
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

  private passesGate(userId: string): boolean {
    if (this.cfg.publicBot) return true;
    return this.cfg.allowedUserIds.includes(userId);
  }

  /**
   * When an artifact can't be uploaded (missing files:write, bot not in the
   * channel, file unresolvable), post a text note instead so the human isn't
   * left with nothing and the cause is actionable.
   */
  private async postArtifactFallback(artifact: Artifact, reason: string): Promise<void> {
    const note =
      `⚠️ I produced "${artifact.name}" but ${reason}. ` +
      `An admin may need to grant the bot the files:write scope and invite it to this channel. ` +
      `Reference: ${artifact.url}`;
    try {
      await this.client.sendText(this.channelId, note);
    } catch (err) {
      console.error(`[${this.platform}] artifact fallback post failed for ${this.agentId}:`, err);
    }
  }

  /** The conversation id this channel maps to. */
  private conversationId(): string {
    return `${this.platform}-${this.channelId}`;
  }

  private onInbound(m: InboundChatMessage): void {
    if (m.channelId !== this.channelId) return;
    if (m.fromSelf) return;
    if (this.cfg.mentionOnly && !m.mentioned) return;
    const body = m.text.trim();
    if (!body || !this.passesGate(m.senderId)) return;
    const command = parseChatCommand(body);
    if (command) {
      this.queue = this.queue.then(async () => {
        const runtime = this.getRuntime();
        if (!runtime) return;
        const reply = handleChatCommand(runtime, this.conversationId(), command);
        try {
          await this.client.sendText(this.channelId, reply);
        } catch (err) {
          console.error(`[${this.platform}] command reply failed for ${this.agentId}:`, err);
        }
      });
      return;
    }
    this.queue = this.queue.then(async () => {
      const runtime = this.getRuntime();
      if (!runtime) return;
      let placeholder: MessageHandle | null = null;
      if (this.client.canEdit) {
        try {
          placeholder = await this.client.sendText(this.channelId, THINKING_PLACEHOLDER);
        } catch (err) {
          console.error(
            `[${this.platform}] thinking placeholder failed for ${this.agentId}:`,
            err
          );
        }
      }
      let reply: string;
      let artifacts: Artifact[] = [];
      try {
        const res = await runtime.respond({
          conversationId: this.conversationId(),
          userMessage: body,
          onChunk: () => {},
        });
        reply = res.finalText || "(no response)";
        artifacts = res.artifacts ?? [];
      } catch (err) {
        reply = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      try {
        if (placeholder != null) {
          await this.client.edit(placeholder, reply);
        } else {
          await this.client.sendText(this.channelId, reply);
        }
        // A successful post means we can reach the channel — clear any stale
        // error state so the Channels UI recovers after a transient failure.
        if (this.connState === "error") this.markConnected();
      } catch (err) {
        // Surface instead of swallowing: a failed post (missing chat:write, bot
        // not in channel) is exactly what leaves the human with nothing.
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[${this.platform}] post failed for ${this.agentId}:`, err);
        this.markError(`post failed: ${reason}`);
      }
      for (const artifact of artifacts) {
        let file: OutboundFile | null = null;
        try {
          file = this.loadArtifact(artifact);
        } catch (err) {
          console.error(`[${this.platform}] artifact load failed for ${this.agentId}:`, err);
        }
        if (!file) {
          await this.postArtifactFallback(artifact, "it couldn't be loaded for upload");
          continue;
        }
        try {
          await this.client.sendFile(this.channelId, file);
        } catch (err) {
          // Don't drop the artifact silently: tell the channel and flag the
          // connector so a missing files:write / channel membership is visible.
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`[${this.platform}] file upload failed for ${this.agentId}:`, err);
          this.markError(`file upload failed: ${reason}`);
          await this.postArtifactFallback(artifact, `upload failed (${reason})`);
        }
      }
    });
  }
}

/** Stable signature used to decide when a connector must reconnect. */
export function connectorSignature(cfg: ChannelBotConfig | null, tokens: string[]): string {
  if (!cfg?.enabled) return "disabled";
  // `mentionOnly` changes which channel events the connector subscribes to,
  // so a change to it must force a reconnect.
  return JSON.stringify([cfg.channelId, cfg.mentionOnly, tokens]);
}
