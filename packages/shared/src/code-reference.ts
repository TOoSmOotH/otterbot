/**
 * Code reference: instance-wide GitHub repos cloned once and indexed for
 * hybrid (keyword + semantic) search. Configured in Global Settings; queried by
 * agents that have the `code-reference` capability enabled.
 */

/** Lifecycle of a single configured repo's clone + index. */
export type RepoSyncState = "pending" | "cloning" | "indexing" | "ready" | "error";

/** A reference repository registered for the whole instance. */
export interface CodeReferenceRepo {
  id: string;
  owner: string;
  name: string;
  /** HTTPS clone URL. */
  url: string;
  /** Branch/tag to track; `null` = the remote's default branch. */
  ref?: string | null;
  /** Clone directory name under `data/repos/` — `"<owner>-<name>"`. */
  dirName: string;
  state: RepoSyncState;
  lastSyncedAt: string | null;
  /** Short HEAD sha of the indexed snapshot. */
  lastCommit: string | null;
  fileCount: number;
  chunkCount: number;
  error: string | null;
  createdAt: string;
}

/** Snapshot returned to the Settings UI. */
export interface CodeReferenceStatus {
  repos: CodeReferenceRepo[];
  /** Whether the instance default embedder is usable (a dimension was probed). */
  embeddingAvailable: boolean;
  embeddingDimension: number | null;
  /** Whether `git` is on PATH. */
  gitAvailable: boolean;
  /** True while any repo is cloning or indexing. */
  indexing: boolean;
  /** Cron expression for scheduled auto-pulls. */
  pullCron: string;
}

/** A single hit from a code search. */
export interface CodeSearchHit {
  repoId: string;
  /** `"owner/name"`. */
  repo: string;
  /** Repo-relative path. */
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  via: "fts" | "vector" | "hybrid" | "grep";
}

/** Persisted config blob (app_settings key `"code_reference"`). */
export interface CodeReferenceConfig {
  repos: CodeReferenceRepo[];
  pullCron: string;
}
