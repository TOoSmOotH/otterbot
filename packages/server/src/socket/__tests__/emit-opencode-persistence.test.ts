import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrateDb, getDb, schema, resetDb } from "../../db/index.js";
import { emitOpenCodeEvent, resetOpenCodePersistence } from "../handlers.js";

// Mock TTS to avoid side-effects
vi.mock("../../tts/tts.js", () => ({
  isTTSEnabled: () => false,
  getConfiguredTTSProvider: () => null,
  stripMarkdown: (s: string) => s,
}));

// Mock auth
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

function createMockIo() {
  return { emit: vi.fn() } as any;
}

describe("emitOpenCodeEvent — DB persistence", () => {
  let io: ReturnType<typeof createMockIo>;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "oc-persist-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
    resetOpenCodePersistence();
    io = createMockIo();
  });

  afterEach(() => {
    resetOpenCodePersistence();
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("__session-start persistence", () => {
    it("inserts a session row into opencode_sessions", () => {
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Build feature X", projectId: "proj-1" },
      });

      const db = getDb();
      const rows = db.select().from(schema.codingAgentSessions).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].agentId).toBe("agent-1");
      expect(rows[0].task).toBe("Build feature X");
      expect(rows[0].projectId).toBe("proj-1");
      expect(rows[0].status).toBe("active");
      expect(rows[0].sessionId).toBe("");
    });

    it("still emits the socket event", () => {
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Do stuff" },
      });

      expect(io.emit).toHaveBeenCalledWith("codeagent:session-start", expect.objectContaining({
        agentId: "agent-1",
        task: "Do stuff",
      }));
    });
  });

  describe("__session-end persistence", () => {
    it("updates session row with status, completedAt, and sessionId", () => {
      // Start a session first
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Build X" },
      });

      // End it with a real sessionId
      emitOpenCodeEvent(io, "agent-1", "sess-real", {
        type: "__session-end",
        properties: { status: "completed", diff: null },
      });

      const db = getDb();
      const rows = db.select().from(schema.codingAgentSessions).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("completed");
      expect(rows[0].completedAt).toBeDefined();
      expect(rows[0].sessionId).toBe("sess-real");
    });

    it("inserts diff rows", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "__session-start",
        properties: { task: "Build X" },
      });

      const diff = [
        { path: "src/a.ts", additions: 10, deletions: 2 },
        { path: "src/b.ts", additions: 5, deletions: 0 },
      ];
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "__session-end",
        properties: { status: "completed", diff },
      });

      const db = getDb();
      const diffRows = db.select().from(schema.codingAgentDiffs).all();
      expect(diffRows).toHaveLength(2);
      expect(diffRows.map((r) => r.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
      expect(diffRows.find((r) => r.path === "src/a.ts")!.additions).toBe(10);
    });

    it("handles null diff gracefully", () => {
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "__session-start",
        properties: { task: "Build X" },
      });

      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "__session-end",
        properties: { status: "error", diff: null },
      });

      const db = getDb();
      const diffRows = db.select().from(schema.codingAgentDiffs).all();
      expect(diffRows).toHaveLength(0);
    });
  });

  describe("message.part.updated — server-side buffering", () => {
    it("accumulates part deltas in server buffer", () => {
      // Send two part deltas
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: { id: "p1", sessionID: "sess-1", messageID: "msg-1", type: "text", text: "" },
          delta: "Hello ",
        },
      });
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: { id: "p1", sessionID: "sess-1", messageID: "msg-1", type: "text", text: "Hello world" },
          delta: "world",
        },
      });

      // The buffer is internal, so we verify via message.updated which reads it
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "__session-start",
        properties: { task: "Test" },
      });
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          info: { id: "msg-1", sessionID: "sess-1", role: "assistant" },
        },
      });

      const db = getDb();
      const msgs = db.select().from(schema.codingAgentMessages).all();
      expect(msgs).toHaveLength(1);
      expect(msgs[0].parts).toHaveLength(1);
      expect((msgs[0].parts as any[])[0].content).toBe("Hello world");
    });
  });

  describe("message.updated persistence", () => {
    it("inserts a message row with accumulated parts", () => {
      // Start session
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Test" },
      });

      // Send part delta
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: { id: "p1", sessionID: "sess-1", messageID: "msg-1", type: "text", text: "" },
          delta: "Hello world",
        },
      });

      // message.updated triggers persistence
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          info: { id: "msg-1", sessionID: "sess-1", role: "assistant" },
        },
      });

      const db = getDb();
      const msgs = db.select().from(schema.codingAgentMessages).all();
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe("msg-1");
      expect(msgs[0].sessionId).toBe("sess-1");
      expect(msgs[0].agentId).toBe("agent-1");
      expect(msgs[0].role).toBe("assistant");
      expect(msgs[0].parts).toHaveLength(1);
    });

    it("upserts message on repeated message.updated", () => {
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Test" },
      });

      // First delta
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: { id: "p1", sessionID: "sess-1", messageID: "msg-1", type: "text" },
          delta: "Hello",
        },
      });

      // First message.updated
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          info: { id: "msg-1", sessionID: "sess-1", role: "assistant" },
        },
      });

      // More deltas
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.part.updated",
        properties: {
          part: { id: "p1", sessionID: "sess-1", messageID: "msg-1", type: "text" },
          delta: " world",
        },
      });

      // Second message.updated
      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          info: { id: "msg-1", sessionID: "sess-1", role: "assistant" },
        },
      });

      const db = getDb();
      const msgs = db.select().from(schema.codingAgentMessages).all();
      expect(msgs).toHaveLength(1); // upserted, not duplicated
      expect((msgs[0].parts as any[])[0].content).toBe("Hello world");
    });

    it("updates session row sessionId when first real sessionId arrives", () => {
      // Start with empty sessionId
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Test" },
      });

      const db = getDb();
      let rows = db.select().from(schema.codingAgentSessions).all();
      expect(rows[0].sessionId).toBe("");

      // message.updated with real sessionId
      emitOpenCodeEvent(io, "agent-1", "sess-real", {
        type: "message.updated",
        properties: {
          info: { id: "msg-1", sessionID: "sess-real", role: "assistant" },
        },
      });

      rows = db.select().from(schema.codingAgentSessions).all();
      expect(rows[0].sessionId).toBe("sess-real");
    });

    it("handles user messages", () => {
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Test" },
      });

      emitOpenCodeEvent(io, "agent-1", "sess-1", {
        type: "message.updated",
        properties: {
          info: { id: "msg-user-1", sessionID: "sess-1", role: "user" },
        },
      });

      const db = getDb();
      const msgs = db.select().from(schema.codingAgentMessages).all();
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe("user");
    });
  });

  describe("full lifecycle", () => {
    it("persists session start → part deltas → message → session end with diffs", () => {
      // 1. Session start
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Implement feature", projectId: "proj-1" },
      });

      // 2. Part deltas
      emitOpenCodeEvent(io, "agent-1", "sess-42", {
        type: "message.part.updated",
        properties: {
          part: { id: "p1", sessionID: "sess-42", messageID: "msg-1", type: "text" },
          delta: "I'll implement ",
        },
      });
      emitOpenCodeEvent(io, "agent-1", "sess-42", {
        type: "message.part.updated",
        properties: {
          part: { id: "p1", sessionID: "sess-42", messageID: "msg-1", type: "text" },
          delta: "this feature",
        },
      });
      emitOpenCodeEvent(io, "agent-1", "sess-42", {
        type: "message.part.updated",
        properties: {
          part: { id: "p2", sessionID: "sess-42", messageID: "msg-1", type: "tool", tool: "file_write", state: { status: "completed" } },
          delta: "Done",
        },
      });

      // 3. Message updated
      emitOpenCodeEvent(io, "agent-1", "sess-42", {
        type: "message.updated",
        properties: {
          info: { id: "msg-1", sessionID: "sess-42", role: "assistant" },
        },
      });

      // 4. Session end
      emitOpenCodeEvent(io, "agent-1", "sess-42", {
        type: "__session-end",
        properties: {
          status: "completed",
          diff: [{ path: "src/feature.ts", additions: 20, deletions: 3 }],
        },
      });

      const db = getDb();

      // Verify session
      const sessions = db.select().from(schema.codingAgentSessions).all();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].task).toBe("Implement feature");
      expect(sessions[0].projectId).toBe("proj-1");
      expect(sessions[0].sessionId).toBe("sess-42");
      expect(sessions[0].status).toBe("completed");
      expect(sessions[0].completedAt).toBeDefined();

      // Verify messages
      const msgs = db.select().from(schema.codingAgentMessages).all();
      expect(msgs).toHaveLength(1);
      expect(msgs[0].parts).toHaveLength(2);
      const parts = msgs[0].parts as any[];
      expect(parts.find((p: any) => p.id === "p1").content).toBe("I'll implement this feature");
      expect(parts.find((p: any) => p.id === "p2").toolName).toBe("file_write");

      // Verify diffs
      const diffs = db.select().from(schema.codingAgentDiffs).all();
      expect(diffs).toHaveLength(1);
      expect(diffs[0].path).toBe("src/feature.ts");
      expect(diffs[0].additions).toBe(20);
      expect(diffs[0].deletions).toBe(3);
    });

    it("handles multiple agents concurrently", () => {
      emitOpenCodeEvent(io, "agent-1", "", {
        type: "__session-start",
        properties: { task: "Task A" },
      });
      emitOpenCodeEvent(io, "agent-2", "", {
        type: "__session-start",
        properties: { task: "Task B" },
      });

      emitOpenCodeEvent(io, "agent-1", "sess-a", {
        type: "__session-end",
        properties: { status: "completed", diff: null },
      });
      emitOpenCodeEvent(io, "agent-2", "sess-b", {
        type: "__session-end",
        properties: { status: "error", diff: null },
      });

      const db = getDb();
      const sessions = db.select().from(schema.codingAgentSessions).all();
      expect(sessions).toHaveLength(2);
      const a = sessions.find((s) => s.agentId === "agent-1")!;
      const b = sessions.find((s) => s.agentId === "agent-2")!;
      expect(a.status).toBe("completed");
      expect(a.sessionId).toBe("sess-a");
      expect(b.status).toBe("error");
      expect(b.sessionId).toBe("sess-b");
    });
  });
});
