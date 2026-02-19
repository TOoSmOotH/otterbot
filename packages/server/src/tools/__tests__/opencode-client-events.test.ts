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
      { type: "message.part.updated", properties: { sessionID: "sess-1", part: { id: "p1", sessionID: "sess-1", messageID: "m1", type: "text", text: "Hello" }, delta: "Hello" } },
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
      properties: expect.objectContaining({ delta: "Hello", part: expect.any(Object) }),
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

  describe("multi-turn executeTask with getHumanResponse", () => {
    it("runs a single turn when getHumanResponse is not provided", async () => {
      mockCreate.mockResolvedValue({ error: null, data: { id: "sess-1" } });
      mockPrompt.mockResolvedValue({ error: null, data: { content: "Done!" } });
      mockDiff.mockResolvedValue({ error: null, data: [] });

      // SSE subscription that ends immediately so executeTurn's monitor doesn't block
      mockSubscribe.mockResolvedValue({
        stream: { [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; } },
      });

      const client = new OpenCodeClient({ apiUrl: "http://localhost:3333" });
      const result = await client.executeTask("Build X");

      expect(result.success).toBe(true);
      expect(result.summary).toBe("Done!");
      expect(mockPrompt).toHaveBeenCalledTimes(1);
    });

    it("loops when getHumanResponse returns a string", async () => {
      mockCreate.mockResolvedValue({ error: null, data: { id: "sess-1" } });
      let promptCount = 0;
      mockPrompt.mockImplementation(async () => {
        promptCount++;
        return { error: null, data: { content: promptCount === 1 ? "Which approach?" : "Done with approach A." } };
      });
      mockDiff.mockResolvedValue({ error: null, data: [] });
      mockSubscribe.mockResolvedValue({
        stream: { [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; } },
      });

      const getHumanResponse = vi.fn()
        .mockResolvedValueOnce("Use approach A")
        .mockResolvedValueOnce(null); // end loop after second turn

      const client = new OpenCodeClient({ apiUrl: "http://localhost:3333" });
      const result = await client.executeTask("Build X", getHumanResponse);

      expect(result.success).toBe(true);
      expect(mockPrompt).toHaveBeenCalledTimes(2);
      expect(getHumanResponse).toHaveBeenCalledTimes(2);
      expect(getHumanResponse).toHaveBeenCalledWith("sess-1", "Which approach?");
    });

    it("stops loop when getHumanResponse returns null", async () => {
      mockCreate.mockResolvedValue({ error: null, data: { id: "sess-1" } });
      mockPrompt.mockResolvedValue({ error: null, data: { content: "Which?" } });
      mockDiff.mockResolvedValue({ error: null, data: [] });
      mockSubscribe.mockResolvedValue({
        stream: { [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; } },
      });

      const getHumanResponse = vi.fn().mockResolvedValue(null);

      const client = new OpenCodeClient({ apiUrl: "http://localhost:3333" });
      const result = await client.executeTask("Build X", getHumanResponse);

      expect(result.success).toBe(true);
      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(getHumanResponse).toHaveBeenCalledTimes(1);
    });
  });

  it("returns 'idle' immediately on session.idle event", async () => {
    const events = [
      { type: "message.updated", properties: { sessionID: "sess-1", role: "assistant" } },
      { type: "session.idle", properties: { sessionID: "sess-1" } },
      // This event should never be reached
      { type: "message.updated", properties: { sessionID: "sess-1", role: "assistant" } },
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

    const result = await (client as any).monitorViaSse("sess-1", controller, Date.now(), Date.now());
    expect(result).toBe("idle");
    // Should have processed only 2 events (message.updated + session.idle)
    expect(eventIdx).toBe(2);
    expect(controller.signal.aborted).toBe(true);
  });

  it("returns 'idle' immediately on session.status with status.type=idle", async () => {
    const events = [
      { type: "message.updated", properties: { sessionID: "sess-1", role: "assistant" } },
      { type: "session.status", properties: { sessionID: "sess-1", status: { type: "idle" } } },
      // This event should never be reached
      { type: "message.updated", properties: { sessionID: "sess-1", role: "assistant" } },
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

    const result = await (client as any).monitorViaSse("sess-1", controller, Date.now(), Date.now());
    expect(result).toBe("idle");
    expect(eventIdx).toBe(2);
    expect(controller.signal.aborted).toBe(true);
  });

  it("does not treat session.status with non-idle status as completion", async () => {
    const events = [
      { type: "session.status", properties: { sessionID: "sess-1", status: { type: "active" } } },
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

    const result = await (client as any).monitorViaSse("sess-1", controller, Date.now(), Date.now());
    // Stream ends naturally (not via idle detection), so it falls through to the end
    expect(result).toBe("idle");
    // All events consumed
    expect(eventIdx).toBe(1);
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
