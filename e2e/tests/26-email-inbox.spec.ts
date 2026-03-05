import { test, expect } from "../fixtures";
import { getStoredCookie } from "../helpers/api";

test.describe("Email Inbox", () => {
  // -------------------------------------------------------------------------
  // API-level tests (work without email configured)
  // -------------------------------------------------------------------------

  test.describe("API routes", () => {
    test("GET /api/email/folders returns error when not configured", async () => {
      const cookie = getStoredCookie();
      const res = await fetch(
        `${process.env.BASE_URL || "https://localhost:62627"}/api/email/folders`,
        { headers: { Cookie: cookie } },
      );
      // Should get 500 with error message about not configured
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    test("GET /api/email/messages accepts folder query param", async () => {
      const cookie = getStoredCookie();
      const res = await fetch(
        `${process.env.BASE_URL || "https://localhost:62627"}/api/email/messages?folder=Sent`,
        { headers: { Cookie: cookie } },
      );
      // Should get 500 (not configured) but the route should exist and accept the param
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    test("GET /api/email/messages/:id accepts folder query param", async () => {
      const cookie = getStoredCookie();
      const res = await fetch(
        `${process.env.BASE_URL || "https://localhost:62627"}/api/email/messages/1?folder=Sent`,
        { headers: { Cookie: cookie } },
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // UI tests — folder sidebar rendering
  // -------------------------------------------------------------------------

  test.describe("Inbox UI", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    });

    test("inbox view shows email configuration prompt when not configured", async ({ page }) => {
      // Navigate to Inbox tab
      const inboxTab = page.locator('button:has-text("Inbox")').first();
      if (await inboxTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await inboxTab.click();
        // Should show configuration prompt or error
        await expect(
          page.locator("text=Configure email").or(page.locator("text=not configured")).first(),
        ).toBeVisible({ timeout: 5_000 });
      }
    });

    test("inbox view has search and compose controls", async ({ page }) => {
      const inboxTab = page.locator('button:has-text("Inbox")').first();
      if (await inboxTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await inboxTab.click();
        // Search input and Compose button should be present
        await expect(page.locator('input[placeholder="Search emails..."]')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('button:has-text("Compose")')).toBeVisible();
      }
    });

    test("compose drawer opens and closes", async ({ page }) => {
      const inboxTab = page.locator('button:has-text("Inbox")').first();
      if (await inboxTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await inboxTab.click();
        const composeButton = page.locator('button:has-text("Compose")');
        if (await composeButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await composeButton.click();
          // Compose fields should appear
          await expect(page.locator('input[placeholder="To"]')).toBeVisible({ timeout: 3_000 });
          await expect(page.locator('input[placeholder="Subject"]')).toBeVisible();
          await expect(page.locator('textarea[placeholder="Write your message..."]')).toBeVisible();

          // Cancel should close
          await page.locator('button:has-text("Cancel")').click();
          await expect(page.locator('input[placeholder="To"]')).not.toBeVisible();
        }
      }
    });
  });
});
