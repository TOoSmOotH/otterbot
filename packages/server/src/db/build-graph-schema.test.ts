import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openControlDb, controlSchema, type ControlDb } from "./control-db.js";

describe("build_runs / tasks schema", () => {
  let dir: string;
  let control: ControlDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-bg-schema-"));
    control = openControlDb(join(dir, "control.db"));
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a build run and a task row", () => {
    const now = new Date().toISOString();
    control.db
      .insert(controlSchema.buildRuns)
      .values({ id: "run1", projectId: "proj1", goal: "build it", createdAt: now, updatedAt: now })
      .run();
    control.db
      .insert(controlSchema.tasks)
      .values({
        id: "t1",
        runId: "run1",
        projectId: "proj1",
        title: "implement X",
        role: "coder",
        deps: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const run = control.db
      .select()
      .from(controlSchema.buildRuns)
      .where(eq(controlSchema.buildRuns.id, "run1"))
      .get();
    const task = control.db
      .select()
      .from(controlSchema.tasks)
      .where(eq(controlSchema.tasks.id, "t1"))
      .get();

    expect(run?.status).toBe("planning"); // default
    expect(run?.parallelism).toBe(3); // default
    expect(task?.status).toBe("blocked"); // default
    expect(task?.attempt).toBe(0);
    expect(task?.deps).toBe("[]");
  });

  it("round-trips a build task transcript row", () => {
    const now = new Date().toISOString();
    const content = JSON.stringify([{ role: "assistant", content: "did the thing", toolCalls: null }]);
    control.db
      .insert(controlSchema.buildTaskTranscripts)
      .values({ runId: "run1", taskId: "t1", attempt: 0, content, createdAt: now })
      .run();

    const row = control.db
      .select()
      .from(controlSchema.buildTaskTranscripts)
      .where(eq(controlSchema.buildTaskTranscripts.taskId, "t1"))
      .get();

    expect(row?.runId).toBe("run1");
    expect(row?.attempt).toBe(0);
    expect(row?.content).toBe(content);
    expect(typeof row?.id).toBe("number"); // autoincrement
  });
});
