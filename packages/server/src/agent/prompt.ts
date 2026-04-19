import { getMemoryService } from "../memory/memory-service.js";
import { getSkillService } from "../skills/skill-service.js";
import { getUserProfileService } from "../user-profile/user-profile-service.js";

const BASE_PERSONA = `You are Otterbot, a personal AI assistant running locally on the user's machine. You remember things across sessions, author reusable skills when you learn something worth keeping, and build a model of the user over time.

Principles:
- Be direct and concrete. Prefer doing to describing.
- When you learn something durable about the user, call save_memory.
- When you complete a multi-step task in a way worth reusing, call author_skill.
- When you use an existing skill and discover a refinement, call update_skill with appendNote.
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

export function buildSystemPrompt(args: BuildPromptArgs): BuiltPrompt {
  const mem = getMemoryService();
  const skillSvc = getSkillService();
  const profile = getUserProfileService();

  const skillHits = mem
    .searchContent(args.userMessage, (args.skillsLimit ?? 3) + (args.memoriesLimit ?? 6))
    .filter((h) => h.kind === "skill")
    .slice(0, args.skillsLimit ?? 3);

  const memoryHits = mem
    .searchContent(args.userMessage, (args.memoriesLimit ?? 6) + (args.skillsLimit ?? 3))
    .filter((h) => h.kind !== "skill")
    .slice(0, args.memoriesLimit ?? 6);

  const parts: string[] = [BASE_PERSONA];

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
