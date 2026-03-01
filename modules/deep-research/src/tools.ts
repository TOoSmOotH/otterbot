/**
 * Deep Research module tools — 8 ModuleToolDefinition tools for
 * multi-source research, content extraction, and finding management.
 */

import type { ModuleToolDefinition, ModuleContext } from "@otterbot/shared";
import { search as webSearch } from "./search-providers.js";
import { extractReadableContent } from "./content-extractor.js";
import { validateUrlForSsrf } from "./ssrf.js";
import { acquireSlot } from "./rate-limiter.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTimeout(ctx: ModuleContext): number {
  return Number(ctx.getConfig("request_timeout_ms")) || 15_000;
}

function getMaxPageLength(ctx: ModuleContext): number {
  return Number(ctx.getConfig("max_page_content_length")) || 15_000;
}

function getMaxResults(ctx: ModuleContext, override?: number): number {
  return override ?? (Number(ctx.getConfig("max_search_results")) || 10);
}

function formatSearchResults(
  results: Array<{ title: string; url: string; snippet: string }>,
  provider: string,
): string {
  if (results.length === 0) return `No results found (provider: ${provider})`;
  return results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`,
    )
    .join("\n\n");
}

// ─── 1. web_search ──────────────────────────────────────────────────────────

export const webSearchTool: ModuleToolDefinition = {
  name: "web_search",
  description:
    "Search the web for information. Returns titles, URLs, and snippets. " +
    "Use focused, specific queries for best results. You can append " +
    "'site:reddit.com' or 'site:news.ycombinator.com' to target specific platforms.",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
    max_results: {
      type: "number",
      description: "Max results to return (default from config)",
      required: false,
    },
  },

  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const query = args.query as string;
    const maxResults = getMaxResults(ctx, args.max_results as number | undefined);

    try {
      const response = await webSearch(query, maxResults, ctx);
      return formatSearchResults(response.results, response.provider);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error("web_search failed:", err);
      return `Search error: ${message}`;
    }
  },
};

// ─── 2. search_reddit ───────────────────────────────────────────────────────

export const searchRedditTool: ModuleToolDefinition = {
  name: "search_reddit",
  description:
    "Search Reddit for discussions, opinions, and community knowledge. " +
    "Can search all of Reddit or a specific subreddit. Reddit often has " +
    "authentic user experiences, reviews, and expert opinions.",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
    subreddit: {
      type: "string",
      description: "Specific subreddit to search (without r/ prefix)",
      required: false,
    },
    sort: {
      type: "string",
      description: "Sort by: relevance, hot, top, new (default: relevance)",
      required: false,
    },
    time: {
      type: "string",
      description:
        "Time range: hour, day, week, month, year, all (default: all)",
      required: false,
    },
    max_results: {
      type: "number",
      description: "Max results (default 10)",
      required: false,
    },
  },

  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const query = args.query as string;
    const subreddit = args.subreddit as string | undefined;
    const sort = (args.sort as string) || "relevance";
    const time = (args.time as string) || "all";
    const maxResults = getMaxResults(ctx, args.max_results as number | undefined);
    const timeout = getTimeout(ctx);

    try {
      const base = subreddit
        ? `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json`
        : "https://www.reddit.com/search.json";

      const url = new URL(base);
      url.searchParams.set("q", query);
      url.searchParams.set("sort", sort);
      url.searchParams.set("t", time);
      url.searchParams.set("limit", String(maxResults));
      if (subreddit) url.searchParams.set("restrict_sr", "1");

      await acquireSlot("www.reddit.com");
      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent": "otterbot-deep-research/0.1.0",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) {
        return `Reddit search returned ${res.status}: ${res.statusText}`;
      }

      const data = (await res.json()) as {
        data?: {
          children?: Array<{
            data: {
              title?: string;
              selftext?: string;
              score?: number;
              num_comments?: number;
              url?: string;
              permalink?: string;
              subreddit?: string;
              author?: string;
              created_utc?: number;
            };
          }>;
        };
      };

      const posts = data.data?.children ?? [];
      if (posts.length === 0) return "No Reddit results found.";

      return posts
        .map((post, i) => {
          const d = post.data;
          const permalink = `https://www.reddit.com${d.permalink ?? ""}`;
          const selftext = d.selftext
            ? d.selftext.slice(0, 300) + (d.selftext.length > 300 ? "..." : "")
            : "";
          const date = d.created_utc
            ? new Date(d.created_utc * 1000).toISOString().split("T")[0]
            : "";
          return [
            `${i + 1}. **${d.title ?? "Untitled"}**`,
            `   r/${d.subreddit ?? "?"} | Score: ${d.score ?? 0} | Comments: ${d.num_comments ?? 0} | ${date}`,
            `   ${permalink}`,
            selftext ? `   ${selftext}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error("search_reddit failed:", err);
      return `Reddit search error: ${message}`;
    }
  },
};

// ─── 3. search_hackernews ───────────────────────────────────────────────────

export const searchHackerNewsTool: ModuleToolDefinition = {
  name: "search_hackernews",
  description:
    "Search Hacker News for tech discussions, startup news, and developer opinions. " +
    "HN often surfaces expert technical analysis and early discussions of emerging topics.",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
    sort: {
      type: "string",
      description: "Sort by: relevance or date (default: relevance)",
      required: false,
    },
    max_results: {
      type: "number",
      description: "Max results (default 10)",
      required: false,
    },
  },

  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const query = args.query as string;
    const sort = (args.sort as string) || "relevance";
    const maxResults = getMaxResults(ctx, args.max_results as number | undefined);
    const timeout = getTimeout(ctx);

    try {
      const endpoint =
        sort === "date"
          ? "https://hn.algolia.com/api/v1/search_by_date"
          : "https://hn.algolia.com/api/v1/search";

      const url = new URL(endpoint);
      url.searchParams.set("query", query);
      url.searchParams.set("tags", "story");
      url.searchParams.set("hitsPerPage", String(maxResults));

      await acquireSlot("hn.algolia.com");
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) {
        return `Hacker News search returned ${res.status}: ${res.statusText}`;
      }

      const data = (await res.json()) as {
        hits?: Array<{
          title?: string;
          url?: string;
          points?: number;
          num_comments?: number;
          author?: string;
          objectID?: string;
          created_at?: string;
        }>;
      };

      const hits = data.hits ?? [];
      if (hits.length === 0) return "No Hacker News results found.";

      return hits
        .map((hit, i) => {
          const hnLink = `https://news.ycombinator.com/item?id=${hit.objectID ?? ""}`;
          const date = hit.created_at
            ? hit.created_at.split("T")[0]
            : "";
          return [
            `${i + 1}. **${hit.title ?? "Untitled"}**`,
            `   Points: ${hit.points ?? 0} | Comments: ${hit.num_comments ?? 0} | by ${hit.author ?? "?"} | ${date}`,
            hit.url ? `   Article: ${hit.url}` : "",
            `   Discussion: ${hnLink}`,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error("search_hackernews failed:", err);
      return `Hacker News search error: ${message}`;
    }
  },
};

// ─── 4. search_twitter ──────────────────────────────────────────────────────

export const searchTwitterTool: ModuleToolDefinition = {
  name: "search_twitter",
  description:
    "Search X/Twitter for tweets and discussions. Uses the Twitter API v2 " +
    "if a Bearer Token is configured, otherwise falls back to web search " +
    "with a site:twitter.com filter.",
  parameters: {
    query: {
      type: "string",
      description: "Search query (supports Twitter search operators)",
      required: true,
    },
    max_results: {
      type: "number",
      description: "Max results 10-100 (default 20)",
      required: false,
    },
  },

  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const query = args.query as string;
    const maxResults = Math.min(
      Math.max((args.max_results as number) || 20, 10),
      100,
    );
    const timeout = getTimeout(ctx);
    const bearerToken = ctx.getConfig("twitter_bearer_token");

    // Fallback to web search if no token
    if (!bearerToken) {
      ctx.log("No Twitter Bearer Token — falling back to web search");
      try {
        const fallbackQuery = `${query} site:twitter.com OR site:x.com`;
        const response = await webSearch(fallbackQuery, maxResults, ctx);
        const header =
          "*Note: Results from web search (no Twitter API token configured)*\n\n";
        return header + formatSearchResults(response.results, response.provider);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Twitter web search fallback error: ${message}`;
      }
    }

    try {
      const url = new URL(
        "https://api.twitter.com/2/tweets/search/recent",
      );
      url.searchParams.set("query", query);
      url.searchParams.set("max_results", String(maxResults));
      url.searchParams.set(
        "tweet.fields",
        "created_at,public_metrics,author_id",
      );
      url.searchParams.set("expansions", "author_id");
      url.searchParams.set("user.fields", "username,name");

      await acquireSlot("api.twitter.com");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return `Twitter API returned ${res.status}: ${body.slice(0, 200)}`;
      }

      const data = (await res.json()) as {
        data?: Array<{
          id?: string;
          text?: string;
          created_at?: string;
          author_id?: string;
          public_metrics?: {
            like_count?: number;
            retweet_count?: number;
            reply_count?: number;
          };
        }>;
        includes?: {
          users?: Array<{
            id?: string;
            username?: string;
            name?: string;
          }>;
        };
        meta?: { result_count?: number };
      };

      const tweets = data.data ?? [];
      if (tweets.length === 0) return "No tweets found.";

      // Build author lookup
      const authors = new Map<string, string>();
      for (const user of data.includes?.users ?? []) {
        if (user.id && user.username) {
          authors.set(user.id, user.username);
        }
      }

      return tweets
        .map((tweet, i) => {
          const username = tweet.author_id
            ? authors.get(tweet.author_id) ?? "unknown"
            : "unknown";
          const metrics = tweet.public_metrics;
          const date = tweet.created_at
            ? tweet.created_at.split("T")[0]
            : "";
          const tweetUrl = `https://x.com/${username}/status/${tweet.id ?? ""}`;
          return [
            `${i + 1}. @${username} (${date})`,
            `   ${tweet.text ?? ""}`,
            `   Likes: ${metrics?.like_count ?? 0} | RTs: ${metrics?.retweet_count ?? 0} | Replies: ${metrics?.reply_count ?? 0}`,
            `   ${tweetUrl}`,
          ].join("\n");
        })
        .join("\n\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error("search_twitter failed:", err);
      return `Twitter search error: ${message}`;
    }
  },
};

// ─── 5. fetch_page ──────────────────────────────────────────────────────────

export const fetchPageTool: ModuleToolDefinition = {
  name: "fetch_page",
  description:
    "Fetch a web page and extract its readable text content. Use this to " +
    "read articles, blog posts, documentation, and other web pages found " +
    "via search. Automatically strips navigation, ads, and boilerplate.",
  parameters: {
    url: { type: "string", description: "URL to fetch", required: true },
    store_as_finding: {
      type: "boolean",
      description:
        "Store extracted content in knowledge base for future reference (default: true)",
      required: false,
    },
    topic: {
      type: "string",
      description: "Research topic/tag for categorizing the finding",
      required: false,
    },
  },

  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const url = args.url as string;
    const storeAsFinding = (args.store_as_finding as boolean) !== false; // default true
    const topic = (args.topic as string) || undefined;
    const timeout = getTimeout(ctx);
    const maxLength = getMaxPageLength(ctx);

    try {
      // SSRF protection
      await validateUrlForSsrf(url);

      const hostname = new URL(url).hostname;
      await acquireSlot(hostname);

      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; otterbot-deep-research/0.1.0)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      });

      if (!res.ok) {
        return `Failed to fetch ${url}: HTTP ${res.status} ${res.statusText}`;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml") &&
        !contentType.includes("text/plain")
      ) {
        return `Cannot extract text from ${url}: content-type is ${contentType}`;
      }

      const html = await res.text();
      const { title, content } = extractReadableContent(html, maxLength);

      if (!content || content.length < 50) {
        return `Could not extract readable content from ${url} (page may require JavaScript rendering)`;
      }

      // Optionally store in knowledge base
      if (storeAsFinding) {
        const id = `finding:page:${Buffer.from(url).toString("base64url").slice(0, 64)}`;
        const fullContent = title
          ? `# ${title}\n\nSource: ${url}\n\n${content}`
          : `Source: ${url}\n\n${content}`;
        await ctx.knowledge.upsert(id, fullContent, {
          url,
          title,
          topic,
          source_type: "web_page",
          fetched_at: new Date().toISOString(),
        });
      }

      const header = title ? `# ${title}\n\n` : "";
      return `${header}Source: ${url}\n\n${content}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error("fetch_page failed:", err);
      return `Fetch error for ${url}: ${message}`;
    }
  },
};

// ─── 6. fetch_reddit_thread ─────────────────────────────────────────────────

export const fetchRedditThreadTool: ModuleToolDefinition = {
  name: "fetch_reddit_thread",
  description:
    "Fetch a Reddit thread with its top comments. Use this to read full " +
    "discussions found via search_reddit. Provides the post content plus " +
    "community responses.",
  parameters: {
    url: {
      type: "string",
      description: "Reddit thread URL (any reddit.com URL)",
      required: true,
    },
    comment_limit: {
      type: "number",
      description: "Max top-level comments to include (default 15)",
      required: false,
    },
    store_as_finding: {
      type: "boolean",
      description: "Store in knowledge base (default: true)",
      required: false,
    },
    topic: {
      type: "string",
      description: "Research topic tag",
      required: false,
    },
  },

  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const rawUrl = args.url as string;
    const commentLimit = (args.comment_limit as number) || 15;
    const storeAsFinding = (args.store_as_finding as boolean) !== false;
    const topic = (args.topic as string) || undefined;
    const timeout = getTimeout(ctx);

    try {
      // Normalize to JSON endpoint
      let jsonUrl = rawUrl.replace(/\?.*$/, "");
      if (!jsonUrl.endsWith(".json")) {
        jsonUrl = jsonUrl.replace(/\/$/, "") + ".json";
      }
      // Ensure it's a reddit.com URL
      const parsed = new URL(jsonUrl);
      if (
        !parsed.hostname.endsWith("reddit.com") &&
        !parsed.hostname.endsWith("redd.it")
      ) {
        return "Error: URL must be a reddit.com link";
      }
      parsed.searchParams.set("limit", String(commentLimit));
      parsed.searchParams.set("sort", "top");

      await acquireSlot("www.reddit.com");
      const res = await fetch(parsed.toString(), {
        headers: {
          "User-Agent": "otterbot-deep-research/0.1.0",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) {
        return `Failed to fetch Reddit thread: HTTP ${res.status}`;
      }

      const data = (await res.json()) as Array<{
        data?: {
          children?: Array<{
            kind?: string;
            data: {
              title?: string;
              selftext?: string;
              author?: string;
              score?: number;
              num_comments?: number;
              subreddit?: string;
              created_utc?: number;
              permalink?: string;
              body?: string;
              replies?: {
                data?: {
                  children?: Array<{
                    kind?: string;
                    data: {
                      body?: string;
                      author?: string;
                      score?: number;
                    };
                  }>;
                };
              };
            };
          }>;
        };
      }>;

      if (!Array.isArray(data) || data.length < 1) {
        return "Could not parse Reddit thread data";
      }

      // Post data
      const post = data[0]?.data?.children?.[0]?.data;
      if (!post) return "Could not find post data";

      const lines: string[] = [];
      lines.push(`# ${post.title ?? "Untitled"}`);
      lines.push(
        `r/${post.subreddit ?? "?"} | by u/${post.author ?? "?"} | Score: ${post.score ?? 0} | ${post.num_comments ?? 0} comments`,
      );
      lines.push("");
      if (post.selftext) {
        lines.push(post.selftext.slice(0, 3000));
        if (post.selftext.length > 3000) lines.push("[Post truncated]");
        lines.push("");
      }

      // Comments
      const comments = data[1]?.data?.children ?? [];
      const realComments = comments.filter((c) => c.kind === "t1");

      if (realComments.length > 0) {
        lines.push("---");
        lines.push("## Top Comments");
        lines.push("");

        for (const comment of realComments.slice(0, commentLimit)) {
          const c = comment.data;
          lines.push(
            `**u/${c.author ?? "?"}** (Score: ${c.score ?? 0})`,
          );
          const body = c.body ?? "";
          lines.push(
            body.slice(0, 1000) + (body.length > 1000 ? "..." : ""),
          );

          // One level of replies
          const replies = c.replies?.data?.children ?? [];
          const realReplies = replies.filter((r) => r.kind === "t1");
          for (const reply of realReplies.slice(0, 3)) {
            const r = reply.data;
            const replyBody = r.body ?? "";
            lines.push(
              `  > **u/${r.author ?? "?"}** (Score: ${r.score ?? 0}): ${replyBody.slice(0, 500)}${replyBody.length > 500 ? "..." : ""}`,
            );
          }
          lines.push("");
        }
      }

      const fullContent = lines.join("\n");

      // Optionally store
      if (storeAsFinding) {
        const postId =
          post.permalink?.split("/comments/")?.[1]?.split("/")?.[0] ??
          Buffer.from(rawUrl).toString("base64url").slice(0, 32);
        const id = `finding:reddit:${postId}`;
        await ctx.knowledge.upsert(id, fullContent, {
          url: rawUrl,
          title: post.title,
          topic,
          source_type: "reddit_thread",
          subreddit: post.subreddit,
          score: post.score,
          num_comments: post.num_comments,
          fetched_at: new Date().toISOString(),
        });
      }

      return fullContent;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error("fetch_reddit_thread failed:", err);
      return `Reddit thread fetch error: ${message}`;
    }
  },
};

// ─── 7. save_finding ────────────────────────────────────────────────────────

export const saveFindingTool: ModuleToolDefinition = {
  name: "save_finding",
  description:
    "Save a research finding, synthesis, or note to the knowledge base. " +
    "Use this to store your analysis, key insights, or summaries that " +
    "combine information from multiple sources.",
  parameters: {
    id: {
      type: "string",
      description:
        "Unique ID for this finding (e.g. 'synthesis:topic-name', 'insight:key-point')",
      required: true,
    },
    content: {
      type: "string",
      description: "The finding content (markdown supported)",
      required: true,
    },
    topic: {
      type: "string",
      description: "Research topic for categorization",
      required: false,
    },
    sources: {
      type: "string",
      description: "Comma-separated source URLs",
      required: false,
    },
  },

  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const id = args.id as string;
    const content = args.content as string;
    const topic = (args.topic as string) || undefined;
    const sources = (args.sources as string) || undefined;

    try {
      await ctx.knowledge.upsert(id, content, {
        topic,
        sources: sources?.split(",").map((s) => s.trim()),
        source_type: "synthesis",
        saved_at: new Date().toISOString(),
      });

      return `Finding saved with ID: ${id}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error("save_finding failed:", err);
      return `Error saving finding: ${message}`;
    }
  },
};

// ─── 8. search_findings ─────────────────────────────────────────────────────

// ─── 9. list_research_subjects ──────────────────────────────────────────────

export const listResearchSubjectsTool: ModuleToolDefinition = {
  name: "list_research_subjects",
  description:
    "List configured background research subjects with finding counts " +
    "and poll status. Shows which subjects are being autonomously monitored.",
  parameters: {},

  async execute(_args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const subjectsRaw = ctx.getConfig("research_subjects");
    if (!subjectsRaw?.trim()) {
      return "No research subjects configured. Set the `research_subjects` config to a comma-separated list of topics.";
    }

    const subjects = subjectsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Get poll state
    let lastSubjectIndex = 0;
    let lastPolledAt: string | null = null;
    try {
      const row = ctx.knowledge.db
        .prepare("SELECT last_subject_index, last_polled_at FROM poll_state WHERE id = 1")
        .get() as { last_subject_index: number; last_polled_at: string | null } | undefined;
      if (row) {
        lastSubjectIndex = row.last_subject_index;
        lastPolledAt = row.last_polled_at;
      }
    } catch {
      // Table may not exist yet if migration hasn't run
    }

    // Count findings per subject
    const lines: string[] = ["## Monitored Research Subjects\n"];

    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i];
      const isNext = i === lastSubjectIndex;
      const marker = isNext ? " ← next" : "";

      // Search for findings related to this subject
      let count = 0;
      try {
        const results = await ctx.knowledge.search(subject, 50);
        count = results.filter(
          (doc) => doc.metadata?.subject === subject && doc.metadata?.source === "poll",
        ).length;
      } catch {
        // Ignore search errors
      }

      lines.push(`${i + 1}. **${subject}**${marker} — ${count} finding${count !== 1 ? "s" : ""}`);
    }

    lines.push("");
    lines.push(`**Last polled:** ${lastPolledAt ?? "never"}`);
    lines.push(`**Sources:** ${ctx.getConfig("poll_sources") || "web,reddit,hackernews"}`);
    lines.push(`**Max results per source:** ${ctx.getConfig("max_poll_results_per_source") || "5"}`);

    return lines.join("\n");
  },
};

export const searchFindingsTool: ModuleToolDefinition = {
  name: "search_findings",
  description:
    "Search past research findings stored in the knowledge base. " +
    "Use this to check if a topic has been researched before or to find " +
    "previously gathered information.",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
    topic: {
      type: "string",
      description: "Filter by research topic",
      required: false,
    },
    limit: {
      type: "number",
      description: "Max results (default 10)",
      required: false,
    },
  },

  async execute(args: Record<string, unknown>, ctx: ModuleContext): Promise<string> {
    const query = args.query as string;
    const topic = args.topic as string | undefined;
    const limit = (args.limit as number) || 10;

    try {
      const results = await ctx.knowledge.search(query, limit);

      if (results.length === 0) {
        return "No past research findings match this query.";
      }

      // Filter by topic if specified
      const filtered = topic
        ? results.filter((doc) => doc.metadata?.topic === topic)
        : results;

      if (filtered.length === 0) {
        return `No findings match topic "${topic}". Found ${results.length} results without topic filter.`;
      }

      return filtered
        .map((doc) => {
          const meta = doc.metadata;
          const topicTag = meta?.topic ? ` [${meta.topic}]` : "";
          const sourceType = meta?.source_type
            ? ` (${meta.source_type})`
            : "";
          const url = meta?.url ? `\nSource: ${meta.url}` : "";
          const savedAt = meta?.saved_at || meta?.fetched_at || doc.updatedAt;
          return `---${topicTag}${sourceType}\nID: ${doc.id}\nDate: ${savedAt}${url}\n\n${doc.content.slice(0, 500)}${doc.content.length > 500 ? "..." : ""}`;
        })
        .join("\n\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.error("search_findings failed:", err);
      return `Search findings error: ${message}`;
    }
  },
};
