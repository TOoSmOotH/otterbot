import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KanbanTask } from "@otterbot/shared";
import { KanbanColumn } from "@otterbot/shared";

vi.mock("../../stores/project-store", () => ({
  useProjectStore: (selector: (s: { tasks: KanbanTask[]; updateTask: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ tasks: [], updateTask: vi.fn() }),
}));

vi.mock("../../lib/socket", () => ({
  getSocket: () => ({ emit: vi.fn() }),
}));

import { KanbanTaskDetail } from "./KanbanTaskDetail";

function makeTask(overrides?: Partial<KanbanTask>): KanbanTask {
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "Task title",
    description: "Task description",
    column: KanbanColumn.Triage,
    position: 0,
    assigneeAgentId: null,
    createdBy: null,
    completionReport: null,
    prNumber: null,
    prBranch: null,
    labels: ["github-issue-42"],
    blockedBy: [],
    pipelineStage: null,
    pipelineStages: [],
    taskNumber: 1,
    pipelineAttempt: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("KanbanTaskDetail retriage action", () => {
  it("shows Re-triage action for triage task with GitHub issue label", () => {
    const html = renderToStaticMarkup(
      <KanbanTaskDetail task={makeTask()} projectId="proj-1" onClose={vi.fn()} />,
    );
    expect(html).toContain("Re-triage");
  });

  it("hides Re-triage action when task is not linked to a GitHub issue", () => {
    const html = renderToStaticMarkup(
      <KanbanTaskDetail task={makeTask({ labels: ["bug"] })} projectId="proj-1" onClose={vi.fn()} />,
    );
    expect(html).not.toContain("Re-triage");
  });
});
