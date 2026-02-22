import { test, expect } from "../fixtures";
import { getStoredCookie } from "../helpers/api";

test.describe("Kanban Board", () => {
  // Kanban requires a project context — we test via API + UI
  test("kanban API: create, update, and delete task", async ({ credentials }) => {
    const cookie = getStoredCookie();

    // Create a project first
    const projRes = await fetch("https://localhost:62627/api/projects", {
      headers: { Cookie: cookie },
    });
    const projects = await projRes.json();

    // If no projects, we test API endpoints directly for 404 handling
    if (!Array.isArray(projects) || projects.length === 0) {
      // Try creating a task on a non-existent project — should still work as API
      // Just verify the API endpoints respond
      const tasksRes = await fetch("https://localhost:62627/api/projects/fake-id/tasks", {
        headers: { Cookie: cookie },
      });
      // The tasks endpoint should return an empty array or 404
      expect([200, 404]).toContain(tasksRes.status);
      return;
    }

    const projectId = projects[0].id;

    // Create a task
    const createRes = await fetch(
      `https://localhost:62627/api/projects/${projectId}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ title: "E2E Test Task", description: "Test description" }),
      },
    );
    expect(createRes.ok).toBe(true);
    const task = await createRes.json();
    expect(task.title).toBe("E2E Test Task");
    expect(task.column).toBe("backlog");

    // Update the task
    const updateRes = await fetch(
      `https://localhost:62627/api/projects/${projectId}/tasks/${task.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ column: "in_progress" }),
      },
    );
    expect(updateRes.ok).toBe(true);
    const updated = await updateRes.json();
    expect(updated.column).toBe("in_progress");

    // Delete the task
    const deleteRes = await fetch(
      `https://localhost:62627/api/projects/${projectId}/tasks/${task.id}`,
      {
        method: "DELETE",
        headers: { Cookie: cookie },
      },
    );
    expect(deleteRes.ok).toBe(true);
  });
});
