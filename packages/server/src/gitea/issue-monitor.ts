import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, KanbanTask } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import { getConfig, setConfig } from "../auth/auth.js";
import { resolveGiteaToken, resolveGiteaUsername, resolveGiteaInstanceUrl } from "./account-resolver.js";
import {
  fetchAssignedIssues,
  fetchOpenIssues,
  fetchAllOpenIssueNumbers,
  fetchIssue,
  fetchIssueComments,
  createIssueComment,
  removeLabelFromIssue,
  checkHasTriageAccess,
} from "./gitea-service.js";
import type { COO } from "../agents/coo.js";
import type { PipelineManager } from "../pipeline/pipeline-manager.js";
import { formatBotComment } from "../utils/github-comments.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

interface WatchedProject {
  projectId: string;
  repo: string;
  assignee: string;
}

export class GiteaIssueMonitor {
  private watched = new Map<string, WatchedProject>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private coo: COO;
  private io: TypedServer;
  private pipelineManager: PipelineManager | null = null;
  private collaboratorCache = new Map<string, { isCollaborator: boolean; checkedAt: number }>();
  private static readonly COLLABORATOR_CACHE_TTL_MS = 600_000; // 10 minutes

  constructor(coo: COO, io: TypedServer) {
    this.coo = coo;
    this.io = io;
  }

  setPipelineManager(pm: PipelineManager): void {
    this.pipelineManager = pm;
  }

  watchProject(projectId: string, repo: string, assignee: string): void {
    this.watched.set(projectId, { projectId, repo, assignee });
    console.log(`[GiteaIssueMonitor] Watching ${repo} for issues assigned to ${assignee} (project ${projectId})`);
  }

  unwatchProject(projectId: string): void {
    this.watched.delete(projectId);
  }

  loadFromDb(): void {
    const db = getDb();
    const projects = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.status, "active"))
      .all();

    for (const project of projects) {
      if (project.giteaRepo && project.giteaIssueMonitor) {
        const assignee = resolveGiteaUsername(project.id);
        if (!assignee) continue;
        this.watchProject(project.id, project.giteaRepo, assignee);
      }
    }
  }

  start(pollIntervalMs = 300_000): void {
    if (this.intervalId) return;
    if (this.watched.size === 0) {
      console.log("[GiteaIssueMonitor] No Gitea projects configured — polling not started");
      return;
    }
    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[GiteaIssueMonitor] Poll error:", err);
      });
    }, pollIntervalMs);
    console.log(`[GiteaIssueMonitor] Started polling every ${pollIntervalMs / 1000}s`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.watched.size === 0) return;
    for (const [projectId, watched] of this.watched) {
      const token = resolveGiteaToken(projectId);
      const instanceUrl = resolveGiteaInstanceUrl(projectId);
      if (!token || !instanceUrl) continue;

      try {
        await this.pollForTriage(projectId, watched, token, instanceUrl);
        await this.pollForAssigned(projectId, watched, token, instanceUrl);
      } catch (err) {
        console.error(`[GiteaIssueMonitor] Error polling ${watched.repo}:`, err);
      }
    }
  }

  private async pollForTriage(
    projectId: string,
    watched: WatchedProject,
    token: string,
    instanceUrl: string,
  ): Promise<void> {
    if (!this.pipelineManager?.isEnabled(projectId)) return;

    const config = this.pipelineManager.getConfig(projectId);
    if (!config?.stages?.triage?.enabled) return;

    const botUsername = resolveGiteaUsername(projectId) ?? null;
    if (!botUsername) return;

    const isCollaborator = await this.isRepoCollaborator(watched.repo, token, instanceUrl);
    if (!isCollaborator) {
      console.log(`[GiteaIssueMonitor] Skipping triage for ${watched.repo} — bot user "${botUsername}" is not a collaborator`);
      return;
    }

    const triageSinceKey = `project:${projectId}:gitea:triage_last_polled_at`;
    const since = getConfig(triageSinceKey) ?? undefined;

    const issues = await fetchOpenIssues(watched.repo, token, instanceUrl, since);

    for (const issue of issues) {
      const isTriaged = issue.labels.some((l) => l.name === "triaged");

      if (isTriaged) {
        if (!this.hasKanbanTask(projectId, issue.number, "gitea")) {
          this.pipelineManager.createTriageTask(
            projectId, issue.number, issue.title, "", issue.body ?? "",
          );
          console.log(`[GiteaIssueMonitor] Recreated missing triage task for issue #${issue.number}`);
          continue;
        }

        const needsRetriage = this.issueUpdatedSinceTask(issue, projectId)
          && await this.hasNewNonBotComments(
            watched.repo, token, issue.number, projectId, botUsername, instanceUrl,
          );
        if (!needsRetriage) continue;

        try {
          await removeLabelFromIssue(watched.repo, token, issue.number, "triaged", instanceUrl);
          issue.labels = issue.labels.filter((l) => l.name !== "triaged");
        } catch (err) {
          console.error(`[GiteaIssueMonitor] Failed to remove triaged label from #${issue.number}:`, err);
          continue;
        }
        console.log(`[GiteaIssueMonitor] Re-triaging issue #${issue.number} due to new comments`);
      }

      // Create triage task directly (pipeline's runTriage is GitHub-specific)
      this.pipelineManager.createTriageTask(
        projectId, issue.number, issue.title, "", issue.body ?? "",
      );

      if (isTriaged) {
        this.updateTriageTaskDescription(projectId, issue.number, issue.body ?? "");
      }
    }

    await this.syncTriageTasks(projectId, watched.repo, token, instanceUrl);
    setConfig(triageSinceKey, new Date().toISOString());
  }

  private async syncTriageTasks(
    projectId: string,
    repo: string,
    token: string,
    instanceUrl: string,
  ): Promise<void> {
    const db = getDb();

    const triageTasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(
        and(
          eq(schema.kanbanTasks.projectId, projectId),
          eq(schema.kanbanTasks.column, "triage"),
        ),
      )
      .all();

    const issueLabel = /^gitea-issue-(\d+)$/;
    const tasksByIssue = new Map<number, typeof triageTasks[0]>();
    for (const task of triageTasks) {
      const labels = task.labels as string[];
      const match = labels.map((l) => issueLabel.exec(l)).find(Boolean);
      if (match) tasksByIssue.set(Number(match[1]), task);
    }

    if (tasksByIssue.size === 0) return;

    const openNumbers = await fetchAllOpenIssueNumbers(repo, token, instanceUrl);

    for (const [issueNum, task] of tasksByIssue) {
      if (openNumbers.has(issueNum)) continue;

      const now = new Date().toISOString();

      // Gitea doesn't have state_reason, so we just check if the issue is closed
      let isClosed = false;
      try {
        const issue = await fetchIssue(repo, token, issueNum, instanceUrl);
        isClosed = issue.state === "closed";
      } catch {
        isClosed = true; // Treat errors as deleted
      }

      if (isClosed) {
        db.update(schema.kanbanTasks)
          .set({
            column: "done",
            completionReport: `Gitea issue #${issueNum} closed.`,
            updatedAt: now,
          })
          .where(eq(schema.kanbanTasks.id, task.id))
          .run();

        const updated = db
          .select()
          .from(schema.kanbanTasks)
          .where(eq(schema.kanbanTasks.id, task.id))
          .get();
        if (updated) {
          this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
        }
        console.log(
          `[GiteaIssueMonitor] Issue #${issueNum} closed → task moved to done (project ${projectId})`,
        );
      }
    }
  }

  private async isRepoCollaborator(
    repo: string,
    token: string,
    instanceUrl: string,
  ): Promise<boolean> {
    const cached = this.collaboratorCache.get(repo);
    if (cached && Date.now() - cached.checkedAt < GiteaIssueMonitor.COLLABORATOR_CACHE_TTL_MS) {
      return cached.isCollaborator;
    }

    try {
      const result = await checkHasTriageAccess(repo, token, instanceUrl);
      this.collaboratorCache.set(repo, { isCollaborator: result, checkedAt: Date.now() });
      if (!result) {
        console.log(`[GiteaIssueMonitor] Bot lacks push access on ${repo} — skipping triage`);
      }
      return result;
    } catch (err) {
      console.error(`[GiteaIssueMonitor] Failed to check permissions on ${repo}:`, err);
      return false;
    }
  }

  private hasKanbanTask(projectId: string, issueNumber: number, prefix = "gitea"): boolean {
    const db = getDb();
    const label = `${prefix}-issue-${issueNumber}`;
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, projectId))
      .all();
    return tasks.some((t) => (t.labels as string[]).includes(label));
  }

  private issueUpdatedSinceTask(
    issue: { number: number; updated_at: string },
    projectId: string,
  ): boolean {
    const db = getDb();
    const label = `gitea-issue-${issue.number}`;

    const triageTasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(
        and(
          eq(schema.kanbanTasks.projectId, projectId),
          eq(schema.kanbanTasks.column, "triage"),
        ),
      )
      .all();

    const triageTask = triageTasks.find(
      (t) => (t.labels as string[]).includes(label),
    );
    if (!triageTask) return false;

    return new Date(issue.updated_at).getTime() > new Date(triageTask.updatedAt).getTime();
  }

  private async hasNewNonBotComments(
    repo: string,
    token: string,
    issueNumber: number,
    projectId: string,
    botUsername: string | null,
    instanceUrl: string,
  ): Promise<boolean> {
    const db = getDb();
    const label = `gitea-issue-${issueNumber}`;

    const triageTasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(
        and(
          eq(schema.kanbanTasks.projectId, projectId),
          eq(schema.kanbanTasks.column, "triage"),
        ),
      )
      .all();

    const triageTask = triageTasks.find(
      (t) => (t.labels as string[]).includes(label),
    );
    if (!triageTask) return false;

    const taskUpdatedAt = new Date(triageTask.updatedAt).getTime();

    try {
      const comments = await fetchIssueComments(repo, token, issueNumber, instanceUrl);
      return comments.some((c) => {
        if (botUsername && c.user.login === botUsername) return false;
        if (c.user.login.endsWith("[bot]")) return false;
        return new Date(c.created_at).getTime() > taskUpdatedAt;
      });
    } catch (err) {
      console.error(`[GiteaIssueMonitor] Failed to fetch comments for #${issueNumber}:`, err);
      return false;
    }
  }

  private updateTriageTaskDescription(
    projectId: string,
    issueNumber: number,
    body: string,
  ): void {
    const db = getDb();
    const label = `gitea-issue-${issueNumber}`;

    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(
        and(
          eq(schema.kanbanTasks.projectId, projectId),
          eq(schema.kanbanTasks.column, "triage"),
        ),
      )
      .all();

    const task = tasks.find((t) => (t.labels as string[]).includes(label));
    if (!task) return;

    const now = new Date().toISOString();
    db.update(schema.kanbanTasks)
      .set({ description: body, updatedAt: now })
      .where(eq(schema.kanbanTasks.id, task.id))
      .run();

    const updated = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, task.id))
      .get();
    if (updated) {
      this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
    }
  }

  private async pollForAssigned(
    projectId: string,
    watched: WatchedProject,
    token: string,
    instanceUrl: string,
  ): Promise<void> {
    const sinceKey = `project:${projectId}:gitea:last_polled_at`;
    const since = getConfig(sinceKey) ?? undefined;

    const issues = await fetchAssignedIssues(
      watched.repo,
      token,
      watched.assignee,
      instanceUrl,
      since,
    );

    const db = getDb();

    for (const issue of issues) {
      const label = `gitea-issue-${issue.number}`;

      const existingTasks = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, projectId))
        .all();

      const existingTriageTask = existingTasks.find(
        (t) => (t.labels as string[]).includes(label) && t.column === "triage",
      );

      const alreadyInProgress = existingTasks.some(
        (t) => (t.labels as string[]).includes(label) && t.column !== "triage",
      );
      if (alreadyInProgress) continue;

      let taskId: string;

      if (existingTriageTask) {
        taskId = existingTriageTask.id;
        const now = new Date().toISOString();
        const maxPos = existingTasks
          .filter((t) => t.column === "backlog")
          .reduce((max, t) => Math.max(max, t.position), -1);

        db.update(schema.kanbanTasks)
          .set({
            column: "backlog",
            position: maxPos + 1,
            spawnCount: 0,
            description: issue.body ?? existingTriageTask.description,
            updatedAt: now,
          })
          .where(eq(schema.kanbanTasks.id, taskId))
          .run();

        const updated = db
          .select()
          .from(schema.kanbanTasks)
          .where(eq(schema.kanbanTasks.id, taskId))
          .get();
        if (updated) {
          this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
        }
        console.log(`[GiteaIssueMonitor] Promoted triage task to backlog for issue #${issue.number}`);
      } else {
        taskId = nanoid();
        const now = new Date().toISOString();
        const maxPos = existingTasks
          .filter((t) => t.column === "backlog")
          .reduce((max, t) => Math.max(max, t.position), -1);

        const maxTaskNum = existingTasks.reduce((max, t) => Math.max(max, (t as any).taskNumber ?? 0), 0);

        const task = {
          id: taskId,
          projectId,
          title: `#${issue.number}: ${issue.title}`,
          description: issue.body ?? "",
          column: "backlog" as const,
          position: maxPos + 1,
          assigneeAgentId: null,
          createdBy: "gitea-issue-monitor",
          labels: [label],
          blockedBy: [] as string[],
          retryCount: 0,
          spawnCount: 0,
          completionReport: null,
          taskNumber: maxTaskNum + 1,
          pipelineStage: null,
          pipelineStages: [] as string[],
          pipelineAttempt: 0,
          createdAt: now,
          updatedAt: now,
        };
        db.insert(schema.kanbanTasks).values(task).run();
        this.io.emit("kanban:task-created", task as unknown as KanbanTask);
      }

      if (this.pipelineManager?.isEnabled(projectId)) {
        await this.pipelineManager.startImplementation(
          taskId,
          projectId,
          issue.number,
          watched.repo,
        );
      } else {
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
                `New Gitea issue #${issue.number} assigned: "${issue.title}"\n\n` +
                `${issue.body ?? "(no description)"}\n\n` +
                `Task created on kanban board (${taskId}). ` +
                `Spawn a worker to create a feature branch, implement the fix, and open a PR.`,
              projectId,
            });
          }
        }
      }

      try {
        await createIssueComment(
          watched.repo,
          token,
          issue.number,
          formatBotComment("Working on It", "Working on this issue now."),
          instanceUrl,
        );
      } catch (commentErr) {
        console.error(
          `[GiteaIssueMonitor] Failed to comment on issue #${issue.number}:`,
          commentErr,
        );
      }

      console.log(`[GiteaIssueMonitor] Created task for issue #${issue.number} in project ${projectId}`);
    }

    setConfig(sinceKey, new Date().toISOString());
  }
}
