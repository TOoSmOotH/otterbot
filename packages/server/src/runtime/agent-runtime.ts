import { nanoid } from "nanoid";
import { streamText, type LanguageModelV1 } from "ai";
import { eq, sql } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { resolveChatModel } from "../providers/registry.js";
import { buildSystemPrompt } from "../agent/prompt.js";
import { buildAgentTools } from "../agent/tools.js";
import { buildContext, maybeAutoCompact } from "./context-manager.js";
import type { AgentContext } from "./agent-context.js";
import type { AgentServices, AgentDirectoryEntry } from "./agent-services.js";
import type {
  AgentStatus,
  AgentMessage,
  Artifact,
  StreamChunk,
  ToolCallRecord,
} from "@otterbot/shared";
import { basename } from "node:path";

/** A tool result that produced an image we persist + render in the chat. */
function isImageResult(result: unknown): result is { url: string } {
  return (
    !!result &&
    typeof result === "object" &&
    (result as { kind?: unknown }).kind === "image" &&
    typeof (result as { url?: unknown }).url === "string"
  );
}

/**
 * Normalize a tool result into an {@link Artifact} if it produced one. Handles
 * both image tool results (`{ kind: "image", url, prompt? }`, synthesizing a
 * name/MIME) and general file results (`{ kind: "file", url, name, mimeType }`).
 * Returns null for any other result.
 */
function artifactFromResult(result: unknown): Artifact | null {
  if (!result || typeof result !== "object") return null;
  const r = result as {
    kind?: unknown;
    url?: unknown;
    name?: unknown;
    mimeType?: unknown;
    prompt?: unknown;
  };
  if (typeof r.url !== "string") return null;
  if (r.kind === "image") {
    const name = typeof r.name === "string" ? r.name : basename(r.url);
    return {
      id: name,
      kind: "image",
      url: r.url,
      name,
      mimeType: typeof r.mimeType === "string" ? r.mimeType : "image/png",
      prompt: typeof r.prompt === "string" ? r.prompt : undefined,
    };
  }
  if (r.kind === "file" && typeof r.name === "string") {
    return {
      id: r.name,
      kind: "file",
      url: r.url,
      name: r.name,
      mimeType: typeof r.mimeType === "string" ? r.mimeType : "application/octet-stream",
    };
  }
  return null;
}

/**
 * If a request carried attached docs on its payload, append a reference block
 * to the task so the receiving agent knows they exist and can open them with
 * `read_file`. Keeps the inline body small while making the docs discoverable.
 */
export function withAttachmentRefs(body: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return body;
  const list = (payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(list) || list.length === 0) return body;
  const refs = list
    .filter((a): a is Artifact => artifactFromResult(a) !== null)
    .map((a) => `- ${a.name} — ${a.url}`);
  if (!refs.length) return body;
  return `${body}\n\n---\nAttached files (use the read_file tool to read each):\n${refs.join("\n")}`;
}

/** A tool result from `delegate` that carried artifacts back from a peer. */
function delegateArtifacts(result: unknown): Artifact[] {
  if (!result || typeof result !== "object") return [];
  const r = result as { kind?: unknown; artifacts?: unknown };
  if (r.kind !== "delegate" || !Array.isArray(r.artifacts)) return [];
  return r.artifacts.filter((a): a is Artifact => artifactFromResult(a) !== null);
}

export interface RespondArgs {
  conversationId: string;
  userMessage: string;
  /** Files the user uploaded with this message, for the agent to process. */
  attachments?: Artifact[];
  onChunk: (chunk: StreamChunk) => void;
}

export interface RespondResult {
  messageId: string;
  finalText: string;
  skillsUsed: string[];
  memoriesUsed: string[];
  /** Files produced during this turn (generated locally or via delegation). */
  artifacts: Artifact[];
}

/**
 * The runtime for a single agent. One instance per profile. Owns the agent's
 * resolved chat model and drives its conversational loop against the agent's
 * own isolated context (memory, skills, profile).
 */
export class AgentRuntime {
  private _chatModel?: LanguageModelV1;
  private _status: AgentStatus = "idle";
  private statusListener?: (status: AgentStatus) => void;
  /** Serial work queue — one agent processes one task at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    public readonly ctx: AgentContext,
    private readonly services?: AgentServices
  ) {}

  /**
   * The agent's chat model, resolved lazily. An agent whose configured model
   * was deleted or never set (empty provider) has no resolvable model — rather
   * than crash at boot, we defer the error to the moment it's actually used.
   */
  private get chatModel(): LanguageModelV1 {
    if (!this._chatModel) {
      const ref = this.ctx.chatModelRef;
      if (!ref.provider || !ref.modelId) {
        throw new Error(
          `Agent "${this.ctx.profile.id}" has no chat model configured. Pick one in Settings › Models.`
        );
      }
      this._chatModel = resolveChatModel(ref, this.ctx.secrets);
    }
    return this._chatModel;
  }

  get id(): string {
    return this.ctx.profile.id;
  }

  get status(): AgentStatus {
    return this._status;
  }

  /** Register a listener notified on every status transition. */
  onStatus(listener: (status: AgentStatus) => void): void {
    this.statusListener = listener;
  }

  private setStatus(status: AgentStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.statusListener?.(status);
  }

  /** Run one conversational turn for this agent. */
  /**
   * Agents this one may delegate to — the COO sees everyone, others see only
   * their permitted peers. Mirrors the gating of the `list_agents` tool so the
   * prompt's peer list matches what `delegate` will actually allow.
   */
  private reachablePeers(): AgentDirectoryEntry[] {
    if (!this.services) return [];
    const others = this.services.listAgents().filter((a) => a.id !== this.ctx.profile.id);
    if (this.ctx.profile.role === "coo") return others;
    const peerIds = new Set(this.ctx.profile.allowedPeers.map((p) => p.agentId));
    return others.filter((a) => peerIds.has(a.id));
  }

  async respond(args: RespondArgs): Promise<RespondResult> {
    this.setStatus("thinking");
    try {
      this.ensureConversation(args.conversationId);
      this.reopenConversation(args.conversationId);
      this.appendMessage(
        args.conversationId,
        "user",
        args.userMessage,
        undefined,
        args.attachments
      );
      this.setTitleIfEmpty(args.conversationId, args.userMessage);

      // Bound the conversation context: compact the oldest turns if it has
      // crossed the token budget, then send only the recap + recent window.
      await maybeAutoCompact(this.ctx, args.conversationId);
      const { recapText, messages: coreMessages } = buildContext(
        this.ctx,
        args.conversationId
      );

      const peers = this.reachablePeers();
      // DEBUG: which conversation, how much history, and who this agent can reach.
      console.log(
        `[respond-debug] agent=${this.id} conv=${args.conversationId} ` +
          `historyMsgs=${coreMessages.length} peers=${JSON.stringify(peers.map((p) => p.id))}`
      );
      const { system, skillsUsed, memoriesUsed } = await buildSystemPrompt(this.ctx, {
        userMessage: args.userMessage,
        recap: recapText,
        peers,
      });

      const tools = buildAgentTools(this.ctx, this.services);

      const result = streamText({
        model: this.chatModel,
        system,
        messages: coreMessages,
        tools,
        maxSteps: 8,
      });

      let finalText = "";
      let sawWork = false;
      let streamError: string | null = null;
      // Image-producing tool results, persisted as their own messages so they
      // survive a reload (they're excluded from the model context).
      const imageMessages: Array<{ toolCall: ToolCallRecord; prompt: string }> = [];
      // Files received back from a delegated peer, persisted so they re-render.
      const artifactMessages: Array<{ content: string; toolCall: ToolCallRecord }> = [];
      // Everything this turn produced (local images + delegated files) — handed
      // back to the bus so a delegating agent can display them.
      const turnArtifacts: Artifact[] = [];
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            finalText += part.textDelta;
            args.onChunk({ kind: "token", text: part.textDelta });
            break;
          case "tool-call":
            // DEBUG: confirm whether the model actually invokes tools (delegate).
            console.log(`[respond-debug] agent=${this.id} tool-call=${part.toolName}`);
            sawWork = true;
            this.setStatus("working");
            args.onChunk({
              kind: "tool_start",
              id: part.toolCallId,
              name: part.toolName,
              args: part.args,
            });
            break;
          case "error": {
            const message =
              part.error instanceof Error ? part.error.message : String(part.error);
            streamError = message;
            console.warn(`[agent ${this.id}] model stream error:`, message);
            args.onChunk({ kind: "error", message });
            break;
          }
          default:
            break;
        }
      }
      void sawWork;

      // Tool results aren't typed into `fullStream` for an untyped tool set, so
      // read them from the completed steps: emit tool_end for the UI, and queue
      // any images for persistence.
      try {
        for (const step of await result.steps) {
          for (const tr of step.toolResults as Array<{
            toolCallId: string;
            toolName: string;
            args: unknown;
            result: unknown;
          }>) {
            // Image results are surfaced to the client and persisted; other
            // tool outputs (web pages, file contents, …) stay server-side.
            if (isImageResult(tr.result)) {
              args.onChunk({ kind: "tool_end", id: tr.toolCallId, result: tr.result });
              imageMessages.push({
                toolCall: { id: tr.toolCallId, name: tr.toolName, args: tr.args, result: tr.result },
                prompt: (tr.args as { prompt?: string })?.prompt ?? "image",
              });
              const art = artifactFromResult(tr.result);
              if (art) turnArtifacts.push(art);
              continue;
            }
            // Files a delegated peer produced and handed back — display them in
            // this agent's chat and persist so they survive a reload.
            const delegated = delegateArtifacts(tr.result);
            if (delegated.length) {
              args.onChunk({ kind: "artifacts", artifacts: delegated });
              delegated.forEach((a, i) => {
                const result =
                  a.kind === "image"
                    ? { kind: "image", url: a.url }
                    : { kind: "file", url: a.url, name: a.name };
                artifactMessages.push({
                  content: a.kind === "image" ? `Image: ${a.prompt ?? a.name}` : a.name,
                  toolCall: {
                    id: `${tr.toolCallId}-art-${i}`,
                    name: tr.toolName,
                    args: tr.args,
                    result,
                  },
                });
              });
              turnArtifacts.push(...delegated);
            }
          }
        }
      } catch {
        /* steps unavailable — nothing to persist */
      }

      // A stream error that produced no text would otherwise surface as a
      // useless "(no response)" — throw so callers report the real cause.
      if (!finalText && streamError) {
        throw new Error(streamError);
      }

      // Persist generated images as tool messages (in turn order, before the
      // assistant's closing text) so they re-render when the chat is reopened.
      for (const img of imageMessages) {
        this.appendMessage(args.conversationId, "tool", `Generated image: ${img.prompt}`, [
          img.toolCall,
        ]);
      }
      // Files received from delegated peers, persisted in turn order too.
      for (const art of artifactMessages) {
        this.appendMessage(args.conversationId, "tool", art.content, [art.toolCall]);
      }

      const messageId = this.appendMessage(args.conversationId, "assistant", finalText);
      this.touchConversation(args.conversationId);

      return { messageId, finalText, skillsUsed, memoriesUsed, artifacts: turnArtifacts };
    } finally {
      this.setStatus("idle");
    }
  }

  /**
   * Handle an inbound bus message. A `request` is processed as a turn and
   * answered with a correlated `response`; other kinds are informational.
   * Runs on the agent's serial queue.
   */
  async handleBusMessage(msg: AgentMessage): Promise<void> {
    if (msg.kind !== "request" || !this.services) return;
    // Service-agent fast path: hand the request to a non-blocking subagent that
    // replies directly to the original requester, leaving this agent's serial
    // queue free to accept the next request. Lets one skilled agent (e.g. an
    // image generator) serve many requesters in parallel.
    if (this.ctx.profile.dispatchToSubagent && this.services.dispatchToSubagent) {
      this.services.dispatchToSubagent({ parentId: this.id, request: msg });
      return;
    }
    this.queue = this.queue.then(async () => {
      const bus = this.services!.bus;
      let reply = "";
      let artifacts: Artifact[] = [];
      try {
        const res = await this.respond({
          conversationId: `bus-${msg.threadId}`,
          userMessage: withAttachmentRefs(msg.body, msg.payload),
          onChunk: () => {},
        });
        reply = res.finalText || "(no response)";
        artifacts = res.artifacts;
      } catch (err) {
        reply = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      bus.publish({
        id: nanoid(),
        kind: "response",
        from: this.id,
        to: msg.from,
        threadId: msg.threadId,
        correlationId: msg.id,
        rootSpawnId: msg.rootSpawnId,
        body: reply,
        payload: artifacts.length ? { artifacts } : undefined,
        transport: this.ctx.profile.transport,
      });
    });
    await this.queue;
  }

  /**
   * Clear a conversation's history — messages, compaction recaps, and session
   * summaries — so the next turn starts fresh. Long-term memory and skills are
   * left untouched; this only resets the chat thread.
   */
  resetConversation(conversationId: string): void {
    const db = this.ctx.db;
    db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId)).run();
    db.delete(schema.conversationRecaps)
      .where(eq(schema.conversationRecaps.conversationId, conversationId))
      .run();
    db.delete(schema.sessionSummaries)
      .where(eq(schema.sessionSummaries.conversationId, conversationId))
      .run();
    db.update(schema.conversations)
      .set({ messageCount: 0, updatedAt: new Date().toISOString() })
      .where(eq(schema.conversations.id, conversationId))
      .run();
  }

  ensureConversation(id: string, title: string | null = null): void {
    const db = this.ctx.db;
    const existing = db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id))
      .get();
    if (existing) return;
    const now = new Date().toISOString();
    db.insert(schema.conversations)
      .values({ id, title, createdAt: now, updatedAt: now, closedAt: null })
      .run();
  }

  appendMessage(
    conversationId: string,
    role: "user" | "assistant" | "tool",
    content: string,
    toolCalls?: ToolCallRecord[],
    attachments?: Artifact[]
  ): string {
    const id = nanoid();
    const db = this.ctx.db;
    db.insert(schema.messages)
      .values({
        id,
        conversationId,
        role,
        content,
        toolCalls: toolCalls ?? null,
        attachments: attachments ?? null,
        createdAt: new Date().toISOString(),
      })
      .run();
    db.update(schema.conversations)
      .set({ messageCount: sql`${schema.conversations.messageCount} + 1` })
      .where(eq(schema.conversations.id, conversationId))
      .run();
    return id;
  }

  touchConversation(id: string): void {
    this.ctx.db
      .update(schema.conversations)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.conversations.id, id))
      .run();
  }

  /** Clear `closedAt` so a resumed conversation isn't flagged closed. */
  reopenConversation(id: string): void {
    this.ctx.db
      .update(schema.conversations)
      .set({ closedAt: null })
      .where(eq(schema.conversations.id, id))
      .run();
  }

  /** Title a conversation from its first user message — once, when still null. */
  setTitleIfEmpty(conversationId: string, text: string): void {
    const row = this.ctx.db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .get();
    if (!row || row.title) return;
    const title = text.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!title) return;
    this.ctx.db
      .update(schema.conversations)
      .set({ title })
      .where(eq(schema.conversations.id, conversationId))
      .run();
  }
}
