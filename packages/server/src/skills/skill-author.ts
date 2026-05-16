import { asc, eq } from "drizzle-orm";
import { generateText } from "ai";
import * as schema from "../db/schema.js";
import { resolveChatModel } from "../providers/registry.js";
import type { AgentContext } from "../runtime/agent-context.js";
import type { Skill } from "@otterbot/shared";

const AUTHOR_PROMPT = `You are a skill curator. After the assistant completes a task, decide whether the approach is worth crystallizing into a reusable skill document the assistant can read back on similar future tasks.

If YES, output a markdown file with YAML frontmatter and a procedural body. Be concrete: list the steps, the preconditions, the gotchas. The body should be procedural (instructions) not descriptive (what happened).

If NO (task was trivial / one-off / already covered by an existing skill / failed), output the literal text "SKIP".

Frontmatter format:
---
name: <short imperative title>
description: <one sentence>
version: 1.0.0
author: otterbot-autolearner
tags: [<lowercase, space-free tags>]
---

Body: markdown steps / code examples.`;

/**
 * Called after a session closes. Given the transcript, asks the agent's model
 * to decide whether to distill a new skill into that agent's skill set.
 */
export async function maybeAuthorSkill(
  ctx: AgentContext,
  conversationId: string
): Promise<Skill | null> {
  const messages = ctx.db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt))
    .all();
  if (messages.length < 4) return null;

  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const existingSkills = ctx.skills
    .list()
    .slice(0, 40)
    .map((s) => `- ${s.meta.name}: ${s.meta.description}`)
    .join("\n");

  const prompt = `Existing skills:\n${existingSkills || "(none)"}\n\nTranscript:\n${transcript}`;

  let text: string;
  try {
    const res = await generateText({
      model: resolveChatModel(ctx.profile.model.chat, ctx.secrets),
      system: AUTHOR_PROMPT,
      prompt,
      maxTokens: 1200,
    });
    text = res.text;
  } catch (err) {
    console.warn("[skill-author] model call failed:", err);
    return null;
  }

  const trimmed = text.trim();
  if (trimmed === "SKIP" || trimmed.startsWith("SKIP")) return null;
  if (!trimmed.startsWith("---")) return null;

  const { meta, body } = ctx.skills.parseSkillFile(trimmed);
  if (!meta.name || !body) return null;
  return ctx.skills.create({ meta, body, source: "authored" });
}
