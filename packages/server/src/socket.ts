import type { Server as HttpServer } from "node:http";
import type { IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import { Server as SocketIOServer } from "socket.io";
import type { Orchestrator } from "./orchestrator/orchestrator.js";
import { summarizeConversation } from "./memory/summarizer.js";
import { extractFactsFromConversation } from "./memory/extractor.js";
import { maybeAuthorSkill } from "./skills/skill-author.js";
import { openTerminal } from "./integrations/shell-terminal.js";
import { getCodingSession } from "./integrations/coding-cli.js";
import { handleChatCommand, parseChatCommand } from "./runtime/chat-commands.js";
import { extractToken, type AuthStore } from "./auth/api-token.js";
import type { Artifact } from "@otterbot/shared";

export interface AttachSocketOpts {
  /** Auth store consulted per connection; null/undefined disables auth. */
  auth?: AuthStore | null;
}

const IDLE_CLOSE_MS = 5 * 60 * 1000;
/** Kill an interactive terminal after this long with no keystrokes. */
const TERM_IDLE_MS = 15 * 60 * 1000;

/** One live interactive terminal — its PTY and idle-kill timer. */
interface TerminalSession {
  pty: IPty;
  idleTimer: NodeJS.Timeout | null;
}

interface JoinedConversation {
  agentId: string;
  conversationId: string;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Multi-agent socket layer. Every chat event carries an `agentId`, so a single
 * client can hold conversations with several agents at once. Agent status
 * changes are broadcast to all clients.
 */
export function attachSocketServer(
  http: HttpServer,
  orch: Orchestrator,
  opts: AttachSocketOpts = {}
): SocketIOServer {
  const io = new SocketIOServer(http, {
    path: "/socket.io",
    cors: { origin: false },
  });

  const auth = opts.auth ?? null;
  if (auth) {
    io.use((socket, next) => {
      if (!auth.hasPassword()) return next(new Error("needs-setup"));
      const handshake = socket.handshake;
      const supplied =
        (typeof handshake.auth?.token === "string" ? handshake.auth.token : null) ??
        extractToken({ headers: handshake.headers, query: handshake.query });
      if (!supplied) return next(new Error("unauthorized"));
      if (auth.validateToken(supplied)) return next();
      next(new Error("unauthorized"));
    });
  }

  // Push every agent status transition to all connected clients.
  orch.onStatusChange((agentId, status) => {
    io.emit("agent:status", { agentId, status });
  });

  // Surface every agent-to-agent bus message to the Activity View.
  orch.getBus().setEmit((msg) => {
    io.emit("bus:message", msg);
  });

  // Tell every client when an agent starts a live coding session, so the UI can
  // offer to attach a terminal view.
  orch.onCodingSession((agentId, tool) => {
    io.emit("coding:started", { agentId, tool });
  });

  // Stream pipeline run state changes to the Projects view.
  orch.onPipelineUpdate((run) => {
    io.emit("pipeline:update", run);
  });

  io.on("connection", (socket) => {
    /** One joined conversation per agent this socket is chatting with. */
    const conversations = new Map<string, JoinedConversation>();

    const ensureJoined = (agentId: string): JoinedConversation => {
      let joined = conversations.get(agentId);
      if (!joined) {
        joined = {
          agentId,
          conversationId: `conv-${agentId}-${Date.now()}`,
          idleTimer: null,
        };
        conversations.set(agentId, joined);
        socket.emit("chat:joined", {
          agentId,
          conversationId: joined.conversationId,
          resumed: false,
        });
      }
      return joined;
    };

    socket.on("chat:join", (payload: { agentId?: string; conversationId?: string }) => {
      const agentId = payload.agentId || "coo";
      const conversationId = payload.conversationId || `conv-${agentId}-${Date.now()}`;
      conversations.set(agentId, { agentId, conversationId, idleTimer: null });
      socket.emit("chat:joined", {
        agentId,
        conversationId,
        resumed: Boolean(payload.conversationId),
      });
    });

    socket.on("chat:message", async (payload: { agentId?: string; text: string; attachments?: Artifact[] }) => {
      const agentId = payload.agentId || "coo";
      const joined = ensureJoined(agentId);
      resetIdle(joined, () => closeSession(orch, agentId, joined.conversationId));

      const runtime = orch.getRuntime(agentId);
      if (!runtime) {
        socket.emit("chat:stream", {
          agentId,
          chunk: { kind: "error", message: `Unknown agent: ${agentId}` },
        });
        socket.emit("chat:done", { agentId, conversationId: joined.conversationId });
        return;
      }

      // Bang-commands (!context, !clear, !reset) are handled inline without a
      // model turn: emit the reply as an ephemeral assistant message.
      const command = parseChatCommand(payload.text);
      if (command) {
        const reply = handleChatCommand(runtime, joined.conversationId, command);
        socket.emit("chat:stream", { agentId, chunk: { kind: "token", text: reply } });
        socket.emit("chat:done", { agentId, conversationId: joined.conversationId });
        return;
      }

      try {
        await runtime.respond({
          conversationId: joined.conversationId,
          userMessage: payload.text,
          attachments: payload.attachments,
          onChunk: (chunk) => socket.emit("chat:stream", { agentId, chunk }),
        });
        socket.emit("chat:done", { agentId, conversationId: joined.conversationId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        socket.emit("chat:stream", { agentId, chunk: { kind: "error", message } });
        socket.emit("chat:done", { agentId, conversationId: joined.conversationId });
      }
    });

    socket.on("chat:close", (payload: { agentId?: string }) => {
      const agentId = payload.agentId || "coo";
      const joined = conversations.get(agentId);
      if (joined) void closeSession(orch, agentId, joined.conversationId);
    });

    // --- Interactive terminals -------------------------------------------
    // One PTY per agent for this socket — a browser-side terminal into the
    // agent's sandboxed workspace. The PTY is killed on close, disconnect, or
    // after an idle period; the workspace files persist regardless.
    const terminals = new Map<string, TerminalSession>();

    const killTerminal = (agentId: string) => {
      const term = terminals.get(agentId);
      if (!term) return;
      if (term.idleTimer) clearTimeout(term.idleTimer);
      terminals.delete(agentId);
      try {
        term.pty.kill();
      } catch {
        /* already exited */
      }
    };

    const resetTermIdle = (agentId: string) => {
      const term = terminals.get(agentId);
      if (!term) return;
      if (term.idleTimer) clearTimeout(term.idleTimer);
      term.idleTimer = setTimeout(() => killTerminal(agentId), TERM_IDLE_MS);
    };

    socket.on("term:open", (payload: { agentId?: string; cols?: number; rows?: number }) => {
      const agentId = payload.agentId || "coo";
      killTerminal(agentId); // replace any existing terminal for this agent

      const ctx = orch.getContext(agentId);
      if (!ctx) {
        socket.emit("term:exit", { agentId, error: `Unknown agent: ${agentId}` });
        return;
      }
      if (!ctx.profile.canRunShell) {
        socket.emit("term:exit", {
          agentId,
          error: "Shell access is disabled for this agent.",
        });
        return;
      }

      const opened = openTerminal(
        ctx.workspaceDir,
        ctx.shellSecrets(),
        { cols: payload.cols, rows: payload.rows },
        { projectWorkspacePath: ctx.projectWorkspacePath(), gitSsh: ctx.gitSsh() ?? undefined }
      );
      if ("error" in opened) {
        socket.emit("term:exit", { agentId, error: opened.error });
        return;
      }

      const pty = opened.pty;
      terminals.set(agentId, { pty, idleTimer: null });
      pty.onData((data) => socket.emit("term:output", { agentId, data }));
      pty.onExit(({ exitCode }) => {
        // Ignore if this PTY was already superseded or explicitly killed.
        if (terminals.get(agentId)?.pty !== pty) return;
        const term = terminals.get(agentId);
        if (term?.idleTimer) clearTimeout(term.idleTimer);
        terminals.delete(agentId);
        socket.emit("term:exit", { agentId, exitCode });
      });
      resetTermIdle(agentId);
    });

    socket.on("term:input", (payload: { agentId?: string; data: string }) => {
      const term = terminals.get(payload.agentId || "coo");
      if (!term) return;
      term.pty.write(payload.data);
      resetTermIdle(payload.agentId || "coo");
    });

    socket.on("term:resize", (payload: { agentId?: string; cols: number; rows: number }) => {
      const term = terminals.get(payload.agentId || "coo");
      if (!term) return;
      try {
        term.pty.resize(payload.cols, payload.rows);
      } catch {
        /* resize raced with the PTY closing */
      }
    });

    socket.on("term:close", (payload: { agentId?: string }) => {
      killTerminal(payload.agentId || "coo");
    });

    // --- Live coding sessions --------------------------------------------
    // Read-only-ish attach to an agent's active coding-CLI PTY (owned by
    // integrations/coding-cli.ts). Multiple sockets can watch the same session;
    // each gets the replay buffer then a live stream, and may relay keystrokes.
    const codingUnsubs = new Map<string, () => void>();

    socket.on("coding:attach", (payload: { agentId?: string }) => {
      const agentId = payload.agentId || "coo";
      const session = getCodingSession(agentId);
      if (!session) {
        socket.emit("coding:exit", { agentId });
        return;
      }
      codingUnsubs.get(agentId)?.();
      socket.emit("coding:output", { agentId, data: session.getReplayBuffer() });
      const unsub = session.onData((data) => socket.emit("coding:output", { agentId, data }));
      codingUnsubs.set(agentId, unsub);
      void session.exited.then(() => {
        socket.emit("coding:exit", { agentId });
        codingUnsubs.get(agentId)?.();
        codingUnsubs.delete(agentId);
      });
    });

    socket.on("coding:input", (payload: { agentId?: string; data: string }) => {
      getCodingSession(payload.agentId || "coo")?.write(payload.data);
    });

    socket.on("coding:resize", (payload: { agentId?: string; cols: number; rows: number }) => {
      getCodingSession(payload.agentId || "coo")?.resize(payload.cols, payload.rows);
    });

    socket.on("coding:detach", (payload: { agentId?: string }) => {
      const agentId = payload.agentId || "coo";
      codingUnsubs.get(agentId)?.();
      codingUnsubs.delete(agentId);
    });

    socket.on("disconnect", () => {
      for (const joined of conversations.values()) {
        if (joined.idleTimer) clearTimeout(joined.idleTimer);
        void closeSession(orch, joined.agentId, joined.conversationId);
      }
      for (const agentId of [...terminals.keys()]) killTerminal(agentId);
      for (const unsub of codingUnsubs.values()) unsub();
      codingUnsubs.clear();
    });
  });

  return io;
}

function resetIdle(joined: JoinedConversation, onIdle: () => void) {
  if (joined.idleTimer) clearTimeout(joined.idleTimer);
  joined.idleTimer = setTimeout(onIdle, IDLE_CLOSE_MS);
}

/**
 * Run the end-of-session learning loop for one agent against its own context:
 * summarize → extract facts → rebuild user profile → optionally author a skill.
 * Failures are logged, never thrown.
 */
async function closeSession(
  orch: Orchestrator,
  agentId: string,
  conversationId: string
): Promise<void> {
  const ctx = orch.getContext(agentId);
  if (!ctx) return;
  // Auto-learning is opt-out per agent — when off, the session closes without
  // touching the agent's memory, user profile or capabilities.
  if (!ctx.profile.autoLearn) return;
  try {
    await summarizeConversation(ctx, conversationId);
  } catch (err) {
    console.error("[close] summarize failed:", err);
  }
  try {
    await extractFactsFromConversation(ctx, conversationId);
  } catch (err) {
    console.error("[close] extract failed:", err);
  }
  try {
    await ctx.userProfile.rebuildFromSession(conversationId);
  } catch (err) {
    console.error("[close] profile rebuild failed:", err);
  }
  try {
    await maybeAuthorSkill(ctx, conversationId);
  } catch (err) {
    console.error("[close] skill author failed:", err);
  }
}
