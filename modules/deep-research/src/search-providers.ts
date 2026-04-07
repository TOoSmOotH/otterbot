/**
 * Web search provider abstraction for the Deep Research module.
 *
 * Reimplemented from packages/server/src/tools/search/providers.ts
 * because module packages cannot import server internals.
 * Each provider is a simple HTTP call (<30 lines each).
 */

import { execFile } from "node:child_process";
import type { ModuleContext } from "@otterbot/shared";
import { acquireSlot } from "./rate-limiter.js";

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── SearXNG ────────────────────────────────────────────────────────────────

async function searchSearXNG(
  query: string,
  maxResults: number,
  baseUrl: string,
  timeout: number,
): Promise<SearchResponse> {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  await acquireSlot(new URL(baseUrl).hostname);
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(timeout),
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

  return { results, provider: "searxng", query };
}

// ─── Brave Search ───────────────────────────────────────────────────────────

async function searchBrave(
  query: string,
  maxResults: number,
  apiKey: string,
  timeout: number,
): Promise<SearchResponse> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  await acquireSlot("api.search.brave.com");
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(timeout),
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

  return { results, provider: "brave", query };
}

// ─── Tavily ─────────────────────────────────────────────────────────────────

async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string,
  timeout: number,
): Promise<SearchResponse> {
  await acquireSlot("api.tavily.com");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
    signal: AbortSignal.timeout(timeout),
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
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  const results: SearchResult[] = (data.results ?? [])
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
    }));

  return { results, provider: "tavily", query };
}

// ─── DuckDuckGo (free, no API key) ─────────────────────────────────────────
// Uses the `ddgs` Python package which handles DuckDuckGo's bot-detection.

function findPython(): string {
  const venvPy = process.env.VIRTUAL_ENV
    ? `${process.env.VIRTUAL_ENV}/bin/python3`
    : null;
  return venvPy ?? "python3";
}

async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  _timeout: number,
): Promise<SearchResponse> {
  await acquireSlot("duckduckgo.com");

  const python = findPython();
  const script = `
import json, sys
try:
    from ddgs import DDGS
except ImportError:
    from duckduckgo_search import DDGS
results = list(DDGS().text(sys.argv[1], max_results=int(sys.argv[2])))
print(json.dumps(results))
`;

  return new Promise((resolve, reject) => {
    execFile(
      python,
      ["-c", script, query, String(maxResults)],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message;
          reject(new Error(`DuckDuckGo search failed: ${msg}`));
          return;
        }
        try {
          const raw = JSON.parse(stdout) as Array<{
            title?: string;
            href?: string;
            body?: string;
          }>;
          const results: SearchResult[] = raw.map((r) => ({
            title: r.title ?? "",
            url: r.href ?? "",
            snippet: r.body ?? "",
          }));
          resolve({ results, provider: "duckduckgo", query });
        } catch (parseErr) {
          reject(
            new Error(
              `Failed to parse DuckDuckGo results: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
            ),
          );
        }
      },
    );
  });
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Search the web using the module's configured provider.
 * Falls back to system config, then to DuckDuckGo.
 */
export async function search(
  query: string,
  maxResults: number,
  ctx: ModuleContext,
): Promise<SearchResponse> {
  const timeout = Number(ctx.getConfig("request_timeout_ms")) || 15_000;
  const provider = ctx.getConfig("search_provider") || "system";

  // Resolve provider ID
  let providerId = provider;
  if (provider === "system") {
    providerId = ctx.getConfig("search:active_provider") ?? "duckduckgo";
  }

  switch (providerId) {
    case "searxng": {
      const baseUrl =
        ctx.getConfig("searxng_base_url") ??
        ctx.getConfig("search:searxng:base_url");
      if (!baseUrl) {
        ctx.warn("SearXNG base URL not configured, falling back to DuckDuckGo");
        return searchDuckDuckGo(query, maxResults, timeout);
      }
      return searchSearXNG(query, maxResults, baseUrl, timeout);
    }
    case "brave": {
      const apiKey =
        ctx.getConfig("brave_api_key") ??
        ctx.getConfig("search:brave:api_key");
      if (!apiKey) {
        ctx.warn("Brave API key not configured, falling back to DuckDuckGo");
        return searchDuckDuckGo(query, maxResults, timeout);
      }
      return searchBrave(query, maxResults, apiKey, timeout);
    }
    case "tavily": {
      const apiKey =
        ctx.getConfig("tavily_api_key") ??
        ctx.getConfig("search:tavily:api_key");
      if (!apiKey) {
        ctx.warn("Tavily API key not configured, falling back to DuckDuckGo");
        return searchDuckDuckGo(query, maxResults, timeout);
      }
      return searchTavily(query, maxResults, apiKey, timeout);
    }
    case "duckduckgo":
    default:
      return searchDuckDuckGo(query, maxResults, timeout);
  }
}
