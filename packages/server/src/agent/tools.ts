import { tool } from "ai";
import { z } from "zod";
import { getMemoryService } from "../memory/memory-service.js";
import { getSkillService } from "../skills/skill-service.js";
import { getUserProfileService } from "../user-profile/user-profile-service.js";

export function buildAgentTools() {
  const mem = getMemoryService();
  const skills = getSkillService();
  const profile = getUserProfileService();

  return {
    save_memory: tool({
      description:
        "Save a durable fact, preference, or instruction about the user or their work for later recall. Use only for things worth remembering across sessions.",
      parameters: z.object({
        content: z.string().min(1),
        category: z
          .enum(["preference", "fact", "instruction", "relationship", "general"])
          .default("general"),
        importance: z.number().min(1).max(10).default(5),
      }),
      execute: async ({ content, category, importance }) => {
        const entry = mem.save({ content, category, importance, source: "agent" });
        return { id: entry.id, saved: true };
      },
    }),

    list_skills: tool({
      description: "List all skills available to the agent. Returns names, descriptions, and tags.",
      parameters: z.object({}),
      execute: async () => {
        return skills.list().map((s) => ({
          id: s.id,
          name: s.meta.name,
          description: s.meta.description,
          tags: s.meta.tags,
          useCount: s.useCount,
        }));
      },
    }),

    author_skill: tool({
      description:
        "Author a new reusable skill. Use when you've just completed a task in a way that would be worth repeating. Provide clear procedural steps in the body.",
      parameters: z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        body: z.string().min(1),
        tags: z.array(z.string()).default([]),
      }),
      execute: async ({ name, description, body, tags }) => {
        const skill = skills.create({
          meta: {
            name,
            description,
            version: "1.0.0",
            author: "otterbot",
            tools: [],
            capabilities: [],
            parameters: {},
            tags,
          },
          body,
          source: "authored",
        });
        return { id: skill.id, created: true };
      },
    }),

    update_skill: tool({
      description:
        "Update an existing skill, either replacing its body or appending a refinement note. Use the skill's id from list_skills.",
      parameters: z.object({
        id: z.string().min(1),
        body: z.string().optional(),
        appendNote: z.string().optional(),
        description: z.string().optional(),
      }),
      execute: async ({ id, body, appendNote, description }) => {
        const updated = skills.update(id, {
          body,
          appendNote,
          meta: description ? { description } : undefined,
        });
        if (!updated) return { ok: false, reason: "skill not found" };
        return { ok: true, id: updated.id };
      },
    }),

    update_user_profile: tool({
      description:
        "Add a known fact, preference, or goal to the user's persistent profile. Use sparingly for durable attributes only.",
      parameters: z.object({
        bucket: z.enum(["preferences", "goals", "facts"]),
        content: z.string().min(1),
      }),
      execute: async ({ bucket, content }) => {
        profile.addFact(bucket, content);
        return { ok: true };
      },
    }),
  };
}
