import type { ModuleToolDefinition, ModuleContext } from "@otterbot/shared";

export const searchCodeTool: ModuleToolDefinition = {
  name: "search_code",
  description:
    "Search indexed source code files by content or filename. " +
    "Uses hybrid full-text + vector search for best results.",
  parameters: {
    query: { type: "string", description: "Search query (code snippets, function names, file paths, etc.)", required: true },
    path_filter: { type: "string", description: "Filter results to paths starting with this prefix (e.g. 'src/api/')", required: false },
    limit: { type: "number", description: "Max results to return (default 5)", required: false },
  },
  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const query = args.query as string;
    const pathFilter = args.path_filter as string | undefined;
    const limit = typeof args.limit === "number" ? Math.min(args.limit, 20) : 5;

    const results = await ctx.knowledge.search(query, limit * 2);

    // Filter to source code files and optionally by path prefix
    let filtered = results.filter((doc) => doc.id.startsWith("file:"));
    if (pathFilter) {
      filtered = filtered.filter((doc) => {
        const path = doc.metadata?.path as string | undefined;
        return path && path.startsWith(pathFilter);
      });
    }
    filtered = filtered.slice(0, limit);

    if (filtered.length === 0) {
      return "No matching source files found.";
    }

    return filtered
      .map((doc) => {
        const meta = doc.metadata;
        const path = (meta?.path as string) ?? doc.id.replace("file:", "");
        const lang = (meta?.language as string) ?? "";
        return `--- ${path} (${lang}) ---\n${doc.content}\n`;
      })
      .join("\n");
  },
};

export const getFileTool: ModuleToolDefinition = {
  name: "get_file",
  description:
    "Retrieve the full content of a specific indexed source file by its path.",
  parameters: {
    path: { type: "string", description: "File path relative to repo root (e.g. 'src/index.ts')", required: true },
  },
  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const path = args.path as string;
    const doc = ctx.knowledge.get(`file:${path}`);

    if (!doc) {
      // Try a search as fallback in case the exact path doesn't match
      const results = await ctx.knowledge.search(path, 3);
      const match = results.find((r) => r.id.startsWith("file:"));
      if (match) {
        const matchPath = (match.metadata?.path as string) ?? match.id.replace("file:", "");
        return `File "${path}" not found. Did you mean "${matchPath}"?\n\n${match.content}`;
      }
      return `File not found: ${path}. Use search_code to find files by content or name.`;
    }

    return doc.content;
  },
};

export const searchThreadsTool: ModuleToolDefinition = {
  name: "search_threads",
  description:
    "Search past Discord support threads for similar questions and answers. " +
    "Useful for finding previously resolved issues.",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
    status: { type: "string", description: "Filter by thread status: 'open', 'resolved', or 'all' (default: all)", required: false },
    limit: { type: "number", description: "Max threads to return (default 5)", required: false },
  },
  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const query = args.query as string;
    const status = args.status as string | undefined;
    const limit = typeof args.limit === "number" ? Math.min(args.limit, 20) : 5;

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Search thread titles and message content
    conditions.push("(t.title LIKE ? OR tm.content LIKE ?)");
    params.push(`%${query}%`, `%${query}%`);

    if (status && status !== "all") {
      conditions.push("t.status = ?");
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = ctx.knowledge.db
      .prepare(
        `SELECT DISTINCT t.thread_id, t.title, t.status, t.author_name, t.created_at, t.updated_at
         FROM threads t
         LEFT JOIN thread_messages tm ON tm.thread_id = t.thread_id
         ${where}
         ORDER BY t.updated_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as Array<{
      thread_id: string;
      title: string;
      status: string;
      author_name: string | null;
      created_at: string;
      updated_at: string;
    }>;

    if (rows.length === 0) {
      return "No matching support threads found.";
    }

    const results: string[] = [];
    for (const row of rows) {
      // Fetch the messages for this thread
      const messages = ctx.knowledge.db
        .prepare(
          `SELECT author_name, is_bot, content, created_at
           FROM thread_messages
           WHERE thread_id = ?
           ORDER BY created_at ASC
           LIMIT 10`,
        )
        .all(row.thread_id) as Array<{
        author_name: string | null;
        is_bot: number;
        content: string;
        created_at: string;
      }>;

      const statusTag = row.status === "resolved" ? " [RESOLVED]" : "";
      let thread = `--- Thread: ${row.title}${statusTag} ---\n`;
      thread += `By: ${row.author_name ?? "unknown"} | Created: ${row.created_at}\n\n`;

      for (const msg of messages) {
        const role = msg.is_bot ? "Bot" : (msg.author_name ?? "User");
        thread += `${role}: ${msg.content.slice(0, 500)}\n\n`;
      }

      results.push(thread);
    }

    return results.join("\n");
  },
};
