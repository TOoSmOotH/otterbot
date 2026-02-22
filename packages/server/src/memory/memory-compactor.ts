import { nanoid } from "nanoid";
import { eq, sql, and, desc } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { generate, type LLMConfig } from "../llm/adapter.js";
import { getConfig } from "../auth/auth.js";
import type { MemoryEpisode } from "@otterbot/shared";

/**
 * Daily compaction job that summarizes the day's conversations
 * into episodic memory logs. Designed to run on a timer (e.g. every 6 hours).
 */
export class MemoryCompactor {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  /** Start the compaction job on a timer */
  start(intervalMs: number = 6 * 60 * 60 * 1000) {
    // Run once on start, then at intervals
    this.compact().catch((err) =>
      console.warn("[MemoryCompactor] Initial compaction failed:", err),
    );

    this.intervalId = setInterval(() => {
      this.compact().catch((err) =>
        console.warn("[MemoryCompactor] Compaction failed:", err),
      );
    }, intervalMs);
  }

  /** Stop the compaction timer */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Run a compaction cycle for yesterday (or a specific date) */
  async compact(date?: string): Promise<MemoryEpisode | null> {
    const targetDate = date ?? this.getYesterdayDate();

    // Check if we already have an episode for this date
    const db = getDb();
    const existing = db.select().from(schema.memoryEpisodes)
      .where(eq(schema.memoryEpisodes.date, targetDate))
      .get();
    if (existing) return this.toEpisode(existing);

    // Gather the day's agent activity
    const dayStart = `${targetDate}T00:00:00.000Z`;
    const dayEnd = `${targetDate}T23:59:59.999Z`;

    const activities = db.select().from(schema.agentActivity)
      .where(
        and(
          sql`${schema.agentActivity.timestamp} >= ${dayStart}`,
          sql`${schema.agentActivity.timestamp} <= ${dayEnd}`,
          eq(schema.agentActivity.type, "response"),
        ),
      )
      .orderBy(schema.agentActivity.timestamp)
      .all();

    if (activities.length === 0) return null;

    // Also get messages from that day
    const messages = db.select().from(schema.messages)
      .where(
        and(
          sql`${schema.messages.timestamp} >= ${dayStart}`,
          sql`${schema.messages.timestamp} <= ${dayEnd}`,
          eq(schema.messages.type, "chat"),
        ),
      )
      .orderBy(schema.messages.timestamp)
      .all();

    // Build a text dump for summarization
    const textDump = [
      ...messages.map((m) => `[${m.fromAgentId ?? "CEO"}→${m.toAgentId ?? "CEO"}] ${m.content.slice(0, 200)}`),
      ...activities.map((a) => `[Agent ${a.agentId}] ${a.content.slice(0, 200)}`),
    ].join("\n").slice(0, 6000);

    // Summarize with LLM
    const config = this.getCompactionConfig();
    if (!config) {
      // Can't summarize without LLM — store a basic dump
      return this.saveEpisode(targetDate, null, `${messages.length} messages, ${activities.length} activities`, []);
    }

    try {
      const result = await generate(config, [
        {
          role: "system",
          content: COMPACTION_PROMPT,
        },
        {
          role: "user",
          content: `Date: ${targetDate}\n\nActivity:\n${textDump}`,
        },
      ]);

      const parsed = this.parseCompactionResult(result.text);
      return this.saveEpisode(targetDate, null, parsed.summary, parsed.keyDecisions);
    } catch (err) {
      console.warn("[MemoryCompactor] LLM summarization failed:", err);
      return this.saveEpisode(targetDate, null, `${messages.length} messages, ${activities.length} activities`, []);
    }
  }

  /** Get recent episodes for injection into agent context */
  getRecentEpisodes(days: number = 3, projectId?: string | null): MemoryEpisode[] {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const condition = projectId
      ? and(
          sql`${schema.memoryEpisodes.date} >= ${cutoffStr}`,
          eq(schema.memoryEpisodes.projectId, projectId),
        )
      : sql`${schema.memoryEpisodes.date} >= ${cutoffStr}`;

    const rows = db.select().from(schema.memoryEpisodes)
      .where(condition)
      .orderBy(desc(schema.memoryEpisodes.date))
      .limit(days)
      .all();

    return rows.map((r) => this.toEpisode(r));
  }

  private saveEpisode(
    date: string,
    projectId: string | null,
    summary: string,
    keyDecisions: string[],
  ): MemoryEpisode {
    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();

    db.insert(schema.memoryEpisodes)
      .values({
        id,
        date,
        projectId,
        summary,
        keyDecisions,
        createdAt: now,
      })
      .run();

    return { id, date, projectId, summary, keyDecisions, createdAt: now };
  }

  private getCompactionConfig(): LLMConfig | null {
    const provider = getConfig("worker_provider") ?? getConfig("coo_provider");
    const model = getConfig("worker_model") ?? getConfig("coo_model");
    if (!provider || !model) return null;
    return { provider, model, temperature: 0, maxRetries: 2 };
  }

  private parseCompactionResult(text: string): { summary: string; keyDecisions: string[] } {
    // Try to parse structured output
    try {
      const parsed = JSON.parse(text);
      if (parsed.summary) {
        return {
          summary: parsed.summary,
          keyDecisions: Array.isArray(parsed.keyDecisions) ? parsed.keyDecisions : [],
        };
      }
    } catch {
      // Not JSON — use as plain text
    }

    // Extract key decisions from bullet points
    const lines = text.split("\n");
    const decisions = lines
      .filter((l) => l.trim().startsWith("- ") || l.trim().startsWith("* "))
      .map((l) => l.replace(/^[\s*-]+/, "").trim())
      .filter(Boolean);

    return {
      summary: text.slice(0, 1000),
      keyDecisions: decisions.slice(0, 10),
    };
  }

  private getYesterdayDate(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  private toEpisode(row: typeof schema.memoryEpisodes.$inferSelect): MemoryEpisode {
    return {
      id: row.id,
      date: row.date,
      projectId: row.projectId,
      summary: row.summary,
      keyDecisions: row.keyDecisions,
      createdAt: row.createdAt,
    };
  }
}

const COMPACTION_PROMPT = `You are a daily journal writer for an AI assistant system. Summarize the day's activities into a brief episode log.

Output JSON:
{"summary": "2-3 sentence overview of the day", "keyDecisions": ["decision 1", "decision 2"]}

Focus on:
- What tasks were worked on
- Key decisions made
- Outcomes and results
- Any notable user preferences or instructions discovered

Keep it concise — this will be injected as context for future conversations.`;
