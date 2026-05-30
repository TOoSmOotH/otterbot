import { describe, it, expect } from "vitest";
import { buildWorld } from "./worldLayout";
import { Cell } from "./geometry";
import type { AgentProfileSummary } from "@otterbot/shared";
import type { Project } from "../../../stores/projects-store";

function agent(id: string, role: AgentProfileSummary["role"]): AgentProfileSummary {
  return {
    id,
    displayName: id,
    role,
    status: "idle",
    chatModel: { provider: "x", account: "default", modelId: "m" },
    artwork: { avatar: null },
    parentId: null,
    activeSubagents: 0,
  };
}

function project(id: string, memberIds: string[]): Project {
  return {
    id,
    name: id.toUpperCase(),
    repoPath: "",
    createdAt: "",
    members: memberIds.map((agentId) => ({ agentId, access: "write" as const })),
    team: memberIds.map((agentId, i) => ({ role: `r${i}`, agentId })),
    mode: "local",
    forgeAccountId: null,
    forgeRepo: null,
    baseBranch: null,
    monitorIssues: false,
    rules: null,
  };
}

describe("buildWorld", () => {
  const agents = [
    agent("coo", "coo"),
    agent("p1-a", "agent"),
    agent("p1-b", "agent"),
    agent("solo", "agent"),
  ];
  const projects = [project("p1", ["p1-a", "p1-b"])];

  it("gives every non-subagent agent a desk slot", () => {
    const w = buildWorld(agents, projects);
    expect(Object.keys(w.deskOf).sort()).toEqual(["coo", "p1-a", "p1-b", "solo"]);
  });

  it("excludes subagents from desks", () => {
    const w = buildWorld([...agents, agent("sub", "subagent")], projects);
    expect(w.deskOf["sub"]).toBeUndefined();
  });

  it("creates a project room, a coo room, and an unassigned cluster", () => {
    const w = buildWorld(agents, projects);
    const kinds = w.rooms.map((r) => r.kind).sort();
    expect(kinds).toEqual(["coo", "project", "unassigned"]);
    const proj = w.rooms.find((r) => r.kind === "project")!;
    expect(proj.label).toBe("P1");
    expect(proj.whiteboard).toBeDefined();
  });

  it("marks each project room's door tile as DOOR and walkable from outside", () => {
    const w = buildWorld(agents, projects);
    const proj = w.rooms.find((r) => r.kind === "project")!;
    expect(w.grid[proj.doorTy * w.cols + proj.doorTx]).toBe(Cell.DOOR);
    const below = (proj.doorTy + 1) * w.cols + proj.doorTx;
    expect(w.grid[below]).toBe(Cell.FLOOR);
  });

  it("keeps COO and agent pool in the left column with projects stacked on the right", () => {
    const manyAgents = [
      agent("coo", "coo"),
      agent("p1-a", "agent"),
      agent("p2-a", "agent"),
      agent("p3-a", "agent"),
      agent("solo", "agent"),
    ];
    const w = buildWorld(manyAgents, [
      project("p1", ["p1-a"]),
      project("p2", ["p2-a"]),
      project("p3", ["p3-a"]),
    ]);

    const projectRooms = w.rooms.filter((r) => r.kind === "project");
    const cooRoom = w.rooms.find((r) => r.kind === "coo")!;
    const agentRoom = w.rooms.find((r) => r.kind === "unassigned")!;

    expect(projectRooms).toHaveLength(3);
    expect(new Set(projectRooms.map((r) => r.x)).size).toBe(1);
    expect(projectRooms.map((r) => r.y)).toEqual([...projectRooms.map((r) => r.y)].sort((a, b) => a - b));
    expect(projectRooms[1].y).toBeGreaterThan(projectRooms[0].y);
    expect(agentRoom.x).toBe(cooRoom.x);
    expect(agentRoom.y).toBeGreaterThan(cooRoom.y);
    expect(projectRooms[0].x).toBeGreaterThan(Math.max(cooRoom.x + cooRoom.w, agentRoom.x + agentRoom.w));
  });

  it("marks desk tiles as DESK and keeps the chair tile walkable", () => {
    const w = buildWorld(agents, projects);
    const slot = w.deskOf["p1-a"];
    expect(w.grid[slot.deskTy * w.cols + slot.deskTx]).toBe(Cell.DESK);
    expect(w.grid[slot.chairTy * w.cols + slot.chairTx]).toBe(Cell.FLOOR);
  });

  it("returns positive pixel dimensions", () => {
    const w = buildWorld(agents, projects);
    expect(w.pxWidth).toBeGreaterThan(0);
    expect(w.pxHeight).toBeGreaterThan(0);
  });
});
