import { describe, it, expect } from "vitest";
import { GitHubForge } from "./github.js";
import { GiteaForge } from "./gitea.js";
import { tokenizeUrl, splitRepo, type ForgeAccount } from "./forge.js";

/** A fake fetch that records calls and returns canned JSON per URL substring. */
function fakeFetch(routes: Array<{ match: string; status?: number; body: unknown; capture?: (init?: RequestInit) => void }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const route = routes.find((r) => u.includes(r.match));
    if (!route) return new Response("not mocked", { status: 404 });
    route.capture?.(init);
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ghAccount: ForgeAccount = {
  id: "a1",
  provider: "github",
  label: "gh",
  baseUrl: "https://api.github.com",
  token: "ghtok",
  username: "bot",
  gitTransport: "https",
  committerName: "",
  committerEmail: "",
  signCommits: false,
};

const giteaAccount: ForgeAccount = {
  id: "a2",
  provider: "gitea",
  label: "gt",
  baseUrl: "https://gitea.lan",
  token: "gttok",
  username: "bot",
  gitTransport: "https",
  committerName: "",
  committerEmail: "",
  signCommits: false,
};

describe("helpers", () => {
  it("splitRepo + tokenizeUrl", () => {
    expect(splitRepo("owner/name")).toEqual({ owner: "owner", name: "name" });
    expect(splitRepo("o/n.git")).toEqual({ owner: "o", name: "n" });
    expect(tokenizeUrl("https://github.com/o/n.git", "x-access-token", "T")).toBe(
      "https://x-access-token:T@github.com/o/n.git"
    );
  });
});

describe("GitHubForge", () => {
  it("getRepo parses default branch + urls and sends a bearer token", async () => {
    let seenAuth = "";
    const { fn } = fakeFetch([
      {
        match: "/repos/o/n",
        body: { default_branch: "main", clone_url: "https://github.com/o/n.git", html_url: "https://github.com/o/n" },
        capture: (init) => {
          seenAuth = String((init?.headers as Record<string, string>)?.Authorization);
        },
      },
    ]);
    const repo = await new GitHubForge(ghAccount, fn).getRepo("o/n");
    expect(repo.defaultBranch).toBe("main");
    expect(repo.cloneUrl).toBe("https://github.com/o/n.git");
    expect(seenAuth).toBe("Bearer ghtok");
  });

  it("opens a pull request", async () => {
    let body: unknown;
    const { fn } = fakeFetch([
      {
        match: "/pulls",
        body: { number: 7, html_url: "https://github.com/o/n/pull/7", state: "open", head: { ref: "feat", sha: "abc" } },
        capture: (init) => {
          body = JSON.parse(String(init?.body));
        },
      },
    ]);
    const pr = await new GitHubForge(ghAccount, fn).openPullRequest({
      repo: "o/n",
      title: "t",
      body: "b",
      head: "feat",
      base: "main",
    });
    expect(pr.number).toBe(7);
    expect(pr.headSha).toBe("abc");
    expect(body).toMatchObject({ head: "feat", base: "main", title: "t" });
  });

  it("aggregates check-runs into a single state", async () => {
    const make = (runs: Array<{ status: string; conclusion: string | null }>) =>
      fakeFetch([{ match: "/check-runs", body: { check_runs: runs } }]).fn;
    const forge = (fn: typeof fetch) => new GitHubForge(ghAccount, fn);
    expect(await forge(make([])).checkState("o/n", "sha")).toBe("none");
    expect(await forge(make([{ status: "in_progress", conclusion: null }])).checkState("o/n", "s")).toBe("pending");
    expect(await forge(make([{ status: "completed", conclusion: "failure" }])).checkState("o/n", "s")).toBe("failure");
    expect(await forge(make([{ status: "completed", conclusion: "success" }])).checkState("o/n", "s")).toBe("success");
  });

  it("filters PRs out of the assigned-issues list", async () => {
    const { fn } = fakeFetch([
      {
        match: "/issues",
        body: [
          { number: 1, title: "bug", body: "x", user: { login: "u" }, html_url: "h1" },
          { number: 2, title: "pr", body: "y", user: { login: "u" }, html_url: "h2", pull_request: {} },
        ],
      },
    ]);
    const issues = await new GitHubForge(ghAccount, fn).listAssignedIssues("o/n");
    expect(issues.map((i) => i.number)).toEqual([1]);
  });

  it("builds an authed clone url", () => {
    expect(new GitHubForge(ghAccount, fetch).authedCloneUrl("o/n")).toBe(
      "https://x-access-token:ghtok@github.com/o/n.git"
    );
  });
});

describe("GiteaForge", () => {
  it("uses /api/v1 + token auth and parses the commit status", async () => {
    let seenAuth = "";
    const { fn, calls } = fakeFetch([
      {
        match: "/api/v1/repos/o/n/commits/sha/status",
        body: { state: "success", statuses: [{}] },
        capture: (init) => {
          seenAuth = String((init?.headers as Record<string, string>)?.Authorization);
        },
      },
    ]);
    const state = await new GiteaForge(giteaAccount, fn).checkState("o/n", "sha");
    expect(state).toBe("success");
    expect(seenAuth).toBe("token gttok");
    expect(calls[0].url).toContain("/api/v1/");
  });

  it("filters assigned issues by the bot's username", async () => {
    const { fn } = fakeFetch([
      {
        match: "/issues",
        body: [
          { number: 1, title: "mine", body: "", user: { login: "u" }, html_url: "h", assignees: [{ login: "bot" }] },
          { number: 2, title: "theirs", body: "", user: { login: "u" }, html_url: "h", assignees: [{ login: "alice" }] },
        ],
      },
    ]);
    const issues = await new GiteaForge(giteaAccount, fn).listAssignedIssues("o/n");
    expect(issues.map((i) => i.number)).toEqual([1]);
  });

  it("builds an authed clone url from the instance host", () => {
    expect(new GiteaForge(giteaAccount, fetch).authedCloneUrl("o/n")).toBe(
      "https://bot:gttok@gitea.lan/o/n.git"
    );
  });
});
