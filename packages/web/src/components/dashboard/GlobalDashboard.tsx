import { useEffect } from "react";
import { useAgentStore } from "../../stores/agent-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useClaudeUsageStore } from "../../stores/claude-usage-store";
import { ProjectStatus } from "@otterbot/shared";
import type { Project } from "@otterbot/shared";
import { formatRelative } from "../../lib/format-relative";

export function GlobalDashboard({
  projects,
  onEnterProject,
}: {
  projects: Project[];
  onEnterProject: (projectId: string) => void;
}) {
  const agents = useAgentStore((s) => s.agents);
  const claudeCodeEnabled = useSettingsStore((s) => s.claudeCodeEnabled);
  const claudeCodeAuthMode = useSettingsStore((s) => s.claudeCodeAuthMode);

  const activeProjects = projects.filter((p) => p.status === ProjectStatus.Active);
  const completedProjects = projects.filter((p) => p.status === ProjectStatus.Completed);

  const showUsageCard = claudeCodeEnabled && claudeCodeAuthMode === "oauth";

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Projects" value={projects.length} />
          <StatCard label="Active" value={activeProjects.length} accent="blue" />
          <StatCard label="Completed" value={completedProjects.length} accent="green" />
          <StatCard label="Active Agents" value={agents.size} accent="yellow" />
        </div>

        {/* Claude Code OAuth usage */}
        {showUsageCard && <ClaudeCodeUsageCard />}

        {/* Project cards */}
        {projects.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No projects yet. Start a conversation to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {projects.map((project) => {
              const agentCount = Array.from(agents.values()).filter(
                (a) => a.projectId === project.id,
              ).length;
              return (
                <button
                  key={project.id}
                  onClick={() => onEnterProject(project.id)}
                  className="text-left rounded-lg border border-border bg-card p-4 hover:border-primary/40 hover:bg-card/80 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-sm font-medium truncate">{project.name}</h3>
                    <StatusBadge status={project.status} />
                  </div>
                  {project.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    {project.githubRepo && (
                      <span className="truncate max-w-[140px]" title={project.githubRepo}>
                        {project.githubRepo}
                      </span>
                    )}
                    {agentCount > 0 && (
                      <span>
                        {agentCount} agent{agentCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    <span className="ml-auto shrink-0">{formatRelative(project.createdAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Claude Code Usage Card
// ---------------------------------------------------------------------------

function ClaudeCodeUsageCard() {
  const usage = useClaudeUsageStore((s) => s.usage);
  const startPolling = useClaudeUsageStore((s) => s.startPolling);

  useEffect(() => {
    const cleanup = startPolling();
    return cleanup;
  }, [startPolling]);

  if (!usage) return null;

  if (usage.needsAuth) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs font-medium text-muted-foreground mb-1">Claude Code Usage</div>
        <p className="text-xs text-muted-foreground">
          OAuth session expired — run <code className="px-1 py-0.5 rounded bg-muted text-[11px]">claude login</code> to re-authenticate.
        </p>
      </div>
    );
  }

  if (usage.errorMessage) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground mb-3">Claude Code Usage</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <UsageBar label="5h Session" percent={usage.sessionPercent} resetsAt={usage.sessionResetsAt} />
        <UsageBar label="Weekly" percent={usage.weeklyPercent} resetsAt={usage.weeklyResetsAt} />
        <UsageBar label="Weekly Opus" percent={usage.weeklyOpusPercent} resetsAt={usage.weeklyOpusResetsAt} />
      </div>
    </div>
  );
}

function UsageBar({
  label,
  percent,
  resetsAt,
}: {
  label: string;
  percent: number;
  resetsAt: string | null;
}) {
  const colorClass =
    percent > 85
      ? "bg-red-500"
      : percent > 60
        ? "bg-yellow-500"
        : "bg-green-500";

  const textColorClass =
    percent > 85
      ? "text-red-400"
      : percent > 60
        ? "text-yellow-400"
        : "text-green-400";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-xs font-medium tabular-nums ${textColorClass}`}>{percent}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {resetsAt && (
        <div className="text-[10px] text-muted-foreground mt-0.5">
          resets {formatTimeUntil(resetsAt)}
        </div>
      )}
    </div>
  );
}

function formatTimeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return "soon";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) {
    return remainMins > 0 ? `in ${hours}h ${remainMins}m` : `in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `in ${days}d ${remainHours}h` : `in ${days}d`;
}

// ---------------------------------------------------------------------------
// Stat / Status helpers
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "blue" | "green" | "yellow";
}) {
  const accentClass =
    accent === "blue"
      ? "text-blue-400"
      : accent === "green"
        ? "text-green-400"
        : accent === "yellow"
          ? "text-yellow-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${accentClass}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  const styles: Record<ProjectStatus, string> = {
    [ProjectStatus.Active]: "bg-blue-500/20 text-blue-400",
    [ProjectStatus.Completed]: "bg-green-500/20 text-green-400",
    [ProjectStatus.Failed]: "bg-red-500/20 text-red-400",
    [ProjectStatus.Cancelled]: "bg-secondary text-muted-foreground",
  };
  return (
    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
