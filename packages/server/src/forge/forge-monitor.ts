import type { Forge, ForgeIssue } from "./forge.js";

/**
 * Polls forge-backed projects and feeds the pipeline:
 *  - a new open issue assigned to the bot starts a pipeline run (once);
 *  - an open PR/MR for a finished run that has CHANGES_REQUESTED reviews or a
 *    failing CI check is kicked back to the coder (bounded by the pipeline's
 *    attempt cap).
 *
 * Forge-agnostic: everything goes through the {@link Forge} interface. The
 * decision logic is unit-tested via injectable deps; only the timer is live.
 */

export interface MonitoredProject {
  id: string;
  forgeRepo: string;
}

export interface WatchableRun {
  id: string;
  prNumber: number | null;
  status: string;
}

export interface ForgeMonitorDeps {
  listMonitoredProjects(): MonitoredProject[];
  forgeForProject(projectId: string): Forge | null;
  /** Has any run already been started from this issue? */
  hasRunForIssue(projectId: string, issueNumber: number): boolean;
  /** Start a pipeline run from an issue; returns the run id. */
  startRunFromIssue(projectId: string, issue: ForgeIssue): string;
  /** Finished runs that opened a PR (candidates for kickback). */
  watchableRuns(projectId: string): WatchableRun[];
  /** Re-drive a finished run from the coder with feedback; false if out of attempts. */
  resumeRun(runId: string, feedback: string): boolean;
}

export class ForgeMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** PRs already observed merged, so we stop polling them. */
  private readonly merged = new Set<number>();

  constructor(private readonly deps: ForgeMonitorDeps) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollOnce().catch(() => {}), intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One poll cycle across all monitored projects. Errors per project are isolated. */
  async pollOnce(): Promise<void> {
    for (const project of this.deps.listMonitoredProjects()) {
      const forge = this.deps.forgeForProject(project.id);
      if (!forge) continue;
      try {
        await this.pollIssues(project, forge);
        await this.pollPullRequests(project, forge);
      } catch (err) {
        console.warn(`[forge-monitor] ${project.forgeRepo}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /** Start a pipeline run for each newly-assigned open issue. */
  async pollIssues(project: MonitoredProject, forge: Forge): Promise<void> {
    const issues = await forge.listAssignedIssues(project.forgeRepo);
    for (const issue of issues) {
      if (this.deps.hasRunForIssue(project.id, issue.number)) continue;
      this.deps.startRunFromIssue(project.id, issue);
      try {
        await forge.commentIssue(
          project.forgeRepo,
          issue.number,
          "On it — the otterbot coding pipeline has picked this up."
        );
      } catch {
        /* commenting is best-effort */
      }
    }
  }

  /** Kick back finished runs whose PR has changes requested or failing CI. */
  async pollPullRequests(project: MonitoredProject, forge: Forge): Promise<void> {
    for (const run of this.deps.watchableRuns(project.id)) {
      if (run.prNumber == null || this.merged.has(run.prNumber)) continue;
      const pr = await forge.getPullRequest(project.forgeRepo, run.prNumber);
      if (pr.merged) {
        this.merged.add(run.prNumber);
        continue;
      }
      const reviews = await forge.listReviews(project.forgeRepo, run.prNumber);
      const changesRequested = reviews.some((r) => r.state === "CHANGES_REQUESTED");
      const ci = pr.headSha ? await forge.checkState(project.forgeRepo, pr.headSha) : "none";
      if (changesRequested || ci === "failure") {
        const reasons = [
          changesRequested ? "a reviewer requested changes" : null,
          ci === "failure" ? "CI is failing" : null,
        ].filter(Boolean);
        this.deps.resumeRun(
          run.id,
          `PR #${run.prNumber} needs work: ${reasons.join(" and ")}. Review the PR ` +
            `comments and CI output, fix the issues, and update the branch.`
        );
      }
    }
  }
}
