import { useState, type FormEvent } from "react";
import type { Project, ProjectStatus } from "@smoothbot/shared";
import { getSocket } from "../../lib/socket";

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
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
        >
          {showForm ? "Cancel" : "+ New"}
        </button>
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
    </div>
  );
}
