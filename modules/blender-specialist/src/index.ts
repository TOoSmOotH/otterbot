import { defineModule, type ModuleContext, type PollResult, type PollResultItem } from "@otterbot/shared";
import { migration001 } from "./migrations/001-initial.js";

const AGENT_PROMPT = `You are a Blender Specialist Agent focused on 3D modeling and practical production workflows.

Your role:
- Learn continuously from internet sources about Blender modeling techniques.
- Use retrieved knowledge to improve speed, mesh quality, and reliability over time.
- Help execute modeling tasks with the Blender MCP server tools available to the host system.

Operating procedure:
1. For a new task, search existing module knowledge first (knowledge_search / search_knowledge).
2. If needed, use search_web_blender and read_url to gather additional context.
3. Convert findings into actionable steps with tradeoffs and pitfalls.
4. When Blender MCP tools are available, call them to perform or guide concrete modeling operations.
5. Save important lessons using save_blender_finding so future jobs improve.

Blender quality standards:
- Prefer non-destructive workflows (modifiers, instances) where practical.
- Keep transforms clean, object names meaningful, and topology intentional.
- Mention polycount/topology concerns and whether geometry is game-ready.
- Highlight if UVs, normals, and scale conventions need cleanup.

When answering:
- Be specific and procedural.
- Include source links for external claims.
- End with a short "next iteration improvements" section.`;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function getListConfig(ctx: ModuleContext, key: string): string[] {
  const raw = ctx.getConfig(key)?.trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchDuckDuckGo(query: string, maxResults = 5): Promise<SearchResult[]> {
  const endpoint = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(endpoint, {
    headers: {
      "user-agent": "otterbot-blender-specialist/0.1",
    },
  });

  if (!res.ok) throw new Error(`DuckDuckGo search failed (${res.status})`);

  const html = await res.text();
  const results: SearchResult[] = [];
  const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) && results.length < maxResults) {
    const rawHref = match[1] ?? "";
    const title = stripHtml(match[2] ?? "");
    const url = decodeURIComponent(rawHref).replace(/^\/l\/\?kh=-1&uddg=/, "");

    if (!url.startsWith("http")) continue;
    results.push({ title, url, snippet: "" });
  }

  return results;
}

async function fetchPageExcerpt(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": "otterbot-blender-specialist/0.1",
    },
  });

  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);

  const html = await res.text();
  const text = stripHtml(html);
  return text.slice(0, 3000);
}

async function pollSearchQueries(ctx: ModuleContext): Promise<PollResultItem[]> {
  const queries = getListConfig(ctx, "research_queries");
  const maxPerQuery = Number(ctx.getConfig("results_per_query") ?? "3");

  const items: PollResultItem[] = [];

  for (const query of queries) {
    try {
      const results = await searchDuckDuckGo(`${query} Blender`, Math.max(1, Math.min(maxPerQuery, 10)));
      for (const result of results) {
        const id = `search:${query}:${result.url}`;
        items.push({
          id,
          title: result.title || `Blender result for ${query}`,
          content: `Query: ${query}\nURL: ${result.url}\nTitle: ${result.title}`,
          url: result.url,
          metadata: {
            source: "duckduckgo",
            query,
          },
        });
      }
    } catch (err) {
      ctx.warn(`Search failed for query "${query}":`, err);
    }
  }

  return items;
}

export default defineModule({
  manifest: {
    id: "blender-specialist",
    name: "Blender Specialist",
    version: "0.1.0",
    description:
      "Specialist agent that researches Blender modeling practices and builds reusable knowledge for Blender MCP-assisted model creation.",
    author: "Otterbot",
  },

  agent: {
    defaultName: "Blender Specialist Agent",
    defaultPrompt: AGENT_PROMPT,
  },

  configSchema: {
    research_queries: {
      type: "string",
      description:
        "Newline-separated Blender topics to monitor (e.g. hard surface topology, retopology workflow, UV packing best practices).",
      required: false,
      default: "hard surface topology\nretopology workflow\nblender modifier stack best practices",
    },
    results_per_query: {
      type: "number",
      description: "How many search results to ingest per research query on each poll (1-10).",
      required: false,
      default: 3,
    },
    blender_mcp_server_name: {
      type: "string",
      description:
        "Optional MCP server name for Blender; used in guidance when calling tools named like mcp_<server>_<tool>.",
      required: false,
      default: "blender",
    },
  },

  tools: [
    {
      name: "search_web_blender",
      description: "Search the web for Blender-specific topics using DuckDuckGo.",
      parameters: {
        query: { type: "string", description: "Search query", required: true },
        maxResults: { type: "number", description: "Maximum results (1-10)", required: false },
      },
      async execute(args) {
        const query = String(args.query ?? "").trim();
        const maxResults = Number(args.maxResults ?? 5);
        if (!query) return "Query is required.";

        const results = await searchDuckDuckGo(query, Math.max(1, Math.min(maxResults, 10)));
        if (results.length === 0) return "No results found.";

        return results
          .map((r, i) => `${i + 1}. ${r.title || "Untitled"}\n${r.url}`)
          .join("\n\n");
      },
    },
    {
      name: "read_url",
      description: "Fetch and summarize readable text from a URL.",
      parameters: {
        url: { type: "string", description: "URL to fetch", required: true },
      },
      async execute(args) {
        const url = String(args.url ?? "").trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          return "URL must start with http:// or https://";
        }

        const excerpt = await fetchPageExcerpt(url);
        return excerpt || "No readable text found.";
      },
    },
    {
      name: "save_blender_finding",
      description: "Save a reusable Blender workflow finding into specialist knowledge.",
      parameters: {
        title: { type: "string", description: "Finding title", required: true },
        content: { type: "string", description: "Detailed finding content", required: true },
        sourceUrl: { type: "string", description: "Optional source URL", required: false },
      },
      async execute(args, ctx) {
        const title = String(args.title ?? "").trim();
        const content = String(args.content ?? "").trim();
        const sourceUrl = args.sourceUrl ? String(args.sourceUrl) : undefined;

        if (!title || !content) return "Both title and content are required.";

        const id = `finding:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${Date.now()}`;
        await ctx.knowledge.upsert(id, `# ${title}\n\n${content}`, {
          type: "blender-finding",
          sourceUrl,
        });

        return `Saved finding \"${title}\".`;
      },
    },
    {
      name: "blender_mcp_tooling_hint",
      description: "Explain how to identify and call Blender MCP tools in this environment.",
      parameters: {},
      async execute(_args, ctx) {
        const serverName = ctx.getConfig("blender_mcp_server_name") ?? "blender";
        return [
          `Configured Blender MCP server hint: ${serverName}`,
          "MCP tool names follow: mcp_<serverName>_<toolName>.",
          "If tool invocation fails, verify the server is installed/enabled and that the sanitized server name matches.",
          "Start with discovery/list tools, then use primitive operations (create object, transform, boolean/modifier, material, export).",
        ].join("\n");
      },
    },
  ],

  triggers: [{ type: "poll", intervalMs: 60 * 60 * 1000, minIntervalMs: 5 * 60 * 1000 }],
  migrations: [migration001],

  async onPoll(ctx): Promise<PollResult> {
    const items = await pollSearchQueries(ctx);
    return {
      items,
      summary: items.length > 0 ? `Indexed ${items.length} Blender research items` : "No new Blender research items",
    };
  },

  async onQuery(query, ctx): Promise<string> {
    const hits = await ctx.knowledge.search(query, 8);
    if (hits.length === 0) {
      return "No saved Blender knowledge found yet. Use search_web_blender and save_blender_finding to build expertise.";
    }

    return hits
      .map((h, i) => `## Result ${i + 1}\n${h.content}`)
      .join("\n\n");
  },

  async onLoad(ctx) {
    ctx.log("Blender Specialist module loaded");
  },
});
