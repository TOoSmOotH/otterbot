import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, KanbanTask } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import { getConfig, setConfig } from "../auth/auth.js";
import {
  fetchAssignedIssues,
  fetchOpenIssues,
  fetchAllOpenIssueNumbers,
  fetchIssue,
  fetchIssueComments,
  createIssueComment,
  removeLabelFromIssue,
} from "./github-service.js";
import type { COO } from "../agents/coo.js";
import type { PipelineManager } from "../pipeline/pipeline-manager.js";

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
  private pipelineManager: PipelineManager | null = null;

  constructor(coo: COO, io: TypedServer) {
    this.coo = coo;
    this.io = io;
  }

  /** Inject the pipeline manager (avoids circular dependency) */
  setPipelineManager(pm: PipelineManager): void {
    this.pipelineManager = pm;
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
  start(pollIntervalMs = 300_000): void {
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
        // Run triage on all new issues (if pipeline is enabled)
        await this.pollForTriage(projectId, watched, token);
        // Process assigned issues (create tasks + start implementation)
        await this.pollForAssigned(projectId, watched, token);
      } catch (err) {
        console.error(`[IssueMonitor] Error polling ${watched.repo}:`, err);
      }
    }
  }

  /**
   * Poll for ALL new open issues and run triage on untriaged ones.
   * Only runs if pipeline is enabled and triage stage is enabled.
   */
  private async pollForTriage(
    projectId: string,
    watched: WatchedProject,
    token: string,
  ): Promise<void> {
    if (!this.pipelineManager?.isEnabled(projectId)) return;

    const config = this.pipelineManager.getConfig(projectId);
    if (!config?.stages?.triage?.enabled) return;

    const triageSinceKey = `project:${projectId}:github:triage_last_polled_at`;
    const since = getConfig(triageSinceKey) ?? undefined;

    const issues = await fetchOpenIssues(watched.repo, token, since);

    const botUsername = getConfig("github:username") ?? null;

    for (const issue of issues) {
      const isTriaged = issue.labels.some((l) => l.name === "triaged");

      if (isTriaged) {
        // Check if the kanban task still exists (may have been accidentally deleted)
        if (!this.hasKanbanTask(projectId, issue.number)) {
          // Recreate the triage task without re-running the LLM
          this.pipelineManager.createTriageTask(
            projectId, issue.number, issue.title, "", issue.body ?? "",
          );
          console.log(`[IssueMonitor] Recreated missing triage task for issue #${issue.number}`);
          continue;
        }

        // Quick check: does this issue have activity newer than the triage task?
        // If not, skip the expensive fetchIssueComments call entirely.
        const needsRetriage = this.issueUpdatedSinceTask(issue, projectId)
          && await this.hasNewNonBotComments(
            watched.repo, token, issue.number, projectId, botUsername,
          );
        if (!needsRetriage) continue;

        // Remove "triaged" label so runTriage will re-apply it
        try {
          await removeLabelFromIssue(watched.repo, token, issue.number, "triaged");
          // Update the issue object so runTriage doesn't see the stale label
          issue.labels = issue.labels.filter((l) => l.name !== "triaged");
        } catch (err) {
          console.error(`[IssueMonitor] Failed to remove triaged label from #${issue.number}:`, err);
          continue;
        }
        console.log(`[IssueMonitor] Re-triaging issue #${issue.number} due to new comments`);
      }

      // Run triage (this also creates a triage task when pipeline is enabled)
      try {
        await this.pipelineManager.runTriage(projectId, watched.repo, issue);
      } catch (err) {
        console.error(`[IssueMonitor] Triage failed for issue #${issue.number}:`, err);
        // Even if triage LLM fails, create a triage task so the issue is visible
        this.pipelineManager.createTriageTask(
          projectId, issue.number, issue.title, "", issue.body ?? "",
        );
      }

      // For re-triaged issues, update the existing triage task description
      if (isTriaged) {
        this.updateTriageTaskDescription(projectId, issue.number, issue.body ?? "");
      }
    }

    await this.syncTriageTasks(projectId, watched.repo, token);

    setConfig(triageSinceKey, new Date().toISOString());
  }

  /**
   * Sync triage tasks with GitHub issue state.
   * - Issues closed as "completed" → move task to done
   * - Issues closed as "not_planned" or deleted → delete task
   * - Open issues stay in triage
   */
  private async syncTriageTasks(
    projectId: string,
    repo: string,
    token: string,
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

    // Only fetch the authoritative set if there are triage tasks to check
    const issueLabel = /^github-issue-(\d+)$/;
    const tasksByIssue = new Map<number, typeof triageTasks[0]>();
    for (const task of triageTasks) {
      const labels = task.labels as string[];
      const match = labels.map((l) => issueLabel.exec(l)).find(Boolean);
      if (match) tasksByIssue.set(Number(match[1]), task);
    }

    if (tasksByIssue.size === 0) return;

    const openNumbers = await fetchAllOpenIssueNumbers(repo, token);

    for (const [issueNum, task] of tasksByIssue) {
      if (openNumbers.has(issueNum)) continue;

      // Issue is not open — fetch it to determine close reason
      let stateReason: string | null = null;
      try {
        const issue = await fetchIssue(repo, token, issueNum);
        stateReason = issue.state_reason;
      } catch {
        // 404 or network error — treat as deleted
      }

      const now = new Date().toISOString();

      if (stateReason === "completed") {
        // Closed as completed → move to done
        db.update(schema.kanbanTasks)
          .set({
            column: "done",
            completionReport: `GitHub issue #${issueNum} closed as completed.`,
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
          `[IssueMonitor] Issue #${issueNum} closed as completed → task moved to done (project ${projectId})`,
        );
      } else {
        // Not planned, deleted, or unknown → remove from board
        db.delete(schema.kanbanTasks)
          .where(eq(schema.kanbanTasks.id, task.id))
          .run();
        this.io.emit("kanban:task-deleted", { taskId: task.id, projectId });
        console.log(
          `[IssueMonitor] Issue #${issueNum} closed (${stateReason ?? "deleted"}) → task removed (project ${projectId})`,
        );
      }
    }
  }

  /**
   * Quick local check: is the issue's updated_at newer than the triage task's updatedAt?
   * This avoids calling fetchIssueComments when nothing has changed.
   */
  /**
   * Check if any kanban task (any column) exists for a given issue number.
   */
  private hasKanbanTask(projectId: string, issueNumber: number): boolean {
    const db = getDb();
    const label = `github-issue-${issueNumber}`;
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
    const label = `github-issue-${issue.number}`;

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

  /**
   * Check if an issue has non-bot comments newer than the existing triage task.
   */
  private async hasNewNonBotComments(
    repo: string,
    token: string,
    issueNumber: number,
    projectId: string,
    botUsername: string | null,
  ): Promise<boolean> {
    const db = getDb();
    const label = `github-issue-${issueNumber}`;

    // Find the existing triage task for this issue
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
      const comments = await fetchIssueComments(repo, token, issueNumber);
      return comments.some((c) => {
        if (botUsername && c.user.login === botUsername) return false;
        // Also skip bot accounts (login ending with [bot])
        if (c.user.login.endsWith("[bot]")) return false;
        return new Date(c.created_at).getTime() > taskUpdatedAt;
      });
    } catch (err) {
      console.error(`[IssueMonitor] Failed to fetch comments for #${issueNumber}:`, err);
      return false;
    }
  }

  /**
   * Update an existing triage task's description after re-triage.
   * runTriage's createTriageTask call is a no-op when the task exists,
   * so we update it here with refreshed content.
   */
  private updateTriageTaskDescription(
    projectId: string,
    issueNumber: number,
    body: string,
  ): void {
    const db = getDb();
    const label = `github-issue-${issueNumber}`;

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

  /**
   * Poll for issues assigned to the configured user — existing behavior.
   * Creates kanban tasks and starts implementation (via pipeline or direct directive).
   */
  private async pollForAssigned(
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

      // Check if a triage task already exists for this issue
      const existingTriageTask = existingTasks.find(
        (t) => (t.labels as string[]).includes(label) && t.column === "triage",
      );

      // Check if already tracked in a non-triage column (backlog, in_progress, etc.)
      const alreadyInProgress = existingTasks.some(
        (t) => (t.labels as string[]).includes(label) && t.column !== "triage",
      );
      if (alreadyInProgress) continue;

      let taskId: string;

      if (existingTriageTask) {
        // Promote triage task to backlog
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
        console.log(`[IssueMonitor] Promoted triage task to backlog for issue #${issue.number}`);
      } else {
        // Create new kanban task in backlog
        taskId = nanoid();
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
          spawnCount: 0,
          completionReport: null,
          pipelineStage: null,
          pipelineStages: [] as string[],
          pipelineAttempt: 0,
          createdAt: now,
          updatedAt: now,
        };
        db.insert(schema.kanbanTasks).values(task).run();

        // Emit to UI
        this.io.emit("kanban:task-created", task as unknown as KanbanTask);
      }

      // Route through pipeline if enabled, otherwise use direct directive
      if (this.pipelineManager?.isEnabled(projectId)) {
        await this.pipelineManager.startImplementation(
          taskId,
          projectId,
          issue.number,
          watched.repo,
        );
      } else {
        // Existing direct directive behavior
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
      }

      // Post acknowledgement comment on the GitHub issue
      try {
        await createIssueComment(
          watched.repo,
          token,
          issue.number,
          `👀 I'm looking into this issue and will begin working on a fix shortly.`,
        );
      } catch (commentErr) {
        console.error(
          `[IssueMonitor] Failed to comment on issue #${issue.number}:`,
          commentErr,
        );
      }

      console.log(`[IssueMonitor] Created task for issue #${issue.number} in project ${projectId}`);
    }

    // Update last polled timestamp
    setConfig(sinceKey, new Date().toISOString());
  }
}
