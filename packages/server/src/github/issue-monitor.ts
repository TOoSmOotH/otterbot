import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, KanbanTask } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import { getConfig, setConfig } from "../auth/auth.js";
import { fetchAssignedIssues } from "./github-service.js";
import type { COO } from "../agents/coo.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

interface WatchedProject {
  projectId: string;
  repo: string;
  assignee: string;
}

export class GitHubIssueMonitor {
  private watched = new Map<string, WatchedProject>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private coo: COO;
  private io: TypedServer;

  constructor(coo: COO, io: TypedServer) {
    this.coo = coo;
    this.io = io;
  }

  /** Register a project for issue monitoring */
  watchProject(projectId: string, repo: string, assignee: string): void {
    this.watched.set(projectId, { projectId, repo, assignee });
    console.log(`[IssueMonitor] Watching ${repo} for issues assigned to ${assignee} (project ${projectId})`);
  }

  /** Unregister a project from issue monitoring */
  unwatchProject(projectId: string): void {
    this.watched.delete(projectId);
  }

  /** Load watched projects from DB on startup */
  loadFromDb(): void {
    const db = getDb();
    const projects = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.status, "active"))
      .all();

    const assignee = getConfig("github:username");
    if (!assignee) return;

    for (const project of projects) {
      if (project.githubIssueMonitor && project.githubRepo) {
        this.watchProject(project.id, project.githubRepo, assignee);
      }
    }
  }

  /** Start the polling loop */
  start(pollIntervalMs = 60_000): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[IssueMonitor] Poll error:", err);
      });
    }, pollIntervalMs);
    console.log(`[IssueMonitor] Started polling every ${pollIntervalMs / 1000}s`);
  }

  /** Stop the polling loop */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    const token = getConfig("github:token");
    if (!token) return;

    for (const [projectId, watched] of this.watched) {
      try {
        await this.pollProject(projectId, watched, token);
      } catch (err) {
        console.error(`[IssueMonitor] Error polling ${watched.repo}:`, err);
      }
    }
  }

  private async pollProject(
    projectId: string,
    watched: WatchedProject,
    token: string,
  ): Promise<void> {
    const sinceKey = `project:${projectId}:github:last_polled_at`;
    const since = getConfig(sinceKey) ?? undefined;

    const issues = await fetchAssignedIssues(
      watched.repo,
      token,
      watched.assignee,
      since,
    );

    const db = getDb();

    for (const issue of issues) {
      const label = `github-issue-${issue.number}`;

      // Check for existing kanban task with this label to avoid duplicates
      const existingTasks = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, projectId))
        .all();

      const alreadyTracked = existingTasks.some(
        (t) => (t.labels as string[]).includes(label),
      );
      if (alreadyTracked) continue;

      // Create kanban task
      const taskId = nanoid();
      const now = new Date().toISOString();
      const maxPos = existingTasks
        .filter((t) => t.column === "backlog")
        .reduce((max, t) => Math.max(max, t.position), -1);

      const task = {
        id: taskId,
        projectId,
        title: `#${issue.number}: ${issue.title}`,
        description: issue.body ?? "",
        column: "backlog" as const,
        position: maxPos + 1,
        assigneeAgentId: null,
        createdBy: "issue-monitor",
        labels: [label],
        blockedBy: [] as string[],
        retryCount: 0,
        completionReport: null,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(schema.kanbanTasks).values(task).run();

      // Emit to UI
      this.io.emit("kanban:task-created", task as unknown as KanbanTask);

      // Send directive to TeamLead
      const teamLeads = this.coo.getTeamLeads();
      const teamLead = teamLeads.get(projectId);
      if (teamLead) {
        const bus = (this.coo as any).bus;
        if (bus) {
          bus.send({
            fromAgentId: "coo",
            toAgentId: teamLead.id,
            type: MessageType.Directive,
            content:
              `New GitHub issue #${issue.number} assigned: "${issue.title}"\n\n` +
              `${issue.body ?? "(no description)"}\n\n` +
              `Task created on kanban board (${taskId}). ` +
              `Spawn a worker to create a feature branch, implement the fix, and open a PR.`,
            projectId,
          });
        }
      }

      console.log(`[IssueMonitor] Created task for issue #${issue.number} in project ${projectId}`);
    }

    // Update last polled timestamp
    setConfig(sinceKey, new Date().toISOString());
  }
}
