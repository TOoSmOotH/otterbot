import { describe, it, expect, vi } from "vitest";
import { buildCommands, filterCommands, type CommandContext } from "./commands";

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    views: [
      { id: "chat", label: "Chat" },
      { id: "settings", label: "Settings" },
    ],
    agents: [{ id: "coo", displayName: "Otto" }],
    projects: [],
    setView: vi.fn(),
    setActive: vi.fn(),
    openSettings: vi.fn(),
    openProject: vi.fn(),
    onNewAgent: vi.fn(),
    ...over,
  };
}

describe("buildCommands", () => {
  it("creates navigation, agent, and action commands", () => {
    const cmds = buildCommands(ctx());
    expect(cmds.find((c) => c.id === "nav:chat")).toBeTruthy();
    expect(cmds.find((c) => c.id === "agent:coo")?.title).toBe("Chat with Otto");
    expect(cmds.find((c) => c.id === "action:new-agent")).toBeTruthy();
    expect(cmds.find((c) => c.id === "action:settings")).toBeTruthy();
  });

  it("agent command selects the agent and opens chat", () => {
    const c = ctx();
    buildCommands(c).find((x) => x.id === "agent:coo")!.run();
    expect(c.setActive).toHaveBeenCalledWith("coo");
    expect(c.setView).toHaveBeenCalledWith("chat");
  });

  it("project command opens the project dashboard", () => {
    const openProject = vi.fn();
    const cmds = buildCommands(
      ctx({ projects: [{ id: "p1", name: "Otter" }], openProject })
    );
    const cmd = cmds.find((c) => c.id === "project:p1");
    expect(cmd).toBeTruthy();
    expect(cmd?.title).toBe("Open project Otter");
    cmd!.run();
    expect(openProject).toHaveBeenCalledWith("p1");
  });
});

describe("filterCommands", () => {
  it("returns everything for an empty query", () => {
    const cmds = buildCommands(ctx());
    expect(filterCommands(cmds, "")).toHaveLength(cmds.length);
  });
  it("matches on title and keywords, case-insensitively", () => {
    const cmds = buildCommands(ctx());
    const r = filterCommands(cmds, "otto");
    expect(r[0]?.id).toBe("agent:coo");
  });
  it("ranks prefix matches above substring matches", () => {
    const cmds = buildCommands(ctx());
    const r = filterCommands(cmds, "chat");
    // "Chat with Otto" (prefix on title) ranks before "Go to Chat" (substring)
    expect(r[0]?.id).toBe("agent:coo");
  });
});
