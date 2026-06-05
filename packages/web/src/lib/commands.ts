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
  projects: { id: string; name: string }[];
  setView: (id: string) => void;
  setActive: (id: string) => void;
  openSettings: () => void;
  openProject: (id: string) => void;
  onNewAgent: () => void;
}

/** Build the flat command list. Order is agents → navigation → actions so the
 *  most-used group surfaces first in the palette. */
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

  const projectCmds: Command[] = ctx.projects.map((p) => ({
    id: `project:${p.id}`,
    title: `Open project ${p.name}`,
    group: "Navigation",
    keywords: [p.name, "project"],
    run: () => ctx.openProject(p.id),
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

  return [...agents, ...projectCmds, ...nav, ...actions];
}

/** Substring filter with prefix-first ranking. Empty query → original order;
 *  within an equal-rank bucket, original order is preserved (stable sort). */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const scored: { cmd: Command; score: number }[] = [];
  for (const cmd of commands) {
    let score = -1;
    for (const field of [cmd.title, ...cmd.keywords]) {
      const h = field.toLowerCase();
      if (h.startsWith(q)) {
        score = 0;
        break;
      }
      if (h.includes(q)) {
        score = 1;
      }
    }
    if (score === -1) continue;
    scored.push({ cmd, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.cmd);
}
