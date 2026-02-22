import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";
import { getConfig } from "../auth/auth.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Teams Bridge
// ---------------------------------------------------------------------------

/**
 * Microsoft Teams chat bridge.
 *
 * Uses the Bot Framework SDK to receive and respond to messages from Teams.
 * The server must expose a POST endpoint (e.g. /api/teams/messages) and
 * delegate incoming requests to the adapter returned by `getAdapter()`.
 *
 * NOTE: The botbuilder SDK is a peer dependency — it must be installed
 * separately (`npm i botbuilder`).  All botbuilder types are imported
 * dynamically so the module can be loaded even when the SDK is absent.
 */

interface PendingResponse {
  /** Serialised conversation reference for proactive replies. */
  conversationRef: unknown;
  conversationId: string;
}

export class TeamsBridge {
  private adapter: unknown | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private pendingResponses = new Map<string, PendingResponse>();
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{teamsUserId}:{channelId}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → conversation reference (for proactive messages) */
  private conversationRefs = new Map<string, unknown>();
  /** Cached botbuilder module */
  private bb: typeof import("botbuilder") | null = null;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: { appId: string; appPassword: string }): Promise<void> {
    if (this.adapter) {
      await this.stop();
    }

    // Dynamic import so the rest of the codebase isn't affected when
    // botbuilder is not installed.
    const bb = await import("botbuilder");
    this.bb = bb;

    const botFrameworkAuth = new bb.ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: config.appId,
      MicrosoftAppPassword: config.appPassword,
      MicrosoftAppType: "SingleTenant",
    });

    const adapter = new bb.CloudAdapter(botFrameworkAuth);

    adapter.onTurnError = async (_context, error) => {
      console.error("[Teams] Turn error:", error);
      this.io.emit("teams:status", { status: "error" });
    };

    this.adapter = adapter;

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    console.log("[Teams] Bridge started");
    this.io.emit("teams:status", { status: "connected" });
  }

  async stop(): Promise<void> {
    this.pendingResponses.clear();

    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    this.adapter = null;
    this.bb = null;
    this.io.emit("teams:status", { status: "disconnected" });
  }

  /**
   * Returns the Bot Framework CloudAdapter for use by an HTTP endpoint.
   * The server should wire up a POST route and call:
   *   adapter.process(req, res, (context) => bridge.handleTurn(context))
   */
  getAdapter(): unknown {
    return this.adapter;
  }

  // -------------------------------------------------------------------------
  // Inbound: Teams → COO
  // -------------------------------------------------------------------------

  /** Called by the HTTP handler for every incoming Bot Framework activity. */
  async handleTurn(context: unknown): Promise<void> {
    const bb = this.bb;
    if (!bb) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = context as any;
    if (ctx.activity?.type !== bb.ActivityTypes.Message) return;

    const content = (ctx.activity.text as string | undefined)?.trim();
    if (!content) return;

    const teamsUserId: string = ctx.activity.from?.id ?? "unknown";
    const channelId: string = ctx.activity.channelId ?? "msteams";

    await this.routeToCOO(ctx, teamsUserId, channelId, content);
  }

  private async routeToCOO(
    turnContext: unknown,
    teamsUserId: string,
    channelId: string,
    content: string,
  ): Promise<void> {
    const bb = this.bb;
    if (!bb) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = turnContext as any;
    const convKey = `${teamsUserId}:${channelId}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const userName: string = ctx.activity.from?.name ?? teamsUserId;
      const title = `Teams: ${userName} — ${content.slice(0, 60)}`;
      const conversation: Conversation = {
        id: conversationId,
        title,
        projectId: null,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(schema.conversations).values(conversation).run();
      this.coo.startNewConversation(conversationId, null, null);
      this.io.emit("conversation:created", conversation);
      this.conversationMap.set(convKey, conversationId);
    } else {
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    // Store conversation reference for proactive messaging
    const ref = bb.TurnContext.getConversationReference(ctx.activity);
    this.conversationRefs.set(conversationId, ref);

    // Track pending response
    this.pendingResponses.set(conversationId, {
      conversationRef: ref,
      conversationId,
    });

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null,
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "teams",
        teamsUserId,
        teamsChannelId: channelId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Teams
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const ref = this.conversationRefs.get(conversationId);
    if (!ref || !this.adapter || !this.bb) return;

    this.pendingResponses.delete(conversationId);

    const bb = this.bb;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = this.adapter as any;
    adapter
      .continueConversationAsync("", ref, async (ctx: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (ctx as any).sendActivity(bb.MessageFactory.text(message.content));
      })
      .catch((err: unknown) => {
        console.error("[Teams] Error sending reply:", err);
      });
  }
}
