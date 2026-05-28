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
}

export interface ForgeRepo {
  owner: string;
  name: string;
  defaultBranch: string;
  /** HTTPS clone URL (no credentials). */
  cloneUrl: string;
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
