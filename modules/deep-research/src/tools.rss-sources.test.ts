import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRssTool, listSourcesTool } from "./tools.js";
import type { ModuleContext } from "@otterbot/shared";

const fetchRssFeedMock = vi.hoisted(() => vi.fn());

vi.mock("./rss-fetcher.js", () => ({
  fetchRssFeed: fetchRssFeedMock,
}));

function createContext(config: Record<string, string | undefined> = {}): ModuleContext {
  return {
    getConfig: (key: string) => config[key],
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    knowledge: {
      db: {
        prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
        exec: vi.fn(),
        transaction: vi.fn((fn: () => unknown) => fn) as never,
      },
      upsert: vi.fn(async () => {}),
      search: vi.fn(async () => []),
      delete: vi.fn(),
      get: vi.fn(() => null),
      count: vi.fn(() => 0),
    },
  };
}

describe("listSourcesTool", () => {
  it("lists configured rss feeds, urls, and subjects", async () => {
    const ctx = createContext({
      rss_feeds: "https://a.example/feed\n https://b.example/atom ",
      research_urls: "https://docs.example.com\nhttps://status.example.com",
      research_subjects: "ai safety, rss aggregation",
      poll_sources: "web,reddit,hackernews,twitter",
    });

    const out = await listSourcesTool.execute({}, ctx);

    expect(out).toContain("### RSS Feeds (2)");
    expect(out).toContain("- https://a.example/feed");
    expect(out).toContain("- https://b.example/atom");
    expect(out).toContain("### Monitored URLs (2)");
    expect(out).toContain("### Research Subjects (2)");
    expect(out).toContain("### Active Poll Sources");
    expect(out).toContain("web,reddit,hackernews,twitter");
  });

  it("shows empty-state sections and default poll sources", async () => {
    const ctx = createContext({});

    const out = await listSourcesTool.execute({}, ctx);

    expect(out).toContain("### RSS Feeds\nNone configured.");
    expect(out).toContain("### Monitored URLs\nNone configured.");
    expect(out).toContain("### Research Subjects\nNone configured.");
    expect(out).toContain("web,reddit,hackernews");
  });
});

describe("fetchRssTool", () => {
  beforeEach(() => {
    fetchRssFeedMock.mockReset();
  });

  it("fetches feed items, stores them in knowledge, and formats output", async () => {
    fetchRssFeedMock.mockResolvedValue({
      feedTitle: "Security Feed",
      feedUrl: "https://feeds.example.com/security",
      items: [
        {
          id: "item-1",
          title: "First item",
          link: "https://example.com/1",
          description: "desc one",
          pubDate: "2026-03-01T12:00:00Z",
          author: "Alice",
        },
        {
          id: "item-2",
          title: "Second item",
          link: "https://example.com/2",
          description: "desc two",
          pubDate: "2026-03-02T12:00:00Z",
        },
      ],
    });

    const ctx = createContext({ request_timeout_ms: "12000" });

    const out = await fetchRssTool.execute(
      { url: "https://feeds.example.com/security", max_items: 2, topic: "threat-intel" },
      ctx,
    );

    expect(fetchRssFeedMock).toHaveBeenCalledWith(
      "https://feeds.example.com/security",
      { timeout: 12000, maxItems: 2 },
    );
    expect(ctx.knowledge.upsert).toHaveBeenCalledTimes(2);

    const firstUpsertCall = (ctx.knowledge.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstUpsertCall[1]).toContain("# First item");
    expect(firstUpsertCall[2]).toMatchObject({
      source_type: "rss",
      feed_url: "https://feeds.example.com/security",
      feed_title: "Security Feed",
      topic: "threat-intel",
      url: "https://example.com/1",
      title: "First item",
      pub_date: "2026-03-01T12:00:00Z",
    });

    expect(out).toContain("## Security Feed");
    expect(out).toContain("Items: 2");
    expect(out).toContain("Stored 2 items in knowledge base.");
  });

  it("returns a readable error when feed fetching fails", async () => {
    fetchRssFeedMock.mockRejectedValue(new Error("bad feed"));
    const ctx = createContext();

    const out = await fetchRssTool.execute({ url: "https://bad.example/rss" }, ctx);

    expect(out).toContain("RSS fetch error for https://bad.example/rss: bad feed");
    expect(ctx.knowledge.upsert).not.toHaveBeenCalled();
  });
});
