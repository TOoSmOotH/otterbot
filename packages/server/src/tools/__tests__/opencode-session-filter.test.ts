import { describe, it, expect } from "vitest";
import { extractSessionId } from "../opencode-client.js";

describe("extractSessionId — cross-worker event isolation", () => {
  it("extracts sessionID from top-level properties", () => {
    expect(
      extractSessionId("session.status", { sessionID: "sess-1", status: "active" }),
    ).toBe("sess-1");
  });

  it("extracts sessionID from properties.part (message.part.updated)", () => {
    expect(
      extractSessionId("message.part.updated", {
        part: { sessionID: "sess-2", text: "hello" },
      }),
    ).toBe("sess-2");
  });

  it("extracts sessionID from properties.part (message.part.delta)", () => {
    expect(
      extractSessionId("message.part.delta", {
        part: { sessionID: "sess-3" },
        delta: "chunk",
      }),
    ).toBe("sess-3");
  });

  it("extracts sessionID from properties.info (message.updated)", () => {
    expect(
      extractSessionId("message.updated", {
        info: { sessionID: "sess-4", modelID: "gpt-4" },
      }),
    ).toBe("sess-4");
  });

  it("extracts id from properties.info for session.* events", () => {
    expect(
      extractSessionId("session.updated", {
        info: { id: "sess-5", status: "idle" },
      }),
    ).toBe("sess-5");
  });

  it("does NOT use info.id for non-session events", () => {
    expect(
      extractSessionId("message.updated", {
        info: { id: "sess-6" },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when no sessionID is present", () => {
    expect(
      extractSessionId("server.status", { status: "ok" }),
    ).toBeUndefined();
  });

  it("prefers top-level sessionID over nested ones", () => {
    expect(
      extractSessionId("message.part.updated", {
        sessionID: "sess-top",
        part: { sessionID: "sess-nested" },
      }),
    ).toBe("sess-top");
  });

  describe("cross-worker isolation (strict filtering)", () => {
    const ourSessionId = "sess-worker-A";

    function isOurSession(eventType: string, props: Record<string, unknown>): boolean {
      return extractSessionId(eventType, props) === ourSessionId;
    }

    it("accepts events matching our session", () => {
      expect(isOurSession("message.part.delta", { sessionID: ourSessionId, delta: "hi" })).toBe(true);
    });

    it("rejects events from another worker's session", () => {
      expect(isOurSession("message.part.delta", { sessionID: "sess-worker-B", delta: "hi" })).toBe(false);
    });

    it("rejects events with no sessionID (global events)", () => {
      expect(isOurSession("server.status", { status: "ok" })).toBe(false);
    });

    it("rejects events with sessionID nested only in part for a different session", () => {
      expect(
        isOurSession("message.part.updated", { part: { sessionID: "sess-worker-B" } }),
      ).toBe(false);
    });
  });
});
