import { describe, expect, it } from "vitest";
import type { AgentProfileSummary } from "@otterbot/shared";
import type { Project } from "../../../stores/projects-store";
import { buildOfficeMap } from "./officeMap";
import { buildWorld } from "./worldLayout";

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
    canRunShell: false,
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
    forkRepo: null,
    baseBranch: null,
    monitorIssues: false,
    triageIssues: false,
    remoteE2e: false,
    rules: null,
  };
}

describe("buildOfficeMap", () => {
  it("converts a dynamic world into tile and sprite object layers", () => {
    const world = buildWorld(
      [agent("coo", "coo"), agent("p1-a", "agent"), agent("solo", "agent")],
      [project("p1", ["p1-a"])]
    );
    const map = buildOfficeMap(world);

    expect(map.width).toBe(world.pxWidth);
    expect(map.height).toBe(world.pxHeight);
    expect(map.tileLayer.tiles).toHaveLength(world.cols * world.rows);
    expect(map.objects.some((o) => o.kind === "desk" && o.agentId === "p1-a")).toBe(true);
    expect(map.objects.some((o) => o.kind === "worker" && o.agentId === "solo")).toBe(true);
    expect(map.objects.some((o) => o.kind === "sprite" && o.atlas === "props")).toBe(true);
    expect(map.objects.some((o) => o.kind === "whiteboard" && o.roomId === "p1")).toBe(true);
  });
});
