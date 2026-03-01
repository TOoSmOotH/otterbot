/**
 * Background polling handler for autonomous deep research.
 *
 * Periodically searches configured sources for configured subjects,
 * returning PollResultItems that the module scheduler automatically
 * ingests into the knowledge store (deduped by ID).
 */

import type { ModuleContext, PollResult, PollResultItem } from "@otterbot/shared";
import { search as webSearch } from "./search-providers.js";
import { acquireSlot } from "./rate-limiter.js";

// ─── Types ──────────────────────────────────────────────────────────────────

type SourceType = "web" | "reddit" | "hackernews" | "twitter";

interface RawResult {
  id: string;
  title: string;
  snippet: string;
  url: string;
  sourceType: SourceType;
}

// ─── Subject round-robin state ──────────────────────────────────────────────

function getNextSubject(
  subjects: string[],
  ctx: ModuleContext,
): { subject: string; nextIndex: number } {
  const db = ctx.knowledge.db;

  const row = db
    .prepare("SELECT last_subject_index FROM poll_state WHERE id = 1")
    .get() as { last_subject_index: number } | undefined;

  const lastIndex = row?.last_subject_index ?? 0;
  const index = lastIndex >= subjects.length ? 0 : lastIndex;
  const nextIndex = (index + 1) % subjects.length;

  db.prepare(
    "UPDATE poll_state SET last_subject_index = ?, last_polled_at = ? WHERE id = 1",
  ).run(nextIndex, new Date().toISOString());

  return { subject: subjects[index], nextIndex };
}

// ─── Source search dispatchers ──────────────────────────────────────────────

async function searchWeb(
  subject: string,
  maxResults: number,
  ctx: ModuleContext,
): Promise<RawResult[]> {
  try {
    const response = await webSearch(subject, maxResults, ctx);
    return response.results.map((r) => ({
      id: `poll:web:${Buffer.from(r.url).toString("base64url").slice(0, 64)}`,
      title: r.title,
      snippet: r.snippet,
      url: r.url,
      sourceType: "web" as const,
    }));
  } catch (err) {
    ctx.warn("Poll web search failed:", err);
    return [];
  }
}

async function searchReddit(
  subject: string,
  maxResults: number,
  ctx: ModuleContext,
): Promise<RawResult[]> {
  const timeout = Number(ctx.getConfig("request_timeout_ms")) || 15_000;

  try {
    const url = new URL("https://www.reddit.com/search.json");
    url.searchParams.set("q", subject);
    url.searchParams.set("sort", "new");
    url.searchParams.set("t", "week");
    url.searchParams.set("limit", String(maxResults));

    await acquireSlot("www.reddit.com");
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "otterbot-deep-research/0.1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      ctx.warn(`Poll Reddit search returned ${res.status}`);
      return [];
    }

    const data = (await res.json()) as {
      data?: {
        children?: Array<{
          data: {
            id?: string;
            title?: string;
            selftext?: string;
            url?: string;
            permalink?: string;
            subreddit?: string;
            score?: number;
            num_comments?: number;
            created_utc?: number;
          };
        }>;
      };
    };

    return (data.data?.children ?? []).map((post) => {
      const d = post.data;
      const postId = d.id ?? Buffer.from(d.permalink ?? "").toString("base64url").slice(0, 32);
      const permalink = `https://www.reddit.com${d.permalink ?? ""}`;
      const snippet = d.selftext
        ? d.selftext.slice(0, 300) + (d.selftext.length > 300 ? "..." : "")
        : "";
      return {
        id: `poll:reddit:${postId}`,
        title: d.title ?? "Untitled",
        snippet: `r/${d.subreddit ?? "?"} | Score: ${d.score ?? 0} | Comments: ${d.num_comments ?? 0}\n${snippet}`,
        url: permalink,
        sourceType: "reddit" as const,
      };
    });
  } catch (err) {
    ctx.warn("Poll Reddit search failed:", err);
    return [];
  }
}

async function searchHackerNews(
  subject: string,
  maxResults: number,
  ctx: ModuleContext,
): Promise<RawResult[]> {
  const timeout = Number(ctx.getConfig("request_timeout_ms")) || 15_000;

  try {
    const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
    url.searchParams.set("query", subject);
    url.searchParams.set("tags", "story");
    url.searchParams.set("hitsPerPage", String(maxResults));

    await acquireSlot("hn.algolia.com");
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      ctx.warn(`Poll HN search returned ${res.status}`);
      return [];
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

    return (data.hits ?? []).map((hit) => {
      const hnLink = `https://news.ycombinator.com/item?id=${hit.objectID ?? ""}`;
      return {
        id: `poll:hn:${hit.objectID ?? "unknown"}`,
        title: hit.title ?? "Untitled",
        snippet: `Points: ${hit.points ?? 0} | Comments: ${hit.num_comments ?? 0} | by ${hit.author ?? "?"}`,
        url: hit.url || hnLink,
        sourceType: "hackernews" as const,
      };
    });
  } catch (err) {
    ctx.warn("Poll HN search failed:", err);
    return [];
  }
}

async function searchTwitter(
  subject: string,
  maxResults: number,
  ctx: ModuleContext,
): Promise<RawResult[]> {
  const timeout = Number(ctx.getConfig("request_timeout_ms")) || 15_000;
  const bearerToken = ctx.getConfig("twitter_bearer_token");

  // Fallback to web search with site filter
  if (!bearerToken) {
    try {
      const response = await webSearch(
        `${subject} site:twitter.com OR site:x.com`,
        maxResults,
        ctx,
      );
      return response.results.map((r) => ({
        id: `poll:twitter:${Buffer.from(r.url).toString("base64url").slice(0, 64)}`,
        title: r.title,
        snippet: r.snippet,
        url: r.url,
        sourceType: "twitter" as const,
      }));
    } catch (err) {
      ctx.warn("Poll Twitter web fallback failed:", err);
      return [];
    }
  }

  try {
    const url = new URL("https://api.twitter.com/2/tweets/search/recent");
    url.searchParams.set("query", subject);
    url.searchParams.set("max_results", String(Math.max(maxResults, 10)));
    url.searchParams.set("tweet.fields", "created_at,public_metrics,author_id");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,name");

    await acquireSlot("api.twitter.com");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      ctx.warn(`Poll Twitter API returned ${res.status}`);
      return [];
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
        };
      }>;
      includes?: {
        users?: Array<{ id?: string; username?: string }>;
      };
    };

    const authors = new Map<string, string>();
    for (const user of data.includes?.users ?? []) {
      if (user.id && user.username) authors.set(user.id, user.username);
    }

    return (data.data ?? []).map((tweet) => {
      const username = tweet.author_id
        ? authors.get(tweet.author_id) ?? "unknown"
        : "unknown";
      const tweetUrl = `https://x.com/${username}/status/${tweet.id ?? ""}`;
      return {
        id: `poll:twitter:${tweet.id ?? "unknown"}`,
        title: `@${username}`,
        snippet: tweet.text ?? "",
        url: tweetUrl,
        sourceType: "twitter" as const,
      };
    });
  } catch (err) {
    ctx.warn("Poll Twitter search failed:", err);
    return [];
  }
}

// ─── Source dispatcher ──────────────────────────────────────────────────────

async function searchSource(
  source: SourceType,
  subject: string,
  maxResults: number,
  ctx: ModuleContext,
): Promise<RawResult[]> {
  switch (source) {
    case "web":
      return searchWeb(subject, maxResults, ctx);
    case "reddit":
      return searchReddit(subject, maxResults, ctx);
    case "hackernews":
      return searchHackerNews(subject, maxResults, ctx);
    case "twitter":
      return searchTwitter(subject, maxResults, ctx);
    default:
      ctx.warn(`Unknown poll source: ${source}`);
      return [];
  }
}

// ─── Main poll handler ──────────────────────────────────────────────────────

export async function handlePoll(ctx: ModuleContext): Promise<PollResult> {
  const subjectsRaw = ctx.getConfig("research_subjects");
  if (!subjectsRaw?.trim()) {
    return { items: [] };
  }

  const subjects = subjectsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (subjects.length === 0) {
    return { items: [] };
  }

  const { subject } = getNextSubject(subjects, ctx);
  ctx.log(`Polling research for subject: "${subject}"`);

  const sourcesRaw = ctx.getConfig("poll_sources") || "web,reddit,hackernews";
  const sources = sourcesRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as SourceType[];

  const maxResults =
    Number(ctx.getConfig("max_poll_results_per_source")) || 5;

  // Search all sources in parallel
  const resultSets = await Promise.all(
    sources.map((source) => searchSource(source, subject, maxResults, ctx)),
  );

  const allResults = resultSets.flat();

  // Convert to PollResultItems
  const items: PollResultItem[] = allResults.map((r) => ({
    id: r.id,
    title: r.title,
    content: `**${r.title}**\n${r.snippet}\n\nSource: ${r.url}`,
    url: r.url,
    metadata: {
      source: "poll",
      subject,
      source_type: r.sourceType,
      polled_at: new Date().toISOString(),
    },
  }));

  ctx.log(`Poll complete for "${subject}": ${items.length} items from ${sources.join(", ")}`);

  return {
    items,
    summary: `Researched "${subject}" — found ${items.length} items across ${sources.join(", ")}`,
  };
}
