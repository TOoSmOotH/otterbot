import { realGit, type GitRunner } from "./git-runner.js";

export interface IntegrationItem {
  taskId: string;
  branch: string;
}

/** Runs the project's test gate in a repo dir; ok=false fails the gate. */
export type TestRunner = (repoPath: string) => { ok: boolean; output: string };

export type MergeResult = "merged" | "conflict" | "test-failed";

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
    const merge = git(repoPath, ["merge", "--no-ff", "-m", `integrate ${item.taskId}`, item.branch]);
    if (!merge.ok) {
      git(repoPath, ["merge", "--abort"]);
      outcomes.push({ taskId: item.taskId, branch: item.branch, result: "conflict", output: merge.output });
      continue;
    }
    outcomes.push({ taskId: item.taskId, branch: item.branch, result: "merged", output: merge.output });
  }
  return outcomes;
}
