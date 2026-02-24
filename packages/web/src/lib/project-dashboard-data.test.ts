import { describe, it, expect } from "vitest";
import { deriveProjectDashboardData } from "./project-dashboard-data";
import { KanbanColumn } from "@otterbot/shared";
import type { KanbanTask, Agent } from "@otterbot/shared";

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "Test task",
    description: "",
    column: KanbanColumn.Backlog,
    position: 0,
    assigneeAgentId: null,
    createdBy: null,
    completionReport: null,
    prNumber: null,
    prBranch: null,
    labels: [],
    blockedBy: [],
    pipelineStage: null,
    pipelineStages: [],
    pipelineAttempt: 0,
    createdAt: "2026-02-20T10:00:00Z",
    updatedAt: "2026-02-20T10:00:00Z",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Test Agent",
    registryEntryId: null,
    role: "worker" as Agent["role"],
    parentId: null,
    status: "idle" as Agent["status"],
    model: "gpt-4",
    provider: "openai",
    projectId: null,
    modelPackId: null,
    gearConfig: null,
    workspacePath: null,
    createdAt: "2026-02-20T10:00:00Z",
    ...overrides,
  };
}

describe("deriveProjectDashboardData", () => {
  describe("task counts and progress", () => {
    it("counts tasks by column", () => {
      const tasks = [
        makeTask({ id: "1", column: KanbanColumn.Backlog }),
        makeTask({ id: "2", column: KanbanColumn.InProgress }),
        makeTask({ id: "3", column: KanbanColumn.Done }),
        makeTask({ id: "4", column: KanbanColumn.Done }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");

      expect(result.backlog).toHaveLength(1);
      expect(result.inProgress).toHaveLength(1);
      expect(result.done).toHaveLength(2);
      expect(result.total).toBe(4);
    });

    it("calculates progress percentage as done/total rounded", () => {
      const tasks = [
        makeTask({ id: "1", column: KanbanColumn.Done }),
        makeTask({ id: "2", column: KanbanColumn.Done }),
        makeTask({ id: "3", column: KanbanColumn.Backlog }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      // 2/3 = 66.67 -> rounded to 67
      expect(result.progressPct).toBe(67);
    });

    it("returns 0% progress when there are no tasks", () => {
      const result = deriveProjectDashboardData([], new Map(), "proj-1");
      expect(result.progressPct).toBe(0);
      expect(result.total).toBe(0);
    });

    it("returns 100% when all tasks are done", () => {
      const tasks = [
        makeTask({ id: "1", column: KanbanColumn.Done }),
        makeTask({ id: "2", column: KanbanColumn.Done }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      expect(result.progressPct).toBe(100);
    });
  });

  describe("triage column handling", () => {
    it("filters triage tasks separately", () => {
      const tasks = [
        makeTask({ id: "1", column: KanbanColumn.Triage }),
        makeTask({ id: "2", column: KanbanColumn.Backlog }),
        makeTask({ id: "3", column: KanbanColumn.Done }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      expect(result.triage).toHaveLength(1);
      expect(result.triage[0].id).toBe("1");
    });

    it("excludes triage tasks from total and progress calculation", () => {
      const tasks = [
        makeTask({ id: "1", column: KanbanColumn.Triage }),
        makeTask({ id: "2", column: KanbanColumn.Triage }),
        makeTask({ id: "3", column: KanbanColumn.Done }),
        makeTask({ id: "4", column: KanbanColumn.Backlog }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      // total should be 2 (done + backlog), not 4
      expect(result.total).toBe(2);
      // progress should be 1/2 = 50%
      expect(result.progressPct).toBe(50);
    });

    it("returns 0% progress when only triage tasks exist", () => {
      const tasks = [
        makeTask({ id: "1", column: KanbanColumn.Triage }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      expect(result.total).toBe(0);
      expect(result.progressPct).toBe(0);
    });
  });

  describe("in-progress task filtering", () => {
    it("returns only in-progress tasks", () => {
      const tasks = [
        makeTask({ id: "1", column: KanbanColumn.InProgress, title: "Active" }),
        makeTask({ id: "2", column: KanbanColumn.Backlog, title: "Waiting" }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      expect(result.inProgress).toHaveLength(1);
      expect(result.inProgress[0].title).toBe("Active");
    });
  });

  describe("GitHub issue filtering", () => {
    it("filters tasks with github-issue labels", () => {
      const tasks = [
        makeTask({ id: "1", labels: ["github-issue#42"] }),
        makeTask({ id: "2", labels: ["github-issue-sync"] }),
        makeTask({ id: "3", labels: ["bug"] }),
        makeTask({ id: "4", labels: [] }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      expect(result.githubTasks).toHaveLength(2);
      expect(result.githubTasks.map((t) => t.id)).toEqual(["1", "2"]);
    });

    it("returns empty array when no tasks have github labels", () => {
      const tasks = [
        makeTask({ id: "1", labels: ["bug", "feature"] }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      expect(result.githubTasks).toHaveLength(0);
    });
  });

  describe("agent filtering", () => {
    it("returns only agents matching the projectId", () => {
      const agents = new Map<string, Agent>([
        ["a1", makeAgent({ id: "a1", projectId: "proj-1", name: "Worker A" })],
        ["a2", makeAgent({ id: "a2", projectId: "proj-2", name: "Worker B" })],
        ["a3", makeAgent({ id: "a3", projectId: "proj-1", name: "Worker C" })],
      ]);
      const result = deriveProjectDashboardData([], agents, "proj-1");
      expect(result.projectAgents).toHaveLength(2);
      expect(result.projectAgents.map((a) => a.name)).toEqual(["Worker A", "Worker C"]);
    });

    it("returns empty array when no agents match", () => {
      const agents = new Map<string, Agent>([
        ["a1", makeAgent({ id: "a1", projectId: "proj-other" })],
      ]);
      const result = deriveProjectDashboardData([], agents, "proj-1");
      expect(result.projectAgents).toHaveLength(0);
    });
  });

  describe("recent activity", () => {
    it("sorts tasks by updatedAt descending and limits to 5", () => {
      const tasks = Array.from({ length: 7 }, (_, i) =>
        makeTask({
          id: `t${i}`,
          title: `Task ${i}`,
          updatedAt: `2026-02-20T${String(10 + i).padStart(2, "0")}:00:00Z`,
        }),
      );
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      expect(result.recentTasks).toHaveLength(5);
      // Most recent first (t6, t5, t4, t3, t2)
      expect(result.recentTasks.map((t) => t.id)).toEqual(["t6", "t5", "t4", "t3", "t2"]);
    });

    it("returns all tasks if fewer than 5", () => {
      const tasks = [
        makeTask({ id: "1", updatedAt: "2026-02-20T12:00:00Z" }),
        makeTask({ id: "2", updatedAt: "2026-02-20T11:00:00Z" }),
      ];
      const result = deriveProjectDashboardData(tasks, new Map(), "proj-1");
      expect(result.recentTasks).toHaveLength(2);
      expect(result.recentTasks[0].id).toBe("1");
    });

    it("returns empty array when no tasks exist", () => {
      const result = deriveProjectDashboardData([], new Map(), "proj-1");
      expect(result.recentTasks).toHaveLength(0);
    });
  });
});
