import { generate, resolveProviderCredentials, type LLMConfig } from "../llm/adapter.js";
import { MemoryService, type MemorySaveInput } from "./memory-service.js";
import { getConfig } from "../auth/auth.js";
import type { MemoryCategory } from "@otterbot/shared";

/**
 * Automatically extracts memories from conversation turns.
 * After each think() completes, this is called fire-and-forget with a
 * cheap/fast model to identify facts, preferences, and instructions
 * mentioned in the user message and assistant response.
 */
export class MemoryExtractor {
  private memoryService = new MemoryService();

  /**
   * Extract and save memories from a conversation exchange.
   * Designed to be called fire-and-forget (non-blocking).
   */
  async extract(
    userMessage: string,
    assistantResponse: string,
    agentRole?: string,
    projectId?: string | null,
  ): Promise<void> {
    try {
      const config = this.getExtractionConfig();
      if (!config) return; // No provider configured

      const prompt = this.buildExtractionPrompt(userMessage, assistantResponse);

      const result = await generate(config, [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);

      const extracted = this.parseExtractionResult(result.text);
      if (extracted.length === 0) return;

      // Deduplicate against existing memories
      for (const item of extracted) {
        const existing = this.memoryService.search({
          query: item.content,
          limit: 3,
        });

        // Skip if a very similar memory already exists
        const isDuplicate = existing.some((m) =>
          this.isSimilar(m.content, item.content),
        );
        if (isDuplicate) continue;

        this.memoryService.save({
          content: item.content,
          category: item.category,
          importance: item.importance,
          source: "agent",
          agentScope: agentRole ?? null,
          projectId: projectId ?? null,
        });
      }

      console.log(`[MemoryExtractor] Extracted ${extracted.length} memories from conversation`);
    } catch (err) {
      console.warn("[MemoryExtractor] Extraction failed (non-critical):", err);
    }
  }

  /** Get a cheap/fast LLM config for extraction */
  private getExtractionConfig(): LLMConfig | null {
    // Use the worker-tier model (typically cheaper/faster) for extraction
    const provider = getConfig("worker_provider") ?? getConfig("coo_provider");
    const model = getConfig("worker_model") ?? getConfig("coo_model");
    if (!provider || !model) return null;

    return {
      provider,
      model,
      temperature: 0,
      maxRetries: 2,
    };
  }

  private buildExtractionPrompt(userMessage: string, assistantResponse: string): string {
    return `User message:\n${userMessage}\n\nAssistant response:\n${assistantResponse}`;
  }

  private parseExtractionResult(text: string): MemorySaveInput[] {
    const results: MemorySaveInput[] = [];

    // Expected format: one memory per line as JSON
    // {"content": "...", "category": "...", "importance": N}
    const lines = text.split("\n").filter((l) => l.trim().startsWith("{"));

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed.content && typeof parsed.content === "string") {
          const validCategories: MemoryCategory[] = [
            "preference", "fact", "instruction", "relationship", "general",
          ];
          results.push({
            content: parsed.content.slice(0, 500),
            category: validCategories.includes(parsed.category)
              ? parsed.category
              : "general",
            importance: Math.min(10, Math.max(1, Number(parsed.importance) || 5)),
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    return results;
  }

  /** Simple similarity check — exact or substring match */
  private isSimilar(existing: string, candidate: string): boolean {
    const a = existing.toLowerCase().trim();
    const b = candidate.toLowerCase().trim();
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    // Check word overlap — if >70% of words overlap, consider similar
    const aWords = new Set(a.split(/\s+/));
    const bWords = new Set(b.split(/\s+/));
    const overlap = [...aWords].filter((w) => bWords.has(w)).length;
    const maxLen = Math.max(aWords.size, bWords.size);
    return maxLen > 0 && overlap / maxLen > 0.7;
  }
}

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system. Analyze the conversation between a user and an assistant to extract important facts, preferences, and instructions that should be remembered for future conversations.

Output ONLY JSON lines (one per memory), no other text. Each line must be:
{"content": "clear concise statement", "category": "preference|fact|instruction|relationship|general", "importance": 1-10}

Guidelines:
- Extract ONLY new information worth remembering long-term
- Do NOT extract trivial or temporary information
- Do NOT extract the task itself — only underlying facts/preferences
- Importance 8-10: critical preferences, identity facts, firm instructions
- Importance 5-7: useful preferences, recurring patterns
- Importance 1-4: minor details
- If nothing is worth extracting, output nothing

Examples of good extractions:
{"content": "User prefers TypeScript over JavaScript", "category": "preference", "importance": 7}
{"content": "User's company uses PostgreSQL as primary database", "category": "fact", "importance": 6}
{"content": "Always run tests before committing code", "category": "instruction", "importance": 8}`;
