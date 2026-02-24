import { useState, type FormEvent } from "react";
import { getSocket } from "../../lib/socket";

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateProjectDialog({ open, onClose }: CreateProjectDialogProps) {
  const [githubRepo, setGithubRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [issueMonitor, setIssueMonitor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setGithubRepo("");
    setBranch("");
    setName("");
    setDescription("");
    setRules("");
    setIssueMonitor(false);
    setLoading(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const hasRepo = githubRepo.trim().length > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const repo = githubRepo.trim();
    if (repo && !repo.includes("/")) {
      setError("Enter a valid repo in owner/repo format.");
      return;
    }
    if (!repo && !name.trim()) {
      setError("Project name is required when no GitHub repo is provided.");
      return;
    }

    setLoading(true);
    setError(null);

    const socket = getSocket();
    socket.emit(
      "project:create-manual",
      {
        name: name.trim() || undefined,
        description: description.trim(),
        githubRepo: repo || undefined,
        githubBranch: repo ? (branch.trim() || undefined) : undefined,
        rules: rules.trim() ? rules.trim().split("\n").map((r) => r.trim()).filter(Boolean) : undefined,
        issueMonitor: repo ? issueMonitor : false,
      } as any,
      (ack: { ok: boolean; projectId?: string; error?: string }) => {
        setLoading(false);
        if (ack.ok) {
          handleClose();
        } else {
          setError(ack.error ?? "Failed to create project.");
        }
      },
    );
  };

  // Auto-fill name from repo
  const handleRepoChange = (value: string) => {
    setGithubRepo(value);
    if (!name.trim()) {
      const repoName = value.split("/")[1] ?? "";
      setName(repoName);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
      onClick={handleClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Create Project</h3>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* GitHub Repo */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              GitHub Repo
            </label>
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => handleRepoChange(e.target.value)}
              placeholder="owner/repo-name"
              autoFocus
              className="w-full text-xs bg-secondary rounded-md px-3 py-2 outline-none placeholder:text-muted-foreground border border-transparent focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Branch */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Branch
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main (defaults to repo default)"
              disabled={!hasRepo}
              className={`w-full text-xs bg-secondary rounded-md px-3 py-2 outline-none placeholder:text-muted-foreground border border-transparent focus:border-primary/50 transition-colors ${!hasRepo ? "opacity-40 cursor-not-allowed" : ""}`}
            />
          </div>

          {/* Project Name */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Project Name {!hasRepo && <span className="text-red-400">*</span>}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={hasRepo ? "Auto-fills from repo name" : "my-project"}
              className="w-full text-xs bg-secondary rounded-md px-3 py-2 outline-none placeholder:text-muted-foreground border border-transparent focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional project description"
              rows={2}
              className="w-full text-xs bg-secondary rounded-md px-3 py-2 outline-none resize-none placeholder:text-muted-foreground border border-transparent focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Rules */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Rules
            </label>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="One rule per line (e.g. &quot;Always sign commits&quot;)"
              rows={3}
              className="w-full text-xs bg-secondary rounded-md px-3 py-2 outline-none resize-none placeholder:text-muted-foreground border border-transparent focus:border-primary/50 transition-colors font-mono"
            />
          </div>

          {/* Issue Monitor */}
          <label className={`flex items-center gap-2 ${hasRepo ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}>
            <input
              type="checkbox"
              checked={issueMonitor}
              onChange={(e) => setIssueMonitor(e.target.checked)}
              disabled={!hasRepo}
              className="rounded border-border"
            />
            <span className="text-xs text-foreground">
              Auto-create tasks from assigned GitHub issues
            </span>
          </label>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || (!githubRepo.trim() && !name.trim())}
            className="w-full text-xs bg-primary text-primary-foreground rounded-md px-3 py-2.5 font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75" />
                </svg>
                {hasRepo ? "Cloning repository..." : "Creating project..."}
              </>
            ) : (
              "Create Project"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
