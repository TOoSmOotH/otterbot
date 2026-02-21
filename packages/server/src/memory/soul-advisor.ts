import { generate, type LLMConfig } from "../llm/adapter.js";
import { getConfig } from "../auth/auth.js";
import { SoulService } from "./soul-service.js";
import { MemoryService } from "./memory-service.js";

export interface SoulSuggestion {
  agentRole: string;
  registryEntryId: string | null;
  currentContent: string | null;
  suggestedContent: string;
  reasoning: string;
  newInsights: string[];
}

/**
 * Analyzes stored memories against current soul documents and suggests
 * updates to keep soul documents aligned with user preferences and behavior
 * patterns. Designed to run weekly or on-demand.
 */
export class SoulAdvisor {
  private soulService = new SoulService();
  private memoryService = new MemoryService();

  /**
   * Analyze memories and generate soul update suggestions.
   * Returns suggestions for each role that has meaningful updates.
   */
  async analyze(): Promise<SoulSuggestion[]> {
    const config = this.getAdvisorConfig();
    if (!config) return [];

    const suggestions: SoulSuggestion[] = [];

    // Analyze for each role
    const roles = ["global", "coo", "admin_assistant", "worker", "team_lead"];

    for (const role of roles) {
      try {
        const suggestion = await this.analyzeRole(role, null, config);
        if (suggestion) {
          suggestions.push(suggestion);
        }
      } catch (err) {
        console.warn(`[SoulAdvisor] Failed to analyze role ${role}:`, err);
      }
    }

    return suggestions;
  }

  /** Analyze a specific role and generate a suggestion if warranted */
  private async analyzeRole(
    agentRole: string,
    registryEntryId: string | null,
    config: LLMConfig,
  ): Promise<SoulSuggestion | null> {
    // Get current soul document
    const currentSoul = this.soulService.get(agentRole, registryEntryId);
    const currentContent = currentSoul?.content ?? null;

    // Get memories relevant to this role
    const memories = this.memoryService.list({
      agentScope: agentRole === "global" ? undefined : agentRole,
    });

    // Need at least 3 memories to make meaningful suggestions
    if (memories.length < 3) return null;

    // Build memory summary
    const memorySummary = memories
      .slice(0, 50) // Cap at 50 for context window
      .map((m) => `- [${m.category}, importance:${m.importance}] ${m.content}`)
      .join("\n");

    const prompt = this.buildAnalysisPrompt(agentRole, currentContent, memorySummary);

    const result = await generate(config, [
      { role: "system", content: ADVISOR_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    return this.parseSuggestion(result.text, agentRole, registryEntryId, currentContent);
  }

  private buildAnalysisPrompt(
    agentRole: string,
    currentSoul: string | null,
    memorySummary: string,
  ): string {
    const soulBlock = currentSoul
      ? `Current soul document for ${agentRole}:\n\`\`\`\n${currentSoul}\n\`\`\``
      : `No soul document exists for ${agentRole} yet.`;

    return `${soulBlock}\n\nStored memories (${agentRole}):\n${memorySummary}\n\nAnalyze the memories and ${currentSoul ? "suggest updates to the soul document" : "draft an initial soul document"} for the ${agentRole} role.`;
  }

  private parseSuggestion(
    text: string,
    agentRole: string,
    registryEntryId: string | null,
    currentContent: string | null,
  ): SoulSuggestion | null {
    try {
      const parsed = JSON.parse(text);
      if (parsed.suggestedContent) {
        return {
          agentRole,
          registryEntryId,
          currentContent,
          suggestedContent: parsed.suggestedContent,
          reasoning: parsed.reasoning ?? "Analysis of stored memories",
          newInsights: Array.isArray(parsed.newInsights) ? parsed.newInsights : [],
        };
      }
    } catch {
      // Not JSON — try to extract markdown content
    }

    // If the response isn't structured JSON, treat the whole text as the suggested content
    if (text.trim().length > 50) {
      return {
        agentRole,
        registryEntryId,
        currentContent,
        suggestedContent: text.trim(),
        reasoning: "Generated from analysis of stored memories",
        newInsights: [],
      };
    }

    return null; // No meaningful suggestion
  }

  private getAdvisorConfig(): LLMConfig | null {
    const provider = getConfig("coo_provider");
    const model = getConfig("coo_model");
    if (!provider || !model) return null;
    return { provider, model, temperature: 0.3, maxRetries: 2 };
  }
}

const ADVISOR_SYSTEM_PROMPT = `You are a Soul Document Advisor. You analyze stored user memories and suggest improvements to agent soul documents (personality/behavior definitions).

Output JSON:
{
  "suggestedContent": "Full markdown soul document content",
  "reasoning": "Brief explanation of what changed and why",
  "newInsights": ["insight 1 from memories", "insight 2"]
}

Guidelines:
- Incorporate user preferences discovered in memories
- Maintain existing personality traits unless contradicted by memories
- Add new sections for patterns you notice (communication style, technical preferences, etc.)
- Keep the document concise and actionable
- Use markdown formatting with ## headers
- If no meaningful changes are needed, set suggestedContent to the current content unchanged`;
