import { realGit, type GitRunner } from "./git-runner.js";

export interface IntegrationItem {
  taskId: string;
  branch: string;
}

/** Runs the project's test gate in a repo dir; ok=false fails the gate. */
export type TestRunner = (repoPath: string) => { ok: boolean; output: string };

export type MergeResult = "merged" | "conflict" | "error" | "test-failed";

export interface MergeOutcome {
  taskId: string;
  branch: string;
  result: MergeResult;
  output: string;
}

/**
 * Merge each item's branch into the repo's CURRENT branch, one at a time (serial
 * integration). Conflicts and failing test gates are recorded per-item and skip
 * to the next item rather than aborting the batch. The caller checks out the
 * integration branch first and decides how to react to non-`merged` outcomes
 * (kick the task back to its coder).
 */
export function integrateSerially(
  repoPath: string,
  items: IntegrationItem[],
  opts: { git?: GitRunner; runTests?: TestRunner } = {}
): MergeOutcome[] {
  const git = opts.git ?? realGit;
  const outcomes: MergeOutcome[] = [];
  for (const item of items) {
    const before = git(repoPath, ["rev-parse", "HEAD"]).output;
    const merge = git(repoPath, ["merge", "--no-ff", "-m", `integrate ${item.taskId}`, item.branch]);
    if (!merge.ok) {
      // Distinguish a true merge conflict (a merge is in progress) from a
      // non-conflict failure (unmergeable ref, dirty tree): only the former has
      // a merge to abort.
      const inMerge = git(repoPath, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok;
      if (inMerge) {
        git(repoPath, ["merge", "--abort"]);
        outcomes.push({ taskId: item.taskId, branch: item.branch, result: "conflict", output: merge.output });
      } else {
        outcomes.push({ taskId: item.taskId, branch: item.branch, result: "error", output: merge.output });
      }
      continue;
    }
    if (opts.runTests) {
      const test = opts.runTests(repoPath);
      if (!test.ok) {
        // Reset to the pre-merge commit (NOT HEAD~1): an "already up to date"
        // no-op merge creates no commit, so HEAD~1 would discard a PRIOR item's
        // integration. NOTE: this restores tracked files only — untracked test
        // artifacts are not cleaned here; Phase 2c should run the gate in an
        // isolated checkout (or `git clean` on rollback).
        git(repoPath, ["reset", "--hard", before]);
        outcomes.push({ taskId: item.taskId, branch: item.branch, result: "test-failed", output: test.output });
        continue;
      }
    }
    outcomes.push({ taskId: item.taskId, branch: item.branch, result: "merged", output: merge.output });
  }
  return outcomes;
}
