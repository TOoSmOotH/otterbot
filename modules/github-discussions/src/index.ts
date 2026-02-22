import {
  defineModule,
  type ModuleContext,
  type PollResult,
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

// ─── Module definition ───────────────────────────────────────────────────────

export default defineModule({
  manifest: {
    id: "github-discussions",
    name: "GitHub Discussions",
    version: "0.1.0",
    description: "Monitors GitHub Discussions and indexes them for Q&A",
    author: "Otterbot",
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

  triggers: [{ type: "poll", intervalMs: 300_000, minIntervalMs: 60_000 }],

  migrations: [migration001],

  async onPoll(ctx): Promise<PollResult> {
    const discussions = await fetchDiscussions(ctx);

    const items = discussions.map((d) => ({
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
    }));

    // Also store discussions and comments in custom tables
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

    return {
      items,
      summary: `Indexed ${items.length} discussions`,
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
