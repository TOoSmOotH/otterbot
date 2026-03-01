/**
 * Background polling handler for autonomous deep research.
 *
 * Periodically searches configured sources for configured subjects,
 * returning PollResultItems that the module scheduler automatically
 * ingests into the knowledge store (deduped by ID).
 *
 * Operates on a time budget (default 5 min), cycling through all
 * subjects with multiple query variations and full-page content
 * extraction for top results.
 */

import type { ModuleContext, PollResult, PollResultItem } from "@otterbot/shared";
import { search as webSearch } from "./search-providers.js";
import { extractReadableContent } from "./content-extractor.js";
import { validateUrlForSsrf } from "./ssrf.js";
import { acquireSlot } from "./rate-limiter.js";
import { crawlSite } from "./crawler.js";

// ─── Types ──────────────────────────────────────────────────────────────────

type SourceType = "web" | "reddit" | "hackernews" | "twitter";

interface RawResult {
  id: string;
  title: string;
  snippet: string;
  url: string;
  sourceType: SourceType;
}

// ─── Time-budget helpers ────────────────────────────────────────────────────

function isTimeUp(deadline: number): boolean {
  return Date.now() >= deadline;
}

/**
 * Generate multiple query variations for a subject to get broader coverage.
 */
function generateQueryVariations(subject: string): string[] {
  const year = new Date().getFullYear();
  return [
    subject,
    `${subject} tutorial guide`,
    `${subject} latest news updates ${year}`,
    `${subject} best practices tips`,
  ];
}

/**
 * Check whether a URL looks like a documentation site worth crawling.
 */
function isDocsUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /\/(docs?|guide|wiki|manual|reference|learn|tutorial|handbook)\b/i.test(pathname);
  } catch {
    return false;
  }
}

// ─── Full-page fetch helper ─────────────────────────────────────────────────

/**
 * Fetch a single URL, extract readable content, and return a PollResultItem.
 * Returns null if the URL is invalid, non-HTML, too short, or already seen.
 */
async function fetchAndStoreFullPage(
  url: string,
  subject: string,
  ctx: ModuleContext,
  seenUrls: Set<string>,
): Promise<PollResultItem | null> {
  if (seenUrls.has(url)) return null;
  seenUrls.add(url);

  const timeout = Number(ctx.getConfig("request_timeout_ms")) || 15_000;
  const maxLength = Number(ctx.getConfig("max_page_content_length")) || 15_000;

  try {
    await validateUrlForSsrf(url);

    const hostname = new URL(url).hostname;
    await acquireSlot(hostname);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; otterbot-deep-research/0.1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml") &&
      !contentType.includes("text/plain")
    ) {
      return null;
    }

    const html = await res.text();
    const { title, content } = extractReadableContent(html, maxLength);

    if (!content || content.length < 100) return null;

    const id = `poll:page:${Buffer.from(url).toString("base64url").slice(0, 64)}`;
    const fullContent = title
      ? `# ${title}\n\nSource: ${url}\n\n${content}`
      : `Source: ${url}\n\n${content}`;

    return {
      id,
      title: title || url,
      content: fullContent,
      url,
      metadata: {
        source: "poll",
        source_type: "full_page",
        subject,
        polled_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    ctx.log(`Poll page fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Subject round-robin state ──────────────────────────────────────────────

function getSubjectIndex(subjects: string[], ctx: ModuleContext): number {
  const db = ctx.knowledge.db;

  const row = db
    .prepare("SELECT last_subject_index FROM poll_state WHERE id = 1")
    .get() as { last_subject_index: number } | undefined;

  const lastIndex = row?.last_subject_index ?? 0;
  return lastIndex >= subjects.length ? 0 : lastIndex;
}

function saveSubjectIndex(index: number, ctx: ModuleContext): void {
  ctx.knowledge.db
    .prepare(
      "UPDATE poll_state SET last_subject_index = ?, last_polled_at = ? WHERE id = 1",
    )
    .run(index, new Date().toISOString());
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

  const sourcesRaw = ctx.getConfig("poll_sources") || "web,reddit,hackernews";
  const sources = sourcesRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as SourceType[];

  const maxResultsPerSource =
    Number(ctx.getConfig("max_poll_results_per_source")) || 5;
  const timeBudgetMs =
    Number(ctx.getConfig("poll_time_budget_ms")) || 300_000;
  const fetchTopN =
    Number(ctx.getConfig("poll_fetch_top_n")) || 3;

  const deadline = Date.now() + timeBudgetMs;
  const startIndex = getSubjectIndex(subjects, ctx);
  const allItems: PollResultItem[] = [];
  const seenUrls = new Set<string>();
  let subjectsProcessed = 0;

  ctx.log(`Poll starting: ${subjects.length} subjects, ${timeBudgetMs / 1000}s budget, starting at index ${startIndex}`);

  for (let i = 0; i < subjects.length; i++) {
    if (isTimeUp(deadline)) break;

    const subjectIndex = (startIndex + i) % subjects.length;
    const subject = subjects[subjectIndex];
    ctx.log(`Researching subject: "${subject}"`);

    const queryVariations = generateQueryVariations(subject);
    const subjectResults: RawResult[] = [];

    // ── Phase 1: Search with query variations ──
    for (const query of queryVariations) {
      if (isTimeUp(deadline)) break;

      ctx.log(`  Searching: "${query}"`);

      // Search all sources in parallel for this query
      const resultSets = await Promise.all(
        sources.map((source) => searchSource(source, query, maxResultsPerSource, ctx)),
      );

      const results = resultSets.flat();
      subjectResults.push(...results);

      // Convert search snippets to PollResultItems
      for (const r of results) {
        allItems.push({
          id: r.id,
          title: r.title,
          content: `**${r.title}**\n${r.snippet}\n\nSource: ${r.url}`,
          url: r.url,
          metadata: {
            source: "poll",
            subject,
            source_type: r.sourceType,
            query,
            polled_at: new Date().toISOString(),
          },
        });
      }
    }

    // ── Phase 2: Fetch full page content for top N unique URLs ──
    const uniqueUrls = [...new Set(subjectResults.map((r) => r.url))];
    const urlsToFetch = uniqueUrls
      .filter((u) => !seenUrls.has(u))
      .slice(0, fetchTopN);

    if (urlsToFetch.length > 0) {
      ctx.log(`  Fetching full content for ${urlsToFetch.length} pages`);
    }

    for (const url of urlsToFetch) {
      if (isTimeUp(deadline)) break;

      const pageItem = await fetchAndStoreFullPage(url, subject, ctx, seenUrls);
      if (pageItem) {
        allItems.push(pageItem);
      }
    }

    // ── Phase 3: Crawl documentation sites ──
    if (!isTimeUp(deadline)) {
      const docsUrl = uniqueUrls.find((u) => isDocsUrl(u) && !seenUrls.has(u));
      if (docsUrl) {
        ctx.log(`  Crawling docs site: ${docsUrl}`);
        try {
          const crawlResult = await crawlSite(docsUrl, {
            maxPages: 10,
            maxDepth: 2,
            skipSitemap: false,
            topic: subject,
          }, ctx);
          ctx.log(`  Crawled ${crawlResult.pagesStored} pages from ${docsUrl}`);

          // Add crawled pages as poll items for the summary
          for (const crawledUrl of crawlResult.urls) {
            seenUrls.add(crawledUrl);
            allItems.push({
              id: `poll:crawl:${Buffer.from(crawledUrl).toString("base64url").slice(0, 64)}`,
              title: `Crawled: ${crawledUrl}`,
              content: `Crawled documentation page from ${crawledUrl}`,
              url: crawledUrl,
              metadata: {
                source: "poll",
                source_type: "crawl",
                subject,
                crawl_base: docsUrl,
                polled_at: new Date().toISOString(),
              },
            });
          }
        } catch (err) {
          ctx.log(`  Doc crawl failed for ${docsUrl}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    subjectsProcessed++;

    // Save progress after each subject so interrupted cycles resume correctly
    const nextIndex = (subjectIndex + 1) % subjects.length;
    saveSubjectIndex(nextIndex, ctx);
  }

  const elapsed = Math.round((timeBudgetMs - (deadline - Date.now())) / 1000);
  ctx.log(`Poll complete: ${subjectsProcessed}/${subjects.length} subjects, ${allItems.length} items, ${elapsed}s elapsed`);

  return {
    items: allItems,
    summary: `Researched ${subjectsProcessed} subject(s) — found ${allItems.length} items across ${sources.join(", ")} in ${elapsed}s`,
  };
}
