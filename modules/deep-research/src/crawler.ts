/**
 * Site crawler — BFS crawl of a documentation site with optional
 * sitemap.xml discovery, SSRF protection, and rate limiting.
 */

import type { ModuleContext } from "@otterbot/shared";
import { extractReadableContent } from "./content-extractor.js";
import { validateUrlForSsrf } from "./ssrf.js";
import { acquireSlot } from "./rate-limiter.js";

// File extensions to skip (binary / non-content resources)
const SKIP_EXTENSIONS = new Set([
  ".pdf", ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".webm",
  ".woff", ".woff2", ".ttf", ".eot",
  ".css", ".js", ".mjs", ".map",
  ".xml", ".json", ".rss", ".atom",
]);

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  skipSitemap: boolean;
  topic?: string;
}

export interface CrawlResult {
  pagesStored: number;
  pagesFailed: number;
  pagesSkipped: number;
  urls: string[];
}

interface QueueEntry {
  url: string;
  depth: number;
}

/**
 * Generate a deterministic dedup ID for a crawled page.
 */
function crawlPageId(url: string): string {
  return `crawl:page:${Buffer.from(url).toString("base64url").slice(0, 64)}`;
}

/**
 * Check whether a URL looks like a content page we should crawl.
 */
function isContentUrl(href: string): boolean {
  try {
    const u = new URL(href);
    const ext = u.pathname.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
    if (ext && SKIP_EXTENSIONS.has(ext)) return false;
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract <a href="..."> links from raw HTML and resolve them
 * against the page URL. Returns only absolute HTTP(S) URLs.
 */
function discoverLinks(html: string, pageUrl: string): string[] {
  const links: string[] = [];
  const re = /<a[^>]+href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const href = match[1];
    // Skip fragment-only and javascript: links
    if (href.startsWith("#") || href.startsWith("javascript:")) continue;

    try {
      const resolved = new URL(href, pageUrl).href;
      // Strip fragments
      const noFrag = resolved.split("#")[0];
      if (isContentUrl(noFrag)) {
        links.push(noFrag);
      }
    } catch {
      // Malformed URL — skip
    }
  }

  return links;
}

/**
 * Try to fetch and parse sitemap.xml at the domain root. Returns
 * discovered URLs that match the given path prefix.
 *
 * Also follows one level of sitemap index (<sitemap> entries).
 */
async function fetchSitemapUrls(
  origin: string,
  pathPrefix: string,
  timeout: number,
  ctx: ModuleContext,
): Promise<string[]> {
  const urls: string[] = [];
  const sitemapUrl = `${origin}/sitemap.xml`;

  try {
    const hostname = new URL(sitemapUrl).hostname;
    await acquireSlot(hostname);

    const res = await fetch(sitemapUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; otterbot-deep-research/0.1.0)",
        Accept: "application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });

    if (!res.ok) return urls;

    const xml = await res.text();

    // Check for sitemap index — extract child sitemap URLs
    const sitemapEntries: string[] = [];
    const sitemapRe = /<sitemap>\s*<loc>\s*(.*?)\s*<\/loc>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = sitemapRe.exec(xml)) !== null) {
      sitemapEntries.push(sm[1]);
    }

    // Extract <loc> from the main sitemap
    const locRe = /<url>\s*<loc>\s*(.*?)\s*<\/loc>/gi;
    let loc: RegExpExecArray | null;
    while ((loc = locRe.exec(xml)) !== null) {
      urls.push(loc[1]);
    }

    // Follow child sitemaps (one level deep, limit to 3)
    for (const childUrl of sitemapEntries.slice(0, 3)) {
      try {
        const childHost = new URL(childUrl).hostname;
        await acquireSlot(childHost);

        const childRes = await fetch(childUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; otterbot-deep-research/0.1.0)",
            Accept: "application/xml, text/xml, */*",
          },
          signal: AbortSignal.timeout(timeout),
          redirect: "follow",
        });

        if (!childRes.ok) continue;

        const childXml = await childRes.text();
        let childLoc: RegExpExecArray | null;
        const childLocRe = /<url>\s*<loc>\s*(.*?)\s*<\/loc>/gi;
        while ((childLoc = childLocRe.exec(childXml)) !== null) {
          urls.push(childLoc[1]);
        }
      } catch {
        ctx.log(`Failed to fetch child sitemap: ${childUrl}`);
      }
    }
  } catch {
    ctx.log("No sitemap.xml found or failed to parse");
  }

  // Filter to URLs matching origin + path prefix
  return urls.filter((u) => {
    try {
      const parsed = new URL(u);
      return (
        parsed.origin === origin &&
        parsed.pathname.startsWith(pathPrefix) &&
        isContentUrl(u)
      );
    } catch {
      return false;
    }
  });
}

/**
 * Crawl a site starting from `baseUrl` using BFS.
 *
 * - Optionally fetches sitemap.xml for efficient discovery
 * - Only follows links within the same origin + path prefix
 * - Stores each page in the knowledge store with crawl:page: IDs
 * - Respects rate limiting via acquireSlot
 */
export async function crawlSite(
  baseUrl: string,
  options: CrawlOptions,
  ctx: ModuleContext,
): Promise<CrawlResult> {
  const { maxPages, maxDepth, skipSitemap, topic } = options;
  const maxPageLength = Number(ctx.getConfig("max_page_content_length")) || 15_000;
  const timeout = Number(ctx.getConfig("request_timeout_ms")) || 15_000;

  const parsed = new URL(baseUrl);
  const origin = parsed.origin;
  // Path prefix: e.g. /docs/v2/ — use the directory part of the base URL
  const pathPrefix = parsed.pathname.endsWith("/")
    ? parsed.pathname
    : parsed.pathname.replace(/\/[^/]*$/, "/");

  const visited = new Set<string>();
  const queue: QueueEntry[] = [];
  const result: CrawlResult = {
    pagesStored: 0,
    pagesFailed: 0,
    pagesSkipped: 0,
    urls: [],
  };

  // Normalize URL for dedup: strip trailing slash, fragment
  function normalize(url: string): string {
    const u = new URL(url);
    u.hash = "";
    // Remove trailing slash except for root
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  }

  // Check if URL is in scope
  function inScope(url: string): boolean {
    try {
      const u = new URL(url);
      return u.origin === origin && u.pathname.startsWith(pathPrefix);
    } catch {
      return false;
    }
  }

  // Enqueue a URL if not already visited and in scope
  function enqueue(url: string, depth: number): void {
    const norm = normalize(url);
    if (visited.has(norm)) return;
    if (!inScope(norm)) return;
    if (depth > maxDepth) return;
    visited.add(norm);
    queue.push({ url: norm, depth });
  }

  // Seed the queue
  if (!skipSitemap) {
    ctx.log(`Checking sitemap.xml for ${origin}...`);
    const sitemapUrls = await fetchSitemapUrls(origin, pathPrefix, timeout, ctx);
    if (sitemapUrls.length > 0) {
      ctx.log(`Found ${sitemapUrls.length} URLs in sitemap matching path prefix`);
      for (const url of sitemapUrls) {
        enqueue(url, 0);
      }
    } else {
      ctx.log("No matching sitemap URLs found, starting from base URL");
      enqueue(baseUrl, 0);
    }
  } else {
    enqueue(baseUrl, 0);
  }

  // BFS loop
  while (queue.length > 0 && result.pagesStored < maxPages) {
    const entry = queue.shift()!;

    try {
      // SSRF validation
      await validateUrlForSsrf(entry.url);

      // Rate limit
      const hostname = new URL(entry.url).hostname;
      await acquireSlot(hostname);

      // Fetch
      const res = await fetch(entry.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; otterbot-deep-research/0.1.0)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      });

      if (!res.ok) {
        ctx.log(`Skipping ${entry.url}: HTTP ${res.status}`);
        result.pagesFailed++;
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml")
      ) {
        result.pagesSkipped++;
        continue;
      }

      const html = await res.text();

      // Extract content
      const { title, content } = extractReadableContent(html, maxPageLength);

      if (!content || content.length < 50) {
        result.pagesSkipped++;
        continue;
      }

      // Store in knowledge base
      const id = crawlPageId(entry.url);
      const fullContent = title
        ? `# ${title}\n\nSource: ${entry.url}\n\n${content}`
        : `Source: ${entry.url}\n\n${content}`;

      await ctx.knowledge.upsert(id, fullContent, {
        source_type: "crawl",
        crawl_base: baseUrl,
        url: entry.url,
        title,
        topic,
        depth: entry.depth,
        crawled_at: new Date().toISOString(),
      });

      result.pagesStored++;
      result.urls.push(entry.url);

      // Discover links from the HTML (only if we haven't hit max depth)
      if (entry.depth < maxDepth) {
        const links = discoverLinks(html, entry.url);
        for (const link of links) {
          enqueue(link, entry.depth + 1);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log(`Error crawling ${entry.url}: ${message}`);
      result.pagesFailed++;
    }
  }

  return result;
}
