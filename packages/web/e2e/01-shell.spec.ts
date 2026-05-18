import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

/**
 * Shell tests — verify the multi-agent app boots, the roster renders, the
 * main views switch, and the core API endpoints respond.
 */
test.describe("shell", () => {
  test("app loads with the COO in the roster", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByRole("heading", { name: "otterbot", exact: true })).toBeVisible();
    await expect(page.getByTestId("agent-card-coo")).toBeVisible();
  });

  test("main views switch", async ({ page }) => {
    await gotoApp(page);

    await page.getByTestId("view-activity").click();
    await expect(page.getByText("Agent communication")).toBeVisible();

    await page.getByTestId("view-chat").click();
    await expect(page.getByTestId("chat-input")).toBeVisible();

    await page.getByTestId("view-settings").click();
    await expect(page.getByTestId("global-settings")).toBeVisible();
  });

  test("GET /api/agents includes the COO", async ({ request }) => {
    const res = await request.get("/api/agents");
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as Array<{ id: string; role: string }>;
    expect(json.some((a) => a.id === "coo" && a.role === "coo")).toBeTruthy();
  });

  test("GET /api/providers lists model providers", async ({ request }) => {
    const res = await request.get("/api/providers");
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as Array<{ id: string }>;
    expect(json.some((p) => p.id === "anthropic")).toBeTruthy();
    expect(json.some((p) => p.id === "lmstudio")).toBeTruthy();
  });

  test("GET /api/settings/global returns redacted global settings", async ({ request }) => {
    const res = await request.get("/api/settings/global");
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as {
      theme: string;
      defaultChatModel: { provider: string };
      providers: { openai: { apiKey?: string } };
    };
    expect(json.theme).toBeTruthy();
    expect(json.defaultChatModel.provider).toBeTruthy();
    expect(json.providers.openai.apiKey).toBeUndefined();
  });

  test("GET /api/bus/messages returns an array", async ({ request }) => {
    const res = await request.get("/api/bus/messages");
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray(await res.json())).toBeTruthy();
  });
});
