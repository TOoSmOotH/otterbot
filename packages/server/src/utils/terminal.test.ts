import { describe, expect, it } from "vitest";
import { stripAnsi, cleanTerminalOutput, extractPtySummary } from "./terminal.js";

describe("stripAnsi", () => {
  it("removes CSI color sequences", () => {
    expect(stripAnsi("\x1B[31mred\x1B[0m")).toBe("red");
  });

  it("removes CSI cursor / erase sequences", () => {
    expect(stripAnsi("\x1B[2J\x1B[Hhello")).toBe("hello");
  });

  it("removes OSC sequences (BEL terminated)", () => {
    expect(stripAnsi("\x1B]0;window title\x07text")).toBe("text");
  });

  it("removes OSC sequences (ST terminated)", () => {
    expect(stripAnsi("\x1B]0;window title\x1B\\text")).toBe("text");
  });

  it("removes DCS sequences", () => {
    expect(stripAnsi("\x1BP+q\x1B\\visible")).toBe("visible");
  });

  it("removes simple Fe escapes (e.g. ESC M)", () => {
    expect(stripAnsi("\x1BMhello")).toBe("hello");
  });

  it("removes standalone BEL", () => {
    expect(stripAnsi("ding\x07dong")).toBe("dingdong");
  });

  it("removes standalone C0 controls but keeps \\n, \\r, \\t", () => {
    expect(stripAnsi("a\x01b\nc\td\re")).toBe("ab\nc\td\re");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    const plain = "just some normal text";
    expect(stripAnsi(plain)).toBe(plain);
  });
});

describe("cleanTerminalOutput", () => {
  it("strips ANSI and trims", () => {
    expect(cleanTerminalOutput("  \x1B[32mok\x1B[0m  ")).toBe("ok");
  });

  it("simulates CR overwrites", () => {
    // spinner line: "⠋ Loading...\r✔ Done"
    expect(cleanTerminalOutput("Loading...\r✔ Done")).toBe("✔ Done");
  });

  it("removes braille spinner glyphs", () => {
    expect(cleanTerminalOutput("⠋ running")).toBe("running");
  });

  it("removes box-drawing characters", () => {
    expect(cleanTerminalOutput("─── result ───")).toBe("result");
  });

  it("collapses multiple blank lines", () => {
    expect(cleanTerminalOutput("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("handles mixed noise", () => {
    const input = "\x1B[32m⠋\x1B[0m Compiling...\r\x1B[32m✔\x1B[0m Done\n\n\n\nNext step";
    const result = cleanTerminalOutput(input);
    expect(result).toBe("✔ Done\n\nNext step");
  });
});

describe("extractPtySummary", () => {
  it("includes 'Task completed.' header", () => {
    expect(extractPtySummary("some output")).toContain("Task completed.");
  });

  it("extracts PR URLs", () => {
    const buf = "Created https://github.com/owner/repo/pull/42 successfully";
    const summary = extractPtySummary(buf);
    expect(summary).toContain("PR created: https://github.com/owner/repo/pull/42");
  });

  it("deduplicates PR URLs", () => {
    const url = "https://github.com/owner/repo/pull/7";
    const buf = `${url}\n${url}\n${url}`;
    const summary = extractPtySummary(buf);
    // Should appear only once
    expect(summary.match(/PR created:/g)?.length).toBe(1);
  });

  it("appends cleaned tail", () => {
    const buf = "\x1B[31mError details\x1B[0m\nStack trace here";
    const summary = extractPtySummary(buf);
    expect(summary).toContain("Terminal output");
    expect(summary).toContain("Error details");
    expect(summary).not.toContain("\x1B");
  });

  it("omits terminal output section when buffer is empty after cleaning", () => {
    const buf = "\x1B[32m\x1B[0m   \n\n\n";
    const summary = extractPtySummary(buf);
    expect(summary).not.toContain("Terminal output");
  });

  it("respects tailChars parameter", () => {
    const buf = "a".repeat(100);
    const summary = extractPtySummary(buf, 50);
    expect(summary).toContain("last 50 chars");
  });
});
