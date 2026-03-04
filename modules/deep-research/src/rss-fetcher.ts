/**
 * Lightweight RSS/Atom feed parser.
 *
 * Uses regex-based XML extraction (no DOM parser dependency),
 * consistent with the content-extractor pattern in this module.
 */

import { validateUrlForSsrf } from "./ssrf.js";
import { acquireSlot } from "./rate-limiter.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author?: string;
}

export interface FeedResult {
  feedTitle: string;
  feedUrl: string;
  items: FeedItem[];
}

// ─── XML helpers ────────────────────────────────────────────────────────────

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function getTagContent(xml: string, tag: string): string {
  // Handle CDATA sections
  const cdataRe = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`,
    "i",
  );
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(re);
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

function getAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, "i");
  const match = xml.match(re);
  return match ? decodeXmlEntities(match[1]) : "";
}

function getAllMatches(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`,
    "gi",
  );
  return [...xml.matchAll(re)].map((m) => m[0]);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Feed detection ─────────────────────────────────────────────────────────

function isAtomFeed(xml: string): boolean {
  return /<feed[\s>]/i.test(xml);
}

// ─── RSS parser ─────────────────────────────────────────────────────────────

function parseRss(xml: string, feedUrl: string): FeedResult {
  const channelMatch = xml.match(/<channel>([\s\S]*?)<\/channel>/i);
  const channel = channelMatch ? channelMatch[1] : xml;

  const feedTitle = getTagContent(channel, "title") || feedUrl;

  const items = getAllMatches(xml, "item").map((itemXml, i) => {
    const title = getTagContent(itemXml, "title") || "Untitled";
    const link = getTagContent(itemXml, "link") || "";
    const description = stripHtml(
      getTagContent(itemXml, "description") ||
        getTagContent(itemXml, "content:encoded") ||
        "",
    );
    const pubDate =
      getTagContent(itemXml, "pubDate") ||
      getTagContent(itemXml, "dc:date") ||
      "";
    const author =
      getTagContent(itemXml, "author") ||
      getTagContent(itemXml, "dc:creator") ||
      undefined;
    const guid = getTagContent(itemXml, "guid") || link || `item-${i}`;

    return {
      id: guid,
      title,
      link,
      description: description.slice(0, 1000),
      pubDate,
      author,
    };
  });

  return { feedTitle, feedUrl, items };
}

// ─── Atom parser ────────────────────────────────────────────────────────────

function parseAtom(xml: string, feedUrl: string): FeedResult {
  const feedTitle = getTagContent(xml, "title") || feedUrl;

  const items = getAllMatches(xml, "entry").map((entryXml, i) => {
    const title = getTagContent(entryXml, "title") || "Untitled";
    const link =
      getAttr(entryXml, "link", "href") ||
      getTagContent(entryXml, "link") ||
      "";
    const description = stripHtml(
      getTagContent(entryXml, "summary") ||
        getTagContent(entryXml, "content") ||
        "",
    );
    const pubDate =
      getTagContent(entryXml, "published") ||
      getTagContent(entryXml, "updated") ||
      "";
    const author = getTagContent(entryXml, "name") || undefined;
    const id = getTagContent(entryXml, "id") || link || `entry-${i}`;

    return {
      id,
      title,
      link,
      description: description.slice(0, 1000),
      pubDate,
      author,
    };
  });

  return { feedTitle, feedUrl, items };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch and parse an RSS or Atom feed.
 */
export async function fetchRssFeed(
  feedUrl: string,
  options: { timeout?: number; maxItems?: number } = {},
): Promise<FeedResult> {
  const { timeout = 15_000, maxItems = 50 } = options;

  await validateUrlForSsrf(feedUrl);

  const hostname = new URL(feedUrl).hostname;
  await acquireSlot(hostname);

  const res = await fetch(feedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; otterbot-deep-research/0.1.0)",
      Accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Feed returned HTTP ${res.status}: ${res.statusText}`);
  }

  const xml = await res.text();

  if (!xml.includes("<") || xml.length < 50) {
    throw new Error("Response does not appear to be valid XML");
  }

  const result = isAtomFeed(xml)
    ? parseAtom(xml, feedUrl)
    : parseRss(xml, feedUrl);

  if (maxItems > 0 && result.items.length > maxItems) {
    result.items = result.items.slice(0, maxItems);
  }

  return result;
}
