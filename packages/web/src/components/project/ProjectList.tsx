import { useState, type FormEvent } from "react";
import type { Project, ProjectStatus } from "@otterbot/shared";
import { getSocket } from "../../lib/socket";
import { CreateProjectDialog } from "./CreateProjectDialog";

const statusColors: Record<ProjectStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  completed: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

export function ProjectList({
  projects,
  onEnterProject,
  cooName,
}: {
  projects: Project[];
  onEnterProject: (projectId: string) => void;
  cooName?: string;
}) {
  const [showForm, setShowForm] = useState(false);
  const [showGitHubDialog, setShowGitHubDialog] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const desc = description.trim();
    const content = desc
      ? `Create a new project called "${trimmed}": ${desc}`
      : `Create a new project called "${trimmed}"`;

    const socket = getSocket();
    socket.emit("ceo:message", { content });

    setName("");
    setDescription("");
    setShowForm(false);
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Projects</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGitHubDialog(true)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors font-medium"
            title="Create from GitHub repo"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </button>
          <button
            data-action="new-project"
            onClick={() => setShowForm(!showForm)}
            className="text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
          >
            {showForm ? "Cancel" : "+ New"}
          </button>
        </div>
      </div>

      {/* Inline new project form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="px-3 py-2 border-b border-border space-y-1.5">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
            className="w-full text-xs bg-secondary rounded px-2 py-1.5 outline-none placeholder:text-muted-foreground"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full text-xs bg-secondary rounded px-2 py-1.5 outline-none resize-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full text-xs bg-primary text-primary-foreground rounded px-2 py-1.5 font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            Create via {cooName ?? "COO"}
          </button>
        </form>
      )}

      {/* Project list */}
      {projects.length === 0 ? (
        <div className="px-4 py-4 text-xs text-muted-foreground text-center">
          No projects yet
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center hover:bg-secondary/50 transition-colors group"
            >
              <button
                onClick={() => onEnterProject(p.id)}
                className="flex-1 text-left px-4 py-2 flex items-center gap-2 min-w-0"
              >
                <span className="text-xs font-medium truncate flex-1">{p.name}</span>
                <span
                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${statusColors[p.status]}`}
                >
                  {p.status}
                </span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete project "${p.name}"? This will remove all tasks, conversations, and files.`)) {
                    const socket = getSocket();
                    socket.emit("project:delete", { projectId: p.id });
                  }
                }}
                className="opacity-0 group-hover:opacity-100 px-2 py-2 text-muted-foreground hover:text-red-400 transition-all shrink-0"
                title="Delete project"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* GitHub project creation dialog */}
      <CreateProjectDialog
        open={showGitHubDialog}
        onClose={() => setShowGitHubDialog(false)}
      />
    </div>
  );
}
