import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { Scheduler, type SchedulableRuntime } from "./scheduler.js";

describe("Scheduler", () => {
  let dir: string;
  let control: ControlDb;
  let fired: string[];
  let scheduler: Scheduler;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-sched-"));
    control = openControlDb(join(dir, "control.db"));
    fired = [];
    const runtime: SchedulableRuntime = {
      respond: async ({ userMessage }) => {
        fired.push(userMessage);
      },
    };
    scheduler = new Scheduler(control, () => runtime);
  });

  afterEach(() => {
    scheduler.stop();
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds a task and computes its next run", () => {
    const task = scheduler.add("coo", "0 9 * * *", "daily standup");
    expect(task).not.toBeNull();
    expect(task?.enabled).toBe(true);
    expect(task?.nextRunAt).toBeTruthy();
  });

  it("rejects an invalid cron expression", () => {
    expect(scheduler.add("coo", "not-a-cron", "x")).toBeNull();
  });

  it("lists tasks, optionally filtered by agent", () => {
    scheduler.add("coo", "0 9 * * *", "a");
    scheduler.add("research", "0 10 * * *", "b");
    expect(scheduler.list()).toHaveLength(2);
    expect(scheduler.list("coo")).toHaveLength(1);
    expect(scheduler.list("coo")[0].prompt).toBe("a");
  });

  it("cancels a task (disables it and stops the job)", () => {
    const task = scheduler.add("coo", "0 9 * * *", "x")!;
    expect(scheduler.cancel(task.id)).toBe(true);
    expect(scheduler.list("coo").filter((t) => t.enabled)).toHaveLength(0);
  });

  it("fires a scheduled prompt against the agent's runtime", async () => {
    scheduler.add("coo", "* * * * * *", "tick"); // every second
    await new Promise((r) => setTimeout(r, 2200));
    expect(fired.length).toBeGreaterThan(0);
    expect(fired[0]).toBe("tick");
  });
});
