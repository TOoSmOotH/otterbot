import {
  type CheckState,
  type FetchFn,
  type Forge,
  type ForgeAccount,
  type ForgeIssue,
  type ForgePullRequest,
  type ForgeRepo,
  type ForgeReview,
  type OpenPrOptions,
  splitRepo,
  tokenizeUrl,
} from "./forge.js";

/** GitHub (or GitHub Enterprise) forge. baseUrl defaults to https://api.github.com. */
export class GitHubForge implements Forge {
  readonly provider = "github" as const;
  private readonly base: string;
  constructor(
    readonly account: ForgeAccount,
    private readonly fetchFn: FetchFn = fetch
  ) {
    this.base = (account.baseUrl || "https://api.github.com").replace(/\/$/, "");
  }

  private async api(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.account.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "otterbot",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async getRepo(repo: string): Promise<ForgeRepo> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(`/repos/${owner}/${name}`)) as {
      default_branch: string;
      clone_url: string;
      html_url: string;
    };
    return { owner, name, defaultBranch: d.default_branch, cloneUrl: d.clone_url, htmlUrl: d.html_url };
  }

  async createRepo(repo: string, opts: { private?: boolean; description?: string } = {}): Promise<ForgeRepo> {
    const name = repo.includes("/") ? splitRepo(repo).name : repo;
    const d = (await this.api(`/user/repos`, {
      method: "POST",
      body: JSON.stringify({ name, private: opts.private ?? true, description: opts.description ?? "" }),
    })) as { owner: { login: string }; name: string; default_branch: string; clone_url: string; html_url: string };
    return {
      owner: d.owner.login,
      name: d.name,
      defaultBranch: d.default_branch || "main",
      cloneUrl: d.clone_url,
      htmlUrl: d.html_url,
    };
  }

  authedCloneUrl(repo: string): string {
    const { owner, name } = splitRepo(repo);
    // Derive the git host from the API base: api.github.com → github.com;
    // GitHub Enterprise (https://HOST/api/v3) → HOST.
    const host = this.base.includes("api.github.com") ? "github.com" : new URL(this.base).host;
    return tokenizeUrl(`https://${host}/${owner}/${name}.git`, "x-access-token", this.account.token);
  }

  async openPullRequest(opts: OpenPrOptions): Promise<ForgePullRequest> {
    const { owner, name } = splitRepo(opts.repo);
    const d = (await this.api(`/repos/${owner}/${name}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: opts.title, body: opts.body, head: opts.head, base: opts.base }),
    })) as { number: number; html_url: string; state: string; merged?: boolean; head: { ref: string; sha: string } };
    return {
      number: d.number,
      htmlUrl: d.html_url,
      state: d.state,
      merged: Boolean(d.merged),
      headBranch: d.head?.ref ?? opts.head,
      headSha: d.head?.sha ?? null,
    };
  }

  async getPullRequest(repo: string, number: number): Promise<ForgePullRequest> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(`/repos/${owner}/${name}/pulls/${number}`)) as {
      number: number;
      html_url: string;
      state: string;
      merged: boolean;
      head: { ref: string; sha: string };
    };
    return {
      number: d.number,
      htmlUrl: d.html_url,
      state: d.state,
      merged: Boolean(d.merged),
      headBranch: d.head?.ref ?? "",
      headSha: d.head?.sha ?? null,
    };
  }

  async listReviews(repo: string, number: number): Promise<ForgeReview[]> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(`/repos/${owner}/${name}/pulls/${number}/reviews`)) as Array<{
      id: number;
      state: string;
      user: { login: string };
    }>;
    return d.map((r) => ({ id: r.id, state: r.state.toUpperCase(), author: r.user?.login ?? "" }));
  }

  async checkState(repo: string, ref: string): Promise<CheckState> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(`/repos/${owner}/${name}/commits/${ref}/check-runs`)) as {
      check_runs: Array<{ status: string; conclusion: string | null }>;
    };
    const runs = d.check_runs ?? [];
    if (runs.length === 0) return "none";
    if (runs.some((r) => r.status !== "completed")) return "pending";
    if (runs.some((r) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion)))
      return "failure";
    return "success";
  }

  async listAssignedIssues(repo: string): Promise<ForgeIssue[]> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(
      `/repos/${owner}/${name}/issues?state=open&assignee=${encodeURIComponent(this.account.username)}&per_page=30`
    )) as Array<{ number: number; title: string; body: string | null; user: { login: string }; html_url: string; pull_request?: unknown }>;
    // The issues endpoint also returns PRs; drop those.
    return d
      .filter((i) => !i.pull_request)
      .map((i) => ({ number: i.number, title: i.title, body: i.body ?? "", author: i.user?.login ?? "", htmlUrl: i.html_url }));
  }

  async commentIssue(repo: string, number: number, body: string): Promise<void> {
    const { owner, name } = splitRepo(repo);
    await this.api(`/repos/${owner}/${name}/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }
}
