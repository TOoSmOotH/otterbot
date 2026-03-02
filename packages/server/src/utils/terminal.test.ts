import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  cleanTerminalOutput,
  cleanTerminalOutputNoCR,
  extractPtySummary,
} from "./terminal.js";

describe("stripAnsi", () => {
  it("removes CSI sequences", () => {
    expect(stripAnsi("\x1B[31mred\x1B[0m")).toBe("red");
  });

  it("removes OSC sequences", () => {
    expect(stripAnsi("\x1B]0;title\x07some text")).toBe("some text");
  });

  it("passes through plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });
});

describe("cleanTerminalOutput", () => {
  it("strips ANSI and collapses blank lines", () => {
    const input = "\x1B[32mline1\x1B[0m\n\n\n\nline2";
    expect(cleanTerminalOutput(input)).toBe("line1\n\nline2");
  });

  it("simulates carriage-return overwrites", () => {
    // Progress bar style: "downloading... 50%\rdownloading... 100%"
    const input = "downloading... 50%\rdownloading... 100%";
    expect(cleanTerminalOutput(input)).toBe("downloading... 100%");
  });

  it("removes spinner glyphs", () => {
    // Braille spinner character U+280B (⠋)
    const input = "⠋ Loading...";
    expect(cleanTerminalOutput(input)).toBe("Loading...");
  });

  it("trims leading and trailing whitespace", () => {
    expect(cleanTerminalOutput("  \n  hello  \n  ")).toBe("hello");
  });
});

describe("cleanTerminalOutputNoCR", () => {
  it("preserves content before \\r instead of discarding it", () => {
    // Simulates TUI tool output where \r is used for screen redraws
    const reviewContent = "## Code Review\nThis file has issues.\n";
    const tuiRedraw = "\rScreen cleared";
    const input = reviewContent + tuiRedraw;

    const result = cleanTerminalOutputNoCR(input);
    expect(result).toContain("Code Review");
    expect(result).toContain("This file has issues.");
  });

  it("still strips ANSI codes", () => {
    const input = "\x1B[31mred text\x1B[0m";
    expect(cleanTerminalOutputNoCR(input)).toBe("red text");
  });

  it("still removes spinner glyphs", () => {
    const input = "⠋ Loading...";
    expect(cleanTerminalOutputNoCR(input)).toBe("Loading...");
  });

  it("collapses blank lines", () => {
    const input = "a\n\n\n\nb";
    expect(cleanTerminalOutputNoCR(input)).toBe("a\n\nb");
  });
});

describe("extractPtySummary", () => {
  it("returns 'Task completed.' with tail for normal CLI output", () => {
    const input = "Building project...\nDone in 3.2s";
    const result = extractPtySummary(input);
    expect(result).toContain("Task completed.");
    expect(result).toContain("Done in 3.2s");
  });

  it("extracts GitHub PR URLs", () => {
    const input = "Created https://github.com/org/repo/pull/42\nDone.";
    const result = extractPtySummary(input);
    expect(result).toContain("PR created: https://github.com/org/repo/pull/42");
  });

  it("deduplicates PR URLs", () => {
    const url = "https://github.com/org/repo/pull/7";
    const input = `Opened ${url}\nLink: ${url}\nDone.`;
    const result = extractPtySummary(input);
    // Should appear exactly once in the PR section
    const prLines = result
      .split("\n")
      .filter((l) => l.startsWith("PR created:"));
    expect(prLines).toHaveLength(1);
  });

  it("falls back to noCR cleaning when CR simulation kills TUI content", () => {
    // Simulate a TUI tool that outputs a review then redraws the screen,
    // leaving only a short exit message after the final \r.
    const review =
      "## Security Review\n\n" +
      "1. SQL injection risk in query builder\n" +
      "2. Missing input validation on /api/users endpoint\n" +
      "3. Hardcoded secret in config.ts line 42\n\n" +
      "Recommendation: address items 1 and 3 before shipping.";
    // TUI exit: \r overwrites each line leaving just a short prompt
    const tuiExit = review
      .split("\n")
      .map((line) => line + "\r")
      .join("\n");

    const result = extractPtySummary(tuiExit);
    // The fallback should preserve the review content
    expect(result).toContain("Security Review");
    expect(result).toContain("SQL injection");
    expect(result).toContain("Recommendation");
  });

  it("does not fall back when CR simulation produces substantial output", () => {
    // Normal progress bar output — CR simulation is correct here
    const lines = Array.from(
      { length: 20 },
      (_, i) => `Step ${i + 1}: completed successfully`,
    );
    const input = lines.join("\n");
    const result = extractPtySummary(input);
    expect(result).toContain("Step 20: completed successfully");
  });

  it("uses default tailChars of 6000", () => {
    // Create content longer than 6000 chars
    const longLine = "x".repeat(100);
    const lines = Array.from({ length: 100 }, () => longLine);
    const input = lines.join("\n");
    const result = extractPtySummary(input);
    expect(result).toContain("Terminal output (last 6000 chars):");
  });

  it("respects custom tailChars parameter", () => {
    const input = "a".repeat(500);
    const result = extractPtySummary(input, 200);
    expect(result).toContain("Terminal output (last 200 chars):");
  });

  it("omits terminal output section when buffer is empty", () => {
    const result = extractPtySummary("");
    expect(result).toBe("Task completed.");
  });
});
