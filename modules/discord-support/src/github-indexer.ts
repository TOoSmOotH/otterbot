import type { ModuleContext, PollResult, PollResultItem } from "@otterbot/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

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

function getGitHubConfig(ctx: ModuleContext) {
  const repo = ctx.getConfig("github_repo");
  const token = ctx.getConfig("github_token") ?? ctx.getConfig("github:token");

  if (!repo) {
    return null;
  }
  if (!token) {
    ctx.warn("No GitHub token configured (set github_token or github:token)");
    return null;
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    ctx.warn("github_repo must be in owner/repo format");
    return null;
  }

  const branch = ctx.getConfig("github_branch") ?? undefined;
  const pathPrefixes = ctx.getConfig("github_paths")
    ?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  const extensionsRaw = ctx.getConfig("github_extensions");
  const extensions = extensionsRaw
    ? new Set(extensionsRaw.split(",").map((e) => e.trim()).filter(Boolean))
    : DEFAULT_EXTENSIONS;
  const maxFileSizeKb = Number(ctx.getConfig("max_file_size_kb")) || 100;

  return { owner, name, token, branch, pathPrefixes, extensions, maxFileSizeKb };
}

async function ghFetch<T>(url: string, token: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "otterbot-discord-support",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function fetchTree(
  owner: string,
  name: string,
  token: string,
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
  token: string,
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

// ─── Index / Sync ───────────────────────────────────────────────────────────

function getExistingShas(ctx: ModuleContext): Map<string, string> {
  const rows = ctx.knowledge.db
    .prepare("SELECT path, sha FROM source_files")
    .all() as Array<{ path: string; sha: string }>;
  return new Map(rows.map((r) => [r.path, r.sha]));
}

function upsertSourceFile(
  ctx: ModuleContext,
  path: string,
  sha: string,
  size: number | undefined,
  language: string,
): void {
  ctx.knowledge.db
    .prepare(
      `INSERT INTO source_files (path, sha, size, language, last_indexed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         sha = excluded.sha,
         size = excluded.size,
         language = excluded.language,
         last_indexed_at = excluded.last_indexed_at`,
    )
    .run(path, sha, size ?? null, language, new Date().toISOString());
}

function removeSourceFile(ctx: ModuleContext, path: string): void {
  ctx.knowledge.db.prepare("DELETE FROM source_files WHERE path = ?").run(path);
  ctx.knowledge.delete(`file:${path}`);
}

/**
 * Incremental poll: only fetch files whose SHA has changed.
 */
export async function pollGitHub(ctx: ModuleContext): Promise<PollResult> {
  const config = getGitHubConfig(ctx);
  if (!config) return { items: [], summary: "Skipped: missing configuration" };

  const { owner, name, token, branch, pathPrefixes, extensions, maxFileSizeKb } = config;
  const maxSizeBytes = maxFileSizeKb * 1024;

  try {
    const tree = await fetchTree(owner, name, token, branch);
    const indexable = tree.tree.filter((e) =>
      shouldIndex(e, pathPrefixes, extensions, maxSizeBytes),
    );

    const existing = getExistingShas(ctx);
    const changed = indexable.filter((e) => existing.get(e.path) !== e.sha);

    // Remove files that no longer exist in the tree
    const treePathSet = new Set(indexable.map((e) => e.path));
    for (const [path] of existing) {
      if (!treePathSet.has(path)) {
        removeSourceFile(ctx, path);
      }
    }

    if (changed.length === 0) {
      return { items: [], summary: "No changed files" };
    }

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
              `file:${entry.path}`,
              `# ${entry.path}\n\n\`\`\`${language}\n${content}\n\`\`\``,
              { path: entry.path, sha: entry.sha, language, size: entry.size },
            );

            upsertSourceFile(ctx, entry.path, entry.sha, entry.size, language);

            return {
              id: `file:${entry.path}`,
              title: entry.path,
              content: content.slice(0, 200),
              metadata: { path: entry.path, sha: entry.sha, language },
            } as PollResultItem;
          } catch (err) {
            ctx.error(`Failed to index ${entry.path}:`, err);
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

    ctx.log(`Indexed ${items.length} changed files (${indexable.length} total tracked)`);
    return {
      items,
      summary: `Indexed ${items.length} changed files`,
    };
  } catch (err) {
    ctx.error("GitHub poll failed:", err);
    return { items: [], summary: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Full sync: re-index all matching files regardless of SHA.
 */
export async function fullSyncGitHub(ctx: ModuleContext): Promise<PollResult> {
  const config = getGitHubConfig(ctx);
  if (!config) return { items: [], summary: "Skipped: missing configuration" };

  const { owner, name, token, branch, pathPrefixes, extensions, maxFileSizeKb } = config;
  const maxSizeBytes = maxFileSizeKb * 1024;

  try {
    const tree = await fetchTree(owner, name, token, branch);
    const indexable = tree.tree.filter((e) =>
      shouldIndex(e, pathPrefixes, extensions, maxSizeBytes),
    );

    // Remove files no longer in the tree
    const existing = getExistingShas(ctx);
    const treePathSet = new Set(indexable.map((e) => e.path));
    for (const [path] of existing) {
      if (!treePathSet.has(path)) {
        removeSourceFile(ctx, path);
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
              `file:${entry.path}`,
              `# ${entry.path}\n\n\`\`\`${language}\n${content}\n\`\`\``,
              { path: entry.path, sha: entry.sha, language, size: entry.size },
            );

            upsertSourceFile(ctx, entry.path, entry.sha, entry.size, language);

            return {
              id: `file:${entry.path}`,
              title: entry.path,
              content: content.slice(0, 200),
              metadata: { path: entry.path, sha: entry.sha, language },
            } as PollResultItem;
          } catch (err) {
            ctx.error(`Failed to index ${entry.path}:`, err);
            return null;
          }
        }),
      );

      items.push(...results.filter((r) => r !== null) as PollResultItem[]);
      pageCount++;
      ctx.log(`Full sync batch ${pageCount} (${items.length}/${indexable.length} files)`);

      // Rate limit
      if (i + batchSize < indexable.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    ctx.log(`Full sync complete: ${items.length} files indexed`);
    return {
      items,
      summary: `Full sync: indexed ${items.length} files`,
    };
  } catch (err) {
    ctx.error("GitHub full sync failed:", err);
    return { items: [], summary: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
