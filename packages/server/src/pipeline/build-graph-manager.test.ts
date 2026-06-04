import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { BuildGraphManager } from "./build-graph.js";

const waitFor = async (pred: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("BuildGraphManager — persistence", () => {
  let dir: string;
  let control: ControlDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-bgm-"));
    control = openControlDb(join(dir, "control.db"));
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a run and seeds tasks, parsing deps back to arrays", () => {
    const mgr = new BuildGraphManager({ control, runTask: async () => ({ report: "ok" }) });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [
      { id: "code", title: "implement", role: "coder" },
      { id: "review", title: "review", role: "security-reviewer", deps: ["code"] },
    ]);

    const view = mgr.view(runId)!;
    expect(view.goal).toBe("build it");
    expect(view.status).toBe("running"); // createRun starts a run ready to drive
    expect(view.tasks.map((t) => t.id).sort()).toEqual(["code", "review"]);
    const review = view.tasks.find((t) => t.id === "review")!;
    expect(review.deps).toEqual(["code"]); // JSON parsed back to array
    expect(review.status).toBe("blocked");
  });

  it("drives a linear chain in dependency order to done (degenerate pipeline)", async () => {
    const calls: string[] = [];
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        calls.push(task.id);
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [
      { id: "code", title: "implement", role: "coder" },
      { id: "review", title: "review", role: "security-reviewer", deps: ["code"] },
      { id: "test", title: "test", role: "tester", deps: ["review"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(calls).toEqual(["code", "review", "test"]);
    expect(mgr.listTasks(runId).every((t) => t.status === "merged")).toBe(true);
  });

  it("runs independent tasks then releases the fan-in task once both merged", async () => {
    const order: string[] = [];
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        order.push(task.id);
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "two-part feature");
    mgr.seedTasks(runId, "proj1", [
      { id: "code-a", title: "part A", role: "coder" },
      { id: "code-b", title: "part B", role: "coder" },
      { id: "integrate", title: "merge A+B", role: "integrator", deps: ["code-a", "code-b"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    // Both coders run before the integrator; integrator is last.
    expect(order[order.length - 1]).toBe("integrate");
    expect(order.slice(0, 2).sort()).toEqual(["code-a", "code-b"]);
    expect(mgr.listTasks(runId).every((t) => t.status === "merged")).toBe(true);
  });

  it("kicks a failed gate back to its deps, re-runs, then finishes done", async () => {
    const order: string[] = [];
    let reviewRuns = 0;
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        order.push(task.id);
        if (task.role === "security-reviewer") {
          reviewRuns += 1;
          return { report: reviewRuns === 1 ? "VERDICT: FAIL" : "VERDICT: PASS" };
        }
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [
      { id: "code", title: "implement", role: "coder" },
      { id: "review", title: "review", role: "security-reviewer", deps: ["code"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    // code, review(FAIL) → reset code+review → code, review(PASS)
    expect(order).toEqual(["code", "review", "code", "review"]);
    const review = mgr.listTasks(runId).find((t) => t.id === "review")!;
    expect(review.attempt).toBe(1);
    expect(mgr.listTasks(runId).every((t) => t.status === "merged")).toBe(true);
  });

  it("fails the run when a gate keeps failing past the attempt budget", async () => {
    const mgr = new BuildGraphManager({
      control,
      maxAttempts: 2,
      runTask: async ({ task }) =>
        task.role === "tester" ? { report: "VERDICT: FAIL" } : { report: `did ${task.id}` },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [
      { id: "code", title: "implement", role: "coder" },
      { id: "test", title: "test", role: "tester", deps: ["code"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status !== "running");
    expect(mgr.getRun(runId)?.status).toBe("failed");
    const test = mgr.listTasks(runId).find((t) => t.id === "test")!;
    expect(test.attempt).toBe(2); // bumped to the cap, then exhausted
  });
});
