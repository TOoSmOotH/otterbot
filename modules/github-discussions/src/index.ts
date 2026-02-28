import {
  defineModule,
  type ModuleContext,
  type PollResult,
  type PollResultItem,
  type WebhookRequest,
  type WebhookResult,
} from "@otterbot/shared";
import { migration001 } from "./migrations/001-initial.js";

// ─── GitHub GraphQL query ────────────────────────────────────────────────────

const DISCUSSIONS_QUERY = `
query($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: $first, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        id
        number
        title
        body
        url
        createdAt
        updatedAt
        category { name }
        author { login }
        answer {
          body
          author { login }
        }
        comments(first: 10) {
          nodes {
            id
            body
            createdAt
            updatedAt
            author { login }
            isAnswer
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`;

interface GHDiscussion {
  id: string;
  number: number;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  category: { name: string } | null;
  author: { login: string } | null;
  answer: { body: string; author: { login: string } | null } | null;
  comments: {
    nodes: Array<{
      id: string;
      body: string;
      createdAt: string;
      updatedAt: string;
      author: { login: string } | null;
      isAnswer: boolean;
    }>;
  };
}

async function fetchDiscussions(
  ctx: ModuleContext,
): Promise<GHDiscussion[]> {
  const owner = ctx.getConfig("repo_owner");
  const name = ctx.getConfig("repo_name");
  const token = ctx.getConfig("github_token") ?? ctx.getConfig("github:token");

  if (!owner || !name) {
    ctx.warn("repo_owner and repo_name must be configured");
    return [];
  }

  if (!token) {
    ctx.warn("No GitHub token configured (set github_token or github:token)");
    return [];
  }

  const categories = ctx.getConfig("categories");
  const first = 20;

  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: DISCUSSIONS_QUERY,
        variables: { owner, name, first },
      }),
    });

    if (!response.ok) {
      ctx.error(`GitHub API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as {
      data?: {
        repository?: {
          discussions?: {
            nodes: GHDiscussion[];
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors) {
      ctx.error("GraphQL errors:", data.errors.map((e) => e.message).join(", "));
      return [];
    }

    let discussions = data.data?.repository?.discussions?.nodes ?? [];

    // Filter by categories if configured
    if (categories) {
      const allowedCategories = categories.split(",").map((c) => c.trim().toLowerCase());
      discussions = discussions.filter((d) =>
        d.category && allowedCategories.includes(d.category.name.toLowerCase()),
      );
    }

    return discussions;
  } catch (err) {
    ctx.error("Failed to fetch discussions:", err);
    return [];
  }
}

function discussionToContent(d: GHDiscussion): string {
  const parts: string[] = [];
  parts.push(`# ${d.title}`);
  parts.push(`Discussion #${d.number} by @${d.author?.login ?? "unknown"}`);
  if (d.category) parts.push(`Category: ${d.category.name}`);
  parts.push(`URL: ${d.url}`);
  parts.push("");
  if (d.body) parts.push(d.body);

  if (d.answer) {
    parts.push("");
    parts.push(`## Accepted Answer (by @${d.answer.author?.login ?? "unknown"})`);
    parts.push(d.answer.body);
  }

  if (d.comments.nodes.length > 0) {
    parts.push("");
    parts.push("## Comments");
    for (const c of d.comments.nodes) {
      const answerTag = c.isAnswer ? " [ANSWER]" : "";
      parts.push(`\n### @${c.author?.login ?? "unknown"}${answerTag}`);
      parts.push(c.body);
    }
  }

  return parts.join("\n");
}

function discussionToItem(d: GHDiscussion): PollResultItem {
  return {
    id: `discussion-${d.number}`,
    title: d.title,
    content: discussionToContent(d),
    url: d.url,
    metadata: {
      number: d.number,
      author: d.author?.login,
      category: d.category?.name,
      hasAnswer: !!d.answer,
      commentCount: d.comments.nodes.length,
    },
  };
}

function upsertDiscussions(ctx: ModuleContext, discussions: GHDiscussion[]): void {
  for (const d of discussions) {
    ctx.knowledge.db
      .prepare(
        `INSERT INTO discussions (id, number, title, body, author, category, url, state, answer_body, answer_author, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           body = excluded.body,
           answer_body = excluded.answer_body,
           answer_author = excluded.answer_author,
           updated_at = excluded.updated_at`,
      )
      .run(
        d.id,
        d.number,
        d.title,
        d.body,
        d.author?.login,
        d.category?.name,
        d.url,
        d.answer?.body ?? null,
        d.answer?.author?.login ?? null,
        d.createdAt,
        d.updatedAt,
      );

    for (const c of d.comments.nodes) {
      ctx.knowledge.db
        .prepare(
          `INSERT INTO comments (id, discussion_id, body, author, is_answer, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             body = excluded.body,
             is_answer = excluded.is_answer,
             updated_at = excluded.updated_at`,
        )
        .run(c.id, d.id, c.body, c.author?.login, c.isAnswer ? 1 : 0, c.createdAt, c.updatedAt);
    }
  }
}

async function fetchAllDiscussions(ctx: ModuleContext): Promise<GHDiscussion[]> {
  const owner = ctx.getConfig("repo_owner");
  const name = ctx.getConfig("repo_name");
  const token = ctx.getConfig("github_token") ?? ctx.getConfig("github:token");

  if (!owner || !name) {
    ctx.warn("repo_owner and repo_name must be configured");
    return [];
  }

  if (!token) {
    ctx.warn("No GitHub token configured (set github_token or github:token)");
    return [];
  }

  const categories = ctx.getConfig("categories");
  const allDiscussions: GHDiscussion[] = [];
  let cursor: string | null = null;
  let pageCount = 0;
  const batchSize = 50; // pages per batch before sleeping

  try {
    while (true) {
      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: DISCUSSIONS_QUERY,
          variables: { owner, name, first: 20, after: cursor },
        }),
      });

      if (!response.ok) {
        ctx.error(`GitHub API error: ${response.status} ${response.statusText}`);
        break;
      }

      const data = (await response.json()) as {
        data?: {
          repository?: {
            discussions?: {
              nodes: GHDiscussion[];
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
            };
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (data.errors) {
        ctx.error("GraphQL errors:", data.errors.map((e) => e.message).join(", "));
        break;
      }

      const discussions = data.data?.repository?.discussions;
      if (!discussions) break;

      let nodes = discussions.nodes;

      // Filter by categories if configured
      if (categories) {
        const allowedCategories = categories.split(",").map((c) => c.trim().toLowerCase());
        nodes = nodes.filter((d) =>
          d.category && allowedCategories.includes(d.category.name.toLowerCase()),
        );
      }

      allDiscussions.push(...nodes);
      pageCount++;

      ctx.log(`Fetched page ${pageCount} (${allDiscussions.length} discussions so far)`);

      if (!discussions.pageInfo.hasNextPage || !discussions.pageInfo.endCursor) break;
      cursor = discussions.pageInfo.endCursor;

      // Rate limit: sleep 2 seconds every batchSize pages
      if (pageCount % batchSize === 0) {
        ctx.log(`Rate limit pause after ${pageCount} pages...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } catch (err) {
    ctx.error("Failed to fetch all discussions:", err);
  }

  ctx.log(`Full sync complete: ${allDiscussions.length} discussions across ${pageCount} pages`);
  return allDiscussions;
}

// ─── Module definition ───────────────────────────────────────────────────────

export default defineModule({
  manifest: {
    id: "github-discussions",
    name: "GitHub Discussions",
    version: "0.2.0",
    description: "Monitors GitHub Discussions and indexes them for Q&A",
    author: "Otterbot",
  },

  agent: {
    defaultName: "Discussions Agent",
    defaultPrompt: [
      "You are a GitHub Discussions specialist. You have access to a knowledge store",
      "containing indexed GitHub Discussions from a repository.",
      "",
      "When answering questions:",
      "- Use the knowledge_search tool to find relevant discussions",
      "- Synthesize information across multiple discussions when appropriate",
      "- Include discussion numbers (#N) and URLs in your answers for reference",
      "- Note whether a discussion has an accepted answer",
      "- If a discussion is unanswered, say so clearly",
      "- Summarize key points rather than dumping raw content",
      "",
      "You can also use the search_discussions tool to query the structured discussions",
      "database for more targeted searches (by category, author, answered status, etc.).",
    ].join("\n"),
  },

  configSchema: {
    repo_owner: {
      type: "string",
      description: "GitHub repository owner (e.g. 'anthropics')",
      required: true,
    },
    repo_name: {
      type: "string",
      description: "GitHub repository name (e.g. 'otterbot')",
      required: true,
    },
    github_token: {
      type: "secret",
      description: "GitHub personal access token (falls back to global github:token)",
      required: false,
    },
    categories: {
      type: "string",
      description: "Comma-separated category names to filter (empty = all)",
      required: false,
    },
  },

  tools: [
    {
      name: "search_discussions",
      description:
        "Search the structured discussions database with filters. " +
        "More targeted than knowledge_search — can filter by category, author, answered status.",
      parameters: {
        query: { type: "string", description: "Text to search in title and body", required: false },
        category: { type: "string", description: "Filter by discussion category name", required: false },
        author: { type: "string", description: "Filter by author login", required: false },
        answered_only: { type: "boolean", description: "Only return discussions with an accepted answer", required: false },
        limit: { type: "number", description: "Max results (default 10)", required: false },
      },
      async execute(args, ctx) {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (args.query) {
          conditions.push("(title LIKE ? OR body LIKE ?)");
          params.push(`%${args.query}%`, `%${args.query}%`);
        }
        if (args.category) {
          conditions.push("category = ?");
          params.push(args.category);
        }
        if (args.author) {
          conditions.push("author = ?");
          params.push(args.author);
        }
        if (args.answered_only) {
          conditions.push("answer_body IS NOT NULL");
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const limit = typeof args.limit === "number" ? Math.min(args.limit, 50) : 10;

        const rows = ctx.knowledge.db
          .prepare(
            `SELECT number, title, body, author, category, url, state, answer_body, answer_author, created_at, updated_at
             FROM discussions ${where}
             ORDER BY updated_at DESC
             LIMIT ?`,
          )
          .all(...params, limit) as Array<Record<string, unknown>>;

        if (rows.length === 0) return "No discussions found matching the criteria.";

        return rows
          .map((r) => {
            const answered = r.answer_body ? " [ANSWERED]" : "";
            const answer = r.answer_body
              ? `\nAccepted Answer by @${r.answer_author ?? "unknown"}:\n${(r.answer_body as string).slice(0, 500)}`
              : "";
            return [
              `--- Discussion #${r.number}${answered} ---`,
              `Title: ${r.title}`,
              `Author: @${r.author ?? "unknown"} | Category: ${r.category ?? "none"}`,
              `URL: ${r.url}`,
              `Updated: ${r.updated_at}`,
              "",
              (r.body as string).slice(0, 1000),
              answer,
            ].join("\n");
          })
          .join("\n\n");
      },
    },
  ],

  triggers: [{ type: "poll", intervalMs: 300_000, minIntervalMs: 60_000 }],

  migrations: [migration001],

  async onPoll(ctx): Promise<PollResult> {
    const discussions = await fetchDiscussions(ctx);
    const items = discussions.map(discussionToItem);
    upsertDiscussions(ctx, discussions);

    return {
      items,
      summary: `Indexed ${items.length} discussions`,
    };
  },

  async onFullSync(ctx): Promise<PollResult> {
    const discussions = await fetchAllDiscussions(ctx);
    const items = discussions.map(discussionToItem);
    upsertDiscussions(ctx, discussions);

    return {
      items,
      summary: `Full sync: indexed ${items.length} discussions`,
    };
  },

  async onWebhook(req: WebhookRequest, ctx): Promise<WebhookResult> {
    const event = req.headers["x-github-event"];
    const payload = req.body as Record<string, unknown>;

    if (event === "discussion" || event === "discussion_comment") {
      const discussion = payload.discussion as GHDiscussion | undefined;
      if (discussion) {
        const content = discussionToContent(discussion);
        return {
          status: 200,
          body: { ok: true },
          items: [
            {
              id: `discussion-${discussion.number}`,
              title: discussion.title,
              content,
              url: discussion.url,
              metadata: {
                number: discussion.number,
                author: discussion.author?.login,
                category: discussion.category?.name,
              },
            },
          ],
        };
      }
    }

    return { status: 200, body: { ok: true, skipped: true } };
  },

  async onQuery(query: string, ctx): Promise<string> {
    const results = await ctx.knowledge.search(query, 5);

    if (results.length === 0) {
      return "No matching discussions found.";
    }

    return results
      .map((doc) => {
        const meta = doc.metadata;
        const num = meta?.number ? `#${meta.number}` : "";
        const author = meta?.author ? ` by @${meta.author}` : "";
        const url = meta?.url ? `\nURL: ${meta.url}` : "";
        const answered = meta?.hasAnswer ? " [ANSWERED]" : "";

        return `---\n${num}${answered}${author}${url}\n\n${doc.content}\n`;
      })
      .join("\n");
  },

  async onLoad(ctx) {
    ctx.log("GitHub Discussions module loaded");
  },
});
