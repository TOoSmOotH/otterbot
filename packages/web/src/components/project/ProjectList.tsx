import type { Project, ProjectStatus } from "@smoothbot/shared";

const statusColors: Record<ProjectStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  completed: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProjectList({
  projects,
  onEnterProject,
}: {
  projects: Project[];
  onEnterProject: (projectId: string) => void;
}) {
  if (projects.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        No projects yet. Ask your assistant to create one.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onEnterProject(p.id)}
            className="text-left rounded-lg border border-border bg-card p-4 hover:border-primary/40 hover:bg-card/80 transition-colors flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sm truncate">{p.name}</span>
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${statusColors[p.status]}`}
              >
                {p.status}
              </span>
            </div>
            {p.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {p.description}
              </p>
            )}
            <span className="text-[11px] text-muted-foreground/60 mt-auto">
              {formatDate(p.createdAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
