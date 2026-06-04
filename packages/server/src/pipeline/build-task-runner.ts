import { GATE_ROLES, type BuildRun, type BuildTask, type RunTaskArgs } from "./build-graph.js";
import type { MergeOutcome } from "./integrate.js";

export interface CoderDispatch {
  task: BuildTask;
  worktreePath: string;
  branch: string;
  priorReports: RunTaskArgs["priorReports"];
}

/**
 * The real-world actions the BuildTaskRunner needs. Injected so the runner is
 * unit-testable with fakes; the live adapters (WorktreeManager, agent dispatch,
 * ProjectStore commit, integrateSerially, bus gate) are wired in the orchestrator
 * (Phase 2c-3).
 */
export interface BuildTaskCaps {
  /** Branch new coder worktrees + the integration branch start from. */
  baseBranch(run: BuildRun): string;
  // --- coder ---
  addWorktree(run: BuildRun, task: BuildTask, baseBranch: string): { path: string; branch: string };
  dispatchCoder(d: CoderDispatch): Promise<string>;
  commitWorktree(a: { worktreePath: string; branch: string; task: BuildTask }): { ok: boolean; output: string };
  removeWorktree(task: BuildTask): void;
  // --- integrator ---
  coderBranches(run: BuildRun): Array<{ taskId: string; branch: string }>;
  integrate(a: { run: BuildRun; items: Array<{ taskId: string; branch: string }> }): MergeOutcome[];
  // --- gate / other roles ---
  runGate(a: { task: BuildTask; priorReports: RunTaskArgs["priorReports"] }): Promise<string>;
}

/**
 * Builds the `runTask` the BuildGraphManager scheduler calls, mapping each task's
 * role to a real action:
 *  - coder: worktree → dispatch coder → commit branch → remove worktree.
 *  - integrator: integrate the coder branches; fail if any didn't merge.
 *  - gate / other roles: delegate to the role's agent (gates emit VERDICT:).
 */
export function makeRunTask(
  caps: BuildTaskCaps
): (args: RunTaskArgs) => Promise<{ report: string; pass?: boolean; kickback?: string[] }> {
  return async ({ run, task, priorReports }) => {
    if (task.role === "coder") {
      const wt = caps.addWorktree(run, task, caps.baseBranch(run));
      try {
        const report = await caps.dispatchCoder({
          task,
          worktreePath: wt.path,
          branch: wt.branch,
          priorReports,
        });
        const commit = caps.commitWorktree({ worktreePath: wt.path, branch: wt.branch, task });
        if (!commit.ok) {
          // No changes committed — fail so the scheduler kicks the task back.
          return { report: `${report}\n\n(no changes committed: ${commit.output})`, pass: false };
        }
        return { report };
      } finally {
        caps.removeWorktree(task);
      }
    }

    if (task.role === "integrator") {
      const items = caps.coderBranches(run);
      const outcomes = caps.integrate({ run, items });
      const failed = outcomes.filter((o) => o.result !== "merged");
      const pass = failed.length === 0;
      const report =
        outcomes
          .map((o) => `${o.taskId}: ${o.result}${o.result === "merged" ? "" : ` — ${o.output}`}`)
          .join("\n") || "(no coder branches to integrate)";
      // On failure, re-run only the offending coder task(s), not every coder.
      return { report, pass, kickback: failed.map((o) => o.taskId) };
    }

    // Gate roles (security-reviewer, tester) and other roles (test-writer): run
    // the role's agent.
    const report = await caps.runGate({ task, priorReports });
    if (GATE_ROLES.has(task.role)) {
      // A gate must EXPLICITLY pass. Absent a `VERDICT: PASS` line — e.g. the gate
      // ran out of its step budget before testing — treat it as a failure (→
      // kickback), never a default pass.
      const pass = /VERDICT:\s*PASS/i.test(report);
      return { report, pass };
    }
    return { report };
  };
}
