import { test, expect } from "../fixtures";
import { setupEventCollector, waitForEvent, getEvents } from "../helpers/ws-events";

/**
 * Mock mode E2E test.
 *
 * Requires the server to be started with MOCK_MODE=true.
 * The mock LLM interceptor runs inside the server process — no external
 * mock server needed.
 *
 * Usage (local):
 *   MOCK_MODE=true MOCK_STREAM_DELAY=0 MOCK_PASSPHRASE=test-passphrase-e2e \
 *     OTTERBOT_DB_KEY=mock-test-key npx tsx packages/server/src/index.ts &
 *   BASE_URL=https://localhost:62626 npx playwright test -c e2e/playwright.config.ts \
 *     e2e/tests/25-mock-mode.spec.ts
 *
 * Usage (Docker):
 *   npx pnpm test:e2e:mock
 */
test.describe("Mock Mode", () => {
  test.setTimeout(180_000); // 3 minutes

  test("full lifecycle: chat → project → agents → tasks → completion", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });

    // Set up WebSocket event collector
    await setupEventCollector(page);

    // Send a message to trigger the orchestration flow
    const textarea = page.locator("textarea").first();
    await textarea.fill(
      "Build a test application with a backend and frontend",
    );
    await textarea.press("Enter");

    // ── Wait for approval request from COO ─────────────────────────
    // The COO will call create_project which requires CEO approval.
    // Wait for the approval message to appear, then send "approve".
    await waitForEvent(
      page,
      "coo:response",
      (data: any) => {
        const content = data?.content ?? "";
        return content.includes("Approval Required") || content.includes("approve");
      },
      60_000,
    );

    // Send approval
    await page.waitForTimeout(500);
    const approveTextarea = page.locator("textarea").first();
    await approveTextarea.fill("approve");
    await approveTextarea.press("Enter");

    // ── Step 1: Wait for project creation ──────────────────────────
    const project = await waitForEvent(
      page,
      "project:created",
      (data: any) => !!data?.projectId || !!data?.id,
      60_000,
    );
    const projectId = project.projectId || project.id;
    expect(projectId).toBeTruthy();

    // Verify project exists via API
    const projectCheck = await page.evaluate(async (pid) => {
      const res = await fetch("/api/projects");
      if (!res.ok) return null;
      const projects = await res.json();
      return Array.isArray(projects)
        ? projects.find((p: any) => p.id === pid || p.projectId === pid)
        : null;
    }, projectId);
    expect(projectCheck).toBeTruthy();

    // ── Step 2: Wait for team lead agent ───────────────────────────
    const teamLead = await waitForEvent(
      page,
      "agent:spawned",
      (data: any) =>
        data?.role === "team_lead" ||
        data?.type === "team_lead" ||
        (data?.name && data.name.toLowerCase().includes("lead")),
      60_000,
    );
    expect(teamLead).toBeTruthy();

    // ── Step 3: Wait for tasks to be created ───────────────────────
    await waitForEvent(
      page,
      "kanban:task-created",
      (_data: any) => true,
      60_000,
    );
    // Give a moment for additional tasks
    await page.waitForTimeout(3_000);
    const tasks = await getEvents(page, "kanban:task-created");
    expect(tasks.length).toBeGreaterThanOrEqual(1);

    // ── Step 4: Wait for worker agent ──────────────────────────────
    const worker = await waitForEvent(
      page,
      "agent:spawned",
      (data: any) =>
        data?.role === "worker" ||
        data?.type === "worker" ||
        (data?.name && data.name.toLowerCase().includes("worker")),
      60_000,
    );
    expect(worker).toBeTruthy();

    // ── Step 5: Wait for tool calls ────────────────────────────────
    await waitForEvent(
      page,
      "agent:tool-call",
      (data: any) =>
        data?.toolName === "file_write" ||
        data?.toolName === "shell_exec",
      60_000,
    );

    // ── Step 6: Wait for task to move to done ──────────────────────
    await waitForEvent(
      page,
      "kanban:task-updated",
      (data: any) =>
        data?.column === "done" ||
        data?.status === "done",
      60_000,
    );

    // ── Step 7: Wait for COO completion response ───────────────────
    // The COO should have received a report from the team lead
    await waitForEvent(
      page,
      "coo:response",
      (data: any) => {
        const content = data?.content ?? "";
        // Skip the approval-related messages, wait for a real response
        return !content.includes("Approval") && !content.includes("approved") && content.length > 0;
      },
      60_000,
    );

    // Verify final state — at least one task should be in "done" column
    const apiTasks = await page.evaluate(async (pid) => {
      const res = await fetch(`/api/projects/${pid}/tasks`);
      if (!res.ok) return [];
      return res.json();
    }, projectId);
    const doneTasks = (Array.isArray(apiTasks) ? apiTasks : []).filter(
      (t: any) => t.column === "done",
    );
    expect(doneTasks.length).toBeGreaterThanOrEqual(1);
  });
});
