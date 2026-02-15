import { mkdirSync, existsSync } from "node:fs";
import { resolve, normalize, relative } from "node:path";
import type { AgentRole } from "@smoothbot/shared";

export class WorkspaceManager {
  private root: string;

  constructor(root?: string) {
    this.root = resolve(root ?? process.env.WORKSPACE_ROOT ?? "./data");
  }

  getRoot(): string {
    return this.root;
  }

  /** Create the full project directory structure */
  createProject(projectId: string): string {
    const projectPath = this.projectPath(projectId);
    const dirs = [
      resolve(projectPath, "shared", "specs"),
      resolve(projectPath, "shared", "docs"),
      resolve(projectPath, "shared", "artifacts"),
      resolve(projectPath, "agents"),
      resolve(projectPath, "repo"),
    ];
    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }
    return projectPath;
  }

  /** Create a private workspace for an agent within a project */
  createAgentWorkspace(projectId: string, agentId: string): string {
    const agentPath = this.agentPath(projectId, agentId);
    mkdirSync(agentPath, { recursive: true });
    return agentPath;
  }

  /** Validate that a path is allowed for the given agent/role */
  validateAccess(
    requestedPath: string,
    agentId: string,
    role: AgentRole,
    projectId: string,
    childAgentIds?: string[],
  ): boolean {
    // Normalize: if absolute, resolve directly; if relative, resolve against root
    const normalized = normalize(
      requestedPath.startsWith("/")
        ? resolve(requestedPath)
        : resolve(this.root, requestedPath),
    );
    // Must be within workspace root
    if (!normalized.startsWith(this.root)) return false;

    const projectDir = this.projectPath(projectId);

    // Must be within the project directory
    if (!this.isUnder(normalized, projectDir)) return false;

    // All agents can access their own workspace
    const ownDir = this.agentPath(projectId, agentId);
    if (this.isUnder(normalized, ownDir)) return true;

    // All agents can access the shared directory
    const sharedDir = resolve(projectDir, "shared");
    if (this.isUnder(normalized, sharedDir)) return true;

    // All agents can access the repo directory
    const repo = this.repoPath(projectId);
    if (this.isUnder(normalized, repo)) return true;

    // Team leads can read their workers' workspaces
    if (role === "team_lead" && childAgentIds) {
      for (const childId of childAgentIds) {
        const childDir = this.agentPath(projectId, childId);
        if (this.isUnder(normalized, childDir)) return true;
      }
    }

    // COO can read all project shared dirs (already covered above)
    // COO does NOT get access to individual agent workspaces (unless it's their own)

    return false;
  }

  /** Resolve a path safely, preventing directory traversal */
  safePath(requestedPath: string): string | null {
    const normalized = normalize(resolve(this.root, requestedPath));
    if (!normalized.startsWith(this.root)) return null;
    return normalized;
  }

  projectPath(projectId: string): string {
    return resolve(this.root, "projects", projectId);
  }

  agentPath(projectId: string, agentId: string): string {
    return resolve(this.root, "projects", projectId, "agents", agentId);
  }

  sharedPath(projectId: string): string {
    return resolve(this.root, "projects", projectId, "shared");
  }

  repoPath(projectId: string): string {
    return resolve(this.root, "projects", projectId, "repo");
  }

  private isUnder(child: string, parent: string): boolean {
    const normalizedChild = resolve(child);
    const normalizedParent = resolve(parent);
    // Child must start with parent path + separator (or be exact match)
    return (
      normalizedChild === normalizedParent ||
      normalizedChild.startsWith(normalizedParent + "/")
    );
  }
}
