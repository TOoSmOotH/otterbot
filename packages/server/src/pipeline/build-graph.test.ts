import { describe, it, expect } from "vitest";
import { readyTasks, type BuildTask } from "./build-graph.js";

const task = (over: Partial<BuildTask> & Pick<BuildTask, "id">): BuildTask => ({
  id: over.id,
  runId: "run1",
  projectId: "proj1",
  title: over.title ?? over.id,
  description: "",
  role: over.role ?? "coder",
  deps: over.deps ?? [],
  status: over.status ?? "blocked",
  assignedAgentId: null,
  branch: null,
  worktreePath: null,
  attempt: over.attempt ?? 0,
  filesHint: null,
  report: "",
  transcriptRef: null,
  createdAt: "t",
  updatedAt: "t",
});

describe("readyTasks", () => {
  it("returns tasks with no deps that haven't started", () => {
    const ts = [task({ id: "a" }), task({ id: "b", status: "running" })];
    expect(readyTasks(ts).map((t) => t.id)).toEqual(["a"]);
  });

  it("holds a task until every dependency is merged", () => {
    const ts = [
      task({ id: "a", status: "merged" }),
      task({ id: "b", status: "running" }),
      task({ id: "c", deps: ["a", "b"] }),
    ];
    expect(readyTasks(ts).map((t) => t.id)).toEqual([]); // b not merged yet
  });

  it("releases a fan-in task once all deps merged", () => {
    const ts = [
      task({ id: "a", status: "merged" }),
      task({ id: "b", status: "merged" }),
      task({ id: "c", deps: ["a", "b"] }),
    ];
    expect(readyTasks(ts).map((t) => t.id)).toEqual(["c"]);
  });

  it("excludes already-merged and failed tasks", () => {
    const ts = [task({ id: "a", status: "merged" }), task({ id: "b", status: "failed" })];
    expect(readyTasks(ts)).toEqual([]);
  });
});
