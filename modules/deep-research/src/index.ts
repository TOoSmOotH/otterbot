import { defineModule, type ModuleContext } from "@otterbot/shared";
import { migration001 } from "./migrations/001-initial.js";
import { migration002 } from "./migrations/002-poll-state.js";
import {
  webSearchTool,
  searchRedditTool,
  searchHackerNewsTool,
  searchTwitterTool,
  fetchPageTool,
  fetchRedditThreadTool,
  saveFindingTool,
  searchFindingsTool,
  listResearchSubjectsTool,
} from "./tools.js";
import { handlePoll } from "./poll-handler.js";

// ─── Agent system prompt ────────────────────────────────────────────────────

const AGENT_PROMPT = `You are a Deep Research Agent — an autonomous research specialist that becomes an expert on whatever topic the user asks about.

## Research Methodology

When given a research question, follow this systematic approach:

1. **Understand the question**: Identify the core topic, key entities, and what kind of information would best answer it. Consider multiple angles.

2. **Plan your search strategy**: Think about which sources will have the best information:
   - web_search: General information, news, articles, documentation
   - search_reddit: Community opinions, personal experiences, reviews, niche expertise
   - search_hackernews: Technical analysis, startup/tech discussions, engineering perspectives
   - search_twitter: Breaking news, real-time reactions, expert commentary, trending discussions

3. **Execute searches iteratively**:
   - Start broad, then narrow based on findings
   - Use different query phrasings to surface diverse results
   - Try source-specific searches (Reddit is great for "best X for Y", HN for technical depth)
   - Use search operators when helpful (site:, quotes for exact phrases)

4. **Read the most promising sources**: Use fetch_page to read full articles, and fetch_reddit_thread for Reddit discussions. Not every search result needs to be read — focus on the most relevant and authoritative.

5. **Synthesize and store**: Use save_finding to record key insights and your synthesis. This builds a knowledge base for follow-up questions.

6. **Present your report**: Deliver a comprehensive, well-structured research report with:
   - Executive summary
   - Key findings organized by theme
   - Specific facts, data points, and quotes with source attribution
   - Areas of consensus and disagreement across sources
   - Gaps in knowledge or areas needing further research
   - Source list

## Tool Usage Guidelines

- Always search at least 2-3 different sources for comprehensive coverage
- Read full articles for the most important/relevant search results (use fetch_page)
- Store important findings as you go with save_finding — don't wait until the end
- Check search_findings first if the user asks about something you may have researched before
- Use the knowledge_search tool to recall previously stored information
- For controversial topics, actively seek multiple viewpoints

## Quality Standards

- Distinguish between facts, expert opinions, and anecdotes
- Note when information is dated or may be outdated
- Flag when sources disagree and explain the different positions
- Be transparent about the limitations of your research
- Cite sources inline using [Source Name](URL) format

## Follow-up Questions

When the user asks follow-up questions:
- Check your existing findings first (search_findings / knowledge_search)
- Only search for new information if needed
- Build on previous research rather than starting from scratch

## Accumulated Research Knowledge

This agent periodically researches configured subjects in the background.
When asked about a topic, ALWAYS check search_findings first — there may
already be accumulated research from background polling.
Use list_research_subjects to see which topics are being monitored.`;

// ─── Module definition ──────────────────────────────────────────────────────

export default defineModule({
  manifest: {
    id: "deep-research",
    name: "Deep Research",
    version: "0.1.0",
    description:
      "Autonomous research agent that becomes an expert on any topic by " +
      "searching the web, Reddit, X/Twitter, Hacker News, and other sources",
    author: "Otterbot",
  },

  agent: {
    defaultName: "Deep Research Agent",
    defaultPrompt: AGENT_PROMPT,
  },

  configSchema: {
    search_provider: {
      type: "select",
      description:
        "Search provider for web searches (uses system default if not set)",
      required: false,
      default: "system",
      options: [
        { value: "system", label: "Use system search provider" },
        { value: "duckduckgo", label: "DuckDuckGo (free)" },
        { value: "brave", label: "Brave Search" },
        { value: "tavily", label: "Tavily (best for research)" },
        { value: "searxng", label: "SearXNG (self-hosted)" },
      ],
    },
    brave_api_key: {
      type: "secret",
      description:
        "Brave Search API key (overrides system key for this module)",
      required: false,
      showWhen: { field: "search_provider", value: "brave" },
    },
    tavily_api_key: {
      type: "secret",
      description:
        "Tavily API key (overrides system key for this module)",
      required: false,
      showWhen: { field: "search_provider", value: "tavily" },
    },
    searxng_base_url: {
      type: "string",
      description:
        "SearXNG instance base URL (overrides system URL for this module)",
      required: false,
      showWhen: { field: "search_provider", value: "searxng" },
    },
    twitter_bearer_token: {
      type: "secret",
      description: "X/Twitter API v2 Bearer Token for searching tweets",
      required: false,
    },
    max_search_results: {
      type: "number",
      description: "Max results per search query (default 10)",
      required: false,
      default: 10,
    },
    max_page_content_length: {
      type: "number",
      description:
        "Max characters to extract from a single web page (default 15000)",
      required: false,
      default: 15000,
    },
    request_timeout_ms: {
      type: "number",
      description: "HTTP request timeout in milliseconds (default 15000)",
      required: false,
      default: 15000,
    },
    research_subjects: {
      type: "string",
      description:
        "Comma-separated subjects to autonomously research in the background " +
        '(e.g. "tacos, machine learning, rust programming")',
      required: false,
    },
    poll_sources: {
      type: "string",
      description:
        "Comma-separated sources to search during background polls: " +
        "web, reddit, hackernews, twitter (default: web,reddit,hackernews)",
      required: false,
      default: "web,reddit,hackernews",
    },
    max_poll_results_per_source: {
      type: "number",
      description: "Max search results per source per poll cycle (default 5)",
      required: false,
      default: 5,
    },
    agent_posting_mode: {
      type: "select",
      description:
        "How the agent posts messages — 'respond' for direct queries only, " +
        "'background' to also share notable background research findings",
      required: false,
      default: "respond",
      options: [
        { value: "respond", label: "Only respond to queries" },
        { value: "background", label: "Also share background findings" },
      ],
    },
  },

  triggers: [{ type: "poll", intervalMs: 3_600_000, minIntervalMs: 300_000 }],

  migrations: [migration001, migration002],

  tools: [
    webSearchTool,
    searchRedditTool,
    searchHackerNewsTool,
    searchTwitterTool,
    fetchPageTool,
    fetchRedditThreadTool,
    saveFindingTool,
    searchFindingsTool,
    listResearchSubjectsTool,
  ],

  onPoll: handlePoll,

  async onQuery(query: string, ctx: ModuleContext): Promise<string> {
    // Handle cross-module queries (e.g. from COO asking about past research)
    const results = await ctx.knowledge.search(query, 5);

    if (results.length === 0) {
      return "No past research findings match this query. Use the Deep Research agent for new research.";
    }

    return results
      .map((doc) => {
        const meta = doc.metadata;
        const topic = meta?.topic ? ` [${meta.topic}]` : "";
        const url = meta?.url ? `\nSource: ${meta.url}` : "";
        return `---${topic}${url}\n${doc.content}\n`;
      })
      .join("\n");
  },

  async onLoad(ctx: ModuleContext): Promise<void> {
    ctx.log("Deep Research module loaded");
    const provider =
      ctx.getConfig("search_provider") || "system";
    ctx.log(`Search provider: ${provider}`);
  },
});
