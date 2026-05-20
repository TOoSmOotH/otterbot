import type { Page } from "@playwright/test";

const E2E_API_TOKEN = process.env.OTTERBOT_API_TOKEN ?? "e2e-test-token-otterbot";

/**
 * Open the app, dismissing the first-run onboarding wizard if it appears, and
 * wait for the agent roster (COO card) to render. The shared API token is
 * pre-seeded into localStorage so the AuthGate accepts it without prompting.
 */
export async function gotoApp(page: Page): Promise<void> {
  await page.addInitScript((token) => {
    try {
      window.localStorage.setItem("otterbot.api-token", token);
    } catch {
      /* ignore */
    }
  }, E2E_API_TOKEN);
  await page.goto("/");
  const skip = page.getByRole("button", { name: "Skip setup" });
  try {
    await skip.click({ timeout: 2500 });
  } catch {
    // wizard not shown — onboarding already complete
  }
  await page.getByTestId("agent-card-coo").waitFor({ state: "visible", timeout: 20_000 });
}

/** Type a message into the active agent's chat and submit it. */
export async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("chat-input");
  await input.fill(text);
  await input.press("Enter");
}
