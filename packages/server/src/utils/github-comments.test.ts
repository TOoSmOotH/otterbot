import { describe, expect, it } from "vitest";
import { formatBotComment, formatBotCommentWithDetails } from "./github-comments.js";

describe("formatBotComment", () => {
  it("renders title only", () => {
    expect(formatBotComment("Pipeline Started")).toBe("### Pipeline Started");
  });

  it("renders title with body", () => {
    const result = formatBotComment("Pipeline Started", "Stages: `coder` → `security`");
    expect(result).toBe("### Pipeline Started\n\nStages: `coder` → `security`");
  });

  it("omits body when undefined", () => {
    const result = formatBotComment("Done");
    expect(result).not.toContain("\n");
  });

  it("includes body when empty string", () => {
    // Empty string is falsy — should behave like undefined
    const result = formatBotComment("Title", "");
    expect(result).toBe("### Title");
  });
});

describe("formatBotCommentWithDetails", () => {
  it("includes title, summary, and collapsible details", () => {
    const result = formatBotCommentWithDetails(
      "Implementation Complete",
      "PR created: #123",
      "detailed output here",
    );
    expect(result).toContain("### Implementation Complete");
    expect(result).toContain("PR created: #123");
    expect(result).toContain("<details>");
    expect(result).toContain("<summary>Details</summary>");
    expect(result).toContain("detailed output here");
    expect(result).toContain("</details>");
  });

  it("preserves multiline details content", () => {
    const details = "line 1\nline 2\nline 3";
    const result = formatBotCommentWithDetails("Title", "Summary", details);
    expect(result).toContain(details);
  });
});
