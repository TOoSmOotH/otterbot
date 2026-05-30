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

/**
 * Gitea forge. `account.baseUrl` is the instance root (e.g. https://gitea.lan);
 * the REST API lives under `/api/v1`. Auth uses Gitea's `token <token>` scheme.
 */
export class GiteaForge implements Forge {
  readonly provider = "gitea" as const;
  private readonly root: string;
  constructor(
    readonly account: ForgeAccount,
    private readonly fetchFn: FetchFn = fetch
  ) {
    this.root = (account.baseUrl || "").replace(/\/$/, "");
    if (!this.root) throw new Error("Gitea account needs a baseUrl (instance URL).");
  }

  private async api(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.fetchFn(`${this.root}/api/v1${path}`, {
      ...init,
      headers: {
        Authorization: `token ${this.account.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Gitea ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async getRepo(repo: string): Promise<ForgeRepo> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(`/repos/${owner}/${name}`)) as {
      default_branch: string;
      clone_url: string;
      ssh_url: string;
      html_url: string;
    };
    return {
      owner,
      name,
      defaultBranch: d.default_branch,
      cloneUrl: d.clone_url,
      sshUrl: d.ssh_url ?? null,
      htmlUrl: d.html_url,
    };
  }

  async createRepo(repo: string, opts: { private?: boolean; description?: string } = {}): Promise<ForgeRepo> {
    const name = repo.includes("/") ? splitRepo(repo).name : repo;
    const d = (await this.api(`/user/repos`, {
      method: "POST",
      body: JSON.stringify({ name, private: opts.private ?? true, description: opts.description ?? "", auto_init: true }),
    })) as {
      owner: { login: string };
      name: string;
      default_branch: string;
      clone_url: string;
      ssh_url: string;
      html_url: string;
    };
    return {
      owner: d.owner.login,
      name: d.name,
      defaultBranch: d.default_branch || "main",
      cloneUrl: d.clone_url,
      sshUrl: d.ssh_url ?? null,
      htmlUrl: d.html_url,
    };
  }

  async forkRepo(repo: string): Promise<ForgeRepo> {
    const { name } = splitRepo(repo);
    try {
      const d = (await this.api(`/repos/${splitRepo(repo).owner}/${name}/forks`, {
        method: "POST",
        body: JSON.stringify({}),
      })) as {
        owner: { login: string };
        name: string;
        default_branch: string;
        clone_url: string;
        ssh_url: string;
        html_url: string;
      };
      return {
        owner: d.owner.login,
        name: d.name,
        defaultBranch: d.default_branch || "main",
        cloneUrl: d.clone_url,
        sshUrl: d.ssh_url ?? null,
        htmlUrl: d.html_url,
      };
    } catch (err) {
      // Gitea returns 409 when the fork already exists; fall back to the
      // existing fork under the account's user.
      if (err instanceof Error && /Gitea 409/.test(err.message)) {
        return this.getRepo(`${this.account.username}/${name}`);
      }
      throw err;
    }
  }

  authedCloneUrl(repo: string): string {
    const { owner, name } = splitRepo(repo);
    const host = new URL(this.root).host;
    return tokenizeUrl(`https://${host}/${owner}/${name}.git`, this.account.username || "git", this.account.token);
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
    return d.map((r) => ({ id: r.id, state: (r.state || "").toUpperCase(), author: r.user?.login ?? "" }));
  }

  async checkState(repo: string, ref: string): Promise<CheckState> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(`/repos/${owner}/${name}/commits/${ref}/status`)) as {
      state: string; // success | pending | failure | error | warning
      statuses?: unknown[];
    };
    if (!d.statuses || d.statuses.length === 0) return "none";
    if (d.state === "success") return "success";
    if (d.state === "pending") return "pending";
    return "failure";
  }

  async listAssignedIssues(repo: string): Promise<ForgeIssue[]> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(
      `/repos/${owner}/${name}/issues?state=open&type=issues&limit=30`
    )) as Array<{
      number: number;
      title: string;
      body: string | null;
      user: { login: string };
      html_url: string;
      assignees?: Array<{ login: string }> | null;
    }>;
    const me = this.account.username.toLowerCase();
    return d
      .filter((i) => (i.assignees ?? []).some((a) => a.login.toLowerCase() === me))
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
