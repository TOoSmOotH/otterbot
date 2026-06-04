export type CommandGroup = "Navigation" | "Agents" | "Actions";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  keywords: string[];
  run: () => void;
}

export interface CommandContext {
  views: { id: string; label: string }[];
  agents: { id: string; displayName: string }[];
  setView: (id: string) => void;
  setActive: (id: string) => void;
  openSettings: () => void;
  onNewAgent: () => void;
}

export function buildCommands(ctx: CommandContext): Command[] {
  const nav: Command[] = ctx.views.map((v) => ({
    id: `nav:${v.id}`,
    title: `Go to ${v.label}`,
    group: "Navigation",
    keywords: [v.label, v.id],
    run: () => ctx.setView(v.id),
  }));

  const agents: Command[] = ctx.agents.map((a) => ({
    id: `agent:${a.id}`,
    title: `Chat with ${a.displayName}`,
    group: "Agents",
    keywords: [a.displayName, a.id, "chat", "dm"],
    run: () => {
      ctx.setActive(a.id);
      ctx.setView("chat");
    },
  }));

  const actions: Command[] = [
    {
      id: "action:new-agent",
      title: "Hire new agent",
      group: "Actions",
      keywords: ["new", "agent", "hire", "create"],
      run: ctx.onNewAgent,
    },
    {
      id: "action:settings",
      title: "Open settings",
      group: "Actions",
      keywords: ["settings", "preferences", "config"],
      run: ctx.openSettings,
    },
  ];

  return [...agents, ...nav, ...actions];
}

/** Substring filter with prefix-first ranking. Empty query → original order. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const scored: { cmd: Command; score: number }[] = [];
  for (const cmd of commands) {
    const hay = [cmd.title, ...cmd.keywords].map((s) => s.toLowerCase());
    const prefix = hay.some((h) => h.startsWith(q));
    const includes = hay.some((h) => h.includes(q));
    if (!includes) continue;
    scored.push({ cmd, score: prefix ? 0 : 1 });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.cmd);
}
