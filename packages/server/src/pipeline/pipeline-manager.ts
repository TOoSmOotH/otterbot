import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { controlSchema, type ControlDb } from "../db/control-db.js";

/**
 * Runs a project's build pipeline: a fixed sequence of stages, each handed to
 * that project's specialist agent. The coder implements, the security reviewer
 * audits, the test writer adds tests, the tester runs the end-to-end suite. A
 * stage that fails kicks the run back to the coder (bounded attempts).
 *
 * The state machine is decoupled from the bus: a `runStage` callback executes a
 * stage (in production, a `bus.request` to the stage's agent) and returns the
 * agent's report text. Pass/fail is read from a `VERDICT: PASS|FAIL` line the
 * gate stages (security, tester) are instructed to emit; stages with no verdict
 * are treated as passing.
 */

export const DEFAULT_STAGES = ["coder", "security-reviewer", "test-writer", "tester"] as const;
export type Stage = string;

/** Stages whose verdict can fail the run and kick back to the coder. */
const GATE_STAGES = new Set(["security-reviewer", "tester"]);

/** Max times a run is kicked back to the coder before it's marked failed. */
const MAX_ATTEMPTS = 2;

export interface StageOutcome {
  report: string;
  /** Explicit verdict; if omitted it's parsed from the report's VERDICT line. */
  pass?: boolean;
}

export interface PipelineRun {
  id: string;
  projectId: string;
  goal: string;
  status: "running" | "done" | "failed" | "cancelled";
  currentStage: string | null;
  attempt: number;
  issueNumber: number | null;
  prBranch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRunView extends PipelineRun {
  stages: Array<{
    stage: string;
    agentId: string;
    status: "pass" | "fail" | "error";
    report: string;
    attempt: number;
    createdAt: string;
  }>;
}

export interface PipelineDeps {
  control: ControlDb;
  /** Resolve which agent fills a role for a project (null if unprovisioned). */
  resolveAgent: (projectId: string, role: Stage) => string | null;
  /** Execute a stage by handing the prompt to its agent; returns the report. */
  runStage: (args: {
    projectId: string;
    runId: string;
    stage: Stage;
    agentId: string;
    goal: string;
    priorReports: Array<{ stage: string; report: string }>;
  }) => Promise<StageOutcome>;
  /** Notified after each run state change (for sockets/UI). Optional. */
  onUpdate?: (run: PipelineRunView) => void;
  /** Stage order; defaults to DEFAULT_STAGES. */
  stages?: Stage[];
  /**
   * Per-project effective stage list (e.g. drop stages whose role was skipped).
   * Falls back to `stages`/DEFAULT_STAGES when omitted.
   */
  resolveStages?: (projectId: string) => Stage[];
}

/** Parse a `VERDICT: PASS|FAIL` line; default to pass when none is present. */
export function parseVerdict(report: string): boolean {
  const m = /VERDICT:\s*(PASS|FAIL)/i.exec(report);
  return m ? m[1].toUpperCase() === "PASS" : true;
}

export class PipelineManager {
  private readonly stages: Stage[];
  constructor(private readonly deps: PipelineDeps) {
    this.stages = deps.stages ?? [...DEFAULT_STAGES];
  }

  /** Start a run and drive it in the background; returns the new run id. */
  startRun(projectId: string, goal: string, opts: { issueNumber?: number } = {}): string {
    const id = nanoid();
    const now = new Date().toISOString();
    this.deps.control.db
      .insert(controlSchema.pipelineRuns)
      .values({
        id,
        projectId,
        goal,
        status: "running",
        // Seed from this project's effective first stage so the run starts at a
        // stage it will actually execute (not a default that may be skipped).
        currentStage: (this.deps.resolveStages?.(projectId) ?? this.stages)[0] ?? null,
        attempt: 0,
        issueNumber: opts.issueNumber ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    void this.drive(id).catch((err) => {
      console.error(`[pipeline] run ${id} crashed:`, err);
      this.finish(id, "failed");
    });
    return id;
  }

  /**
   * Re-open a finished run and re-drive it from the coder, carrying review/CI
   * feedback so the coder addresses it. Used by the PR monitor on
   * changes-requested or CI failure. Bounded by MAX_ATTEMPTS; returns false if
   * the run is unknown, still running, or out of attempts.
   */
  resume(runId: string, feedback: string): boolean {
    const run = this.get(runId);
    if (!run || run.status === "running") return false;
    const nextAttempt = run.attempt + 1;
    if (nextAttempt > MAX_ATTEMPTS) return false;
    // Record the feedback so it appears in the coder's prior reports.
    this.recordStage(runId, "review-feedback", "(forge)", "fail", feedback, nextAttempt);
    this.deps.control.db
      .update(controlSchema.pipelineRuns)
      .set({
        status: "running",
        currentStage: "coder",
        attempt: nextAttempt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(controlSchema.pipelineRuns.id, runId))
      .run();
    void this.drive(runId).catch((err) => {
      console.error(`[pipeline] resumed run ${runId} crashed:`, err);
      this.finish(runId, "failed");
    });
    return true;
  }

  /** The most recent run started from a given forge issue, if any. */
  findRunByIssue(projectId: string, issueNumber: number): PipelineRun | null {
    const rows = this.deps.control.db
      .select()
      .from(controlSchema.pipelineRuns)
      .where(eq(controlSchema.pipelineRuns.projectId, projectId))
      .all() as PipelineRun[];
    return rows.filter((r) => r.issueNumber === issueNumber).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  private async drive(runId: string): Promise<void> {
    let run = this.get(runId);
    if (!run) return;
    // The effective stage list can be narrower than the default when a project
    // skips optional roles — a stage whose role has no agent is left out here
    // rather than failing the run mid-flight.
    const stages = this.deps.resolveStages?.(run.projectId) ?? this.stages;
    if (stages.length === 0) {
      // No provisioned roles to run — fail loudly rather than report a no-op "done".
      this.recordStage(runId, "(none)", "(none)", "error", "No pipeline stages for this project.", run.attempt);
      this.finish(runId, "failed");
      return;
    }
    let i = Math.max(0, stages.indexOf(run.currentStage ?? stages[0]));

    while (i < stages.length) {
      run = this.get(runId);
      if (!run || run.status !== "running") return; // cancelled / gone
      const stage = stages[i];
      this.setCurrentStage(runId, stage);

      const agentId = this.deps.resolveAgent(run.projectId, stage);
      if (!agentId) {
        this.recordStage(runId, stage, "(none)", "error", `No agent for stage "${stage}".`, run.attempt);
        this.finish(runId, "failed");
        return;
      }

      const priorReports = this.stageHistory(runId).map((s) => ({ stage: s.stage, report: s.report }));
      let outcome: StageOutcome;
      try {
        outcome = await this.deps.runStage({
          projectId: run.projectId,
          runId,
          stage,
          agentId,
          goal: run.goal,
          priorReports,
        });
      } catch (err) {
        this.recordStage(runId, stage, agentId, "error", err instanceof Error ? err.message : String(err), run.attempt);
        this.finish(runId, "failed");
        return;
      }

      const pass = outcome.pass ?? parseVerdict(outcome.report);
      this.recordStage(runId, stage, agentId, pass ? "pass" : "fail", outcome.report, run.attempt);

      if (!pass && GATE_STAGES.has(stage)) {
        // Kick back to the coder, bounded by MAX_ATTEMPTS.
        const nextAttempt = run.attempt + 1;
        if (nextAttempt > MAX_ATTEMPTS) {
          this.finish(runId, "failed");
          return;
        }
        this.bumpAttempt(runId, nextAttempt);
        i = Math.max(0, stages.indexOf("coder"));
        continue;
      }

      i += 1;
    }
    this.finish(runId, "done");
  }

  // --- persistence helpers -------------------------------------------------

  get(runId: string): PipelineRun | null {
    return (
      (this.deps.control.db
        .select()
        .from(controlSchema.pipelineRuns)
        .where(eq(controlSchema.pipelineRuns.id, runId))
        .get() as PipelineRun | undefined) ?? null
    );
  }

  stageHistory(runId: string) {
    return this.deps.control.db
      .select()
      .from(controlSchema.pipelineStageResults)
      .where(eq(controlSchema.pipelineStageResults.runId, runId))
      .all();
  }

  view(runId: string): PipelineRunView | null {
    const run = this.get(runId);
    if (!run) return null;
    return { ...run, stages: this.stageHistory(runId) as PipelineRunView["stages"] };
  }

  listForProject(projectId: string): PipelineRun[] {
    return this.deps.control.db
      .select()
      .from(controlSchema.pipelineRuns)
      .where(eq(controlSchema.pipelineRuns.projectId, projectId))
      .all() as PipelineRun[];
  }

  cancel(runId: string): void {
    this.finish(runId, "cancelled");
  }

  /** Record the branch/PR a run published (set by the orchestrator's publish step). */
  setPrInfo(runId: string, info: { branch?: string; number?: number; url?: string }): void {
    this.deps.control.db
      .update(controlSchema.pipelineRuns)
      .set({
        ...(info.branch !== undefined ? { prBranch: info.branch } : {}),
        ...(info.number !== undefined ? { prNumber: info.number } : {}),
        ...(info.url !== undefined ? { prUrl: info.url } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(controlSchema.pipelineRuns.id, runId))
      .run();
    this.emit(runId);
  }

  private setCurrentStage(runId: string, stage: string): void {
    this.deps.control.db
      .update(controlSchema.pipelineRuns)
      .set({ currentStage: stage, updatedAt: new Date().toISOString() })
      .where(eq(controlSchema.pipelineRuns.id, runId))
      .run();
    this.emit(runId);
  }

  private bumpAttempt(runId: string, attempt: number): void {
    this.deps.control.db
      .update(controlSchema.pipelineRuns)
      .set({ attempt, updatedAt: new Date().toISOString() })
      .where(eq(controlSchema.pipelineRuns.id, runId))
      .run();
  }

  private recordStage(
    runId: string,
    stage: string,
    agentId: string,
    status: "pass" | "fail" | "error",
    report: string,
    attempt: number
  ): void {
    this.deps.control.db
      .insert(controlSchema.pipelineStageResults)
      .values({ runId, stage, agentId, status, report, attempt, createdAt: new Date().toISOString() })
      .run();
    this.emit(runId);
  }

  private finish(runId: string, status: PipelineRun["status"]): void {
    this.deps.control.db
      .update(controlSchema.pipelineRuns)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(controlSchema.pipelineRuns.id, runId))
      .run();
    this.emit(runId);
  }

  private emit(runId: string): void {
    if (!this.deps.onUpdate) return;
    const v = this.view(runId);
    if (v) this.deps.onUpdate(v);
  }
}
