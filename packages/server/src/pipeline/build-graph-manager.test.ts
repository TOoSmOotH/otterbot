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
});
