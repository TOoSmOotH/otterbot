import { asc, eq } from "drizzle-orm";
import { generateText } from "ai";
import type { AgentDrizzle } from "../db/agent-db.js";
import * as schema from "../db/schema.js";
import { llm, hasLlm } from "../llm.js";
import { getDefaultContext } from "../runtime/default-agent.js";
import { emptyUserProfile, type UserProfile, type UserProfileFact } from "@otterbot/shared";

const SINGLETON_ID = "singleton";

const DIALECTIC_PROMPT = `You are maintaining a persistent model of a user across sessions. You will be given the current profile (JSON) and the transcript of a new session. Update the profile dialectically:

1. Add new facts, preferences, and goals that appear in the session.
2. Mark contradicted old facts by setting "contradicted": true and keep them in the profile (do not delete) so we remember the history.
3. Bump "confidence" for re-confirmed items and update "lastConfirmedAt".
4. Merge duplicates.

Return ONLY the updated profile JSON, matching this shape:

{
  "name": string | null,
  "preferences": [{ "content": string, "confidence": number, "firstSeenAt": string, "lastConfirmedAt": string, "contradicted": boolean }, ...],
  "goals": [...],
  "facts": [...],
  "notes": string,
  "updatedAt": string
}`;

/** Per-agent user-profile service over the agent's isolated database. */
export class UserProfileService {
  constructor(private readonly db: AgentDrizzle) {}

  get(): UserProfile {
    const db = this.db;
    const row = db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.id, SINGLETON_ID))
      .get();
    if (!row) {
      const empty = emptyUserProfile();
      this.save(empty);
      return empty;
    }
    try {
      return JSON.parse(row.profileJson) as UserProfile;
    } catch {
      return emptyUserProfile();
    }
  }

  save(profile: UserProfile): UserProfile {
    const db = this.db;
    const next = { ...profile, updatedAt: new Date().toISOString() };
    const json = JSON.stringify(next);
    db.insert(schema.userProfile)
      .values({ id: SINGLETON_ID, profileJson: json, updatedAt: next.updatedAt })
      .onConflictDoUpdate({
        target: schema.userProfile.id,
        set: { profileJson: json, updatedAt: next.updatedAt },
      })
      .run();
    return next;
  }

  addFact(bucket: "preferences" | "goals" | "facts", content: string): UserProfile {
    const profile = this.get();
    const now = new Date().toISOString();
    const existing = profile[bucket].find((f) => f.content === content);
    if (existing) {
      existing.confidence = Math.min(10, existing.confidence + 1);
      existing.lastConfirmedAt = now;
      existing.contradicted = false;
    } else {
      const fact: UserProfileFact = {
        content,
        confidence: 5,
        firstSeenAt: now,
        lastConfirmedAt: now,
        contradicted: false,
      };
      profile[bucket].push(fact);
    }
    return this.save(profile);
  }

  setName(name: string | null): UserProfile {
    const profile = this.get();
    profile.name = name;
    return this.save(profile);
  }

  /**
   * Merge an imported profile into the current one. Facts in each bucket are
   * deduped by content (keeping the strongest confidence and most recent
   * confirmation); the existing name and notes win, with imported notes
   * appended. Never deletes existing knowledge.
   */
  merge(incoming: UserProfile): UserProfile {
    const profile = this.get();
    profile.name = profile.name ?? incoming.name;
    for (const bucket of ["preferences", "goals", "facts"] as const) {
      profile[bucket] = mergeFacts(profile[bucket], incoming[bucket]);
    }
    const incomingNotes = incoming.notes?.trim() ?? "";
    if (incomingNotes && !profile.notes.includes(incomingNotes)) {
      profile.notes = profile.notes.trim()
        ? `${profile.notes.trim()}\n\n${incomingNotes}`
        : incomingNotes;
    }
    return this.save(profile);
  }

  /**
   * Honcho-style dialectic rebuild: diff the current profile against
   * the transcript of a session, producing an evolved profile.
   */
  async rebuildFromSession(conversationId: string): Promise<UserProfile> {
    if (!hasLlm()) return this.get();

    const db = this.db;
    const messages = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(asc(schema.messages.createdAt))
      .all();
    if (messages.length === 0) return this.get();

    const transcript = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    const current = this.get();
    const { text } = await generateText({
      model: llm(),
      system: DIALECTIC_PROMPT,
      prompt: `CURRENT PROFILE:\n${JSON.stringify(current, null, 2)}\n\nSESSION TRANSCRIPT:\n${transcript}`,
      maxTokens: 1500,
    });

    const next = parseProfileJson(text);
    if (!next) return current;
    return this.save(next);
  }

  /** Render the profile as a markdown block suitable for the system prompt. */
  renderForPrompt(): string {
    const p = this.get();
    const bullets = (items: UserProfileFact[]) =>
      items
        .filter((i) => !i.contradicted)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 8)
        .map((i) => `- ${i.content}`)
        .join("\n");

    const parts: string[] = [];
    if (p.name) parts.push(`Name: ${p.name}`);
    if (p.preferences.some((i) => !i.contradicted)) {
      parts.push("Preferences:\n" + bullets(p.preferences));
    }
    if (p.goals.some((i) => !i.contradicted)) {
      parts.push("Goals:\n" + bullets(p.goals));
    }
    if (p.facts.some((i) => !i.contradicted)) {
      parts.push("Facts:\n" + bullets(p.facts));
    }
    if (p.notes.trim()) parts.push("Notes:\n" + p.notes.trim());
    if (parts.length === 0) return "";
    return `## What I know about the user\n\n${parts.join("\n\n")}`;
  }
}

function parseProfileJson(text: string): UserProfile | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed || typeof parsed !== "object") return null;
    const base = emptyUserProfile();
    return {
      name: typeof parsed.name === "string" ? parsed.name : parsed.name === null ? null : base.name,
      preferences: Array.isArray(parsed.preferences) ? parsed.preferences.filter(isFact) : base.preferences,
      goals: Array.isArray(parsed.goals) ? parsed.goals.filter(isFact) : base.goals,
      facts: Array.isArray(parsed.facts) ? parsed.facts.filter(isFact) : base.facts,
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Union two fact lists, deduping by content and keeping the stronger signal. */
function mergeFacts(existing: UserProfileFact[], incoming: UserProfileFact[]): UserProfileFact[] {
  const byContent = new Map<string, UserProfileFact>();
  for (const f of existing) byContent.set(f.content, { ...f });
  for (const f of incoming.filter(isFact)) {
    const prev = byContent.get(f.content);
    if (!prev) {
      byContent.set(f.content, { ...f });
      continue;
    }
    prev.confidence = Math.max(prev.confidence, f.confidence);
    prev.firstSeenAt = earliest(prev.firstSeenAt, f.firstSeenAt);
    prev.lastConfirmedAt = latest(prev.lastConfirmedAt, f.lastConfirmedAt);
    prev.contradicted = prev.contradicted && f.contradicted;
  }
  return [...byContent.values()];
}

function earliest(a: string, b: string): string {
  return a <= b ? a : b;
}

function latest(a: string, b: string): string {
  return a >= b ? a : b;
}

function isFact(v: unknown): v is UserProfileFact {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as UserProfileFact).content === "string" &&
    typeof (v as UserProfileFact).confidence === "number"
  );
}

/** @deprecated Compatibility shim — resolves to the default (COO) agent's profile service. */
export function getUserProfileService(): UserProfileService {
  return getDefaultContext().userProfile;
}
