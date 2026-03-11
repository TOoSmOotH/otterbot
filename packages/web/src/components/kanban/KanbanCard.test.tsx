import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KanbanColumn, type KanbanTask } from "@otterbot/shared";
import { KanbanCard } from "./KanbanCard";

const emitMock = vi.fn();

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
    Transform: { toString: vi.fn(() => "") },
  },
}));

vi.mock("../../stores/merge-queue-store", () => ({
  useMergeQueueStore: (selector: (state: { entries: any[] }) => unknown) => selector({ entries: [] }),
}));

vi.mock("../../lib/socket", () => ({
  getSocket: () => ({ emit: emitMock }),
}));

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  const now = new Date().toISOString();
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "Task title",
    description: "",
    column: KanbanColumn.Triage,
    position: 0,
    assigneeAgentId: null,
    createdBy: "test",
    completionReport: null,
    prNumber: null,
    prBranch: null,
    labels: [],
    blockedBy: [],
    pipelineStage: null,
    pipelineStages: [],
    taskNumber: 1,
    pipelineAttempt: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function findRetriageButton(node: any): any | null {
  if (!node || typeof node !== "object") return null;
  if (node.type === "button" && node.props?.children === "Re-triage") return node;

  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findRetriageButton(child);
      if (found) return found;
    }
    return null;
  }
  return findRetriageButton(children);
}

describe("KanbanCard Re-triage button", () => {
  beforeEach(() => {
    emitMock.mockReset();
  });

  it("shows Re-triage for triage-column tasks linked to a GitHub issue", () => {
    const html = renderToStaticMarkup(
      <KanbanCard task={makeTask({ labels: ["github-issue-439"] })} />,
    );

    expect(html).toContain("Re-triage");
  });

  it("hides Re-triage for non-GitHub tasks or non-triage columns", () => {
    const noIssueLabel = renderToStaticMarkup(
      <KanbanCard task={makeTask({ labels: ["bug"], column: KanbanColumn.Triage })} />,
    );
    const wrongColumn = renderToStaticMarkup(
      <KanbanCard task={makeTask({ labels: ["github-issue-439"], column: KanbanColumn.Backlog })} />,
    );

    expect(noIssueLabel).not.toContain("Re-triage");
    expect(wrongColumn).not.toContain("Re-triage");
  });

  it("emits kanban:retriage with the task id when clicked", () => {
    const task = makeTask({ id: "internal-task-abc", labels: ["github-issue-439"], column: KanbanColumn.Triage });
    const tree = KanbanCard({ task });
    const retriageButton = findRetriageButton(tree);
    expect(retriageButton).toBeTruthy();

    const stopPropagation = vi.fn();
    retriageButton.props.onClick({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith("kanban:retriage", { taskId: "internal-task-abc" });
  });
});
