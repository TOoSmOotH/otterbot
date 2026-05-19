/**
 * Keyless web search via DuckDuckGo's HTML endpoint. No API key — DuckDuckGo
 * offers no official search API, so this parses the public HTML SERP. It is an
 * unofficial route and can be rate-limited; failures are surfaced, not thrown
 * past the tool layer.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const ENDPOINT = "https://html.duckduckgo.com/html/";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0";

/** Decode a handful of HTML entities and strip tags from a result fragment. */
function clean(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

/** DuckDuckGo wraps result links in a `/l/?uddg=<encoded>` redirect. */
function resolveUrl(href: string): string {
  const h = href.replace(/&amp;/g, "&");
  const m = h.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return "";
    }
  }
  if (h.startsWith("//")) return "https:" + h;
  return h;
}

/** Search the web with DuckDuckGo. Returns up to `limit` results. */
export async function searchWeb(query: string, limit = 8): Promise<WebSearchResult[]> {
  const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(query)}&kl=us-en`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`DuckDuckGo returned ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  const linkRe = /<a\b[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a\b[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const links = [...html.matchAll(linkRe)];
  const snippets = [...html.matchAll(snipRe)];

  const results: WebSearchResult[] = [];
  for (let i = 0; i < links.length && results.length < limit; i++) {
    const url = resolveUrl(links[i][1]);
    const title = clean(links[i][2]);
    if (!url || !title) continue;
    results.push({ title, url, snippet: snippets[i] ? clean(snippets[i][1]) : "" });
  }
  return results;
}
