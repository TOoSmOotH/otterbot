import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { PipelineManager, parseVerdict } from "./pipeline-manager.js";

const waitFor = async (pred: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("parseVerdict", () => {
  it("reads PASS/FAIL and defaults to pass", () => {
    expect(parseVerdict("all good\nVERDICT: PASS")).toBe(true);
    expect(parseVerdict("nope\nVERDICT: fail")).toBe(false);
    expect(parseVerdict("no verdict line here")).toBe(true);
  });
});

describe("PipelineManager", () => {
  let dir: string;
  let control: ControlDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-pipe-"));
    control = openControlDb(join(dir, "control.db"));
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const resolveAgent = (_p: string, role: string) => `agent-${role}`;

  it("runs all stages in order and finishes done", async () => {
    const calls: string[] = [];
    const pm = new PipelineManager({
      control,
      resolveAgent,
      runStage: async ({ stage }) => {
        calls.push(stage);
        return { report: `did ${stage}` };
      },
    });
    const runId = pm.startRun("proj1", "build it");
    await waitFor(() => pm.get(runId)?.status === "done");
    expect(calls).toEqual(["coder", "security-reviewer", "test-writer", "tester"]);
    const v = pm.view(runId)!;
    expect(v.stages.map((s) => s.status)).toEqual(["pass", "pass", "pass", "pass"]);
  });

  it("kicks back to the coder when a gate stage fails, then completes", async () => {
    const calls: string[] = [];
    let securityRuns = 0;
    const pm = new PipelineManager({
      control,
      resolveAgent,
      runStage: async ({ stage }) => {
        calls.push(stage);
        if (stage === "security-reviewer") {
          securityRuns += 1;
          // Fail the first time, pass on the retry.
          return { report: securityRuns === 1 ? "issues\nVERDICT: FAIL" : "clean\nVERDICT: PASS" };
        }
        return { report: `did ${stage}` };
      },
    });
    const runId = pm.startRun("proj1", "build it");
    await waitFor(() => pm.get(runId)?.status === "done");
    // coder, security(FAIL) -> back to coder, security(PASS), test-writer, tester
    expect(calls).toEqual([
      "coder",
      "security-reviewer",
      "coder",
      "security-reviewer",
      "test-writer",
      "tester",
    ]);
    expect(pm.get(runId)!.attempt).toBe(1);
  });

  it("fails the run after exceeding the kickback limit", async () => {
    const pm = new PipelineManager({
      control,
      resolveAgent,
      runStage: async ({ stage }) =>
        stage === "tester" ? { report: "VERDICT: FAIL" } : { report: `did ${stage}` },
    });
    const runId = pm.startRun("proj1", "build it");
    await waitFor(() => pm.get(runId)?.status === "failed");
    expect(pm.get(runId)!.status).toBe("failed");
  });

  it("errors out when a stage has no agent", async () => {
    const pm = new PipelineManager({
      control,
      resolveAgent: () => null,
      runStage: async () => ({ report: "unused" }),
    });
    const runId = pm.startRun("proj1", "build it");
    await waitFor(() => pm.get(runId)?.status === "failed");
    expect(pm.view(runId)!.stages[0].status).toBe("error");
  });

  it("runs only the stages whose roles resolve (resolveStages subset)", async () => {
    const calls: string[] = [];
    const pm = new PipelineManager({
      control,
      resolveAgent,
      resolveStages: () => ["coder", "tester"],
      runStage: async ({ stage }) => {
        calls.push(stage);
        return { report: `did ${stage}` };
      },
    });
    const runId = pm.startRun("proj1", "build it");
    await waitFor(() => pm.get(runId)?.status === "done");
    expect(calls).toEqual(["coder", "tester"]);
    expect(pm.get(runId)?.status).toBe("done");
  });

  it("fails (not done) when the effective stage list is empty", async () => {
    const calls: string[] = [];
    const pm = new PipelineManager({
      control,
      resolveAgent,
      resolveStages: () => [],
      runStage: async ({ stage }) => {
        calls.push(stage);
        return { report: `did ${stage}` };
      },
    });
    const runId = pm.startRun("proj1", "go");
    await waitFor(() => pm.get(runId)?.status !== "running");
    expect(pm.get(runId)?.status).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("starts at the effective first stage even when it isn't the default first", async () => {
    const calls: string[] = [];
    const pm = new PipelineManager({
      control,
      resolveAgent,
      resolveStages: () => ["security-reviewer", "tester"],
      runStage: async ({ stage }) => {
        calls.push(stage);
        return { report: `did ${stage}` };
      },
    });
    const runId = pm.startRun("proj1", "go");
    await waitFor(() => pm.get(runId)?.status === "done");
    expect(calls).toEqual(["security-reviewer", "tester"]);
    expect(pm.get(runId)?.currentStage).toBe("tester");
  });

  it("finishes done when only the coder stage resolves (no missing-agent error)", async () => {
    const calls: string[] = [];
    const pm = new PipelineManager({
      control,
      resolveAgent,
      resolveStages: () => ["coder"],
      runStage: async ({ stage }) => {
        calls.push(stage);
        return { report: `did ${stage}` };
      },
    });
    const runId = pm.startRun("proj1", "go");
    await waitFor(() => pm.get(runId)?.status === "done");
    expect(calls).toEqual(["coder"]);
    expect(pm.view(runId)!.stages.every((s) => s.status !== "error")).toBe(true);
  });
});
