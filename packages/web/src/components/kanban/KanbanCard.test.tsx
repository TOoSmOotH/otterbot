import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KanbanTask } from "@otterbot/shared";
import { KanbanColumn } from "@otterbot/shared";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => undefined),
    },
  },
}));

vi.mock("../../stores/merge-queue-store", () => ({
  useMergeQueueStore: (selector: (s: { entries: unknown[] }) => unknown) => selector({ entries: [] }),
}));

vi.mock("../../lib/socket", () => ({
  getSocket: () => ({ emit: vi.fn() }),
}));

import { KanbanCard } from "./KanbanCard";

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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("KanbanCard retriage button", () => {
  it("renders Re-triage button for triage tasks linked to a GitHub issue", () => {
    const html = renderToStaticMarkup(<KanbanCard task={makeTask()} />);
    expect(html).toContain("Re-triage");
  });

  it("does not render Re-triage button without a GitHub issue label", () => {
    const html = renderToStaticMarkup(
      <KanbanCard task={makeTask({ labels: ["bug"] })} />,
    );
    expect(html).not.toContain("Re-triage");
  });
});
