import { describe, it, expect, beforeEach } from "vitest";
import { useOpenCodeStore } from "../opencode-store";
import type { OpenCodeSession, OpenCodeMessage } from "@otterbot/shared";

function makeSession(overrides: Partial<OpenCodeSession> = {}): OpenCodeSession {
  return {
    id: "sess-1",
    agentId: "agent-1",
    projectId: "proj-1",
    task: "Build feature X",
    status: "active",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMessage(overrides: Partial<OpenCodeMessage> = {}): OpenCodeMessage {
  return {
    id: "msg-1",
    sessionId: "sess-1",
    role: "assistant",
    parts: [],
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("opencode-store", () => {
  beforeEach(() => {
    // Reset store state between tests
    useOpenCodeStore.setState({
      sessions: new Map(),
      messages: new Map(),
      partBuffers: new Map(),
      diffs: new Map(),
      selectedAgentId: null,
    });
  });

  describe("selectAgent", () => {
    it("sets the selected agent ID", () => {
      useOpenCodeStore.getState().selectAgent("agent-1");
      expect(useOpenCodeStore.getState().selectedAgentId).toBe("agent-1");
    });

    it("can clear selection with null", () => {
      useOpenCodeStore.getState().selectAgent("agent-1");
      useOpenCodeStore.getState().selectAgent(null);
      expect(useOpenCodeStore.getState().selectedAgentId).toBeNull();
    });
  });

  describe("startSession", () => {
    it("adds a session keyed by agentId", () => {
      const session = makeSession();
      useOpenCodeStore.getState().startSession(session);
      expect(useOpenCodeStore.getState().sessions.get("agent-1")).toEqual(session);
    });

    it("auto-selects the first session", () => {
      useOpenCodeStore.getState().startSession(makeSession());
      expect(useOpenCodeStore.getState().selectedAgentId).toBe("agent-1");
    });

    it("does not override existing selection", () => {
      useOpenCodeStore.getState().selectAgent("agent-0");
      useOpenCodeStore.getState().startSession(makeSession());
      expect(useOpenCodeStore.getState().selectedAgentId).toBe("agent-0");
    });

    it("handles multiple sessions", () => {
      useOpenCodeStore.getState().startSession(makeSession({ agentId: "agent-1" }));
      useOpenCodeStore.getState().startSession(makeSession({ agentId: "agent-2", id: "sess-2" }));
      expect(useOpenCodeStore.getState().sessions.size).toBe(2);
    });
  });

  describe("endSession", () => {
    it("updates session status and completedAt", () => {
      useOpenCodeStore.getState().startSession(makeSession());
      useOpenCodeStore.getState().endSession("agent-1", "sess-1", "completed", null);

      const session = useOpenCodeStore.getState().sessions.get("agent-1")!;
      expect(session.status).toBe("completed");
      expect(session.completedAt).toBeDefined();
    });

    it("updates session ID if provided", () => {
      useOpenCodeStore.getState().startSession(makeSession({ id: "" }));
      useOpenCodeStore.getState().endSession("agent-1", "sess-real", "completed", null);

      const session = useOpenCodeStore.getState().sessions.get("agent-1")!;
      expect(session.id).toBe("sess-real");
    });

    it("stores diffs when provided", () => {
      useOpenCodeStore.getState().startSession(makeSession());
      const diffs = [{ path: "src/x.ts", additions: 10, deletions: 2 }];
      useOpenCodeStore.getState().endSession("agent-1", "sess-1", "completed", diffs);

      expect(useOpenCodeStore.getState().diffs.get("sess-1")).toEqual(diffs);
    });

    it("does not crash for unknown agent", () => {
      useOpenCodeStore.getState().endSession("unknown", "sess-x", "completed", null);
      expect(useOpenCodeStore.getState().sessions.size).toBe(0);
    });
  });

  describe("addMessage", () => {
    it("adds a message to the session", () => {
      const msg = makeMessage();
      useOpenCodeStore.getState().addMessage("agent-1", "sess-1", msg);

      expect(useOpenCodeStore.getState().messages.get("sess-1")).toEqual([msg]);
    });

    it("appends subsequent messages", () => {
      useOpenCodeStore.getState().addMessage("agent-1", "sess-1", makeMessage({ id: "msg-1" }));
      useOpenCodeStore.getState().addMessage("agent-1", "sess-1", makeMessage({ id: "msg-2" }));

      expect(useOpenCodeStore.getState().messages.get("sess-1")!.length).toBe(2);
    });

    it("updates session ID if it was empty", () => {
      useOpenCodeStore.getState().startSession(makeSession({ id: "" }));
      useOpenCodeStore.getState().addMessage("agent-1", "sess-real", makeMessage({ id: "msg-1" }));

      const session = useOpenCodeStore.getState().sessions.get("agent-1")!;
      expect(session.id).toBe("sess-real");
    });

    it("replaces a message with the same ID", () => {
      useOpenCodeStore.getState().addMessage("agent-1", "sess-1", makeMessage({
        id: "msg-1",
        parts: [{ id: "p1", messageId: "msg-1", type: "text", content: "v1" }],
      }));
      useOpenCodeStore.getState().addMessage("agent-1", "sess-1", makeMessage({
        id: "msg-1",
        parts: [{ id: "p1", messageId: "msg-1", type: "text", content: "v2" }],
      }));

      const msgs = useOpenCodeStore.getState().messages.get("sess-1")!;
      expect(msgs.length).toBe(1);
      expect(msgs[0].parts[0].content).toBe("v2");
    });
  });

  describe("appendPartDelta", () => {
    it("updates session ID if it was empty", () => {
      useOpenCodeStore.getState().startSession(makeSession({ id: "" }));
      useOpenCodeStore.getState().appendPartDelta("agent-1", "sess-real", "msg-1", "p1", "text", "hi");

      const session = useOpenCodeStore.getState().sessions.get("agent-1")!;
      expect(session.id).toBe("sess-real");
    });

    it("accumulates delta text for a part", () => {
      const store = useOpenCodeStore.getState();
      store.appendPartDelta("agent-1", "sess-1", "msg-1", "part-1", "text", "Hello ");
      store.appendPartDelta("agent-1", "sess-1", "msg-1", "part-1", "text", "world");

      const key = "sess-1:msg-1:part-1";
      const buf = useOpenCodeStore.getState().partBuffers.get(key)!;
      expect(buf.content).toBe("Hello world");
      expect(buf.type).toBe("text");
    });

    it("stores toolName and toolState", () => {
      useOpenCodeStore.getState().appendPartDelta(
        "agent-1", "sess-1", "msg-1", "part-2", "tool-invocation",
        '{"file": "x"}', "file_write", "call",
      );

      const buf = useOpenCodeStore.getState().partBuffers.get("sess-1:msg-1:part-2")!;
      expect(buf.toolName).toBe("file_write");
      expect(buf.toolState).toBe("call");
    });

    it("preserves toolName across deltas when not re-specified", () => {
      const store = useOpenCodeStore.getState();
      store.appendPartDelta("agent-1", "sess-1", "msg-1", "p1", "tool-invocation", "first", "shell");
      store.appendPartDelta("agent-1", "sess-1", "msg-1", "p1", "tool-invocation", "second");

      const buf = useOpenCodeStore.getState().partBuffers.get("sess-1:msg-1:p1")!;
      expect(buf.content).toBe("firstsecond");
      expect(buf.toolName).toBe("shell");
    });

    it("tracks separate buffers per part", () => {
      const store = useOpenCodeStore.getState();
      store.appendPartDelta("agent-1", "sess-1", "msg-1", "p1", "text", "AAA");
      store.appendPartDelta("agent-1", "sess-1", "msg-1", "p2", "reasoning", "BBB");

      expect(useOpenCodeStore.getState().partBuffers.size).toBe(2);
      expect(useOpenCodeStore.getState().partBuffers.get("sess-1:msg-1:p1")!.content).toBe("AAA");
      expect(useOpenCodeStore.getState().partBuffers.get("sess-1:msg-1:p2")!.content).toBe("BBB");
    });
  });

  describe("clearSession", () => {
    it("removes session, messages, diffs, and part buffers", () => {
      const store = useOpenCodeStore.getState();

      // Set up a session with data
      store.startSession(makeSession());
      store.addMessage("agent-1", "sess-1", makeMessage());
      store.appendPartDelta("agent-1", "sess-1", "msg-1", "p1", "text", "data");
      store.endSession("agent-1", "sess-1", "completed", [
        { path: "x.ts", additions: 1, deletions: 0 },
      ]);

      // Verify data exists
      expect(useOpenCodeStore.getState().sessions.size).toBe(1);
      expect(useOpenCodeStore.getState().messages.size).toBe(1);
      expect(useOpenCodeStore.getState().partBuffers.size).toBe(1);
      expect(useOpenCodeStore.getState().diffs.size).toBe(1);

      // Clear
      useOpenCodeStore.getState().clearSession("agent-1");

      expect(useOpenCodeStore.getState().sessions.size).toBe(0);
      expect(useOpenCodeStore.getState().messages.size).toBe(0);
      expect(useOpenCodeStore.getState().partBuffers.size).toBe(0);
      expect(useOpenCodeStore.getState().diffs.size).toBe(0);
    });

    it("clears selection if the cleared agent was selected", () => {
      useOpenCodeStore.getState().startSession(makeSession());
      expect(useOpenCodeStore.getState().selectedAgentId).toBe("agent-1");

      useOpenCodeStore.getState().clearSession("agent-1");
      expect(useOpenCodeStore.getState().selectedAgentId).toBeNull();
    });

    it("does not affect other sessions", () => {
      useOpenCodeStore.getState().startSession(makeSession({ agentId: "agent-1", id: "sess-1" }));
      useOpenCodeStore.getState().startSession(makeSession({ agentId: "agent-2", id: "sess-2" }));

      useOpenCodeStore.getState().clearSession("agent-1");
      expect(useOpenCodeStore.getState().sessions.size).toBe(1);
      expect(useOpenCodeStore.getState().sessions.has("agent-2")).toBe(true);
    });

    it("does not crash for unknown agent", () => {
      useOpenCodeStore.getState().clearSession("unknown");
      expect(useOpenCodeStore.getState().sessions.size).toBe(0);
    });
  });
});
