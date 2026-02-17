import { describe, it, expect } from "vitest";
import { SkillService } from "../skill-service.js";

describe("SkillService", () => {
  const service = new SkillService();

  const sampleSkillMd = `---
name: Code Reviewer
description: Reviews code for quality, bugs, and security issues.
version: 1.0.0
author: Mike Reeves
tools:
  - file_read
capabilities:
  - code-review
  - security-audit
parameters:
  strictness:
    type: string
    default: moderate
    description: Review strictness level
tags:
  - code
  - review
---

You are an expert code reviewer. Analyze code for correctness, readability, and security.
`;

  describe("parseSkillFile", () => {
    it("parses a valid skill file", () => {
      const { meta, body } = service.parseSkillFile(sampleSkillMd);

      expect(meta.name).toBe("Code Reviewer");
      expect(meta.description).toBe("Reviews code for quality, bugs, and security issues.");
      expect(meta.version).toBe("1.0.0");
      expect(meta.author).toBe("Mike Reeves");
      expect(meta.tools).toEqual(["file_read"]);
      expect(meta.capabilities).toEqual(["code-review", "security-audit"]);
      expect(meta.tags).toEqual(["code", "review"]);
      expect(meta.parameters.strictness).toBeDefined();
      expect(meta.parameters.strictness.type).toBe("string");
      expect(meta.parameters.strictness.default).toBe("moderate");
      expect(body).toContain("You are an expert code reviewer");
    });

    it("handles missing optional fields gracefully", () => {
      const minimal = `---
name: Minimal Skill
---

Do something.
`;
      const { meta, body } = service.parseSkillFile(minimal);

      expect(meta.name).toBe("Minimal Skill");
      expect(meta.description).toBe("");
      expect(meta.tools).toEqual([]);
      expect(meta.capabilities).toEqual([]);
      expect(meta.parameters).toEqual({});
      expect(meta.tags).toEqual([]);
      expect(body).toBe("Do something.");
    });

    it("handles files with no frontmatter", () => {
      const noFm = "Just raw instructions, no frontmatter.";
      const { meta, body } = service.parseSkillFile(noFm);

      expect(meta.name).toBe("Untitled Skill");
      expect(body).toBe("Just raw instructions, no frontmatter.");
    });
  });

  describe("serializeSkillFile", () => {
    it("round-trips a parsed skill file", () => {
      const { meta, body } = service.parseSkillFile(sampleSkillMd);
      const serialized = service.serializeSkillFile(meta, body);
      const { meta: meta2, body: body2 } = service.parseSkillFile(serialized);

      expect(meta2.name).toBe(meta.name);
      expect(meta2.description).toBe(meta.description);
      expect(meta2.version).toBe(meta.version);
      expect(meta2.author).toBe(meta.author);
      expect(meta2.tools).toEqual(meta.tools);
      expect(meta2.capabilities).toEqual(meta.capabilities);
      expect(meta2.tags).toEqual(meta.tags);
      expect(body2).toBe(body);
    });

    it("omits empty arrays from frontmatter", () => {
      const serialized = service.serializeSkillFile(
        {
          name: "Test",
          description: "A test skill",
          version: "1.0.0",
          author: "Author",
          tools: [],
          capabilities: [],
          parameters: {},
          tags: [],
        },
        "Body content",
      );

      expect(serialized).not.toContain("tools:");
      expect(serialized).not.toContain("capabilities:");
      expect(serialized).not.toContain("tags:");
      expect(serialized).not.toContain("parameters:");
    });
  });
});
