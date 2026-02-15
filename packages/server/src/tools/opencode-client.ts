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
    const res = await fetch(`${this.apiUrl}/session`, {
      method: "POST",
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Failed to create session: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as OpenCodeSession;
  }

  /** Send a task message to a session (blocks until OpenCode finishes) */
  async sendMessage(
    sessionId: string,
    task: string,
  ): Promise<{ content: string; [key: string]: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.apiUrl}/session/${sessionId}/message`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          message: task,
          maxIterations: this.maxIterations,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(
          `Failed to send message: ${res.status} ${res.statusText}`,
        );
      }
      return (await res.json()) as { content: string; [key: string]: unknown };
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
    const res = await fetch(`${this.apiUrl}/session/${sessionId}/abort`, {
      method: "POST",
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to abort session: ${res.status} ${res.statusText}`,
      );
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
   * High-level orchestrator: create session, send message, fetch diff,
   * return structured result.
   */
  async executeTask(
    task: string,
  ): Promise<OpenCodeTaskResult> {
    const session = await this.createSession();

    let response: { content: string; [key: string]: unknown };
    try {
      response = await this.sendMessage(session.id, task);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Try to abort the session gracefully
        try {
          await this.abort(session.id);
        } catch { /* ignore */ }
        return {
          success: false,
          sessionId: session.id,
          summary: `Task timed out after ${Math.round(this.timeoutMs / 1000)}s. The session was aborted.`,
          diff: null,
          error: "timeout",
        };
      }
      throw err;
    }

    let diff: OpenCodeDiff | null = null;
    try {
      diff = await this.getDiff(session.id);
    } catch {
      // Diff may not be available — that's OK
    }

    return {
      success: true,
      sessionId: session.id,
      summary: response.content ?? "(no response)",
      diff,
    };
  }
}
