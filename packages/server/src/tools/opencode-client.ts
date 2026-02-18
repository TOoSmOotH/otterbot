/**
 * HTTP client for the OpenCode server API.
 *
 * OpenCode exposes an HTTP API via `opencode serve` (default: http://127.0.0.1:4096).
 * Auth is HTTP Basic (optional, via OPENCODE_SERVER_PASSWORD env var).
 */

export interface OpenCodeConfig {
  apiUrl: string;
  username?: string;
  password?: string;
  /** Idle timeout — abort only after this many ms with NO new activity (default: 180 000) */
  timeoutMs?: number;
  maxIterations?: number;
}

export interface OpenCodeSession {
  id: string;
  time?: { created?: number; updated?: number };
  [key: string]: unknown;
}

export interface OpenCodeDiff {
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
  [key: string]: unknown;
}

export interface OpenCodeTaskResult {
  success: boolean;
  sessionId: string;
  summary: string;
  diff: OpenCodeDiff | null;
  error?: string;
}

const POLL_INTERVAL_MS = 15_000; // Check for activity every 15 seconds
const MAX_TOTAL_WAIT_MS = 30 * 60 * 1000; // Hard cap at 30 minutes regardless of activity

export class OpenCodeClient {
  private apiUrl: string;
  private authHeader: string | null;
  private idleTimeoutMs: number;
  private maxIterations: number;

  constructor(config: OpenCodeConfig) {
    // Strip trailing slash
    this.apiUrl = config.apiUrl.replace(/\/+$/, "");
    this.idleTimeoutMs = config.timeoutMs ?? 180_000;
    this.maxIterations = config.maxIterations ?? 50;

    if (config.username && config.password) {
      const credentials = Buffer.from(
        `${config.username}:${config.password}`,
      ).toString("base64");
      this.authHeader = `Basic ${credentials}`;
    } else if (config.password) {
      const credentials = Buffer.from(`:${config.password}`).toString("base64");
      this.authHeader = `Basic ${credentials}`;
    } else {
      this.authHeader = null;
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authHeader) {
      h["Authorization"] = this.authHeader;
    }
    return h;
  }

  /** Create a new OpenCode session */
  async createSession(): Promise<OpenCodeSession> {
    console.log(`[OpenCode Client] POST ${this.apiUrl}/session`);
    const res = await fetch(`${this.apiUrl}/session`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[OpenCode Client] createSession failed: ${res.status} ${res.statusText} ${body}`);
      throw new Error(`Failed to create session: ${res.status} ${res.statusText} ${body}`);
    }
    const session = (await res.json()) as OpenCodeSession;
    console.log(`[OpenCode Client] Session created: ${session.id}`);
    return session;
  }

  /** Send a task message to a session (blocks until OpenCode finishes). Caller provides AbortSignal. */
  async sendMessage(
    sessionId: string,
    task: string,
    signal?: AbortSignal,
  ): Promise<{ content: string; [key: string]: unknown }> {
    console.log(`[OpenCode Client] POST ${this.apiUrl}/session/${sessionId}/message (task: ${task.length} chars)`);

    const res = await fetch(`${this.apiUrl}/session/${sessionId}/message`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        parts: [{ type: "text", text: task }],
      }),
      signal,
    });
    const rawBody = await res.text();
    console.log(`[OpenCode Client] sendMessage response: status=${res.status} body=${rawBody.slice(0, 1000)}`);
    if (!res.ok) {
      throw new Error(
        `Failed to send message: ${res.status} ${res.statusText} ${rawBody}`,
      );
    }
    const parsed = JSON.parse(rawBody);
    console.log(`[OpenCode Client] sendMessage parsed keys: ${Object.keys(parsed).join(", ")}`);
    return parsed as { content: string; [key: string]: unknown };
  }

  /** Get session status/summary */
  async getSession(
    sessionId: string,
  ): Promise<OpenCodeSession> {
    const res = await fetch(`${this.apiUrl}/session/${sessionId}`, {
      method: "GET",
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to get session: ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as OpenCodeSession;
  }

  /** Get messages for a session */
  async getMessages(
    sessionId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const res = await fetch(`${this.apiUrl}/session/${sessionId}/message`, {
      method: "GET",
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to get messages: ${res.status} ${res.statusText}`,
      );
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  /** Get file changes made in a session */
  async getDiff(sessionId: string): Promise<OpenCodeDiff> {
    const res = await fetch(`${this.apiUrl}/session/${sessionId}/diff`, {
      method: "GET",
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Failed to get diff: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as OpenCodeDiff;
  }

  /** Cancel a running session */
  async abort(sessionId: string): Promise<void> {
    try {
      const res = await fetch(`${this.apiUrl}/session/${sessionId}/abort`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      });
      // Abort may 404 if session already finished — that's OK
      if (!res.ok && res.status !== 404) {
        throw new Error(
          `Failed to abort session: ${res.status} ${res.statusText}`,
        );
      }
    } catch {
      // Best-effort abort
    }
  }

  /** Lightweight connectivity test */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.apiUrl}/session`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Authentication failed. Check credentials." };
      }
      if (!res.ok) {
        return { ok: false, error: `Server returned ${res.status} ${res.statusText}` };
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
   * Extract text content from an OpenCode message response.
   * The response may be a message object with parts, a list of messages,
   * or a simple { content } object.
   */
  private extractContent(response: Record<string, unknown>): string {
    console.log(`[OpenCode Client] extractContent — type=${typeof response}, isArray=${Array.isArray(response)}, keys=${typeof response === "object" && response ? Object.keys(response).join(",") : "N/A"}`);

    // Direct content field
    if (typeof response.content === "string") {
      console.log(`[OpenCode Client] extractContent — matched: direct content field (${response.content.length} chars)`);
      return response.content;
    }

    // Message with parts array (OpenCode v2 format)
    const parts = response.parts as Array<{ type?: string; text?: string }> | undefined;
    if (Array.isArray(parts)) {
      const textParts = parts.filter((p) => p.type === "text" && p.text);
      console.log(`[OpenCode Client] extractContent — matched: parts array (${parts.length} parts, ${textParts.length} text parts)`);
      return textParts.map((p) => p.text).join("\n");
    }

    // Array of messages — extract from last assistant message
    if (Array.isArray(response)) {
      console.log(`[OpenCode Client] extractContent — matched: array of messages (${response.length} items)`);
      for (let i = response.length - 1; i >= 0; i--) {
        const msg = response[i] as Record<string, unknown>;
        if (msg.role === "assistant") {
          return this.extractContent(msg);
        }
      }
    }

    // Fallback: stringify
    const fallback = JSON.stringify(response).slice(0, 2000);
    console.log(`[OpenCode Client] extractContent — FALLBACK (no match): ${fallback.slice(0, 500)}`);
    return fallback;
  }

  /**
   * Monitor session activity. Resolves when the session has been idle
   * (no new messages or session updates) for longer than idleTimeoutMs.
   * The caller should race this against the actual sendMessage call.
   */
  private async monitorActivity(
    sessionId: string,
    controller: AbortController,
  ): Promise<"idle" | "hard_cap"> {
    const startTime = Date.now();
    let lastActivityTime = Date.now();
    let lastMessageCount = 0;
    let lastUpdated = 0;

    while (!controller.signal.aborted) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      // If the sendMessage already completed, the controller will be aborted
      if (controller.signal.aborted) return "idle"; // doesn't matter, won't be used

      // Hard cap — don't wait forever regardless of activity
      if (Date.now() - startTime > MAX_TOTAL_WAIT_MS) {
        console.warn(`[OpenCode Client] Hard cap reached (${MAX_TOTAL_WAIT_MS / 1000}s total). Aborting.`);
        controller.abort();
        return "hard_cap";
      }

      try {
        // Check session updated timestamp
        const session = await this.getSession(sessionId);
        const sessionUpdated = session.time?.updated ?? 0;

        // Check message count
        let messageCount = 0;
        try {
          const messages = await this.getMessages(sessionId);
          messageCount = messages.length;
        } catch {
          // Message endpoint may not be available — fall back to session-only check
        }

        // Detect activity: session timestamp changed or new messages appeared
        if (sessionUpdated > lastUpdated || messageCount > lastMessageCount) {
          console.log(
            `[OpenCode Client] Activity detected — messages: ${lastMessageCount}→${messageCount}, ` +
            `updated: ${lastUpdated}→${sessionUpdated}`,
          );
          lastActivityTime = Date.now();
          lastUpdated = sessionUpdated;
          lastMessageCount = messageCount;
        } else {
          const idleMs = Date.now() - lastActivityTime;
          console.log(
            `[OpenCode Client] No new activity — idle for ${Math.round(idleMs / 1000)}s ` +
            `(timeout at ${Math.round(this.idleTimeoutMs / 1000)}s), messages=${messageCount}`,
          );
        }

        // Idle timeout — no activity for too long
        if (Date.now() - lastActivityTime > this.idleTimeoutMs) {
          console.warn(
            `[OpenCode Client] Idle timeout reached (${Math.round(this.idleTimeoutMs / 1000)}s with no activity). Aborting.`,
          );
          controller.abort();
          return "idle";
        }
      } catch (err) {
        // Polling failure — don't abort, just log and try again
        console.warn(`[OpenCode Client] Activity poll error (non-fatal):`, err instanceof Error ? err.message : err);
      }
    }

    return "idle";
  }

  /**
   * High-level orchestrator: create session, send message with activity-based
   * timeout, fetch diff, return structured result.
   *
   * Instead of a fixed timeout, monitors session activity (new messages,
   * session timestamp updates). Only aborts after idleTimeoutMs of inactivity.
   */
  async executeTask(
    task: string,
  ): Promise<OpenCodeTaskResult> {
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
        // Node 18+ uses a different error type for AbortSignal
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
        const summary = this.extractContent(result.response as Record<string, unknown>);
        console.log(`[OpenCode Client] extractContent result (${summary.length} chars): ${summary.slice(0, 500)}`);

        let diff: OpenCodeDiff | null = null;
        try {
          diff = await this.getDiff(session.id);
          console.log(`[OpenCode Client] getDiff: ${diff?.files?.length ?? 0} files changed`);
        } catch (err) {
          console.warn(`[OpenCode Client] getDiff failed (non-fatal):`, err);
        }

        return {
          success: true,
          sessionId: session.id,
          summary,
          diff,
        };
      }

      // Timed out (idle or hard cap)
      const reason = result.type === "timeout"
        ? (result as { reason: string }).reason
        : "idle";
      const timeoutDesc = reason === "hard_cap"
        ? `${Math.round(MAX_TOTAL_WAIT_MS / 1000)}s total time`
        : `${Math.round(this.idleTimeoutMs / 1000)}s with no activity`;

      console.warn(`[OpenCode Client] executeTask timed out (${reason}: ${timeoutDesc})`);
      await this.abort(session.id);

      // Try to salvage partial results
      let summary = `Task timed out after ${timeoutDesc}. The session was aborted.`;
      try {
        const messages = await this.getMessages(session.id);
        if (messages.length > 0) {
          const lastAssistant = [...messages].reverse().find(
            (m) => (m as Record<string, unknown>).role === "assistant",
          );
          if (lastAssistant) {
            const partial = this.extractContent(lastAssistant as Record<string, unknown>);
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
        error: reason === "hard_cap" ? "hard_timeout" : "idle_timeout",
      };
    } catch (err) {
      // Stop monitor on unexpected errors
      if (!controller.signal.aborted) {
        controller.abort();
      }
      console.error(`[OpenCode Client] executeTask error:`, err);
      throw err;
    }
  }
}
