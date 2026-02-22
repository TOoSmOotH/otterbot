import { test, expect } from "../fixtures";
import { setupEventCollector, waitForEvent, getEvents } from "../helpers/ws-events";
import { hasProvider } from "../credentials";
import {
  getStoredCookie,
  getSettings,
  getProviders,
  updateProvider,
  getRegistry,
} from "../helpers/api";
import { startMockLLMServer, setRegistryEntryId } from "../helpers/mock-llm-server";

/**
 * Full team orchestration E2E test.
 *
 * Two modes:
 * - **Real LLM** (credentials present): Full end-to-end including deliverable
 *   verification (ports serving, todo app works).
 * - **Mock mode** (no credentials): Verifies the structural orchestration flow
 *   using canned LLM responses (project created → agents spawned → tasks
 *   created/moved → COO response).
 */
test.describe("Team Orchestration", () => {
  test.setTimeout(600_000); // 10 minutes total

  let mockMode: boolean;
  let mockServer: { port: number; close: () => Promise<void> } | null = null;
  let setupProviderId: string | null = null;
  let originalBaseUrl: string | undefined;
  let originalApiKey: string | undefined;
  let cookie: string | null = null;

  test.beforeAll(async () => {
    mockMode = !hasProvider("openai-compatible");
    if (!mockMode) return;

    // Start mock LLM server
    mockServer = await startMockLLMServer();

    // Get auth cookie from stored state
    cookie = getStoredCookie();
    if (!cookie) throw new Error("No stored auth cookie for mock setup");

    // Find the setup provider (the one the COO is already using) and
    // point it at our mock server. The COO caches its provider ID at
    // startup, so we can't create a new provider — we must update the
    // existing one in-place.
    const settingsRes = await getSettings(cookie);
    if (!settingsRes.ok) throw new Error("Failed to get settings");
    const settings = await settingsRes.json();
    setupProviderId = settings.defaults?.coo?.provider ?? null;

    if (setupProviderId) {
      // Save the original values so we can restore them in afterAll
      const providersRes = await getProviders(cookie);
      if (providersRes.ok) {
        const providers = await providersRes.json();
        const existing = (Array.isArray(providers) ? providers : []).find(
          (p: any) => p.id === setupProviderId,
        );
        if (existing) {
          originalBaseUrl = existing.baseUrl;
          originalApiKey = existing.apiKeyMasked;
        }
      }

      // Update the setup provider to point at the mock server.
      // The Otter server runs in Docker, so use host.docker.internal
      // (added via extra_hosts in docker-compose.e2e.yml) to reach the
      // mock server running on the host machine.
      const updateRes = await updateProvider(cookie, setupProviderId, {
        baseUrl: `http://host.docker.internal:${mockServer.port}`,
        apiKey: "mock-key",
      });
      if (!updateRes.ok) {
        const err = await updateRes.text();
        throw new Error(`Failed to update setup provider: ${err}`);
      }
    }

    // Fetch registry to find a worker entry ID for the mock
    const registryRes = await getRegistry(cookie);
    if (registryRes.ok) {
      const entries = await registryRes.json();
      const workerEntry = (Array.isArray(entries) ? entries : []).find(
        (e: any) => e.role === "worker",
      );
      if (workerEntry) {
        setRegistryEntryId(workerEntry.id);
      }
    }
  });

  test.afterAll(async () => {
    if (!mockMode || !cookie) return;

    // Restore original provider settings
    if (setupProviderId) {
      await updateProvider(cookie, setupProviderId, {
        baseUrl: originalBaseUrl ?? "",
        apiKey: originalApiKey ?? "",
      });
    }

    // Stop mock server
    if (mockServer) {
      await mockServer.close();
    }
  });

  test("full lifecycle: prompt → project → agents → tasks → completion", async ({
    page,
    requireProvider,
  }) => {
    // In real mode, skip if no credentials; in mock mode, always run
    if (!mockMode) {
      requireProvider("openai-compatible");
    }

    // Navigate to app and wait for it to be ready
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });

    // Set up the WebSocket event collector
    await setupEventCollector(page);

    // Send the chat message
    const textarea = page.locator("textarea").first();
    await textarea.fill(
      "I want you to create a todo web application using React for the front end " +
        "and go + sqlite for the back end. I want you to start it up locally and have " +
        "full end to end tests that are passing via playwright. Run the frontend on " +
        "port 3335 and the backend on 3336",
    );
    await textarea.press("Enter");

    // ── Step 1: Wait for project creation ──────────────────────────
    const project = await waitForEvent(
      page,
      "project:created",
      (data: any) => !!data?.projectId || !!data?.id,
      120_000,
    );
    const projectId = project.projectId || project.id;
    expect(projectId).toBeTruthy();

    // Verify project exists via API
    const projectCheck = await page.evaluate(async (pid) => {
      const res = await fetch(`/api/projects`);
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
      120_000,
    );
    // Give a moment for more tasks to arrive
    await page.waitForTimeout(5_000);
    const tasks = await getEvents(page, "kanban:task-created");
    expect(tasks.length).toBeGreaterThanOrEqual(2);

    // Verify tasks via API
    const apiTasks = await page.evaluate(async (pid) => {
      const res = await fetch(`/api/projects/${pid}/tasks`);
      if (!res.ok) return [];
      return res.json();
    }, projectId);
    expect(Array.isArray(apiTasks) ? apiTasks.length : 0).toBeGreaterThanOrEqual(1);

    // ── Step 4: Wait for worker agents ─────────────────────────────
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
        data?.toolName === "shell_exec" ||
        data?.toolName === "write_file" ||
        data?.toolName === "execute_command",
      300_000,
    );
    const toolCalls = await getEvents(page, "agent:tool-call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);

    // ── Step 6: Wait for at least one task to move to done ─────────
    await waitForEvent(
      page,
      "kanban:task-updated",
      (data: any) =>
        data?.column === "done" ||
        data?.status === "done" ||
        data?.column === "Done",
      300_000,
    );

    // ── Step 7: Wait for COO completion response ───────────────────
    await waitForEvent(
      page,
      "coo:response",
      (_data: any) => true,
      600_000,
    );

    // ── Steps 8-11: Deliverable verification (real LLM only) ──────
    if (!mockMode) {
      // Step 8: Verify deliverables — ports are serving
      const frontendOk = await page.evaluate(async () => {
        try {
          const res = await fetch("http://localhost:3335");
          return res.ok || res.status < 400;
        } catch {
          return false;
        }
      });
      expect(frontendOk).toBe(true);

      const backendOk = await page.evaluate(async () => {
        try {
          const res = await fetch("http://localhost:3336");
          return res.ok || res.status < 400;
        } catch {
          // Try common health endpoints
          try {
            const res = await fetch("http://localhost:3336/health");
            return res.ok;
          } catch {
            return false;
          }
        }
      });
      expect(backendOk).toBe(true);

      // Step 9: Verify the todo app works end-to-end
      const createTodo = await page.evaluate(async () => {
        try {
          const res = await fetch("http://localhost:3336/todos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "e2e-test-todo", completed: false }),
          });
          if (!res.ok) {
            const alt = await fetch("http://localhost:3336/api/todos", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: "e2e-test-todo", completed: false }),
            });
            return alt.ok;
          }
          return true;
        } catch {
          return false;
        }
      });
      expect(createTodo).toBe(true);

      // Verify it was persisted
      const getTodos = await page.evaluate(async () => {
        try {
          let res = await fetch("http://localhost:3336/todos");
          if (!res.ok) {
            res = await fetch("http://localhost:3336/api/todos");
          }
          if (!res.ok) return [];
          return res.json();
        } catch {
          return [];
        }
      });
      expect(Array.isArray(getTodos) ? getTodos.length : 0).toBeGreaterThanOrEqual(1);

      // Navigate to the React frontend and verify it renders
      await page.goto("http://localhost:3335");
      await expect(page.locator("body")).not.toBeEmpty();
      const hasTodoUI = await page.evaluate(() => {
        const body = document.body.innerText.toLowerCase();
        return body.includes("todo") || body.includes("task") || body.includes("add");
      });
      expect(hasTodoUI).toBe(true);
    }
  });
});
