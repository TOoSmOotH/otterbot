/**
 * HTTP client for the OpenCode server API, built on @opencode-ai/sdk.
 *
 * Uses SSE event streaming for activity-based idle timeout instead of
 * a fixed duration — OpenCode can run as long as it's actively working.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client";
import { Agent } from "undici";

export interface OpenCodeConfig {
  apiUrl: string;
  username?: string;
  password?: string;
  /** Idle timeout — abort only after this many ms with NO new activity (default: 180 000) */
  timeoutMs?: number;
  maxIterations?: number;
}

export interface OpenCodeDiff {
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

export interface OpenCodeTaskResult {
  success: boolean;
  sessionId: string;
  summary: string;
  diff: OpenCodeDiff | null;
  error?: string;
}

const POLL_INTERVAL_MS = 15_000; // Fallback poll interval if SSE isn't available
const MAX_TOTAL_WAIT_MS = 30 * 60 * 1000; // Hard cap at 30 minutes regardless of activity

export class OpenCodeClient {
  private client: OpencodeClient;
  private apiUrl: string;
  private idleTimeoutMs: number;
  private maxIterations: number;

  constructor(config: OpenCodeConfig) {
    const baseUrl = config.apiUrl.replace(/\/+$/, "");
    this.apiUrl = baseUrl;
    this.idleTimeoutMs = config.timeoutMs ?? 1_200_000;
    this.maxIterations = config.maxIterations ?? 50;

    // Build auth header for HTTP Basic
    const headers: Record<string, string> = {};
    if (config.username && config.password) {
      headers["Authorization"] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
    } else if (config.password) {
      headers["Authorization"] = `Basic ${Buffer.from(`:${config.password}`).toString("base64")}`;
    }

    // Disable undici's default headers/body timeouts — session.prompt() blocks
    // until OpenCode finishes which can take many minutes. Our activity monitor
    // handles idle detection instead.
    const dispatcher = new Agent({
      headersTimeout: 0,
      bodyTimeout: 0,
      connectTimeout: 30_000,
    });

    this.client = createOpencodeClient({
      baseUrl,
      headers,
      fetch: ((input: Request) =>
        fetch(input, { dispatcher } as RequestInit)) as (request: Request) => Promise<Response>,
    });
  }

  /** Create a new OpenCode session */
  async createSession(): Promise<{ id: string }> {
    console.log(`[OpenCode Client] Creating session...`);
    const result = await this.client.session.create({ body: {} });
    if (result.error) {
      console.error(`[OpenCode Client] createSession failed:`, result.error);
      throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`);
    }
    const session = result.data!;
    console.log(`[OpenCode Client] Session created: ${session.id}`);
    return { id: session.id };
  }

  /** Send a task message to a session (blocks until OpenCode finishes) */
  async sendMessage(
    sessionId: string,
    task: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    console.log(`[OpenCode Client] Sending message to session ${sessionId} (${task.length} chars)`);
    const result = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: task }],
      },
      signal,
    });
    if (result.error) {
      console.error(`[OpenCode Client] sendMessage failed:`, result.error);
      throw new Error(`Failed to send message: ${JSON.stringify(result.error)}`);
    }
    console.log(`[OpenCode Client] sendMessage response received`);
    return (result.data ?? {}) as Record<string, unknown>;
  }

  /** Get session messages */
  async getMessages(sessionId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.session.messages({
      path: { id: sessionId },
    });
    if (result.error) {
      throw new Error(`Failed to get messages: ${JSON.stringify(result.error)}`);
    }
    const data = result.data;
    return Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  }

  /** Get file changes made in a session */
  async getDiff(sessionId: string): Promise<OpenCodeDiff> {
    const result = await this.client.session.diff({
      path: { id: sessionId },
    });
    if (result.error) {
      throw new Error(`Failed to get diff: ${JSON.stringify(result.error)}`);
    }
    // SDK returns Array<FileDiff> with { file, additions, deletions, before, after }
    // Map to our interface: { files: [{ path, additions, deletions }] }
    const fileDiffs = result.data ?? [];
    return {
      files: fileDiffs.map((f) => ({
        path: f.file,
        additions: f.additions,
        deletions: f.deletions,
      })),
    };
  }

  /** Cancel a running session */
  async abort(sessionId: string): Promise<void> {
    try {
      await this.client.session.abort({
        path: { id: sessionId },
      });
    } catch {
      // Best-effort abort
    }
  }

  /** Lightweight connectivity test */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.client.session.list();
      if (result.error) {
        const errStr = JSON.stringify(result.error);
        if (errStr.includes("401") || errStr.includes("403")) {
          return { ok: false, error: "Authentication failed. Check credentials." };
        }
        return { ok: false, error: `Server returned error: ${errStr}` };
      }
      return { ok: true };
    } catch (err) {
      if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("ECONNREFUSED"))) {
        return { ok: false, error: "Connection refused. Is OpenCode server running?" };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Extract text content from an OpenCode message/response.
   */
  private extractContent(response: Record<string, unknown>): string {
    // Direct content field
    if (typeof response.content === "string") {
      return response.content;
    }

    // Message with parts array (OpenCode v2 format)
    const parts = response.parts as Array<{ type?: string; text?: string }> | undefined;
    if (Array.isArray(parts)) {
      const textParts = parts.filter((p) => p.type === "text" && p.text);
      return textParts.map((p) => p.text).join("\n");
    }

    // Array of messages — extract from last assistant message
    if (Array.isArray(response)) {
      for (let i = response.length - 1; i >= 0; i--) {
        const msg = response[i] as Record<string, unknown>;
        if (msg.role === "assistant") {
          return this.extractContent(msg);
        }
      }
    }

    // Fallback: stringify
    return JSON.stringify(response).slice(0, 2000);
  }

  /**
   * Monitor session activity via SSE event stream.
   * Resets idle timer on any event related to this session.
   * Falls back to polling if SSE subscription fails.
   *
   * Resolves with a reason string when the session should be aborted.
   */
  private async monitorActivity(
    sessionId: string,
    controller: AbortController,
  ): Promise<"idle" | "hard_cap" | "error"> {
    const startTime = Date.now();
    let lastActivityTime = Date.now();

    // Try SSE first, fall back to polling
    try {
      return await this.monitorViaSse(sessionId, controller, startTime, lastActivityTime);
    } catch (err) {
      console.warn(`[OpenCode Client] SSE subscription failed, falling back to polling:`, err instanceof Error ? err.message : err);
      return this.monitorViaPolling(sessionId, controller, startTime, lastActivityTime);
    }
  }

  /** Monitor activity via SSE event stream */
  private async monitorViaSse(
    sessionId: string,
    controller: AbortController,
    startTime: number,
    lastActivityTime: number,
  ): Promise<"idle" | "hard_cap" | "error"> {
    const events = await this.client.event.subscribe({
      signal: controller.signal,
    });

    // Process events with a timeout check loop
    const checkInterval = setInterval(() => {
      if (controller.signal.aborted) return;

      // Hard cap
      if (Date.now() - startTime > MAX_TOTAL_WAIT_MS) {
        console.warn(`[OpenCode Client] Hard cap reached (${MAX_TOTAL_WAIT_MS / 1000}s total). Aborting.`);
        controller.abort();
        return;
      }

      // Idle timeout
      const idleMs = Date.now() - lastActivityTime;
      if (idleMs > this.idleTimeoutMs) {
        console.warn(`[OpenCode Client] Idle timeout (${Math.round(idleMs / 1000)}s with no activity). Aborting.`);
        controller.abort();
        return;
      }
    }, 5_000);

    try {
      for await (const event of events.stream) {
        if (controller.signal.aborted) break;

        const eventType = (event as Record<string, unknown>).type as string | undefined;
        const props = (event as Record<string, unknown>).properties as Record<string, unknown> | undefined;

        // Check if this event is related to our session
        const eventSessionId = props?.sessionID as string | undefined;
        const isOurSession = !eventSessionId || eventSessionId === sessionId;

        if (isOurSession) {
          lastActivityTime = Date.now();
          console.log(`[OpenCode Client] SSE activity: ${eventType ?? "unknown"}`);

          // Check for error events
          if (eventType === "session.error" && eventSessionId === sessionId) {
            console.error(`[OpenCode Client] Session error event:`, props?.error);
            clearInterval(checkInterval);
            controller.abort();
            return "error";
          }
        }
      }
    } catch (err) {
      // Stream ended or was aborted
      if (!controller.signal.aborted) {
        console.warn(`[OpenCode Client] SSE stream ended:`, err instanceof Error ? err.message : err);
      }
    } finally {
      clearInterval(checkInterval);
    }

    // Determine why we stopped
    if (Date.now() - startTime > MAX_TOTAL_WAIT_MS) return "hard_cap";
    if (Date.now() - lastActivityTime > this.idleTimeoutMs) return "idle";
    return "idle"; // controller was aborted by sendMessage completing
  }

  /** Fallback: monitor activity by polling session messages */
  private async monitorViaPolling(
    sessionId: string,
    controller: AbortController,
    startTime: number,
    lastActivityTime: number,
  ): Promise<"idle" | "hard_cap"> {
    let lastMessageCount = 0;

    while (!controller.signal.aborted) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (controller.signal.aborted) break;

      // Hard cap
      if (Date.now() - startTime > MAX_TOTAL_WAIT_MS) {
        console.warn(`[OpenCode Client] Hard cap reached (${MAX_TOTAL_WAIT_MS / 1000}s). Aborting.`);
        controller.abort();
        return "hard_cap";
      }

      try {
        const messages = await this.getMessages(sessionId);
        if (messages.length > lastMessageCount) {
          console.log(`[OpenCode Client] Poll activity: messages ${lastMessageCount}→${messages.length}`);
          lastActivityTime = Date.now();
          lastMessageCount = messages.length;
        } else {
          const idleMs = Date.now() - lastActivityTime;
          console.log(`[OpenCode Client] No activity — idle ${Math.round(idleMs / 1000)}s (timeout at ${Math.round(this.idleTimeoutMs / 1000)}s)`);
        }
      } catch {
        // Polling error — ignore and try again
      }

      if (Date.now() - lastActivityTime > this.idleTimeoutMs) {
        console.warn(`[OpenCode Client] Idle timeout. Aborting.`);
        controller.abort();
        return "idle";
      }
    }

    return "idle";
  }

  /**
   * High-level orchestrator: create session, send message with activity-based
   * timeout, fetch diff, return structured result.
   */
  async executeTask(task: string): Promise<OpenCodeTaskResult> {
    console.log(`[OpenCode Client] executeTask starting (idleTimeout=${this.idleTimeoutMs}ms, task: ${task.slice(0, 200)}...)`);
    const session = await this.createSession();

    const controller = new AbortController();

    // Race: sendMessage vs activity monitor
    const messagePromise = this.sendMessage(session.id, task, controller.signal)
      .then((response) => ({ type: "response" as const, response }))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return { type: "aborted" as const, response: null };
        }
        if (err instanceof Error && err.name === "AbortError") {
          return { type: "aborted" as const, response: null };
        }
        throw err;
      });

    const monitorPromise = this.monitorActivity(session.id, controller);

    try {
      const result = await Promise.race([
        messagePromise,
        monitorPromise.then((reason) => ({ type: "timeout" as const, reason, response: null })),
      ]);

      // Stop the monitor if sendMessage completed first
      if (!controller.signal.aborted) {
        controller.abort();
      }

      if (result.type === "response" && result.response) {
        console.log(`[OpenCode Client] executeTask response received, extracting content...`);
        const summary = this.extractContent(result.response);
        console.log(`[OpenCode Client] extractContent result (${summary.length} chars): ${summary.slice(0, 500)}`);

        let diff: OpenCodeDiff | null = null;
        try {
          diff = await this.getDiff(session.id);
          console.log(`[OpenCode Client] getDiff: ${diff?.files?.length ?? 0} files changed`);
        } catch (err) {
          console.warn(`[OpenCode Client] getDiff failed (non-fatal):`, err);
        }

        return { success: true, sessionId: session.id, summary, diff };
      }

      // Timed out (idle, hard cap, or error)
      const reason = result.type === "timeout"
        ? (result as { reason: string }).reason
        : "idle";
      const timeoutDesc = reason === "hard_cap"
        ? `${Math.round(MAX_TOTAL_WAIT_MS / 1000)}s total time`
        : reason === "error"
          ? "session error"
          : `${Math.round(this.idleTimeoutMs / 1000)}s with no activity`;

      console.warn(`[OpenCode Client] executeTask timed out (${reason}: ${timeoutDesc})`);
      await this.abort(session.id);

      // Try to salvage partial results
      let summary = `Task timed out after ${timeoutDesc}. The session was aborted.`;
      try {
        const messages = await this.getMessages(session.id);
        if (messages.length > 0) {
          const lastAssistant = [...messages].reverse().find(
            (m) => m.role === "assistant",
          );
          if (lastAssistant) {
            const partial = this.extractContent(lastAssistant);
            if (partial.length > 50) {
              summary += `\n\nPartial result from last assistant message:\n${partial}`;
            }
          }
        }
      } catch {
        // Best-effort partial result extraction
      }

      let diff: OpenCodeDiff | null = null;
      try {
        diff = await this.getDiff(session.id);
      } catch {
        // Best-effort diff
      }

      return {
        success: false,
        sessionId: session.id,
        summary,
        diff,
        error: reason === "hard_cap" ? "hard_timeout" : reason === "error" ? "session_error" : "idle_timeout",
      };
    } catch (err) {
      if (!controller.signal.aborted) {
        controller.abort();
      }
      console.error(`[OpenCode Client] executeTask error:`, err);
      throw err;
    }
  }
}
