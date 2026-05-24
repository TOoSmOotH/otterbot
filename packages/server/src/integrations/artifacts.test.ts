import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistArtifact, mimeFromName } from "./artifacts.js";

describe("artifacts", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-art-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("mimeFromName resolves known extensions and falls back to octet-stream", () => {
    expect(mimeFromName("a.png")).toBe("image/png");
    expect(mimeFromName("report.pdf")).toBe("application/pdf");
    expect(mimeFromName("notes.md")).toContain("text/markdown");
    expect(mimeFromName("mystery.xyz")).toBe("application/octet-stream");
  });

  it("persistArtifact writes the bytes and returns a well-formed image artifact", () => {
    const data = Buffer.from("PNGDATA");
    const art = persistArtifact({
      filesDir: join(dir, "files"),
      agentId: "coo",
      data,
      name: "otter.png",
    });
    expect(art.kind).toBe("image");
    expect(art.mimeType).toBe("image/png");
    expect(art.name).toBe("otter.png");
    // The stored id is a unique, traversal-safe basename, and the URL points at it.
    expect(art.id).toMatch(/^art_\d+_[0-9a-f]{8}\.png$/);
    expect(art.url).toBe(`/api/agents/coo/files/${art.id}`);
    expect(readFileSync(join(dir, "files", art.id)).toString()).toBe("PNGDATA");
  });

  it("persistArtifact infers the file kind for non-image MIME types", () => {
    const art = persistArtifact({
      filesDir: join(dir, "files"),
      agentId: "coo",
      data: Buffer.from("hello"),
      name: "summary.txt",
    });
    expect(art.kind).toBe("file");
    expect(art.mimeType).toContain("text/plain");
  });
});
