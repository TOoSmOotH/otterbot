import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { nanoid } from "nanoid";
import { Cron } from "croner";
import type {
  CodeReferenceConfig,
  CodeReferenceRepo,
  CodeReferenceStatus,
  CodeSearchHit,
  RepoSyncState,
} from "@otterbot/shared";
import type { Embedder } from "../embedding.js";
import { NullEmbedder } from "../embedding.js";
import { openCodeReferenceDb, type CodeReferenceDb } from "../db/code-reference-db.js";
import { sanitizeFtsQuery } from "../memory/memory-service.js";

/** Dependencies the orchestrator wires in. */
export interface CodeReferenceServiceDeps {
  /** The instance data dir (`cfg.dataDir`). */
  dataDir: string;
  /** DB encryption key (`cfg.dbKey`); null = unencrypted (dev). */
  dbKey: string | null;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  /** Build the instance default embedder afresh (settings can change). */
  resolveEmbedder(): Embedder;
}

const CONFIG_KEY = "code_reference";
const DEFAULT_PULL_CRON = "0 */6 * * *";

// Indexing tuning.
const WINDOW_LINES = 60;
const WINDOW_STEP = 50; // 10-line overlap
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES_PER_REPO = 20_000;
const SNIPPET_MAX = 1_200;
const READ_MAX_LINES = 400;
const READ_MAX_BYTES = 16 * 1024;

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  "target",
  ".venv",
  "__pycache__",
]);
const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "go.sum",
]);

interface RepoRow {
  id: string;
  repo_id: string;
  path: string;
  start_line: number;
  end_line: number;
  body: string;
}

/**
 * Instance-wide code reference service. Owns the shared `data/code-reference.db`
 * (FTS5 + sqlite-vec), clones/pulls configured repos under `data/repos/`, and
 * exposes hybrid search / grep / file-read for agents. One instance per process,
 * owned by the orchestrator.
 */
export class CodeReferenceService {
  private db: CodeReferenceDb | null = null;
  private embedder: Embedder = new NullEmbedder();
  private dimension: number | null = null;
  private vecAvailable = false;
  private gitAvailable = false;
  private job: Cron | null = null;
  /** repoIds currently cloning/pulling/indexing — guards concurrent work. */
  private readonly indexing = new Set<string>();

  private readonly reposDir: string;
  private readonly dbPath: string;
  /** Resolves when the initial bootstrap (probe + reconcile) finishes. */
  private readyPromise: Promise<void> = Promise.resolve();

  constructor(private readonly deps: CodeReferenceServiceDeps) {
    this.reposDir = join(deps.dataDir, "repos");
    this.dbPath = join(deps.dataDir, "code-reference.db");
  }

  /** Open the DB, arm the pull schedule, and reconcile clones in the background. */
  start(): void {
    mkdirSync(this.reposDir, { recursive: true });
    this.db = openCodeReferenceDb(this.dbPath, this.deps.dbKey);
    this.embedder = this.deps.resolveEmbedder();
    this.armCron(this.loadConfig().pullCron);
    this.readyPromise = this.bootstrap();
  }

  /** Await the initial bootstrap (clone/index reconcile). Mainly for tests. */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Stop the schedule and close the DB. */
  async stop(): Promise<void> {
    this.job?.stop();
    this.job = null;
    this.db?.close();
    this.db = null;
  }

  // --- registry ----------------------------------------------------------

  listRepos(): CodeReferenceRepo[] {
    return this.loadConfig().repos;
  }

  /** Repos available to search, as a directory for the `list_reference_repos` tool. */
  listRepoDirectory(): { repo: string; path: string; state: RepoSyncState }[] {
    return this.loadConfig().repos.map((r) => ({
      repo: `${r.owner}/${r.name}`,
      path: r.dirName,
      state: r.state,
    }));
  }

  /**
   * Register a repo and kick off clone + index in the background. Throws on a
   * malformed URL or a duplicate.
   */
  async addRepo(input: { url: string; ref?: string | null }): Promise<CodeReferenceRepo> {
    const parsed = parseRepoUrl(input.url);
    if (!parsed) throw new Error("Could not parse a GitHub owner/repo from that URL.");
    const cfg = this.loadConfig();
    const dirName = `${parsed.owner}-${parsed.name}`.replace(/[^a-zA-Z0-9._-]/g, "-");
    if (cfg.repos.some((r) => r.dirName === dirName)) {
      throw new Error(`${parsed.owner}/${parsed.name} is already configured.`);
    }
    const repo: CodeReferenceRepo = {
      id: nanoid(),
      owner: parsed.owner,
      name: parsed.name,
      url: parsed.cloneUrl,
      ref: input.ref?.trim() || null,
      dirName,
      state: "pending",
      lastSyncedAt: null,
      lastCommit: null,
      fileCount: 0,
      chunkCount: 0,
      error: null,
      createdAt: new Date().toISOString(),
    };
    cfg.repos.push(repo);
    this.saveConfig(cfg);
    void this.cloneAndIndex(repo.id);
    return repo;
  }

  /** Remove a repo: drop its index rows, delete the clone, forget it. */
  async removeRepo(id: string): Promise<boolean> {
    const cfg = this.loadConfig();
    const repo = cfg.repos.find((r) => r.id === id);
    if (!repo) return false;
    cfg.repos = cfg.repos.filter((r) => r.id !== id);
    this.saveConfig(cfg);
    this.deleteRepoRows(id);
    try {
      rmSync(join(this.reposDir, repo.dirName), { recursive: true, force: true });
    } catch {
      // best-effort
    }
    return true;
  }

  /** Pull and re-index one repo (manual refresh button / scheduled pull). */
  async refresh(id: string): Promise<void> {
    const repo = this.loadConfig().repos.find((r) => r.id === id);
    if (!repo) return;
    if (this.indexing.has(id)) return;
    const dir = join(this.reposDir, repo.dirName);
    if (!existsSync(dir)) {
      await this.cloneAndIndex(id);
      return;
    }
    if (!this.gitAvailable) return;
    this.indexing.add(id);
    try {
      this.patchRepo(id, { state: "indexing", error: null });
      await this.pull(dir, repo.ref ?? null);
      await this.indexRepo(id);
      const sha = await this.headSha(dir);
      this.patchRepo(id, { state: "ready", lastCommit: sha, lastSyncedAt: new Date().toISOString() });
    } catch (err) {
      this.patchRepo(id, { state: "error", error: errMsg(err) });
    } finally {
      this.indexing.delete(id);
    }
  }

  /** Pull + re-index every configured repo (scheduled). */
  async refreshAll(): Promise<void> {
    for (const repo of this.loadConfig().repos) {
      await this.refresh(repo.id);
    }
  }

  // --- query (used by agent tools via AgentServices) ---------------------

  /** Hybrid keyword + semantic search across chunks. */
  async search(query: string, opts: { limit?: number; repo?: string } = {}): Promise<CodeSearchHit[]> {
    const db = this.db;
    if (!db || !query.trim()) return [];
    const limit = opts.limit ?? 8;
    const repoId = opts.repo ? this.repoIdFor(opts.repo) : null;
    if (opts.repo && !repoId) return [];

    const ftsMap = new Map<string, number>();
    const sanitized = sanitizeFtsQuery(query);
    if (sanitized) {
      const filter = repoId ? "AND repo_id = ?" : "";
      const params: unknown[] = [sanitized];
      if (repoId) params.push(repoId);
      params.push(limit * 2);
      const rows = db.sqlite
        .prepare(
          `SELECT chunk_id, bm25(chunks_fts) AS score
           FROM chunks_fts WHERE chunks_fts MATCH ? ${filter}
           ORDER BY score LIMIT ?`
        )
        .all(...params) as Array<{ chunk_id: string; score: number }>;
      for (const r of rows) ftsMap.set(r.chunk_id, -r.score);
    }

    const vecMap = new Map<string, number>();
    if (this.vecAvailable) {
      const vec = await this.embedder.generate(query);
      if (vec) {
        // Fetch extra when filtering by repo since vec0 can't filter by repo.
        const k = repoId ? limit * 6 : limit * 2;
        const rows = db.sqlite
          .prepare(
            `SELECT chunk_id, distance FROM vec_chunks
             WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
          )
          .all(toBlob(vec), k) as Array<{ chunk_id: string; distance: number }>;
        for (const r of rows) vecMap.set(r.chunk_id, 1 / (1 + r.distance));
      }
    }

    const allIds = new Set([...ftsMap.keys(), ...vecMap.keys()]);
    const scored: Array<{ id: string; score: number }> = [];
    for (const id of allIds) {
      const ftsScore = ftsMap.get(id) ?? 0;
      const vecScore = vecMap.get(id) ?? 0;
      const overlap = ftsMap.has(id) && vecMap.has(id) ? 0.1 : 0;
      scored.push({ id, score: ftsScore * 0.5 + vecScore * 0.4 + overlap });
    }
    scored.sort((a, b) => b.score - a.score);

    const hits: CodeSearchHit[] = [];
    for (const item of scored) {
      if (hits.length >= limit) break;
      const row = db.sqlite
        .prepare(`SELECT id, repo_id, path, start_line, end_line, body FROM code_chunks WHERE id = ?`)
        .get(item.id) as RepoRow | undefined;
      if (!row) continue;
      if (repoId && row.repo_id !== repoId) continue;
      const via = ftsMap.has(item.id) && vecMap.has(item.id) ? "hybrid" : ftsMap.has(item.id) ? "fts" : "vector";
      hits.push(this.toHit(row, item.score, via));
    }
    return hits;
  }

  /** Exact grep via `git grep` across one or all repos. */
  async grep(
    pattern: string,
    opts: { repo?: string; limit?: number; regex?: boolean } = {}
  ): Promise<CodeSearchHit[]> {
    if (!pattern.trim() || !this.gitAvailable) return [];
    const limit = opts.limit ?? 20;
    const repos = this.loadConfig().repos.filter(
      (r) => r.state === "ready" && (!opts.repo || `${r.owner}/${r.name}` === opts.repo)
    );
    const hits: CodeSearchHit[] = [];
    for (const repo of repos) {
      if (hits.length >= limit) break;
      const dir = join(this.reposDir, repo.dirName);
      if (!existsSync(dir)) continue;
      const args = ["-C", dir, "grep", "-n", "-I", "--no-color"];
      if (!opts.regex) args.push("-F");
      args.push("-e", pattern);
      const { code, stdout } = await runGit(args);
      if (code !== 0 && code !== 1) continue; // 1 = no matches
      for (const line of stdout.split("\n")) {
        if (hits.length >= limit) break;
        const m = /^(.*?):(\d+):(.*)$/.exec(line);
        if (!m) continue;
        const lineNo = parseInt(m[2], 10);
        hits.push({
          repoId: repo.id,
          repo: `${repo.owner}/${repo.name}`,
          path: m[1],
          startLine: lineNo,
          endLine: lineNo,
          snippet: m[3].slice(0, SNIPPET_MAX),
          score: 1,
          via: "grep",
        });
      }
    }
    return hits;
  }

  /** Read a file (or line range) from a repo clone. Rejects path traversal. */
  readFile(
    repo: string,
    path: string,
    range?: { start: number; end?: number }
  ): { ok: boolean; content?: string; path?: string; truncated?: boolean; error?: string } {
    const cfgRepo = this.loadConfig().repos.find((r) => `${r.owner}/${r.name}` === repo);
    if (!cfgRepo) return { ok: false, error: `Unknown repo "${repo}".` };
    const root = resolve(this.reposDir, cfgRepo.dirName);
    const full = resolve(root, path);
    const rel = relative(root, full);
    if (rel.startsWith("..") || rel.startsWith(sep) || resolve(root, rel) !== full) {
      return { ok: false, error: "Path escapes the repository." };
    }
    if (!existsSync(full) || !statSync(full).isFile()) {
      return { ok: false, error: `File not found: ${path}` };
    }
    let content = readFileSync(full, "utf8");
    let truncated = false;
    if (range?.start) {
      const lines = content.split("\n");
      const start = Math.max(1, range.start);
      const end = Math.min(lines.length, range.end ?? start + READ_MAX_LINES);
      content = lines.slice(start - 1, end).join("\n");
    }
    if (content.length > READ_MAX_BYTES) {
      content = content.slice(0, READ_MAX_BYTES);
      truncated = true;
    }
    return { ok: true, content, path, truncated };
  }

  status(): CodeReferenceStatus {
    return {
      repos: this.loadConfig().repos,
      embeddingAvailable: this.vecAvailable,
      embeddingDimension: this.dimension,
      gitAvailable: this.gitAvailable,
      indexing: this.indexing.size > 0,
      pullCron: this.loadConfig().pullCron,
    };
  }

  /** Update the pull schedule (re-arms the cron). */
  setPullCron(cron: string): void {
    const cfg = this.loadConfig();
    cfg.pullCron = cron || DEFAULT_PULL_CRON;
    this.saveConfig(cfg);
    this.armCron(cfg.pullCron);
  }

  /** Re-resolve the instance embedder (after a global-settings change). */
  async reloadEmbedder(): Promise<void> {
    if (!this.db) return;
    this.embedder = this.deps.resolveEmbedder();
    const changed = await this.ensureDimension();
    if (changed) {
      for (const repo of this.loadConfig().repos) void this.reindexOnly(repo.id);
    }
  }

  // --- internals ---------------------------------------------------------

  private async bootstrap(): Promise<void> {
    this.gitAvailable = await probeGit();
    await this.ensureDimension();
    // Reconcile: clone anything missing, index anything not yet ready.
    for (const repo of this.loadConfig().repos) {
      const dir = join(this.reposDir, repo.dirName);
      if (!existsSync(dir)) {
        await this.cloneAndIndex(repo.id);
      } else if (repo.state !== "ready") {
        this.indexing.add(repo.id);
        try {
          await this.indexRepo(repo.id);
          const sha = await this.headSha(dir);
          this.patchRepo(repo.id, {
            state: "ready",
            lastCommit: sha,
            lastSyncedAt: new Date().toISOString(),
          });
        } catch (err) {
          this.patchRepo(repo.id, { state: "error", error: errMsg(err) });
        } finally {
          this.indexing.delete(repo.id);
        }
      }
    }
  }

  private async cloneAndIndex(id: string): Promise<void> {
    if (this.indexing.has(id)) return;
    const repo = this.loadConfig().repos.find((r) => r.id === id);
    if (!repo) return;
    if (!this.gitAvailable) {
      this.patchRepo(id, { state: "error", error: "git is not installed on the server." });
      return;
    }
    this.indexing.add(id);
    const dir = join(this.reposDir, repo.dirName);
    try {
      this.patchRepo(id, { state: "cloning", error: null });
      rmSync(dir, { recursive: true, force: true });
      await this.clone(repo.url, repo.ref ?? null, dir);
      this.patchRepo(id, { state: "indexing" });
      await this.indexRepo(id);
      const sha = await this.headSha(dir);
      this.patchRepo(id, { state: "ready", lastCommit: sha, lastSyncedAt: new Date().toISOString() });
    } catch (err) {
      this.patchRepo(id, { state: "error", error: errMsg(err) });
    } finally {
      this.indexing.delete(id);
    }
  }

  /** Re-index without pulling (used after a dimension change). */
  private async reindexOnly(id: string): Promise<void> {
    if (this.indexing.has(id)) return;
    const repo = this.loadConfig().repos.find((r) => r.id === id);
    if (!repo || !existsSync(join(this.reposDir, repo.dirName))) return;
    this.indexing.add(id);
    try {
      await this.indexRepo(id);
    } catch {
      // best-effort
    } finally {
      this.indexing.delete(id);
    }
  }

  /** Full re-index of a repo's clone into the shared DB. */
  private async indexRepo(id: string): Promise<void> {
    const db = this.db;
    const repo = this.loadConfig().repos.find((r) => r.id === id);
    if (!db || !repo) return;
    const dir = join(this.reposDir, repo.dirName);
    this.deleteRepoRows(id);

    const insChunk = db.sqlite.prepare(
      `INSERT INTO code_chunks (id, repo_id, path, start_line, end_line, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insFts = db.sqlite.prepare(
      `INSERT INTO chunks_fts (repo_id, chunk_id, path, body) VALUES (?, ?, ?, ?)`
    );
    const insVec = this.vecAvailable
      ? db.sqlite.prepare(`INSERT OR REPLACE INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)`)
      : null;

    const now = new Date().toISOString();
    let fileCount = 0;
    let chunkCount = 0;

    const files = walkFiles(dir);
    for (const relPath of files) {
      if (fileCount >= MAX_FILES_PER_REPO) break;
      const abs = join(dir, relPath);
      let text: string;
      try {
        const buf = readFileSync(abs);
        if (isBinary(buf)) continue;
        text = buf.toString("utf8");
      } catch {
        continue;
      }
      fileCount += 1;
      for (const chunk of chunkLines(text)) {
        const chunkId = nanoid();
        insChunk.run(chunkId, id, relPath, chunk.start, chunk.end, chunk.body, now);
        insFts.run(id, chunkId, relPath, chunk.body);
        if (insVec) {
          const vec = await this.embedder.generate(`${relPath}\n${chunk.body}`);
          if (vec) insVec.run(chunkId, toBlob(vec));
        }
        chunkCount += 1;
      }
    }
    this.patchRepo(id, { fileCount, chunkCount });
  }

  /** Probe the instance embedder and (re)build the vec table. Returns true if the dimension changed. */
  private async ensureDimension(): Promise<boolean> {
    const db = this.db;
    if (!db) return false;
    try {
      const probed = await this.embedder.probeDimension();
      if (!probed) {
        this.vecAvailable = false;
        return false;
      }
      const stored = this.getStoredDim();
      if (stored === probed) {
        this.dimension = probed;
        this.vecAvailable = true;
        return false;
      }
      db.recreateVecTable(probed);
      this.setStoredDim(probed);
      this.dimension = probed;
      this.vecAvailable = true;
      return stored !== null; // changed (not first-time)
    } catch (err) {
      console.warn("[code-ref] embedder probe failed:", errMsg(err));
      this.vecAvailable = false;
      return false;
    }
  }

  private toHit(row: RepoRow, score: number, via: CodeSearchHit["via"]): CodeSearchHit {
    const cfgRepo = this.loadConfig().repos.find((r) => r.id === row.repo_id);
    return {
      repoId: row.repo_id,
      repo: cfgRepo ? `${cfgRepo.owner}/${cfgRepo.name}` : row.repo_id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      snippet: row.body.slice(0, SNIPPET_MAX),
      score,
      via,
    };
  }

  private deleteRepoRows(id: string): void {
    const db = this.db;
    if (!db) return;
    if (this.vecAvailable) {
      const ids = db.sqlite
        .prepare(`SELECT id FROM code_chunks WHERE repo_id = ?`)
        .all(id) as Array<{ id: string }>;
      const del = db.sqlite.prepare(`DELETE FROM vec_chunks WHERE chunk_id = ?`);
      for (const r of ids) {
        try {
          del.run(r.id);
        } catch {
          // vec table may not exist yet
        }
      }
    }
    db.sqlite.prepare(`DELETE FROM chunks_fts WHERE repo_id = ?`).run(id);
    db.sqlite.prepare(`DELETE FROM code_chunks WHERE repo_id = ?`).run(id);
  }

  private repoIdFor(repo: string): string | null {
    return this.loadConfig().repos.find((r) => `${r.owner}/${r.name}` === repo)?.id ?? null;
  }

  private armCron(cron: string): void {
    this.job?.stop();
    try {
      this.job = new Cron(cron, () => void this.refreshAll());
    } catch (err) {
      console.warn("[code-ref] invalid pull cron, scheduling disabled:", errMsg(err));
      this.job = null;
    }
  }

  // git wrappers ----------------------------------------------------------

  private async clone(url: string, ref: string | null, dir: string): Promise<void> {
    const args = ["clone", "--depth", "1", "--single-branch"];
    if (ref) args.push("--branch", ref);
    args.push(url, dir);
    const { code, stderr } = await runGit(args);
    if (code !== 0) throw new Error(`git clone failed: ${stderr.trim().slice(0, 500)}`);
  }

  private async pull(dir: string, ref: string | null): Promise<void> {
    const fetch = await runGit(["-C", dir, "fetch", "--depth", "1", "origin", ref || "HEAD"]);
    if (fetch.code !== 0) throw new Error(`git fetch failed: ${fetch.stderr.trim().slice(0, 500)}`);
    const reset = await runGit(["-C", dir, "reset", "--hard", "FETCH_HEAD"]);
    if (reset.code !== 0) throw new Error(`git reset failed: ${reset.stderr.trim().slice(0, 500)}`);
  }

  private async headSha(dir: string): Promise<string | null> {
    const { code, stdout } = await runGit(["-C", dir, "rev-parse", "--short", "HEAD"]);
    return code === 0 ? stdout.trim() || null : null;
  }

  // config + vec_config ---------------------------------------------------

  private loadConfig(): CodeReferenceConfig {
    const raw = this.deps.getSetting(CONFIG_KEY);
    if (!raw) return { repos: [], pullCron: DEFAULT_PULL_CRON };
    try {
      const parsed = JSON.parse(raw) as Partial<CodeReferenceConfig>;
      return {
        repos: Array.isArray(parsed.repos) ? parsed.repos : [],
        pullCron: typeof parsed.pullCron === "string" && parsed.pullCron ? parsed.pullCron : DEFAULT_PULL_CRON,
      };
    } catch {
      return { repos: [], pullCron: DEFAULT_PULL_CRON };
    }
  }

  private saveConfig(cfg: CodeReferenceConfig): void {
    this.deps.setSetting(CONFIG_KEY, JSON.stringify(cfg));
  }

  private patchRepo(id: string, patch: Partial<CodeReferenceRepo>): void {
    const cfg = this.loadConfig();
    const idx = cfg.repos.findIndex((r) => r.id === id);
    if (idx === -1) return;
    cfg.repos[idx] = { ...cfg.repos[idx], ...patch };
    this.saveConfig(cfg);
  }

  private getStoredDim(): number | null {
    const row = this.db?.sqlite
      .prepare("SELECT value FROM vec_config WHERE key = 'embedding_dim'")
      .get() as { value: string } | undefined;
    if (!row) return null;
    const n = parseInt(row.value, 10);
    return Number.isNaN(n) ? null : n;
  }

  private setStoredDim(dim: number): void {
    this.db?.sqlite
      .prepare("INSERT OR REPLACE INTO vec_config (key, value) VALUES ('embedding_dim', ?)")
      .run(String(dim));
  }
}

// --- free functions --------------------------------------------------------

/** Recursively list repo-relative file paths, applying the dir/file exclusions. */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        try {
          if (statSync(abs).size > MAX_FILE_BYTES) continue;
        } catch {
          continue;
        }
        out.push(relative(root, abs));
      }
    }
  };
  walk(root);
  return out;
}

/** Heuristic binary sniff: NUL byte or >30% non-printable in the first 8 KB. */
function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  if (n === 0) return false;
  let nonPrintable = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i];
    if (c === 0) return true;
    // allow tab(9), lf(10), cr(13), and printable range
    if (c < 9 || (c > 13 && c < 32)) nonPrintable++;
  }
  return nonPrintable / n > 0.3;
}

/** Split text into overlapping line windows. */
function chunkLines(text: string): Array<{ start: number; end: number; body: string }> {
  const lines = text.split("\n");
  const out: Array<{ start: number; end: number; body: string }> = [];
  for (let i = 0; i < lines.length; i += WINDOW_STEP) {
    const slice = lines.slice(i, i + WINDOW_LINES);
    const body = slice.join("\n");
    if (body.trim()) out.push({ start: i + 1, end: i + slice.length, body });
    if (i + WINDOW_LINES >= lines.length) break;
  }
  return out;
}

/** Parse a GitHub URL or `owner/repo` shorthand. */
function parseRepoUrl(input: string): { owner: string; name: string; cloneUrl: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  // owner/repo shorthand
  const short = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(raw);
  if (short && !raw.includes("://") && !raw.includes("@")) {
    return { owner: short[1], name: short[2], cloneUrl: `https://github.com/${short[1]}/${short[2]}.git` };
  }
  // https URL
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/.exec(raw);
  if (m) {
    return { owner: m[1], name: m[2], cloneUrl: `https://github.com/${m[1]}/${m[2]}.git` };
  }
  return null;
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `git` with args, never rejecting — resolves with exit code + output. */
function runGit(args: string[]): Promise<GitResult> {
  return new Promise((res) => {
    execFile(
      "git",
      args,
      { maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === "number"
          ? ((err as { code: number }).code)
          : err
            ? 1
            : 0;
        res({ code, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
      }
    );
  });
}

/** Probe whether `git` is on PATH. */
async function probeGit(): Promise<boolean> {
  const { code } = await runGit(["--version"]);
  return code === 0;
}

function toBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
