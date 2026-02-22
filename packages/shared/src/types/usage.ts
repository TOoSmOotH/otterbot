export interface TokenUsageRecord {
  id: string;
  agentId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number | null; // microcents
  projectId: string | null;
  conversationId: string | null;
  messageId: string | null;
  timestamp: string;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number; // microcents
  recordCount: number;
}

export interface UsageTimePoint {
  period: string; // ISO date or hour
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ModelUsageBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  count: number;
}

export interface AgentUsageBreakdown {
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  count: number;
}

export interface ModelPriceInfo {
  inputPerMillion: number;
  outputPerMillion: number;
  isCustom: boolean;
}

export interface ClaudeCodeOAuthUsage {
  sessionPercent: number;       // 5-hour window (0-100)
  sessionResetsAt: string | null;
  weeklyPercent: number;        // 7-day window (0-100)
  weeklyResetsAt: string | null;
  errorMessage: string | null;
  needsAuth: boolean;
}
