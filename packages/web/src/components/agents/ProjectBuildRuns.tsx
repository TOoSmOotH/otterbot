import { useEffect } from "react";
import { GitPullRequest } from "lucide-react";
import { Icon } from "../ui/Icon";
import { useBuildRunsStore, type BuildRunSummary } from "../../stores/build-runs-store";

const EMPTY: BuildRunSummary[] = [];

const STATUS_COLOR: Record<string, string> = {
  running: "rgb(var(--info))",
  integrating: "rgb(var(--info))",
  reviewing: "rgb(var(--info))",
  planning: "rgb(var(--muted))",
  awaiting_approval: "rgb(var(--warning))",
  done: "rgb(var(--success))",
  failed: "rgb(var(--danger))",
  aborted: "rgb(var(--muted))",
};

export function ProjectBuildRuns({
  projectId,
  onOpenBuilds,
}: {
  projectId: string;
  onOpenBuilds?: () => void;
}) {
  const runs = useBuildRunsStore((s) => s.runsByProject[projectId]) ?? EMPTY;
  const loadForProject = useBuildRunsStore((s) => s.loadForProject);
  const bindSocket = useBuildRunsStore((s) => s.bindSocket);

  useEffect(() => {
    bindSocket();
    void loadForProject(projectId);
  }, [projectId, loadForProject, bindSocket]);

  return (
    <div
      data-testid="project-build-runs"
      style={{
        border: "1px solid rgb(var(--border))",
        borderRadius: 12,
        padding: 12,
        background: "rgb(var(--surface))",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Build runs</span>
        <span style={{ flex: 1 }} />
        {onOpenBuilds && (
          <button
            onClick={onOpenBuilds}
            style={{
              background: "transparent",
              border: "none",
              color: "rgb(var(--accent))",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Open in Build Runs ▸
          </button>
        )}
      </div>
      {runs.length === 0 && (
        <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>No build runs yet.</span>
      )}
      {runs.slice(0, 6).map((r) => (
        <div
          key={r.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            padding: "6px 0",
            borderTop: "1px solid rgb(var(--border))",
          }}
        >
          <span style={{ color: STATUS_COLOR[r.status] ?? "rgb(var(--fg))", fontWeight: 700 }}>
            {r.status}
          </span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.goal}
          </span>
          {r.prUrl && (
            <a
              href={r.prUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "rgb(var(--accent))", display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              <Icon icon={GitPullRequest} size={13} /> {r.prNumber ? `#${r.prNumber}` : "PR"}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
