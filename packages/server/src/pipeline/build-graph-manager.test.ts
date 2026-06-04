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

  it("allows the same task id across different runs and scopes status updates per run", async () => {
    const mgr = new BuildGraphManager({ control, runTask: async () => ({ report: "ok" }) });
    const a = mgr.createRun("proj1", "A", { status: "awaiting_approval" });
    const b = mgr.createRun("proj1", "B", { status: "awaiting_approval" });
    // The PM reuses semantic ids across runs — the same "code" id in both must
    // not collide (composite primary key).
    mgr.seedTasks(a, "proj1", [{ id: "code", title: "A code", role: "coder" }]);
    mgr.seedTasks(b, "proj1", [{ id: "code", title: "B code", role: "coder" }]);
    expect(mgr.listTasks(a).length).toBe(1);
    expect(mgr.listTasks(b).length).toBe(1);

    // Driving run A to done must not touch run B's identically-named task.
    mgr.launch(a);
    await waitFor(() => mgr.getRun(a)?.status === "done");
    expect(mgr.listTasks(a)[0].status).toBe("merged");
    expect(mgr.listTasks(b)[0].status).toBe("blocked");
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

  it("fails the run and records the error when a task throws", async () => {
    const mgr = new BuildGraphManager({
      control,
      runTask: async () => {
        throw new Error("boom");
      },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [{ id: "code", title: "implement", role: "coder" }]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status !== "running");
    expect(mgr.getRun(runId)?.status).toBe("failed");
    const code = mgr.listTasks(runId).find((t) => t.id === "code")!;
    expect(code.status).toBe("failed");
    expect(code.report).toContain("boom");
  });

  it("fails gracefully on a dependency cycle instead of hanging", async () => {
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => ({ report: `did ${task.id}` }),
    });
    const runId = mgr.createRun("proj1", "cyclic");
    mgr.seedTasks(runId, "proj1", [
      { id: "a", title: "A", role: "coder", deps: ["b"] },
      { id: "b", title: "B", role: "coder", deps: ["a"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status !== "running");
    expect(mgr.getRun(runId)?.status).toBe("failed");
  });

  it("runs up to `parallelism` ready tasks concurrently", async () => {
    let active = 0;
    let peak = 0;
    let releaseAll = () => {};
    const barrier = new Promise<void>((res) => {
      releaseAll = res;
    });
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        active += 1;
        peak = Math.max(peak, active);
        await barrier;
        active -= 1;
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "parallel", { parallelism: 3 });
    mgr.seedTasks(runId, "proj1", [
      { id: "a", title: "A", role: "coder" },
      { id: "b", title: "B", role: "coder" },
      { id: "c", title: "C", role: "coder" },
    ]);
    mgr.start(runId);

    await waitFor(() => active === 3);
    expect(peak).toBe(3);
    releaseAll();
    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(mgr.listTasks(runId).every((t) => t.status === "merged")).toBe(true);
  });

  it("never exceeds the parallelism cap", async () => {
    let active = 0;
    let peak = 0;
    let releaseAll = () => {};
    const barrier = new Promise<void>((res) => {
      releaseAll = res;
    });
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        active += 1;
        peak = Math.max(peak, active);
        await barrier;
        active -= 1;
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "cap", { parallelism: 2 });
    mgr.seedTasks(runId, "proj1", [
      { id: "a", title: "A", role: "coder" },
      { id: "b", title: "B", role: "coder" },
      { id: "c", title: "C", role: "coder" },
    ]);
    mgr.start(runId);

    await waitFor(() => active === 2);
    await new Promise((r) => setTimeout(r, 30)); // give the loop a chance to over-dispatch
    expect(peak).toBe(2); // third task held back while 2 are busy
    releaseAll();
    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(peak).toBe(2); // still capped even after the third ran
  });

  it("waits for in-flight tasks instead of failing when nothing else is ready", async () => {
    const order: string[] = [];
    let releaseSlow = () => {};
    const slowBarrier = new Promise<void>((res) => {
      releaseSlow = res;
    });
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        order.push(task.id);
        if (task.id === "slow") await slowBarrier;
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "wait", { parallelism: 3 });
    mgr.seedTasks(runId, "proj1", [
      { id: "slow", title: "slow coder", role: "coder" },
      { id: "after", title: "depends on slow", role: "integrator", deps: ["slow"] },
    ]);
    mgr.start(runId);

    await waitFor(() => order.includes("slow"));
    await new Promise((r) => setTimeout(r, 30)); // 'after' is blocked; nothing else is ready
    expect(mgr.getRun(runId)?.status).toBe("running"); // MUST NOT have failed as "stuck"
    releaseSlow();
    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(order).toEqual(["slow", "after"]);
  });

  it("retries a coder task that returns pass:false, then completes", async () => {
    let coderRuns = 0;
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        if (task.id === "code") {
          coderRuns += 1;
          return { report: `attempt ${coderRuns}`, pass: coderRuns > 1 }; // fail first, pass second
        }
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [{ id: "code", title: "implement", role: "coder" }]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(coderRuns).toBe(2);
    const code = mgr.listTasks(runId).find((t) => t.id === "code")!;
    expect(code.status).toBe("merged");
    expect(code.attempt).toBe(1);
  });

  it("retries a coder task that throws, then completes", async () => {
    let coderRuns = 0;
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        if (task.id === "code") {
          coderRuns += 1;
          if (coderRuns === 1) throw new Error("transient boom");
          return { report: "recovered" };
        }
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [{ id: "code", title: "implement", role: "coder" }]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(coderRuns).toBe(2);
    expect(mgr.listTasks(runId).find((t) => t.id === "code")!.status).toBe("merged");
  });

  it("never double-dispatches a shared dep when sibling gates kick back concurrently", async () => {
    const active = new Map<string, number>();
    const peakById = new Map<string, number>();
    const bump = (id: string, d: number) => {
      const n = (active.get(id) ?? 0) + d;
      active.set(id, n);
      if (d > 0) peakById.set(id, Math.max(peakById.get(id) ?? 0, n));
    };
    let gFailed = false;
    let hFailed = false;
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        bump(task.id, 1);
        await new Promise((r) => setTimeout(r, task.role === "coder" ? 25 : 1));
        bump(task.id, -1);
        if (task.id === "G" && !gFailed) {
          gFailed = true;
          return { report: "VERDICT: FAIL" };
        }
        if (task.id === "H" && !hFailed) {
          hFailed = true;
          return { report: "VERDICT: FAIL" };
        }
        if (task.role === "tester") return { report: "VERDICT: PASS" };
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "shared dep", { parallelism: 3 });
    mgr.seedTasks(runId, "proj1", [
      { id: "X", title: "X", role: "coder" },
      { id: "G", title: "G", role: "tester", deps: ["X"] },
      { id: "H", title: "H", role: "tester", deps: ["X"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status !== "running", 5000);
    expect(mgr.getRun(runId)?.status).toBe("done");
    expect(peakById.get("X")).toBe(1); // X must never run concurrently with itself
  });

  it("creates a run awaiting_approval that does not run until launched", async () => {
    const calls: string[] = [];
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        calls.push(task.id);
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "gated", { status: "awaiting_approval" });
    mgr.seedTasks(runId, "proj1", [{ id: "code", title: "implement", role: "coder" }]);

    // Give the loop a chance: it must NOT run while awaiting approval.
    await new Promise((r) => setTimeout(r, 30));
    expect(mgr.getRun(runId)?.status).toBe("awaiting_approval");
    expect(calls).toEqual([]);

    mgr.launch(runId);
    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(calls).toEqual(["code"]);
  });

  it("lists runs for a project, newest first", () => {
    const mgr = new BuildGraphManager({ control, runTask: async () => ({ report: "ok" }) });
    const a = mgr.createRun("projX", "first", { status: "awaiting_approval" });
    const b = mgr.createRun("projX", "second", { status: "awaiting_approval" });
    mgr.createRun("projY", "other", { status: "awaiting_approval" });
    const runs = mgr.listForProject("projX");
    expect(runs.length).toBe(2);
    expect(runs.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(mgr.listForProject("projY").length).toBe(1);
  });
});
