import { useEffect } from "react";
import { useUsageStore, type TimeRange } from "../../stores/usage-store";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "all", label: "All" },
];

const COLORS = [
  "hsl(var(--primary))",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#14b8a6",
];

function formatCost(microcents: number): string {
  const dollars = microcents / 1_000_000;
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 1) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortModel(model: string): string {
  // Trim date suffixes and long prefixes
  return model.replace(/-\d{8}$/, "").replace(/^(models\/|accounts\/[^/]+\/models\/)/, "");
}

export function UsageDashboard() {
  const {
    loading,
    timeRange,
    summary,
    timeSeries,
    byModel,
    byAgent,
    setTimeRange,
    loadUsageData,
  } = useUsageStore();

  useEffect(() => {
    loadUsageData();
  }, []);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header + time range selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Token Usage</h2>
        <div className="flex items-center gap-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setTimeRange(r.id)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                timeRange === r.id
                  ? "bg-primary/20 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !summary ? (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
          Loading usage data...
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <SummaryCard
              label="Total Tokens"
              value={formatTokens((summary?.totalInputTokens ?? 0) + (summary?.totalOutputTokens ?? 0))}
            />
            <SummaryCard
              label="Total Cost"
              value={formatCost(summary?.totalCost ?? 0)}
            />
            <SummaryCard
              label="API Calls"
              value={String(summary?.recordCount ?? 0)}
            />
            <SummaryCard
              label="Top Model"
              value={byModel.length > 0 ? shortModel(byModel[0].model) : "—"}
            />
          </div>

          {/* Cost over time chart */}
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-xs font-medium text-muted-foreground mb-3">Cost Over Time</h3>
            {timeSeries.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                No usage data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={timeSeries}>
                  <defs>
                    <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: string) => v.slice(5)} // show MM-DD
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: number) => formatCost(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "11px",
                    }}
                    formatter={(value: number | undefined) => [formatCost(value ?? 0), "Cost"]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    stroke="hsl(var(--primary))"
                    fill="url(#costGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Bottom row: pie + bar */}
          <div className="grid grid-cols-2 gap-3">
            {/* Cost by model pie chart */}
            <div className="border border-border rounded-lg p-4 bg-card">
              <h3 className="text-xs font-medium text-muted-foreground mb-3">Cost by Model</h3>
              {byModel.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                  No data
                </div>
              ) : (
                <div className="flex items-center">
                  <ResponsiveContainer width="50%" height={200}>
                    <PieChart>
                      <Pie
                        data={byModel}
                        dataKey="cost"
                        nameKey="model"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                      >
                        {byModel.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "11px",
                        }}
                        formatter={(value: number | undefined) => [formatCost(value ?? 0), "Cost"]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1 text-[11px]">
                    {byModel.slice(0, 6).map((m, i) => (
                      <div key={m.model} className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <span className="truncate text-muted-foreground">{shortModel(m.model)}</span>
                        <span className="ml-auto font-mono">{formatCost(m.cost)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Usage by agent bar chart */}
            <div className="border border-border rounded-lg p-4 bg-card">
              <h3 className="text-xs font-medium text-muted-foreground mb-3">Usage by Agent</h3>
              {byAgent.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                  No data
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={byAgent.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v: number) => formatCost(v)}
                    />
                    <YAxis
                      dataKey="agentId"
                      type="category"
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      width={80}
                      tickFormatter={(v: string) => v.slice(0, 10)}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "11px",
                      }}
                      formatter={(value: number | undefined) => [formatCost(value ?? 0), "Cost"]}
                    />
                    <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-lg font-semibold truncate">{value}</div>
    </div>
  );
}
