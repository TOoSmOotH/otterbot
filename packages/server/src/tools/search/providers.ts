/**
 * Search provider abstraction — SearXNG, Brave Search, and Tavily backends.
 *
 * All providers implement the same interface and are selected via the
 * `search:active_provider` config key.
 */

import { getConfig } from "../../auth/auth.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  provider: string;
  query: string;
}

interface SearchProvider {
  readonly id: string;
  search(query: string, maxResults: number): Promise<SearchResponse>;
}

// ---------------------------------------------------------------------------
// SearXNG
// ---------------------------------------------------------------------------

class SearXNGProvider implements SearchProvider {
  readonly id = "searxng";
  constructor(private baseUrl: string) {}

  async search(query: string, maxResults: number): Promise<SearchResponse> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.text();
        if (body) detail = body.slice(0, 200);
      } catch {}
      throw new Error(`SearXNG returned ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    const results: SearchResult[] = (data.results ?? [])
      .slice(0, maxResults)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      }));

    return { results, provider: this.id, query };
  }
}

// ---------------------------------------------------------------------------
// Brave Search
// ---------------------------------------------------------------------------

class BraveSearchProvider implements SearchProvider {
  readonly id = "brave";
  constructor(private apiKey: string) {}

  async search(query: string, maxResults: number): Promise<SearchResponse> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.text();
        if (body) detail = body.slice(0, 200);
      } catch {}
      throw new Error(`Brave Search returned ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
        }>;
      };
    };

    const results: SearchResult[] = (data.web?.results ?? [])
      .slice(0, maxResults)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
      }));

    return { results, provider: this.id, query };
  }
}

// ---------------------------------------------------------------------------
// Tavily
// ---------------------------------------------------------------------------

class TavilyProvider implements SearchProvider {
  readonly id = "tavily";
  constructor(private apiKey: string) {}

  async search(query: string, maxResults: number): Promise<SearchResponse> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.text();
        if (body) detail = body.slice(0, 200);
      } catch {}
      throw new Error(`Tavily returned ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
      }>;
    };

    const results: SearchResult[] = (data.results ?? [])
      .slice(0, maxResults)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      }));

    return { results, provider: this.id, query };
  }
}

// ---------------------------------------------------------------------------
// DuckDuckGo (free, no API key)
// ---------------------------------------------------------------------------

class DuckDuckGoProvider implements SearchProvider {
  readonly id = "duckduckgo";

  async search(query: string, maxResults: number): Promise<SearchResponse> {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`DuckDuckGo returned ${res.status}: ${res.statusText}`);
    }

    const html = await res.text();
    const results: SearchResult[] = [];

    // Parse result blocks: each is a <div class="result ..."> containing
    // an <a class="result__a"> (title + URL) and <a class="result__snippet"> (snippet).
    const blockRe = /<div[^>]+class="[^"]*result [^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]+class="[^"]*result |$)/g;
    let block: RegExpExecArray | null;
    while ((block = blockRe.exec(html)) !== null && results.length < maxResults) {
      const inner = block[1];

      // Title + URL from <a class="result__a" href="...">Title</a>
      const linkMatch = inner.match(
        /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/,
      );
      if (!linkMatch) continue;

      let url = linkMatch[1];
      // DuckDuckGo wraps URLs in a redirect; extract the real one
      const uddgMatch = url.match(/[?&]uddg=([^&]+)/);
      if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);

      const title = linkMatch[2].replace(/<[^>]*>/g, "").trim();

      // Snippet from <a class="result__snippet" ...>
      const snippetMatch = inner.match(
        /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/,
      );
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<[^>]*>/g, "").trim()
        : "";

      if (url && title) {
        results.push({ title, url, snippet });
      }
    }

    return { results, provider: this.id, query };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getConfiguredSearchProvider(): SearchProvider | null {
  const activeId = getConfig("search:active_provider");
  if (!activeId) return null;

  switch (activeId) {
    case "duckduckgo":
      return new DuckDuckGoProvider();
    case "searxng": {
      const baseUrl = getConfig("search:searxng:base_url");
      if (!baseUrl) return null;
      return new SearXNGProvider(baseUrl);
    }
    case "brave": {
      const apiKey = getConfig("search:brave:api_key");
      if (!apiKey) return null;
      return new BraveSearchProvider(apiKey);
    }
    case "tavily": {
      const apiKey = getConfig("search:tavily:api_key");
      if (!apiKey) return null;
      return new TavilyProvider(apiKey);
    }
    default:
      return null;
  }
}
