import { create } from "zustand";
import type {
  UsageSummary,
  UsageTimePoint,
  ModelUsageBreakdown,
  AgentUsageBreakdown,
  TokenUsageRecord,
} from "@otterbot/shared";

export type TimeRange = "today" | "7d" | "30d" | "all";

interface UsageState {
  loading: boolean;
  timeRange: TimeRange;
  summary: UsageSummary | null;
  timeSeries: UsageTimePoint[];
  byModel: ModelUsageBreakdown[];
  byAgent: AgentUsageBreakdown[];
  recent: TokenUsageRecord[];

  setTimeRange: (range: TimeRange) => void;
  loadUsageData: () => Promise<void>;
}

function getTimeRangeParams(range: TimeRange): string {
  if (range === "all") return "";
  const now = new Date();
  let from: Date;
  switch (range) {
    case "today":
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "7d":
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }
  return `from=${from.toISOString()}`;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  loading: false,
  timeRange: "30d",
  summary: null,
  timeSeries: [],
  byModel: [],
  byAgent: [],
  recent: [],

  setTimeRange: (range: TimeRange) => {
    set({ timeRange: range });
    get().loadUsageData();
  },

  loadUsageData: async () => {
    set({ loading: true });
    const range = get().timeRange;
    const params = getTimeRangeParams(range);
    const sep = params ? "&" : "";

    try {
      const [summaryRes, timeSeriesRes, byModelRes, byAgentRes, recentRes] =
        await Promise.all([
          fetch(`/api/usage/summary?${params}`),
          fetch(`/api/usage/summary?${params}${sep}groupBy=day`),
          fetch(`/api/usage/by-model?${params}`),
          fetch(`/api/usage/by-agent?${params}`),
          fetch("/api/usage/recent?limit=20"),
        ]);

      const [summary, timeSeries, byModel, byAgent, recent] = await Promise.all([
        summaryRes.json(),
        timeSeriesRes.json(),
        byModelRes.json(),
        byAgentRes.json(),
        recentRes.json(),
      ]);

      set({
        summary,
        timeSeries,
        byModel,
        byAgent,
        recent,
        loading: false,
      });
    } catch (err) {
      console.error("Failed to load usage data:", err);
      set({ loading: false });
    }
  },
}));
