import { test, expect } from "@playwright/test";
import { openSessionAndWait } from "./helpers";

/**
 * Shell tests — do not require LM Studio. Verify the app boots, the
 * socket connects, the view panes toggle, and the API endpoints are
 * reachable. Skipping these would mean the server is not running.
 */
test.describe("shell", () => {
  test("app loads and socket connects", async ({ page }) => {
    await openSessionAndWait(page);
    await expect(page.getByText("otterbot")).toBeVisible();
    const status = page.getByTestId("connection-status");
    await expect(status).toContainText("●");
  });

  test("view tabs switch panes", async ({ page }) => {
    await openSessionAndWait(page);
    // With pane=none, corner tabs offer opening a pane.
    await page.getByTestId("tab-open-2d").click();
    await expect(page.getByTestId("view-2d, view-2d-empty").or(page.getByTestId("view-2d")).or(page.getByTestId("view-2d-empty"))).toBeVisible();

    await page.getByTestId("tab-3d").click();
    await expect(page.getByTestId("view-3d").or(page.getByTestId("view-3d-empty"))).toBeVisible();

    await page.getByTestId("tab-desktop").click();
    const desktopEl = page
      .getByTestId("view-desktop")
      .or(page.getByTestId("view-desktop-placeholder"));
    await expect(desktopEl).toBeVisible();
  });

  test("scenes endpoint returns JSON", async ({ request }) => {
    const res = await request.get("/api/scenes");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(Array.isArray(json)).toBeTruthy();
  });

  test("skills endpoint returns JSON", async ({ request }) => {
    const res = await request.get("/api/skills");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(Array.isArray(json)).toBeTruthy();
  });

  test("user-profile endpoint returns profile shape", async ({ request }) => {
    const res = await request.get("/api/user-profile");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json).toHaveProperty("preferences");
    expect(json).toHaveProperty("goals");
    expect(json).toHaveProperty("facts");
  });

  test("desktop status endpoint responds", async ({ request }) => {
    const res = await request.get("/api/desktop/status");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json).toHaveProperty("enabled");
  });
});
