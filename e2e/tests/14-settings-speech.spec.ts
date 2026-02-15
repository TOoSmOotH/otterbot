import { test, expect } from "../fixtures";

test.describe("Settings - Speech (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("speech tab is accessible", async ({ page }) => {
    const speechTab = page.locator('button:has-text("Speech")').first();
    await expect(speechTab).toBeVisible({ timeout: 5_000 });
    await speechTab.click();
  });

  test("TTS section is visible", async ({ page }) => {
    const speechTab = page.locator('button:has-text("Speech")').first();
    await speechTab.click();

    await expect(
      page.locator("text=Text-to-Speech").or(page.locator("text=TTS")),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("STT section is visible", async ({ page }) => {
    const speechTab = page.locator('button:has-text("Speech")').first();
    await speechTab.click();

    await expect(
      page.locator("text=Speech-to-Text").or(page.locator("text=STT")),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Settings - Speech (API)", () => {
  test("TTS and STT APIs return settings", async ({ credentials }) => {
    const loginRes = await fetch("https://localhost:62627/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: credentials.setup.passphrase }),
    });
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const ttsRes = await fetch("https://localhost:62627/api/settings/tts", {
      headers: { Cookie: cookie },
    });
    expect(ttsRes.ok).toBe(true);

    const sttRes = await fetch("https://localhost:62627/api/settings/stt", {
      headers: { Cookie: cookie },
    });
    expect(sttRes.ok).toBe(true);
  });
});
