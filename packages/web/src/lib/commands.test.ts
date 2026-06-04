import { describe, it, expect, vi } from "vitest";
import { buildCommands, filterCommands, type CommandContext } from "./commands";

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    views: [
      { id: "chat", label: "Chat" },
      { id: "settings", label: "Settings" },
    ],
    agents: [{ id: "coo", displayName: "Otto" }],
    setView: vi.fn(),
    setActive: vi.fn(),
    openSettings: vi.fn(),
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
});

describe("filterCommands", () => {
  const cmds = buildCommands(ctx());
  it("returns everything for an empty query", () => {
    expect(filterCommands(cmds, "")).toHaveLength(cmds.length);
  });
  it("matches on title and keywords, case-insensitively", () => {
    const r = filterCommands(cmds, "otto");
    expect(r[0]?.id).toBe("agent:coo");
  });
  it("ranks prefix matches above substring matches", () => {
    const r = filterCommands(cmds, "chat");
    // "Chat with Otto" (prefix) ranks before "Go to Chat" (substring)
    expect(r[0]?.title.startsWith("Chat")).toBe(true);
  });
});
