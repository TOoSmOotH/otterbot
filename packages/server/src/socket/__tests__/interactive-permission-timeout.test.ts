import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the interactive-mode permission resolver logic in index.ts.
 *
 * The permission system stores { resolve } entries in a Map keyed by
 * `${agentId}:${permissionId}`. Previously a 5-minute setTimeout would
 * auto-reject unresolved requests — this caused interactive coding sessions
 * to fail when the user didn't respond within 5 minutes (issue #161).
 *
 * The fix removes the timeout entirely: interactive mode waits for the user
 * to respond, and pending permissions are cleaned up when the agent is
 * destroyed.
 *
 * Since the resolver logic lives inside the startServer() closure, these
 * tests replicate the exact Map + resolve pattern used in production.
 */

type PermissionResponse = "once" | "always" | "reject";
type PermissionEntry = { resolve: (response: PermissionResponse) => void };

// Replicate the resolver helpers from index.ts
function createPermissionSystem() {
  const resolvers = new Map<string, PermissionEntry>();
  let activePermissionRequest: { agentId: string; permissionId: string; sessionId: string } | null = null;

  function resolve(agentId: string, permissionId: string, response: PermissionResponse): boolean {
    const key = `${agentId}:${permissionId}`;
    const entry = resolvers.get(key);
    if (!entry) return false;
    resolvers.delete(key);
    entry.resolve(response);
    if (activePermissionRequest?.permissionId === permissionId) {
      activePermissionRequest = null;
    }
    return true;
  }

  function requestPermission(agentId: string, sessionId: string, permissionId: string): Promise<PermissionResponse> {
    return new Promise<PermissionResponse>((res) => {
      const key = `${agentId}:${permissionId}`;
      resolvers.set(key, { resolve: res });
    });
  }

  function destroyAgent(agentId: string) {
    for (const [key, entry] of resolvers) {
      if (key.startsWith(`${agentId}:`)) {
        resolvers.delete(key);
        entry.resolve("reject");
      }
    }
    if (activePermissionRequest?.agentId === agentId) {
      activePermissionRequest = null;
    }
  }

  return {
    resolvers,
    resolve,
    requestPermission,
    destroyAgent,
    get activePermissionRequest() { return activePermissionRequest; },
    set activePermissionRequest(v) { activePermissionRequest = v; },
  };
}

describe("Interactive mode permission resolver", () => {
  let system: ReturnType<typeof createPermissionSystem>;

  beforeEach(() => {
    vi.useFakeTimers();
    system = createPermissionSystem();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the user responds with 'once'", async () => {
    const promise = system.requestPermission("agent-1", "sess-1", "perm-1");

    // Simulate user responding
    const resolved = system.resolve("agent-1", "perm-1", "once");
    expect(resolved).toBe(true);

    const result = await promise;
    expect(result).toBe("once");
  });

  it("resolves when the user responds with 'always'", async () => {
    const promise = system.requestPermission("agent-1", "sess-1", "perm-1");

    system.resolve("agent-1", "perm-1", "always");

    const result = await promise;
    expect(result).toBe("always");
  });

  it("resolves when the user responds with 'reject'", async () => {
    const promise = system.requestPermission("agent-1", "sess-1", "perm-1");

    system.resolve("agent-1", "perm-1", "reject");

    const result = await promise;
    expect(result).toBe("reject");
  });

  it("does NOT auto-reject after 5 minutes (the fixed behavior)", async () => {
    const promise = system.requestPermission("agent-1", "sess-1", "perm-1");

    // Advance past the old 5-minute timeout
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    // The promise should still be pending (not rejected)
    expect(system.resolvers.size).toBe(1);

    // Resolve it manually — should still work
    const resolved = system.resolve("agent-1", "perm-1", "once");
    expect(resolved).toBe(true);

    const result = await promise;
    expect(result).toBe("once");
  });

  it("does NOT auto-reject after 30 minutes", async () => {
    const promise = system.requestPermission("agent-1", "sess-1", "perm-1");

    vi.advanceTimersByTime(30 * 60 * 1000);

    // Still pending
    expect(system.resolvers.size).toBe(1);

    system.resolve("agent-1", "perm-1", "always");
    const result = await promise;
    expect(result).toBe("always");
  });

  it("returns false when resolving a non-existent permission", () => {
    const resolved = system.resolve("agent-1", "perm-999", "once");
    expect(resolved).toBe(false);
  });

  it("cleans up pending permissions when the agent is destroyed", async () => {
    const promise = system.requestPermission("agent-1", "sess-1", "perm-1");

    expect(system.resolvers.size).toBe(1);

    system.destroyAgent("agent-1");

    expect(system.resolvers.size).toBe(0);
    const result = await promise;
    expect(result).toBe("reject");
  });

  it("only cleans up permissions for the destroyed agent", async () => {
    const p1 = system.requestPermission("agent-1", "sess-1", "perm-1");
    const p2 = system.requestPermission("agent-2", "sess-2", "perm-2");

    expect(system.resolvers.size).toBe(2);

    system.destroyAgent("agent-1");

    // agent-1's permission is cleaned up
    expect(system.resolvers.size).toBe(1);
    const result1 = await p1;
    expect(result1).toBe("reject");

    // agent-2's permission is still pending
    system.resolve("agent-2", "perm-2", "once");
    const result2 = await p2;
    expect(result2).toBe("once");
  });

  it("cleans up multiple pending permissions for the same agent", async () => {
    const p1 = system.requestPermission("agent-1", "sess-1", "perm-1");
    const p2 = system.requestPermission("agent-1", "sess-1", "perm-2");

    expect(system.resolvers.size).toBe(2);

    system.destroyAgent("agent-1");

    expect(system.resolvers.size).toBe(0);
    expect(await p1).toBe("reject");
    expect(await p2).toBe("reject");
  });

  it("clears activePermissionRequest on agent destroy", () => {
    system.activePermissionRequest = { agentId: "agent-1", permissionId: "perm-1", sessionId: "sess-1" };

    system.destroyAgent("agent-1");

    expect(system.activePermissionRequest).toBeNull();
  });

  it("does not clear activePermissionRequest for a different agent", () => {
    system.activePermissionRequest = { agentId: "agent-2", permissionId: "perm-1", sessionId: "sess-1" };

    system.destroyAgent("agent-1");

    expect(system.activePermissionRequest).not.toBeNull();
  });

  it("clears activePermissionRequest when permission is resolved", () => {
    system.requestPermission("agent-1", "sess-1", "perm-1");
    system.activePermissionRequest = { agentId: "agent-1", permissionId: "perm-1", sessionId: "sess-1" };

    system.resolve("agent-1", "perm-1", "once");

    expect(system.activePermissionRequest).toBeNull();
  });
});
