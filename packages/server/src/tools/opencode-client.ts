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
  timeoutMs?: number;
  maxIterations?: number;
}

export interface OpenCodeSession {
  id: string;
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

export class OpenCodeClient {
  private apiUrl: string;
  private authHeader: string | null;
  private timeoutMs: number;
  private maxIterations: number;

  constructor(config: OpenCodeConfig) {
    // Strip trailing slash
    this.apiUrl = config.apiUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 180_000;
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

  /** Send a task message to a session (blocks until OpenCode finishes) */
  async sendMessage(
    sessionId: string,
    task: string,
  ): Promise<{ content: string; [key: string]: unknown }> {
    console.log(`[OpenCode Client] POST ${this.apiUrl}/session/${sessionId}/message (task: ${task.length} chars, timeout: ${this.timeoutMs}ms)`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.apiUrl}/session/${sessionId}/message`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          parts: [{ type: "text", text: task }],
        }),
        signal: controller.signal,
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
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Get session status/summary */
  async getSession(
    sessionId: string,
  ): Promise<{ id: string; [key: string]: unknown }> {
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
    return (await res.json()) as { id: string; [key: string]: unknown };
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
   * High-level orchestrator: create session, send message, fetch diff,
   * return structured result.
   */
  async executeTask(
    task: string,
  ): Promise<OpenCodeTaskResult> {
    console.log(`[OpenCode Client] executeTask starting (task: ${task.slice(0, 200)}...)`);
    const session = await this.createSession();

    let response: { content: string; [key: string]: unknown };
    try {
      response = await this.sendMessage(session.id, task);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.warn(`[OpenCode Client] executeTask timed out after ${this.timeoutMs}ms`);
        await this.abort(session.id);
        return {
          success: false,
          sessionId: session.id,
          summary: `Task timed out after ${Math.round(this.timeoutMs / 1000)}s. The session was aborted.`,
          diff: null,
          error: "timeout",
        };
      }
      console.error(`[OpenCode Client] executeTask error:`, err);
      throw err;
    }

    console.log(`[OpenCode Client] executeTask response received, extracting content...`);
    const summary = this.extractContent(response as Record<string, unknown>);
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
}
