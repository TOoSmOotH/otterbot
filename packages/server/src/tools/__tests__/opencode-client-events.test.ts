import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock undici Agent to prevent actual network connections
vi.mock("undici", () => ({
  Agent: vi.fn().mockImplementation(() => ({})),
}));

// Mock the SDK client
const mockSubscribe = vi.fn();
const mockCreate = vi.fn();
const mockPrompt = vi.fn();
const mockDiff = vi.fn();
const mockAbort = vi.fn();

vi.mock("@opencode-ai/sdk/client", () => ({
  createOpencodeClient: vi.fn(() => ({
    event: { subscribe: mockSubscribe },
    session: {
      create: mockCreate,
      prompt: mockPrompt,
      diff: mockDiff,
      abort: mockAbort,
      list: vi.fn(() => ({ error: null, data: [] })),
      messages: vi.fn(() => ({ error: null, data: [] })),
    },
  })),
}));

import { OpenCodeClient } from "../opencode-client.js";

describe("OpenCodeClient — onEvent callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the onEvent callback from config", () => {
    const onEvent = vi.fn();
    const client = new OpenCodeClient({
      apiUrl: "http://localhost:3333",
      onEvent,
    });
    // Access private field to verify it's stored
    expect((client as any).onEvent).toBe(onEvent);
  });

  it("forwards SSE events through the onEvent callback during monitorViaSse", async () => {
    const onEvent = vi.fn();

    // Create an async iterable that yields a few events then ends
    const events = [
      { type: "message.part.updated", properties: { sessionID: "sess-1", delta: "Hello", partID: "p1", messageID: "m1", type: "text" } },
      { type: "session.status", properties: { sessionID: "sess-1", status: "active" } },
    ];

    let eventIdx = 0;
    mockSubscribe.mockResolvedValue({
      stream: {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              if (eventIdx < events.length) {
                return { value: events[eventIdx++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      },
    });

    const client = new OpenCodeClient({
      apiUrl: "http://localhost:3333",
      onEvent,
    });

    const controller = new AbortController();
    // Call monitorViaSse directly via the private method
    const result = await (client as any).monitorViaSse(
      "sess-1",
      controller,
      Date.now(),
      Date.now(),
    );

    // Should have forwarded both events
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledWith({
      type: "message.part.updated",
      properties: expect.objectContaining({ delta: "Hello" }),
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: "session.status",
      properties: expect.objectContaining({ status: "active" }),
    });
  });

  it("does not throw when onEvent is not provided", async () => {
    const events = [
      { type: "session.status", properties: { sessionID: "sess-1" } },
    ];
    let eventIdx = 0;
    mockSubscribe.mockResolvedValue({
      stream: {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              if (eventIdx < events.length) {
                return { value: events[eventIdx++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      },
    });

    const client = new OpenCodeClient({ apiUrl: "http://localhost:3333" });
    const controller = new AbortController();

    // Should complete without throwing
    await expect(
      (client as any).monitorViaSse("sess-1", controller, Date.now(), Date.now()),
    ).resolves.toBeDefined();
  });

  it("does not forward events for other sessions", async () => {
    const onEvent = vi.fn();
    const events = [
      { type: "message.updated", properties: { sessionID: "other-session", role: "assistant" } },
    ];
    let eventIdx = 0;
    mockSubscribe.mockResolvedValue({
      stream: {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              if (eventIdx < events.length) {
                return { value: events[eventIdx++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      },
    });

    const client = new OpenCodeClient({ apiUrl: "http://localhost:3333", onEvent });
    const controller = new AbortController();

    await (client as any).monitorViaSse("sess-1", controller, Date.now(), Date.now());

    // Should NOT forward event for a different session
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("catches errors in onEvent callback without breaking the loop", async () => {
    const onEvent = vi.fn().mockImplementation(() => {
      throw new Error("callback error");
    });

    const events = [
      { type: "session.status", properties: { sessionID: "sess-1" } },
      { type: "message.updated", properties: { sessionID: "sess-1", role: "assistant", messageID: "m1" } },
    ];
    let eventIdx = 0;
    mockSubscribe.mockResolvedValue({
      stream: {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              if (eventIdx < events.length) {
                return { value: events[eventIdx++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      },
    });

    const client = new OpenCodeClient({ apiUrl: "http://localhost:3333", onEvent });
    const controller = new AbortController();

    // Should complete successfully despite callback throwing
    const result = await (client as any).monitorViaSse("sess-1", controller, Date.now(), Date.now());
    expect(result).toBe("idle");

    // Both events should have been attempted
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});
