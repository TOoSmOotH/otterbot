import { useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { Icon } from "../ui/Icon";
import { useProjectsStore } from "../../stores/projects-store";
import { useAgentsStore } from "../../stores/agents-store";
import { ProjectCard } from "./ProjectsView";
import { ProjectBuildRuns } from "./ProjectBuildRuns";

export function ProjectDashboard({
  projectId,
  onChatPM,
  onOpenBuilds,
  onOpenSettings,
}: {
  projectId: string | null;
  onChatPM?: (agentId: string) => void;
  onOpenBuilds?: () => void;
  onOpenSettings?: (tab?: string) => void;
}) {
  const projects = useProjectsStore((s) => s.projects);
  const load = useProjectsStore((s) => s.load);
  const loadForgeAccounts = useProjectsStore((s) => s.loadForgeAccounts);
  const bindSocket = useProjectsStore((s) => s.bindSocket);
  const remove = useProjectsStore((s) => s.remove);
  const agents = useAgentsStore((s) => s.agents);

  useEffect(() => {
    void load();
    void loadForgeAccounts();
    bindSocket();
  }, [load, loadForgeAccounts, bindSocket]);

  const project = projects.find((p) => p.id === projectId) ?? null;

  if (!project) {
    return (
      <div style={{ padding: 24, color: "rgb(var(--muted))", fontSize: 13 }} data-testid="project-dashboard-empty">
        Select a project from the sidebar to see its dashboard.
      </div>
    );
  }

  const pmId = project.team.find((t) => t.role === "pm")?.agentId ?? null;
  const teamAgents = project.team
    .map((t) => agents.find((a) => a.id === t.agentId))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  return (
    <div data-testid="project-dashboard" style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgb(var(--surface-elevated))", display: "grid", placeItems: "center", fontSize: 18 }}>🦦</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{project.name}</h2>
          <div style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 2 }}>
            {project.repos.length} repo{project.repos.length === 1 ? "" : "s"} · {project.team.length} agents · {project.mode}
          </div>
        </div>
        <div style={{ display: "flex" }}>
          {teamAgents.map((a, i) => (
            <span key={a.id} title={a.displayName} style={{ width: 28, height: 28, borderRadius: "50%", marginLeft: i === 0 ? 0 : -8, border: "2px solid rgb(var(--bg))", background: "rgb(var(--surface-elevated))", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800 }}>
              {a.displayName.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
        {pmId && onChatPM && (
          <button data-testid="dashboard-chat-pm" onClick={() => onChatPM(pmId)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 10, border: "1px solid rgb(var(--border))", background: "rgb(var(--surface))", color: "rgb(var(--fg))", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            <Icon icon={MessageSquare} size={14} /> Chat with PM
          </button>
        )}
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
        <ProjectBuildRuns projectId={project.id} onOpenBuilds={onOpenBuilds} />
        <ProjectCard project={project} onDelete={() => remove(project.id)} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}
