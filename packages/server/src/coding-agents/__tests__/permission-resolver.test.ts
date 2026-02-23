import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CodingAgentPermissionResolver,
  DEFAULT_PERMISSION_TIMEOUT_MS,
} from "../permission-resolver.js";

describe("CodingAgentPermissionResolver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("default timeout is under 30 seconds", () => {
    expect(DEFAULT_PERMISSION_TIMEOUT_MS).toBeLessThan(30_000);
  });

  it("resolves with 'reject' when timeout fires", async () => {
    const resolver = new CodingAgentPermissionResolver();
    const promise = resolver.register("agent-1", "perm-1");

    vi.advanceTimersByTime(resolver.timeoutMs);

    await expect(promise).resolves.toBe("reject");
    expect(resolver.size).toBe(0);
  });

  it("resolves with frontend response when resolved before timeout", async () => {
    const resolver = new CodingAgentPermissionResolver();
    const promise = resolver.register("agent-1", "perm-1");

    const resolved = resolver.resolve("agent-1", "perm-1", "once");
    expect(resolved).toBe(true);

    await expect(promise).resolves.toBe("once");
    expect(resolver.size).toBe(0);
  });

  it("resolves with 'always' when frontend sends always", async () => {
    const resolver = new CodingAgentPermissionResolver();
    const promise = resolver.register("agent-1", "perm-1");

    resolver.resolve("agent-1", "perm-1", "always");

    await expect(promise).resolves.toBe("always");
  });

  it("returns false when resolving a non-existent request", () => {
    const resolver = new CodingAgentPermissionResolver();
    expect(resolver.resolve("agent-1", "perm-1", "once")).toBe(false);
  });

  it("tracks pending requests with has() and size", () => {
    const resolver = new CodingAgentPermissionResolver();
    expect(resolver.has("a", "p")).toBe(false);
    expect(resolver.size).toBe(0);

    resolver.register("a", "p");
    expect(resolver.has("a", "p")).toBe(true);
    expect(resolver.size).toBe(1);

    resolver.resolve("a", "p", "reject");
    expect(resolver.has("a", "p")).toBe(false);
    expect(resolver.size).toBe(0);
  });

  it("handles multiple concurrent permission requests independently", async () => {
    const resolver = new CodingAgentPermissionResolver();
    const p1 = resolver.register("agent-1", "perm-1");
    const p2 = resolver.register("agent-2", "perm-2");

    expect(resolver.size).toBe(2);

    resolver.resolve("agent-1", "perm-1", "once");
    vi.advanceTimersByTime(resolver.timeoutMs);

    await expect(p1).resolves.toBe("once");
    await expect(p2).resolves.toBe("reject");
  });

  it("clear() cancels all pending timers and removes entries", () => {
    const resolver = new CodingAgentPermissionResolver();
    resolver.register("a", "1");
    resolver.register("b", "2");
    expect(resolver.size).toBe(2);

    resolver.clear();
    expect(resolver.size).toBe(0);
  });

  it("accepts a custom timeout", async () => {
    const resolver = new CodingAgentPermissionResolver(500);
    expect(resolver.timeoutMs).toBe(500);

    const promise = resolver.register("agent-1", "perm-1");

    vi.advanceTimersByTime(499);
    // Should still be pending
    expect(resolver.has("agent-1", "perm-1")).toBe(true);

    vi.advanceTimersByTime(1);
    await expect(promise).resolves.toBe("reject");
  });

  it("rejectByAgent rejects only that agent's pending requests", async () => {
    const resolver = new CodingAgentPermissionResolver();
    const p1 = resolver.register("agent-1", "perm-1");
    const p2 = resolver.register("agent-1", "perm-2");
    const p3 = resolver.register("agent-2", "perm-3");

    resolver.rejectByAgent("agent-1");

    await expect(p1).resolves.toBe("reject");
    await expect(p2).resolves.toBe("reject");
    // agent-2's request should still be pending
    expect(resolver.has("agent-2", "perm-3")).toBe(true);
    expect(resolver.size).toBe(1);

    resolver.resolve("agent-2", "perm-3", "once");
    await expect(p3).resolves.toBe("once");
  });

  it("timeout fires quickly — not 5 minutes", async () => {
    const resolver = new CodingAgentPermissionResolver();
    const promise = resolver.register("agent-1", "perm-1");

    // After 30 seconds the request must already be resolved (rejected)
    vi.advanceTimersByTime(30_000);
    await expect(promise).resolves.toBe("reject");
  });
});
