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

  describe("message.part.updated events (SDK format)", () => {
    it("emits part-delta for text parts with delta", () => {
      // SDK EventMessagePartUpdated: { part: TextPart, delta?: string }
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-1",
            sessionID: "sess-1",
            messageID: "msg-1",
            type: "text",
            text: "Full text so far",
          },
          delta: "Hello world",
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:event", expect.any(Object));
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

    it("extracts text from part when no explicit delta", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-2",
            sessionID: "sess-1",
            messageID: "msg-1",
            type: "text",
            text: "Some accumulated text",
          },
          // no delta
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:part-delta", {
        agentId: "agent-1",
        sessionId: "sess-1",
        messageId: "msg-1",
        partId: "part-2",
        type: "text",
        delta: "Some accumulated text",
        toolName: undefined,
        toolState: undefined,
      });
    });

    it("handles tool parts with state object", () => {
      // SDK ToolPart: { type: "tool", tool: "shell_exec", state: { status: "completed", input: {...}, output: "..." } }
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-3",
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
          delta: "File written successfully",
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:part-delta", {
        agentId: "agent-1",
        sessionId: "sess-1",
        messageId: "msg-1",
        partId: "part-3",
        type: "tool",
        delta: "File written successfully",
        toolName: "file_write",
        toolState: "completed",
      });
    });

    it("uses tool output when no delta for tool parts", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-4",
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
          // no delta
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:part-delta", expect.objectContaining({
        delta: "file1.ts\nfile2.ts",
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

    it("handles reasoning parts", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-5",
            sessionID: "sess-1",
            messageID: "msg-1",
            type: "reasoning",
            text: "Thinking about this...",
            time: { start: 1 },
          },
          delta: "more thinking",
        },
      });

      expect(io.emit).toHaveBeenCalledWith("opencode:part-delta", expect.objectContaining({
        type: "reasoning",
        delta: "more thinking",
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
