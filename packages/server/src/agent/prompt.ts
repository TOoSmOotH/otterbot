import type { AgentContext } from "../runtime/agent-context.js";
import type { AgentDirectoryEntry } from "../runtime/agent-services.js";

const FALLBACK_PERSONA = `You are an Otterbot agent. You remember things across sessions,
author reusable skills when you learn something worth keeping, and build a model
of the user over time.

Principles:
- Be direct and concrete. Prefer doing to describing.`;

/**
 * Tool-usage rules appended to *every* agent's system prompt, independent of
 * persona. The persona (SOUL.md) is user-editable, so behaviour that must
 * always hold — like actually persisting memory — lives here, not in it.
 */
const OPERATING_GUIDE = `## Memory

Your memory only carries across sessions if you write to it with the \`save_memory\` tool. Chat replies are forgotten; saved memories are not.

Save a memory whenever the user:
- tells you to remember something ("remember that…", "don't forget…", "make a note…"),
- shares a durable fact about themselves — their name, role, location, the projects or people they mention,
- states a preference or a standing instruction for how you should work.

How to save: call \`save_memory\` in the same turn, before or alongside your reply, with \`content\` written as a clear standalone sentence. For example, if the user says "my name is Mike", call \`save_memory\` with \`content: "The user's name is Mike."\` and \`category: "fact"\`, then reply confirming you saved it. Replying "Got it" or "Noted" WITHOUT calling \`save_memory\` does not save anything — the fact is lost.

Use \`search_memory\` to recall earlier facts before answering questions about the user or past sessions. When you complete a multi-step task worth reusing, call \`author_skill\`. Never save a memory the user did not actually confirm.

## Images & files

Images and files are shown to the user automatically — those you create with a tool, and those another agent hands back when you delegate to it. Do NOT paste image URLs or markdown image links (\`![alt](/api/agents/.../images/x.png)\`) into your reply; they will not render and only clutter the message. Just refer to the result in plain language ("Here's the baseball bat image."). When you relay another agent's result, summarize it in your own words — never copy image links or file URLs out of their reply.`;

export interface BuildPromptArgs {
  userMessage: string;
  skillsLimit?: number;
  memoriesLimit?: number;
  /** Compacted recap of earlier turns when the conversation was compacted. */
  recap?: string | null;
  /** Agents this one may delegate to, so it knows who to hand work it can't do. */
  peers?: AgentDirectoryEntry[];
}

export interface BuiltPrompt {
  system: string;
  skillsUsed: string[];
  memoriesUsed: string[];
}

/**
 * Compose an agent's system prompt: its persona (SOUL.md) + the user profile +
 * top-K hybrid memory hits + top-K matching skills + the date. All data is read
 * from the agent's own isolated context.
 */
export async function buildSystemPrompt(
  ctx: AgentContext,
  args: BuildPromptArgs
): Promise<BuiltPrompt> {
  const mem = ctx.memory;
  const skillSvc = ctx.skills;
  const profile = ctx.userProfile;

  const contentHits = await mem.searchContent(
    args.userMessage,
    (args.skillsLimit ?? 3) + (args.memoriesLimit ?? 6)
  );

  // Enabled capabilities are always injected; their tools are always granted.
  const enabledSkills = skillSvc.listEnabled();
  const enabledIds = new Set(enabledSkills.map((s) => s.id));

  // Semantic-searched skill hits cover only non-enabled / pure-prompt skills —
  // enabled capabilities are already injected, so don't double-render them.
  const skillHits = contentHits
    .filter((h) => h.kind === "skill" && !enabledIds.has(h.refId))
    .slice(0, args.skillsLimit ?? 3);
  const memoryHits = contentHits.filter((h) => h.kind !== "skill").slice(0, args.memoriesLimit ?? 6);

  const persona = ctx.profile.persona.trim() || FALLBACK_PERSONA;
  const parts: string[] = [persona, OPERATING_GUIDE];

  if (args.peers && args.peers.length > 0) {
    const rendered = args.peers
      .map((p) => `- \`${p.id}\` — ${p.displayName}: ${p.summary}`)
      .join("\n");
    parts.push(
      `## Agents you can delegate to\n\n` +
        `You can hand work to these agents with the \`delegate\` tool (call \`list_agents\` for the live roster). ` +
        `When a request needs something you can't do yourself — generate an image, run code, send email, and so on — and one of them handles it, delegate the task and relay their result. ` +
        `Never say you did something (produced an image, sent a message) that you did not actually do with a tool; if you can't do it and no peer can, say so.\n\n` +
        rendered
    );
  }

  const profileBlock = profile.renderForPrompt();
  if (profileBlock) parts.push(profileBlock);

  if (memoryHits.length > 0) {
    const rendered = memoryHits
      .map((h) => `- [${h.kind}] ${truncate(h.body, 240)}`)
      .join("\n");
    parts.push(`## Relevant memories\n\n${rendered}`);
  }

  if (enabledSkills.length > 0) {
    const rendered = enabledSkills
      .map((s) => `### Capability: ${s.meta.name}\n${s.meta.description}\n\n${s.body}`)
      .join("\n\n---\n\n");
    parts.push(`## Active capabilities\n\n${rendered}`);
    for (const s of enabledSkills) skillSvc.recordUse(s.id);
  }

  if (skillHits.length > 0) {
    const rendered = skillHits
      .map((h) => {
        const skill = skillSvc.get(h.refId);
        if (!skill) return null;
        return `### Skill: ${skill.meta.name}\n${skill.meta.description}\n\n${skill.body}`;
      })
      .filter((x): x is string => x !== null)
      .join("\n\n---\n\n");
    if (rendered) {
      parts.push(`## Relevant skills (applied)\n\n${rendered}`);
      for (const h of skillHits) skillSvc.recordUse(h.refId);
    }
  }

  if (args.recap && args.recap.trim()) {
    parts.push(`## Earlier in this conversation\n\n${args.recap.trim()}`);
  }

  parts.push(`## Today\n${new Date().toISOString().slice(0, 10)}`);

  return {
    system: parts.join("\n\n"),
    skillsUsed: [...enabledSkills.map((s) => s.id), ...skillHits.map((h) => h.refId)],
    memoriesUsed: memoryHits.map((h) => h.refId),
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
