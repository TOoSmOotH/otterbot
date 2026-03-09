import {
  defineModule,
  type ModuleContext,
  type PollResult,
} from "@otterbot/shared";
import { migration001 } from "./migrations/001-initial.js";

// ─── Module definition ───────────────────────────────────────────────────────

export default defineModule({
  // --- Manifest: identifies this specialist ---
  manifest: {
    id: "CHANGEME",           // unique kebab-case ID
    name: "CHANGEME Name",    // human-readable name
    version: "0.1.0",
    description: "CHANGEME — describe what this specialist does",
    author: "Otterbot",
  },

  // --- Agent: the specialist's AI persona ---
  agent: {
    defaultName: "CHANGEME Agent",
    defaultPrompt: [
      "You are a specialist agent for CHANGEME.",
      "",
      "When answering questions:",
      "- Use the knowledge_search tool to find relevant items",
      "- Provide clear, concise answers with source references",
    ].join("\n"),
  },

  // --- Config: user-provided settings (API keys, URLs, etc.) ---
  configSchema: {
    api_key: {
      type: "secret",
      description: "API key for the external service",
      required: true,
    },
    // Add more config fields as needed:
    // endpoint_url: {
    //   type: "string",
    //   description: "Base URL for the API",
    //   required: false,
    //   default: "https://api.example.com",
    // },
  },

  // --- Tools: custom tools exposed to the specialist's agent ---
  tools: [
    {
      name: "search_items",
      description: "Search items in the knowledge store with filters.",
      parameters: {
        query: { type: "string", description: "Text to search for", required: false },
        limit: { type: "number", description: "Max results (default 10)", required: false },
      },
      async execute(args, ctx) {
        const limit = typeof args.limit === "number" ? Math.min(args.limit, 50) : 10;
        const results = await ctx.knowledge.search(args.query as string ?? "", limit);

        if (results.length === 0) return "No items found.";

        return results
          .map((doc) => `---\n${doc.content}\n`)
          .join("\n");
      },
    },
  ],

  // --- Triggers: how data is ingested ---
  triggers: [
    { type: "poll", intervalMs: 300_000, minIntervalMs: 60_000 }, // every 5 min
  ],

  // --- Migrations: database schema evolution ---
  migrations: [migration001],

  // --- Handlers ---

  async onPoll(ctx): Promise<PollResult> {
    // Fetch new data from your source and return items to index.
    // Each item is automatically stored in the knowledge store.
    //
    // Example:
    // const data = await fetchFromAPI(ctx);
    // const items = data.map(item => ({
    //   id: item.id,
    //   title: item.title,
    //   content: item.content,
    //   url: item.url,
    //   metadata: { author: item.author },
    // }));
    // return { items, summary: `Indexed ${items.length} items` };

    return { items: [], summary: "No items fetched (not yet implemented)" };
  },

  async onQuery(query: string, ctx): Promise<string> {
    // Handle direct queries from other agents.
    const results = await ctx.knowledge.search(query, 5);

    if (results.length === 0) {
      return "No matching items found.";
    }

    return results
      .map((doc) => `---\n${doc.content}\n`)
      .join("\n");
  },

  async onLoad(ctx) {
    ctx.log("CHANGEME module loaded");
  },
});
