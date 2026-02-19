import { describe, it, expect } from "vitest";
import { formatOpenCodeResult } from "../opencode-task.js";
import type { OpenCodeTaskResult } from "../opencode-client.js";

describe("formatOpenCodeResult", () => {
  it("returns failure message for failed result", () => {
    const result: OpenCodeTaskResult = {
      success: false,
      sessionId: "sess-1",
      summary: "Could not compile project",
      diff: null,
      usage: null,
    };
    expect(formatOpenCodeResult(result)).toBe(
      "OpenCode task failed: Could not compile project",
    );
  });

  it("includes 'No file changes detected' when no files", () => {
    const result: OpenCodeTaskResult = {
      success: true,
      sessionId: "sess-2",
      summary: "Refactored module",
      diff: null,
      usage: null,
    };
    const output = formatOpenCodeResult(result);
    expect(output).toContain("OpenCode task completed successfully.");
    expect(output).toContain("Refactored module");
    expect(output).toContain("No file changes detected.");
  });

  it("lists files with additions and deletions", () => {
    const result: OpenCodeTaskResult = {
      success: true,
      sessionId: "sess-3",
      summary: "Added feature",
      diff: {
        files: [
          { path: "src/index.ts", additions: 10, deletions: 3 },
          { path: "src/utils.ts", additions: 5, deletions: 2 },
        ],
      },
      usage: null,
    };
    const output = formatOpenCodeResult(result);
    expect(output).toContain("src/index.ts (+10, -3)");
    expect(output).toContain("src/utils.ts (+5, -2)");
    expect(output).toContain("Total: 2 file(s) changed");
    expect(output).not.toContain("No file changes detected.");
  });

  it("shows only additions when no deletions", () => {
    const result: OpenCodeTaskResult = {
      success: true,
      sessionId: "sess-4",
      summary: "New file",
      diff: {
        files: [{ path: "src/new.ts", additions: 20, deletions: 0 }],
      },
      usage: null,
    };
    const output = formatOpenCodeResult(result);
    expect(output).toContain("src/new.ts (+20)");
    expect(output).not.toContain("-0");
  });

  it("truncates summaries longer than 2000 chars", () => {
    const longSummary = "x".repeat(3000);
    const result: OpenCodeTaskResult = {
      success: true,
      sessionId: "sess-5",
      summary: longSummary,
      diff: null,
      usage: null,
    };
    const output = formatOpenCodeResult(result);
    expect(output).toContain("[truncated]");
    // The truncated summary should be at most 2000 chars of the original
    expect(output).not.toContain("x".repeat(2001));
  });

  it("treats empty files array as no file changes", () => {
    const result: OpenCodeTaskResult = {
      success: true,
      sessionId: "sess-6",
      summary: "No-op",
      diff: { files: [] },
      usage: null,
    };
    const output = formatOpenCodeResult(result);
    expect(output).toContain("No file changes detected.");
  });
});
