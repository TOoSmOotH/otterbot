import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type { ChannelBotConfig } from "@otterbot/shared";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { ChannelConnector } from "./channel-connector.js";

/** The subset of a Slack message event we use. */
interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  bot_id?: string;
}

/**
 * Connects one agent to a Slack channel over Socket Mode. Inbound channel
 * messages run an agent turn (gated by `publicBot` / `allowedUserIds`) and the
 * reply is posted back with the Web API.
 *
 * Reads `SLACK_BOT_TOKEN` (xoxb-…) and `SLACK_APP_TOKEN` (xapp-…) from the
 * agent's encrypted credentials.
 */
export class SlackConnector extends ChannelConnector {
  private socket: SocketModeClient | null = null;
  private readonly web: WebClient;

  constructor(
    agentId: string,
    cfg: ChannelBotConfig,
    private readonly botToken: string,
    private readonly appToken: string,
    getRuntime: () => AgentRuntime | undefined
  ) {
    super("slack", agentId, cfg, getRuntime);
    this.web = new WebClient(botToken);
  }

  async start(): Promise<void> {
    const socket = new SocketModeClient({ appToken: this.appToken });
    socket.on("message", ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
      void ack();
      this.onSlackMessage(event);
    });
    await socket.start();
    this.socket = socket;
    console.info(`[slack] connector connected for ${this.agentId}`);
  }

  async stop(): Promise<void> {
    await this.socket?.disconnect();
    this.socket = null;
  }

  protected async post(text: string): Promise<void> {
    await this.web.chat.postMessage({ channel: this.cfg.channelId, text });
  }

  private onSlackMessage(event: SlackMessageEvent): void {
    // Only plain user messages in this agent's channel — skip bots, edits, joins.
    if (event.subtype || event.bot_id) return;
    if (event.channel !== this.cfg.channelId) return;
    if (!event.user || !event.text) return;
    this.handleInbound(event.user, event.text);
  }
}
