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
  onOpenSettings,
}: {
  projects: Project[];
  onEnterProject: (projectId: string) => void;
  onOpenSettings?: () => void;
}) {
  const agents = useAgentStore((s) => s.agents);
  const claudeCodeEnabled = useSettingsStore((s) => s.claudeCodeEnabled);
  const claudeCodeAuthMode = useSettingsStore((s) => s.claudeCodeAuthMode);

  const activeProjects = projects.filter((p) => p.status === ProjectStatus.Active);
  const completedProjects = projects.filter((p) => p.status === ProjectStatus.Completed);

  const showUsageCard = claudeCodeEnabled && claudeCodeAuthMode === "oauth";
  const isEmpty = projects.length === 0;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-5xl mx-auto space-y-6">
        {isEmpty ? (
          /* Onboarding empty state */
          <div className="flex flex-col items-center justify-center py-16 space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-lg font-semibold">Welcome to Otterbot</h2>
              <p className="text-sm text-muted-foreground max-w-md">
                Your personal AI assistant. Create a project to get started, or explore the settings to connect your tools.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
              <QuickAction
                icon={<path d="M12 5v14M5 12h14" />}
                label="Create a Project"
                description="Start a new task or conversation"
                onClick={() => {
                  // Focus the project name input in the sidebar
                  const btn = document.querySelector<HTMLButtonElement>('[data-action="new-project"]');
                  btn?.click();
                }}
              />
              {onOpenSettings && (
                <QuickAction
                  icon={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>}
                  label="Open Settings"
                  description="Connect integrations and customize"
                  onClick={onOpenSettings}
                />
              )}
            </div>

            {agents.size > 0 && (
              <div className="text-center">
                <span className="text-xs text-muted-foreground">
                  {agents.size} agent{agents.size !== 1 ? "s" : ""} active
                </span>
              </div>
            )}
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick action card for onboarding
// ---------------------------------------------------------------------------

function QuickAction({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border border-border bg-card p-4 hover:border-primary/40 hover:bg-card/80 transition-colors group"
    >
      <div className="flex items-center gap-3 mb-1.5">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary shrink-0"
        >
          {icon}
        </svg>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UsageBar label="5h Session" percent={usage.sessionPercent} resetsAt={usage.sessionResetsAt} />
        <UsageBar label="Weekly" percent={usage.weeklyPercent} resetsAt={usage.weeklyResetsAt} />
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
