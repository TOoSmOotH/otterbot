import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitOpenCodeEvent } from "../handlers.js";

function createMockIo() {
  return {
    emit: vi.fn(),
  } as any;
}

describe("emitOpenCodeEvent", () => {
  let io: ReturnType<typeof createMockIo>;

  beforeEach(() => {
    io = createMockIo();
  });

  describe("__session-start internal marker", () => {
    it("emits opencode:session-start with session data", () => {
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Build feature X", projectId: "proj-1" },
      });

      expect(io.emit).toHaveBeenCalledTimes(1);
      expect(io.emit).toHaveBeenCalledWith("opencode:session-start", {
        id: "",
        agentId: "agent-1",
        projectId: "proj-1",
        task: "Build feature X",
        status: "active",
        startedAt: expect.any(String),
      });
    });

    it("handles null projectId", () => {
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Do stuff", projectId: "" },
      });

      const emitted = io.emit.mock.calls[0][1];
      expect(emitted.projectId).toBeNull();
    });
  });

  describe("__session-end internal marker", () => {
    it("emits opencode:session-end with status and diff", () => {
      const diff = [{ path: "src/x.ts", additions: 10, deletions: 2 }];
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "__session-end",
        properties: { status: "completed", diff, error: undefined },
      });

      expect(io.emit).toHaveBeenCalledTimes(1);
      expect(io.emit).toHaveBeenCalledWith("opencode:session-end", {
        agentId: "agent-1",
        sessionId: "sess-1",
        status: "completed",
        diff: [{ path: "src/x.ts", additions: 10, deletions: 2 }],
      });
    });

    it("handles null diff", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "__session-end",
        properties: { status: "error", diff: null },
      });

      const emitted = io.emit.mock.calls[0][1];
      expect(emitted.diff).toBeNull();
    });
  });

  describe("message.part.updated events", () => {
    it("emits opencode:event and opencode:part-delta for text deltas", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          partID: "part-1",
          messageID: "msg-1",
          type: "text",
          delta: "Hello world",
        },
      });

      // Should emit both the raw event and the parsed part-delta
      expect(io.emit).toHaveBeenCalledWith("opencode:event", {
        agentId: "agent-1",
        sessionId: "sess-1",
        type: "message.part.updated",
        properties: expect.any(Object),
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:part-delta", {
        agentId: "agent-1",
        sessionId: "sess-1",
        messageId: "msg-1",
        partId: "part-1",
        type: "text",
        delta: "Hello world",
        toolName: undefined,
        toolState: undefined,
      });
    });

    it("includes toolName and toolState for tool-invocation parts", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          partID: "part-2",
          messageID: "msg-1",
          type: "tool-invocation",
          delta: '{"file": "src/x.ts"}',
          toolName: "file_write",
          state: "call",
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:part-delta", {
        agentId: "agent-1",
        sessionId: "sess-1",
        messageId: "msg-1",
        partId: "part-2",
        type: "tool-invocation",
        delta: '{"file": "src/x.ts"}',
        toolName: "file_write",
        toolState: "call",
      });
    });

    it("does not emit part-delta when delta is missing", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          partID: "part-3",
          messageID: "msg-1",
          type: "text",
          // no delta field
        },
      });

      // Should still emit the raw event
      expect(io.emit).toHaveBeenCalledWith("opencode:event", expect.any(Object));
      // Should NOT emit part-delta
      const partDeltaCalls = io.emit.mock.calls.filter(
        (c: any[]) => c[0] === "opencode:part-delta",
      );
      expect(partDeltaCalls).toHaveLength(0);
    });
  });

  describe("message.updated events", () => {
    it("emits opencode:event and opencode:message with parsed parts", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          messageID: "msg-1",
          role: "assistant",
          parts: [
            { id: "p1", type: "text", content: "Hello" },
            { id: "p2", type: "tool-invocation", toolName: "shell", state: "result", toolResult: "ok" },
          ],
          createdAt: "2026-01-01T00:00:00Z",
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:message", {
        agentId: "agent-1",
        sessionId: "sess-1",
        message: {
          id: "msg-1",
          sessionId: "sess-1",
          role: "assistant",
          parts: [
            {
              id: "p1",
              messageId: "msg-1",
              type: "text",
              content: "Hello",
              toolName: undefined,
              toolArgs: undefined,
              toolState: undefined,
              toolResult: undefined,
            },
            {
              id: "p2",
              messageId: "msg-1",
              type: "tool-invocation",
              content: "",
              toolName: "shell",
              toolArgs: undefined,
              toolState: "result",
              toolResult: "ok",
            },
          ],
          createdAt: "2026-01-01T00:00:00Z",
        },
      });
    });

    it("does not emit opencode:message when role is missing", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          messageID: "msg-1",
          // no role
          parts: [],
        },
      });

      const messageCalls = io.emit.mock.calls.filter(
        (c: any[]) => c[0] === "opencode:message",
      );
      expect(messageCalls).toHaveLength(0);
    });
  });

  describe("generic events", () => {
    it("emits opencode:event for session.status", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "session.status",
        properties: { sessionID: "sess-1", status: "active" },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:event", {
        agentId: "agent-1",
        sessionId: "sess-1",
        type: "session.status",
        properties: { sessionID: "sess-1", status: "active" },
      });
    });

    it("emits opencode:event for session.diff", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "session.diff",
        properties: { files: [] },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:event", {
        agentId: "agent-1",
        sessionId: "sess-1",
        type: "session.diff",
        properties: { files: [] },
      });
    });
  });
});
