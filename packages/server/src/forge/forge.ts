/**
 * Forge abstraction: the git host a project lives on. GitHub and Gitea differ in
 * base URL, auth header, and a few payload shapes, but the pipeline and monitors
 * only need this common surface — so they stay forge-agnostic.
 */

export type ForgeProvider = "github" | "gitea";

/** Injectable fetch so the implementations are unit-testable. */
export type FetchFn = typeof fetch;

export interface ForgeAccount {
  id: string;
  provider: ForgeProvider;
  label: string;
  /** API base, e.g. https://api.github.com or https://gitea.example.com. */
  baseUrl: string;
  token: string;
  /** The bot's username on the forge (for assignment detection + clone URLs). */
  username: string;
  /** How git transport authenticates: tokenized HTTPS or a managed SSH key. */
  gitTransport: "https" | "ssh";
  /** Commit author identity (email should match the account for "Verified"). */
  committerName: string;
  committerEmail: string;
  /** SSH-sign commits with the managed key (requires gitTransport "ssh"). */
  signCommits: boolean;
}

export interface ForgeRepo {
  owner: string;
  name: string;
  defaultBranch: string;
  /** HTTPS clone URL (no credentials). */
  cloneUrl: string;
  /** SSH clone/push URL (e.g. git@host:owner/name.git), or null if unknown. */
  sshUrl: string | null;
  htmlUrl: string;
}

export interface ForgeIssue {
  number: number;
  title: string;
  body: string;
  author: string;
  htmlUrl: string;
}

export interface ForgePullRequest {
  number: number;
  htmlUrl: string;
  state: string;
  merged: boolean;
  headBranch: string;
  /** The head commit sha, for status/check lookups. */
  headSha: string | null;
}

export interface ForgeReview {
  id: string | number;
  /** APPROVED | CHANGES_REQUESTED | COMMENTED | … (forge-specific casing normalized). */
  state: string;
  author: string;
}

export type CheckState = "success" | "failure" | "pending" | "none";

export interface OpenPrOptions {
  repo: string; // owner/name
  title: string;
  body: string;
  head: string; // branch
  base: string; // target branch
}

/** The common forge surface used by the pipeline, repo lifecycle, and monitors. */
export interface Forge {
  readonly provider: ForgeProvider;
  readonly account: ForgeAccount;

  getRepo(repo: string): Promise<ForgeRepo>;
  /** Create a repo under the account's user. `repo` may be "owner/name" or "name". */
  createRepo(repo: string, opts?: { private?: boolean; description?: string }): Promise<ForgeRepo>;
  /** Fork `repo` ("owner/name") under the account's user; returns the fork. Idempotent. */
  forkRepo(repo: string): Promise<ForgeRepo>;
  /** HTTPS clone/push URL with credentials embedded (used host-side only). */
  authedCloneUrl(repo: string): string;

  openPullRequest(opts: OpenPrOptions): Promise<ForgePullRequest>;
  getPullRequest(repo: string, number: number): Promise<ForgePullRequest>;
  listReviews(repo: string, number: number): Promise<ForgeReview[]>;
  /** Aggregate CI state for a commit ref. */
  checkState(repo: string, ref: string): Promise<CheckState>;

  /** Open issues assigned to the account's bot user. */
  listAssignedIssues(repo: string): Promise<ForgeIssue[]>;
  commentIssue(repo: string, number: number, body: string): Promise<void>;
}

/** Split "owner/name" into parts; throws if malformed. */
export function splitRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Invalid repo "${repo}" — expected "owner/name".`);
  return { owner: parts[0], name: parts[parts.length - 1].replace(/\.git$/, "") };
}

/**
 * Normalize a user-entered repo to "owner/name". Accepts a bare "owner/name",
 * a full HTTPS URL (e.g. https://gitea.somehost.com/org/repo[.git], including
 * a subpath) or an SSH URL (git@host:org/repo.git, ssh://git@host:222/org/repo).
 * The host is ignored here — it comes from the account — so a repo on any
 * self-hosted forge can be pasted as its browser URL.
 */
export function parseRepoInput(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("A repo is required.");

  // scp-style SSH: git@host:owner/repo(.git)
  const scp = /^[^@]+@[^:]+:(.+)$/.exec(raw);
  let path = raw;
  if (scp) {
    path = scp[1];
  } else if (/^(https?|ssh):\/\//i.test(raw)) {
    try {
      path = new URL(raw).pathname;
    } catch {
      /* fall through to plain handling */
    }
  }
  const parts = path.replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Could not read "owner/name" from "${input}".`);
  // Take the last two path segments (handles Gitea subpath installs).
  const name = parts[parts.length - 1];
  const owner = parts[parts.length - 2];
  return `${owner}/${name}`;
}

/** Embed a token into an https URL for host-side git clone/push. */
export function tokenizeUrl(httpsUrl: string, username: string, token: string): string {
  try {
    const u = new URL(httpsUrl);
    u.username = encodeURIComponent(username || "x-access-token");
    u.password = encodeURIComponent(token);
    return u.toString();
  } catch {
    return httpsUrl;
  }
}
