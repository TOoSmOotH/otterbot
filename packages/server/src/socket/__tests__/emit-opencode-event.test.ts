import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitOpenCodeEvent, resetOpenCodePersistence } from "../handlers.js";

function createMockIo() {
  return {
    emit: vi.fn(),
  } as any;
}

describe("emitOpenCodeEvent", () => {
  let io: ReturnType<typeof createMockIo>;

  beforeEach(() => {
    io = createMockIo();
    resetOpenCodePersistence();
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

  describe("__awaiting-input internal marker", () => {
    it("emits opencode:awaiting-input with prompt data", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "__awaiting-input",
        properties: { prompt: "Which approach should I use?" },
      });

      expect(io.emit).toHaveBeenCalledTimes(1);
      expect(io.emit).toHaveBeenCalledWith("opencode:awaiting-input", {
        agentId: "agent-1",
        sessionId: "sess-1",
        prompt: "Which approach should I use?",
      });
    });

    it("handles empty prompt", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "__awaiting-input",
        properties: {},
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:awaiting-input", {
        agentId: "agent-1",
        sessionId: "sess-1",
        prompt: "",
      });
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

  describe("message.part.updated events (SDK format)", () => {
    it("emits full content as delta when no prior deltas exist", () => {
      // message.part.updated with no prior message.part.delta events
      // should emit the full content as a delta (frontend hasn't seen it yet)
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-1",
            sessionID: "sess-1",
            messageID: "msg-1",
            type: "text",
            text: "Full text content",
          },
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:event", expect.any(Object));
      expect(io.emit).toHaveBeenCalledWith("opencode:part-delta", {
        agentId: "agent-1",
        sessionId: "sess-1",
        messageId: "msg-1",
        partId: "part-1",
        type: "text",
        delta: "Full text content",
        toolName: undefined,
        toolState: undefined,
      });
    });

    it("does NOT re-emit content already delivered via message.part.delta", () => {
      // First, send streaming deltas
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-1",
          messageID: "msg-1",
          partID: "part-2",
          field: "text",
          delta: "Hello world",
        },
      });

      io.emit.mockClear();

      // Now message.part.updated arrives with the same content — should NOT emit a duplicate delta
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-2",
            sessionID: "sess-1",
            messageID: "msg-1",
            type: "text",
            text: "Hello world",
          },
        },
      });

      const partDeltaCalls = io.emit.mock.calls.filter(
        (c: any[]) => c[0] === "opencode:part-delta",
      );
      // Should not emit any part-delta since content is already delivered
      expect(partDeltaCalls).toHaveLength(0);
    });

    it("emits only the missing portion when snapshot has more content than deltas", () => {
      // Send a partial delta first
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-1",
          messageID: "msg-1",
          partID: "part-3",
          field: "text",
          delta: "Hello ",
        },
      });

      io.emit.mockClear();

      // Snapshot arrives with more content than the delta delivered
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-3",
            sessionID: "sess-1",
            messageID: "msg-1",
            type: "text",
            text: "Hello world",
          },
        },
      });

      const partDeltaCalls = io.emit.mock.calls.filter(
        (c: any[]) => c[0] === "opencode:part-delta",
      );
      expect(partDeltaCalls).toHaveLength(1);
      expect(partDeltaCalls[0][1].delta).toBe("world");
    });

    it("handles tool parts with state object", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-4",
            sessionID: "sess-1",
            messageID: "msg-1",
            type: "tool",
            tool: "file_write",
            callID: "call-1",
            state: {
              status: "completed",
              input: { path: "src/x.ts" },
              output: "File written successfully",
              title: "file_write",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:part-delta", {
        agentId: "agent-1",
        sessionId: "sess-1",
        messageId: "msg-1",
        partId: "part-4",
        type: "tool",
        delta: "File written successfully",
        toolName: "file_write",
        toolState: "completed",
      });
    });

    it("emits tool state change with empty delta when content already delivered", () => {
      // Send tool content via deltas first
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-1",
          messageID: "msg-1",
          partID: "part-5",
          field: "text",
          delta: "file1.ts\nfile2.ts",
        },
      });

      io.emit.mockClear();

      // Tool state changes to completed but content is the same
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-5",
            sessionID: "sess-1",
            messageID: "msg-1",
            type: "tool",
            tool: "shell_exec",
            callID: "call-2",
            state: {
              status: "completed",
              input: { command: "ls" },
              output: "file1.ts\nfile2.ts",
              title: "shell_exec",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        },
      });

      const partDeltaCalls = io.emit.mock.calls.filter(
        (c: any[]) => c[0] === "opencode:part-delta",
      );
      // Should emit a state-change delta with empty content
      expect(partDeltaCalls).toHaveLength(1);
      expect(partDeltaCalls[0][1]).toEqual(expect.objectContaining({
        delta: "",
        toolName: "shell_exec",
        toolState: "completed",
      }));
    });

    it("does not emit part-delta when part is missing", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          // no part
          delta: "orphan delta",
        },
      });

      const partDeltaCalls = io.emit.mock.calls.filter(
        (c: any[]) => c[0] === "opencode:part-delta",
      );
      expect(partDeltaCalls).toHaveLength(0);
    });

    it("handles reasoning parts with no prior deltas", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-6",
            sessionID: "sess-1",
            messageID: "msg-1",
            type: "reasoning",
            text: "Thinking about this...",
            time: { start: 1 },
          },
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:part-delta", expect.objectContaining({
        type: "reasoning",
        delta: "Thinking about this...",
      }));
    });
  });

  describe("message.updated events (SDK format)", () => {
    it("emits opencode:message from properties.info", () => {
      // SDK EventMessageUpdated: { properties: { info: Message } }
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-1",
            sessionID: "sess-1",
            role: "assistant",
            time: { created: 1706745600 },
            parentID: "msg-0",
            modelID: "claude-sonnet-4-5-20250929",
            providerID: "anthropic",
            mode: "default",
            path: { cwd: "/workspace", root: "/workspace" },
            cost: 0.01,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:message", {
        agentId: "agent-1",
        sessionId: "sess-1",
        message: {
          id: "msg-1",
          sessionId: "sess-1",
          role: "assistant",
          parts: [],
          createdAt: expect.any(String),
        },
      });
    });

    it("does not emit when info is missing", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {},
      });

      const messageCalls = io.emit.mock.calls.filter(
        (c: any[]) => c[0] === "opencode:message",
      );
      expect(messageCalls).toHaveLength(0);
    });

    it("includes accumulated part deltas in emitted message", () => {
      // First, send some part deltas to build up the buffer
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-1",
          messageID: "msg-2",
          partID: "part-a",
          field: "text",
          delta: "Hello ",
        },
      });
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.delta",
        properties: {
          sessionID: "sess-1",
          messageID: "msg-2",
          partID: "part-a",
          field: "text",
          delta: "world",
        },
      });

      // Now message.updated should include the accumulated parts
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-2",
            sessionID: "sess-1",
            role: "assistant",
          },
        },
      });

      const msgCall = io.emit.mock.calls.find(
        (c: any[]) => c[0] === "opencode:message" && c[1].message.id === "msg-2",
      );
      expect(msgCall).toBeDefined();
      expect(msgCall![1].message.parts).toHaveLength(1);
      expect(msgCall![1].message.parts[0]).toEqual({
        id: "part-a",
        messageId: "msg-2",
        type: "text",
        content: "Hello world",
        toolName: undefined,
        toolState: undefined,
      });
    });

    it("handles user messages", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-0",
            sessionID: "sess-1",
            role: "user",
            time: { created: 1706745600 },
            agent: "default",
            model: { providerID: "anthropic", modelID: "claude-sonnet-4-5-20250929" },
          },
        },
      });

      const msgCall = io.emit.mock.calls.find((c: any[]) => c[0] === "opencode:message");
      expect(msgCall).toBeDefined();
      expect(msgCall![1].message.role).toBe("user");
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
