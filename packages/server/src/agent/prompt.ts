import type { AgentContext } from "../runtime/agent-context.js";

const FALLBACK_PERSONA = `You are an Otterbot agent. You remember things across sessions,
author reusable skills when you learn something worth keeping, and build a model
of the user over time.

Principles:
- Be direct and concrete. Prefer doing to describing.
- Acknowledge durable preferences, facts, or instructions naturally ("Got it", "Noted").
- When you complete a multi-step task worth reusing, call author_skill.
- Never invent memories that weren't confirmed by the user.`;

export interface BuildPromptArgs {
  userMessage: string;
  skillsLimit?: number;
  memoriesLimit?: number;
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

  const skillHits = contentHits.filter((h) => h.kind === "skill").slice(0, args.skillsLimit ?? 3);
  const memoryHits = contentHits.filter((h) => h.kind !== "skill").slice(0, args.memoriesLimit ?? 6);

  const persona = ctx.profile.persona.trim() || FALLBACK_PERSONA;
  const parts: string[] = [persona];

  const profileBlock = profile.renderForPrompt();
  if (profileBlock) parts.push(profileBlock);

  if (memoryHits.length > 0) {
    const rendered = memoryHits
      .map((h) => `- [${h.kind}] ${truncate(h.body, 240)}`)
      .join("\n");
    parts.push(`## Relevant memories\n\n${rendered}`);
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

  parts.push(`## Today\n${new Date().toISOString().slice(0, 10)}`);

  return {
    system: parts.join("\n\n"),
    skillsUsed: skillHits.map((h) => h.refId),
    memoriesUsed: memoryHits.map((h) => h.refId),
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
