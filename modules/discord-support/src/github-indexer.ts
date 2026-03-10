import { randomUUID } from "node:crypto";
import type { ModuleContext, PollResult, PollResultItem } from "@otterbot/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

interface GitTreeResponse {
  sha: string;
  tree: GitTreeEntry[];
  truncated: boolean;
}

interface RepoConfig {
  owner: string;
  name: string;
  repoId: string; // "owner/name"
  token: string | undefined;
  branch: string | undefined;
  pathPrefixes: string[];
  extensions: Set<string>;
  maxFileSizeKb: number;
}

// ─── Default extensions ─────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = new Set([
  ".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".md",
  ".yaml", ".yml", ".json", ".toml", ".sh", ".css", ".html",
  ".java", ".kt", ".c", ".cpp", ".h", ".hpp", ".rb", ".ex",
  ".exs", ".swift", ".zig", ".sql",
]);

// ─── Language detection ─────────────────────────────────────────────────────

function detectLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
    ".jsx": "javascript", ".py": "python", ".go": "go", ".rs": "rust",
    ".md": "markdown", ".yaml": "yaml", ".yml": "yaml", ".json": "json",
    ".toml": "toml", ".sh": "bash", ".css": "css", ".html": "html",
    ".java": "java", ".kt": "kotlin", ".c": "c", ".cpp": "cpp",
    ".h": "c", ".hpp": "cpp", ".rb": "ruby", ".ex": "elixir",
    ".exs": "elixir", ".swift": "swift", ".zig": "zig", ".sql": "sql",
  };
  return map[ext] ?? "text";
}

// ─── GitHub API helpers ─────────────────────────────────────────────────────

function getGitHubConfigs(ctx: ModuleContext): RepoConfig[] {
  const repoRaw = ctx.getConfig("github_repo");
  const token = ctx.getConfig("github_token") ?? ctx.getConfig("github:token");

  if (!repoRaw) return [];

  const branch = ctx.getConfig("github_branch") ?? undefined;
  const pathPrefixes = ctx.getConfig("github_paths")
    ?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  const extensionsRaw = ctx.getConfig("github_extensions");
  const extensions = extensionsRaw
    ? new Set(extensionsRaw.split(",").map((e) => e.trim()).filter(Boolean))
    : DEFAULT_EXTENSIONS;
  const maxFileSizeKb = Number(ctx.getConfig("max_file_size_kb")) || 100;

  const repos = repoRaw.split(",").map((r) => r.trim()).filter(Boolean);
  const configs: RepoConfig[] = [];

  for (const repo of repos) {
    const [owner, name] = repo.split("/");
    if (!owner || !name) {
      ctx.warn(`github_repo entry "${repo}" must be in owner/repo format — skipping`);
      continue;
    }
    configs.push({
      owner,
      name,
      repoId: `${owner}/${name}`,
      token,
      branch,
      pathPrefixes,
      extensions,
      maxFileSizeKb,
    });
  }

  return configs;
}

async function ghFetch<T>(url: string, token: string | undefined): Promise<T | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "otterbot-discord-support",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function fetchTree(
  owner: string,
  name: string,
  token: string | undefined,
  branch?: string,
): Promise<GitTreeResponse> {
  const ref = branch ?? "HEAD";
  const url = `https://api.github.com/repos/${owner}/${name}/git/trees/${ref}?recursive=1`;
  const data = await ghFetch<GitTreeResponse>(url, token);
  if (!data) throw new Error("Failed to fetch repository tree");
  return data;
}

async function fetchFileContent(
  owner: string,
  name: string,
  token: string | undefined,
  path: string,
  branch?: string,
): Promise<string> {
  const ref = branch ? `?ref=${branch}` : "";
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${path}${ref}`;
  const data = await ghFetch<{ content?: string; encoding?: string }>(url, token);
  if (!data?.content) return "";

  if (data.encoding === "base64") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  return data.content;
}

// ─── Filtering ──────────────────────────────────────────────────────────────

function shouldIndex(
  entry: GitTreeEntry,
  pathPrefixes: string[],
  extensions: Set<string>,
  maxSizeBytes: number,
): boolean {
  if (entry.type !== "blob") return false;
  if (entry.size && entry.size > maxSizeBytes) return false;

  const ext = entry.path.slice(entry.path.lastIndexOf("."));
  if (!extensions.has(ext)) return false;

  if (pathPrefixes.length > 0) {
    if (!pathPrefixes.some((prefix) => entry.path.startsWith(prefix))) return false;
  }

  return true;
}

// ─── DB helpers (repo-scoped) ───────────────────────────────────────────────

function getExistingShas(ctx: ModuleContext, repo: string): Map<string, string> {
  const rows = ctx.knowledge.db
    .prepare("SELECT path, sha FROM source_files WHERE repo = ?")
    .all(repo) as Array<{ path: string; sha: string }>;
  return new Map(rows.map((r) => [r.path, r.sha]));
}

function upsertSourceFile(
  ctx: ModuleContext,
  repo: string,
  path: string,
  sha: string,
  size: number | undefined,
  language: string,
): void {
  ctx.knowledge.db
    .prepare(
      `INSERT INTO source_files (repo, path, sha, size, language, last_indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, path) DO UPDATE SET
         sha = excluded.sha,
         size = excluded.size,
         language = excluded.language,
         last_indexed_at = excluded.last_indexed_at`,
    )
    .run(repo, path, sha, size ?? null, language, new Date().toISOString());
}

function removeSourceFile(ctx: ModuleContext, repo: string, path: string): void {
  ctx.knowledge.db.prepare("DELETE FROM source_files WHERE repo = ? AND path = ?").run(repo, path);
  ctx.knowledge.delete(`file:${repo}:${path}`);
}

/**
 * Clean up legacy rows with empty repo (from before multi-repo migration).
 * These will be re-indexed with proper repo prefixes on the next poll.
 */
function cleanupLegacyRows(ctx: ModuleContext): void {
  const legacyFiles = ctx.knowledge.db
    .prepare("SELECT path FROM source_files WHERE repo = ''")
    .all() as Array<{ path: string }>;

  if (legacyFiles.length > 0) {
    for (const row of legacyFiles) {
      ctx.knowledge.delete(`file:${row.path}`);
    }
    ctx.knowledge.db.prepare("DELETE FROM source_files WHERE repo = ''").run();
    ctx.log(`Cleaned up ${legacyFiles.length} legacy source_files rows (will re-index with repo prefix)`);
  }

  const legacyAnnouncements = ctx.knowledge.db
    .prepare("SELECT COUNT(*) as count FROM announcements WHERE repo = ''")
    .get() as { count: number };

  if (legacyAnnouncements.count > 0) {
    ctx.knowledge.db.prepare("DELETE FROM announcements WHERE repo = ''").run();
    ctx.log(`Cleaned up ${legacyAnnouncements.count} legacy announcement rows (will re-seed on next poll)`);
  }
}

// ─── Single-repo poll ───────────────────────────────────────────────────────

async function pollSingleRepo(
  ctx: ModuleContext,
  config: RepoConfig,
): Promise<PollResultItem[]> {
  const { owner, name, repoId, token, branch, pathPrefixes, extensions, maxFileSizeKb } = config;
  const maxSizeBytes = maxFileSizeKb * 1024;

  const tree = await fetchTree(owner, name, token, branch);
  const indexable = tree.tree.filter((e) =>
    shouldIndex(e, pathPrefixes, extensions, maxSizeBytes),
  );

  const existing = getExistingShas(ctx, repoId);
  const changed = indexable.filter((e) => existing.get(e.path) !== e.sha);

  // Remove files that no longer exist in the tree
  const treePathSet = new Set(indexable.map((e) => e.path));
  for (const [path] of existing) {
    if (!treePathSet.has(path)) {
      removeSourceFile(ctx, repoId, path);
    }
  }

  if (changed.length === 0) return [];

  const items: PollResultItem[] = [];
  const batchSize = 10;

  for (let i = 0; i < changed.length; i += batchSize) {
    const batch = changed.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          const content = await fetchFileContent(owner, name, token, entry.path, branch);
          const language = detectLanguage(entry.path);

          await ctx.knowledge.upsert(
            `file:${repoId}:${entry.path}`,
            `# ${repoId}:${entry.path}\n\n\`\`\`${language}\n${content}\n\`\`\``,
            { repo: repoId, path: entry.path, sha: entry.sha, language, size: entry.size },
          );

          upsertSourceFile(ctx, repoId, entry.path, entry.sha, entry.size, language);

          return {
            id: `file:${repoId}:${entry.path}`,
            title: `${repoId}:${entry.path}`,
            content: content.slice(0, 200),
            metadata: { repo: repoId, path: entry.path, sha: entry.sha, language },
          } as PollResultItem;
        } catch (err) {
          ctx.error(`Failed to index ${repoId}:${entry.path}:`, err);
          return null;
        }
      }),
    );

    items.push(...results.filter((r) => r !== null) as PollResultItem[]);

    // Rate limit: pause between batches
    if (i + batchSize < changed.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return items;
}

// ─── Single-repo full sync ──────────────────────────────────────────────────

async function fullSyncSingleRepo(
  ctx: ModuleContext,
  config: RepoConfig,
): Promise<PollResultItem[]> {
  const { owner, name, repoId, token, branch, pathPrefixes, extensions, maxFileSizeKb } = config;
  const maxSizeBytes = maxFileSizeKb * 1024;

  const tree = await fetchTree(owner, name, token, branch);
  const indexable = tree.tree.filter((e) =>
    shouldIndex(e, pathPrefixes, extensions, maxSizeBytes),
  );

  // Remove files no longer in the tree
  const existing = getExistingShas(ctx, repoId);
  const treePathSet = new Set(indexable.map((e) => e.path));
  for (const [path] of existing) {
    if (!treePathSet.has(path)) {
      removeSourceFile(ctx, repoId, path);
    }
  }

  const items: PollResultItem[] = [];
  const batchSize = 10;
  let pageCount = 0;

  for (let i = 0; i < indexable.length; i += batchSize) {
    const batch = indexable.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          const content = await fetchFileContent(owner, name, token, entry.path, branch);
          const language = detectLanguage(entry.path);

          await ctx.knowledge.upsert(
            `file:${repoId}:${entry.path}`,
            `# ${repoId}:${entry.path}\n\n\`\`\`${language}\n${content}\n\`\`\``,
            { repo: repoId, path: entry.path, sha: entry.sha, language, size: entry.size },
          );

          upsertSourceFile(ctx, repoId, entry.path, entry.sha, entry.size, language);

          return {
            id: `file:${repoId}:${entry.path}`,
            title: `${repoId}:${entry.path}`,
            content: content.slice(0, 200),
            metadata: { repo: repoId, path: entry.path, sha: entry.sha, language },
          } as PollResultItem;
        } catch (err) {
          ctx.error(`Failed to index ${repoId}:${entry.path}:`, err);
          return null;
        }
      }),
    );

    items.push(...results.filter((r) => r !== null) as PollResultItem[]);
    pageCount++;
    ctx.log(`Full sync ${repoId} batch ${pageCount} (${items.length}/${indexable.length} files)`);

    // Rate limit
    if (i + batchSize < indexable.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return items;
}

// ─── Public API: Poll ───────────────────────────────────────────────────────

/**
 * Incremental poll: only fetch files whose SHA has changed.
 */
export async function pollGitHub(ctx: ModuleContext): Promise<PollResult> {
  const configs = getGitHubConfigs(ctx);
  if (configs.length === 0) return { items: [], summary: "Skipped: missing configuration" };

  // Clean up legacy rows on first poll after migration
  cleanupLegacyRows(ctx);

  try {
    const allItems: PollResultItem[] = [];

    for (const config of configs) {
      try {
        const items = await pollSingleRepo(ctx, config);
        allItems.push(...items);
      } catch (err) {
        ctx.error(`GitHub poll failed for ${config.repoId}:`, err);
      }
    }

    if (allItems.length === 0) {
      return { items: [], summary: "No changed files" };
    }

    ctx.log(`Indexed ${allItems.length} changed files across ${configs.length} repo(s)`);
    return {
      items: allItems,
      summary: `Indexed ${allItems.length} changed files`,
    };
  } catch (err) {
    ctx.error("GitHub poll failed:", err);
    return { items: [], summary: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Release checking ────────────────────────────────────────────────────────

/**
 * Check for new GitHub releases that haven't been announced yet.
 * Returns an array of { release, repoId } for each unannounced release across all repos.
 */
export async function checkForNewReleases(
  ctx: ModuleContext,
): Promise<Array<{ release: GitHubRelease; repoId: string }>> {
  const configs = getGitHubConfigs(ctx);
  if (configs.length === 0) return [];

  const results: Array<{ release: GitHubRelease; repoId: string }> = [];

  for (const config of configs) {
    try {
      const releases = await ghFetch<GitHubRelease[]>(
        `https://api.github.com/repos/${config.owner}/${config.name}/releases?per_page=10`,
        config.token,
      );

      if (!releases || releases.length === 0) continue;

      // Filter out drafts
      const published = releases.filter((r) => !r.draft);

      // Check if we've ever announced anything for this repo
      const announcementCount = ctx.knowledge.db
        .prepare("SELECT COUNT(*) as count FROM announcements WHERE type = 'release' AND repo = ?")
        .get(config.repoId) as { count: number };

      if (announcementCount.count === 0 && published.length > 0) {
        // First run for this repo: seed all existing releases as already seen
        for (const release of published) {
          ctx.knowledge.db
            .prepare(
              `INSERT OR IGNORE INTO announcements (id, channel_id, type, reference_id, repo, content, posted_at)
               VALUES (?, '_seed', 'release', ?, ?, '', ?)`,
            )
            .run(randomUUID(), `${config.repoId}:${release.tag_name}`, config.repoId, new Date().toISOString());
        }
        ctx.log(`Seeded ${published.length} existing releases for ${config.repoId}`);
        continue;
      }

      // Check which ones have already been announced
      for (const release of published) {
        const refId = `${config.repoId}:${release.tag_name}`;
        const existing = ctx.knowledge.db
          .prepare("SELECT id FROM announcements WHERE reference_id = ? AND type = 'release'")
          .get(refId) as { id: string } | undefined;

        if (!existing) {
          results.push({ release, repoId: config.repoId });
        }
      }
    } catch (err) {
      ctx.error(`Failed to check releases for ${config.repoId}:`, err);
    }
  }

  return results;
}

/**
 * Record that a release has been announced to a channel.
 */
export function recordAnnouncement(
  ctx: ModuleContext,
  channelId: string,
  type: string,
  referenceId: string,
  repo: string,
  content: string,
): void {
  ctx.knowledge.db
    .prepare(
      `INSERT INTO announcements (id, channel_id, type, reference_id, repo, content, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), channelId, type, referenceId, repo, content, new Date().toISOString());
}

/**
 * Full sync: re-index all matching files regardless of SHA.
 */
export async function fullSyncGitHub(ctx: ModuleContext): Promise<PollResult> {
  const configs = getGitHubConfigs(ctx);
  if (configs.length === 0) return { items: [], summary: "Skipped: missing configuration" };

  // Clean up legacy rows before full sync
  cleanupLegacyRows(ctx);

  try {
    const allItems: PollResultItem[] = [];

    for (const config of configs) {
      try {
        const items = await fullSyncSingleRepo(ctx, config);
        allItems.push(...items);
        ctx.log(`Full sync complete for ${config.repoId}: ${items.length} files`);
      } catch (err) {
        ctx.error(`GitHub full sync failed for ${config.repoId}:`, err);
      }
    }

    ctx.log(`Full sync complete: ${allItems.length} files across ${configs.length} repo(s)`);
    return {
      items: allItems,
      summary: `Full sync: indexed ${allItems.length} files`,
    };
  } catch (err) {
    ctx.error("GitHub full sync failed:", err);
    return { items: [], summary: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
