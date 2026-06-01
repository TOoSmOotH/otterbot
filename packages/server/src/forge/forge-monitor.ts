import type { Forge, ForgeComment, ForgeIssue } from "./forge.js";

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
  /** Projects with PM issue-triage enabled. */
  listTriageProjects(): MonitoredProject[];
  /** Current triage state for an issue, or null if never triaged. */
  getTriage(projectId: string, issueNumber: number): { plan: string; lastCommentId: number } | null;
  /** PM (with coder) drafts the first plan from the issue + any existing instruction comments; persists it. */
  triageInitial(projectId: string, issue: ForgeIssue, instructionComments: ForgeComment[]): Promise<void>;
  /** PM (with coder) revises the plan from new instruction comments; persists it. */
  refinePlan(projectId: string, issue: ForgeIssue, currentPlan: string, instructionComments: ForgeComment[]): Promise<void>;
  /** Move the comment high-water mark forward without changing the plan. */
  advanceWatermark(projectId: string, issueNumber: number, lastCommentId: number): void;
}

export class ForgeMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** PRs already observed merged, so we stop polling them. */
  private readonly merged = new Set<number>();
  /** issues currently being triaged/refined (a slow PM round must not double-fire). */
  private readonly inFlight = new Set<string>();

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
    for (const project of this.deps.listTriageProjects()) {
      const forge = this.deps.forgeForProject(project.id);
      if (!forge) continue;
      try {
        await this.pollTriage(project, forge);
      } catch (err) {
        console.warn(`[forge-monitor] triage ${project.forgeRepo}:`, err instanceof Error ? err.message : err);
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

  /** Draft/refine a PM plan on new unassigned issues. */
  async pollTriage(project: MonitoredProject, forge: Forge): Promise<void> {
    const permCache = new Map<string, "admin" | "write" | "read" | "none">();
    const issues = await forge.listOpenIssues(project.forgeRepo);
    for (const issue of issues) {
      if (issue.assignees.length > 0) continue; // assigned → not a triage candidate
      const key = `${project.id}#${issue.number}`;
      if (this.inFlight.has(key)) continue;

      const existing = this.deps.getTriage(project.id, issue.number);
      if (!existing) {
        const comments = await forge.listIssueComments(project.forgeRepo, issue.number);
        const instr = await this.instructions(forge, project.forgeRepo, issue, comments, permCache);
        this.inFlight.add(key);
        try {
          await this.deps.triageInitial(project.id, issue, instr);
        } finally {
          this.inFlight.delete(key);
        }
        continue;
      }

      const comments = await forge.listIssueComments(project.forgeRepo, issue.number);
      const me = forge.account.username.toLowerCase();
      const fresh = comments.filter((c) => c.id > existing.lastCommentId && c.author.toLowerCase() !== me);
      if (fresh.length === 0) continue;
      const instr = await this.instructions(forge, project.forgeRepo, issue, fresh, permCache);
      if (instr.length === 0) {
        const maxId = Math.max(existing.lastCommentId, ...comments.map((c) => c.id));
        this.deps.advanceWatermark(project.id, issue.number, maxId);
        continue;
      }
      this.inFlight.add(key);
      try {
        await this.deps.refinePlan(project.id, issue, existing.plan, instr);
      } finally {
        this.inFlight.delete(key);
      }
    }
  }

  /** Comments whose author may steer the plan: the issue author, or a write/admin user. */
  private async instructions(
    forge: Forge,
    repo: string,
    issue: ForgeIssue,
    comments: ForgeComment[],
    permCache: Map<string, "admin" | "write" | "read" | "none">
  ): Promise<ForgeComment[]> {
    const me = forge.account.username.toLowerCase();
    const author = issue.author.toLowerCase();
    const out: ForgeComment[] = [];
    for (const c of comments) {
      const who = c.author.toLowerCase();
      if (who === me) continue;
      if (who === author) {
        out.push(c);
        continue;
      }
      let perm = permCache.get(who);
      if (perm === undefined) {
        perm = await forge.getUserPermission(repo, c.author);
        permCache.set(who, perm);
      }
      if (perm === "admin" || perm === "write") out.push(c);
    }
    return out;
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
