import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeReferenceService } from "./code-reference-service.js";
import type { Embedder } from "../embedding.js";

/** Deterministic fixed-dim embedder so vector search is exercised offline. */
class FakeEmbedder implements Embedder {
  constructor(private readonly dim = 8) {}
  async probeDimension(): Promise<number | null> {
    return this.dim;
  }
  async generate(text: string): Promise<Float32Array | null> {
    const v = new Float32Array(this.dim);
    for (let i = 0; i < text.length; i++) v[i % this.dim] += text.charCodeAt(i) % 17;
    // normalise so cosine distance behaves
    let mag = 0;
    for (const x of v) mag += x * x;
    mag = Math.sqrt(mag) || 1;
    for (let i = 0; i < this.dim; i++) v[i] /= mag;
    return v;
  }
}

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitAvailable();

describe.skipIf(!HAS_GIT)("CodeReferenceService", () => {
  let dataDir: string;
  let settings: Map<string, string>;
  let svc: CodeReferenceService;
  const repoId = "r1";

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "coderef-"));
    settings = new Map();

    // Build a git fixture clone under data/repos/octo-demo.
    const dir = join(dataDir, "repos", "octo-demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.conf"),
      "# Server config\nMAX_CONNECTIONS=100  # maximum allowed concurrent connections\nLOG_LEVEL=info\n"
    );
    writeFileSync(join(dir, "README.md"), "# Demo\nThis project handles connections.\n");
    writeFileSync(join(dir, "package-lock.json"), '{"note":"LOCKFILEONLYTOKEN should be skipped"}\n');
    writeFileSync(join(dir, "logo.bin"), Buffer.from([0, 1, 2, 0, 66, 73, 78, 0, 65, 82, 89])); // NUL bytes
    execFileSync("git", ["-C", dir, "init", "-q"]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@t.t"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"]);

    settings.set(
      "code_reference",
      JSON.stringify({
        pullCron: "0 */6 * * *",
        repos: [
          {
            id: repoId,
            owner: "octo",
            name: "demo",
            url: "https://github.com/octo/demo.git",
            ref: null,
            dirName: "octo-demo",
            state: "pending",
            lastSyncedAt: null,
            lastCommit: null,
            fileCount: 0,
            chunkCount: 0,
            error: null,
            createdAt: new Date().toISOString(),
          },
        ],
      })
    );

    svc = new CodeReferenceService({
      dataDir,
      dbKey: null,
      getSetting: (k) => settings.get(k) ?? null,
      setSetting: (k, v) => void settings.set(k, v),
      resolveEmbedder: () => new FakeEmbedder(),
    });
    svc.start();
    await svc.whenReady();
  });

  afterEach(async () => {
    await svc.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("indexes the existing clone and marks it ready", () => {
    const status = svc.status();
    expect(status.embeddingAvailable).toBe(true);
    expect(status.embeddingDimension).toBe(8);
    const repo = status.repos[0];
    expect(repo.state).toBe("ready");
    expect(repo.fileCount).toBeGreaterThan(0);
    expect(repo.chunkCount).toBeGreaterThan(0);
    expect(repo.lastCommit).toBeTruthy();
  });

  it("finds a setting via hybrid search", async () => {
    const hits = await svc.search("maximum connections");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.path === "settings.conf")).toBe(true);
    expect(["fts", "vector", "hybrid"]).toContain(hits[0].via);
  });

  it("finds a literal via git grep", async () => {
    const hits = await svc.grep("MAX_CONNECTIONS");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe("settings.conf");
    expect(hits[0].via).toBe("grep");
    expect(hits[0].startLine).toBe(2);
  });

  it("excludes lockfiles and binary files from the index", async () => {
    // Vector KNN always returns nearest chunks, so assert the excluded files'
    // paths never appear (rather than expecting an empty result set). git grep
    // only searches indexed-or-not files on disk, so use it to prove the token
    // exists on disk yet was never chunked into the search index.
    const lockHits = await svc.search("LOCKFILEONLYTOKEN");
    expect(lockHits.some((h) => h.path === "package-lock.json")).toBe(false);
    const binHits = await svc.search("BINARY");
    expect(binHits.some((h) => h.path === "logo.bin")).toBe(false);
    // Sanity: the lockfile token does exist on disk (so exclusion, not absence).
    const grepLock = await svc.grep("LOCKFILEONLYTOKEN");
    expect(grepLock.some((h) => h.path === "package-lock.json")).toBe(true);
  });

  it("reads a file range and rejects path traversal", () => {
    const ok = svc.readFile("octo/demo", "settings.conf", { start: 2, end: 2 });
    expect(ok.ok).toBe(true);
    expect(ok.content).toContain("MAX_CONNECTIONS");
    expect(ok.content).not.toContain("LOG_LEVEL");

    const escape = svc.readFile("octo/demo", "../../../etc/passwd");
    expect(escape.ok).toBe(false);
  });

  it("removes a repo and clears its index", async () => {
    expect(await svc.removeRepo(repoId)).toBe(true);
    expect(svc.listRepos()).toHaveLength(0);
    expect(await svc.search("maximum connections")).toHaveLength(0);
  });
});
