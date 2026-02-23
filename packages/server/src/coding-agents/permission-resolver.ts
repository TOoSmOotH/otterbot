/**
 * Manages coding agent permission request resolution with timeouts.
 *
 * When a coding agent (Claude Code, OpenCode, etc.) requests permission in
 * interactive mode, we store a resolver so the frontend can approve/reject it.
 * If no response arrives within the timeout, the permission is automatically
 * rejected to prevent the session from hanging indefinitely.
 */

export type PermissionResponse = "once" | "always" | "reject";

interface PermissionEntry {
  resolve: (response: PermissionResponse) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Default timeout: 15 seconds — short enough for interactive use */
export const DEFAULT_PERMISSION_TIMEOUT_MS = 15_000;

export class CodingAgentPermissionResolver {
  private resolvers = new Map<string, PermissionEntry>();
  readonly timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_PERMISSION_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Register a new permission request and return a promise that resolves when
   * the frontend responds or the timeout fires (whichever comes first).
   */
  register(agentId: string, permissionId: string): Promise<PermissionResponse> {
    return new Promise<PermissionResponse>((resolve) => {
      const key = this.key(agentId, permissionId);
      const timeout = setTimeout(() => {
        this.resolvers.delete(key);
        resolve("reject");
      }, this.timeoutMs);
      this.resolvers.set(key, { resolve, timeout });
    });
  }

  /**
   * Resolve a pending permission request with a response from the frontend.
   * Returns true if the request existed and was resolved, false otherwise.
   */
  resolve(agentId: string, permissionId: string, response: PermissionResponse): boolean {
    const key = this.key(agentId, permissionId);
    const entry = this.resolvers.get(key);
    if (!entry) return false;
    clearTimeout(entry.timeout);
    this.resolvers.delete(key);
    entry.resolve(response);
    return true;
  }

  /** Check if a permission request is pending */
  has(agentId: string, permissionId: string): boolean {
    return this.resolvers.has(this.key(agentId, permissionId));
  }

  /** Number of pending permission requests */
  get size(): number {
    return this.resolvers.size;
  }

  /** Reject all pending requests for a specific agent (e.g., on session end) */
  rejectByAgent(agentId: string): void {
    const prefix = `${agentId}:`;
    for (const [key, entry] of this.resolvers) {
      if (key.startsWith(prefix)) {
        clearTimeout(entry.timeout);
        this.resolvers.delete(key);
        entry.resolve("reject");
      }
    }
  }

  /** Clear all pending requests (cleans up timers) */
  clear(): void {
    for (const entry of this.resolvers.values()) {
      clearTimeout(entry.timeout);
    }
    this.resolvers.clear();
  }

  private key(agentId: string, permissionId: string): string {
    return `${agentId}:${permissionId}`;
  }
}
