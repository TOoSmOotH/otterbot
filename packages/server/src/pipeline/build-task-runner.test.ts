import { describe, it, expect } from "vitest";
import { makeRunTask, type BuildTaskCaps } from "./build-task-runner.js";
import type { BuildRun, BuildTask } from "./build-graph.js";
import type { MergeOutcome } from "./integrate.js";

const run: BuildRun = {
  id: "run1",
  projectId: "proj1",
  goal: "g",
  status: "running",
  integrationBranch: null,
  parallelism: 3,
  prNumber: null,
  prUrl: null,
  createdAt: "t",
  updatedAt: "t",
};

const task = (over: Partial<BuildTask> & Pick<BuildTask, "id" | "role">): BuildTask => ({
  runId: "run1",
  projectId: "proj1",
  title: over.id,
  description: "",
  deps: [],
  status: "running",
  assignedAgentId: null,
  branch: null,
  worktreePath: null,
  attempt: 0,
  filesHint: null,
  report: "",
  transcriptRef: null,
  createdAt: "t",
  updatedAt: "t",
  ...over,
});

const makeCaps = (over: Partial<BuildTaskCaps> = {}): BuildTaskCaps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    baseBranch: () => "main",
    addWorktree: (_r, t) => {
      calls.push(`add:${t.id}`);
      return { path: `/wt/${t.id}`, branch: `task/run1/${t.id}` };
    },
    dispatchCoder: async (d) => {
      calls.push(`dispatch:${d.task.id}@${d.worktreePath}`);
      return `coded ${d.task.id}`;
    },
    commitWorktree: () => {
      calls.push("commit");
      return { ok: true, output: "" };
    },
    removeWorktree: (t) => {
      calls.push(`remove:${t.id}`);
    },
    coderBranches: () => [],
    integrate: () => [],
    runGate: async (a) => {
      calls.push(`gate:${a.task.id}`);
      return `gated ${a.task.id}`;
    },
    ...over,
  };
};

describe("makeRunTask", () => {
  it("coder: adds worktree, dispatches, commits, removes; returns the report", async () => {
    const caps = makeCaps();
    const out = await makeRunTask(caps)({ run, task: task({ id: "code", role: "coder" }), priorReports: [] });
    expect(out.report).toBe("coded code");
    expect(out.pass).toBeUndefined();
    expect(caps.calls).toEqual(["add:code", "dispatch:code@/wt/code", "commit", "remove:code"]);
  });

  it("coder: a no-op commit fails the task (pass:false) so the scheduler retries", async () => {
    const caps = makeCaps({ commitWorktree: () => ({ ok: false, output: "nothing to commit" }) });
    const out = await makeRunTask(caps)({ run, task: task({ id: "code", role: "coder" }), priorReports: [] });
    expect(out.pass).toBe(false);
    expect(out.report).toContain("nothing to commit");
    expect(caps.calls).toContain("remove:code");
  });

  it("coder: removes the worktree even if dispatch throws", async () => {
    const caps = makeCaps({
      dispatchCoder: async () => {
        throw new Error("boom");
      },
    });
    await expect(
      makeRunTask(caps)({ run, task: task({ id: "code", role: "coder" }), priorReports: [] })
    ).rejects.toThrow("boom");
    expect(caps.calls).toContain("remove:code");
    expect(caps.calls).not.toContain("commit");
  });

  it("integrator: passes when every coder branch merges", async () => {
    const outcomes: MergeOutcome[] = [
      { taskId: "a", branch: "task/run1/a", result: "merged", output: "" },
      { taskId: "b", branch: "task/run1/b", result: "merged", output: "" },
    ];
    const caps = makeCaps({
      coderBranches: () => [
        { taskId: "a", branch: "task/run1/a" },
        { taskId: "b", branch: "task/run1/b" },
      ],
      integrate: () => outcomes,
    });
    const out = await makeRunTask(caps)({ run, task: task({ id: "int", role: "integrator" }), priorReports: [] });
    expect(out.pass).toBe(true);
    expect(out.report).toContain("a: merged");
    expect(out.report).toContain("b: merged");
  });

  it("integrator: fails when a coder branch conflicts (report names it)", async () => {
    const caps = makeCaps({
      coderBranches: () => [
        { taskId: "a", branch: "task/run1/a" },
        { taskId: "b", branch: "task/run1/b" },
      ],
      integrate: () => [
        { taskId: "a", branch: "task/run1/a", result: "merged", output: "" },
        { taskId: "b", branch: "task/run1/b", result: "conflict", output: "CONFLICT base.txt" },
      ],
    });
    const out = await makeRunTask(caps)({ run, task: task({ id: "int", role: "integrator" }), priorReports: [] });
    expect(out.pass).toBe(false);
    expect(out.report).toContain("b: conflict");
    expect(out.report).toContain("CONFLICT base.txt");
  });

  it("gate / other roles: delegate to runGate and pass the report through", async () => {
    const caps = makeCaps();
    const out = await makeRunTask(caps)({ run, task: task({ id: "test", role: "tester" }), priorReports: [] });
    expect(out.report).toBe("gated test");
    expect(out.pass).toBeUndefined();
    expect(caps.calls).toEqual(["gate:test"]);
  });
});
