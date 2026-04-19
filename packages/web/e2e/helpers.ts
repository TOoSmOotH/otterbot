import type { Page, Locator, APIRequestContext } from "@playwright/test";

/**
 * Probe LM Studio once per test run. Tests that depend on real LLM output
 * call `test.skip()` when this returns false so the suite still runs on
 * machines without LM Studio.
 */
let _lmstudioOk: boolean | null = null;
export async function lmstudioReachable(request: APIRequestContext): Promise<boolean> {
  if (_lmstudioOk !== null) return _lmstudioOk;
  const url = process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1";
  try {
    const res = await request.get(`${url}/models`, { timeout: 3000 });
    _lmstudioOk = res.ok();
  } catch {
    _lmstudioOk = false;
  }
  return _lmstudioOk;
}

export async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("chat-input");
  await input.fill(text);
  await input.press("Enter");
}

export async function waitForAssistantReply(page: Page, timeoutMs = 60_000): Promise<Locator> {
  const assistant = page.getByTestId("message-assistant").last();
  await assistant.waitFor({ state: "visible", timeout: timeoutMs });
  // Wait for streaming to finish: presence of a non-empty body + no "..." placeholder
  const input = page.getByTestId("chat-input");
  await page.waitForFunction(
    (el) => !(el as HTMLTextAreaElement).disabled,
    await input.elementHandle(),
    { timeout: timeoutMs },
  );
  return assistant;
}

export async function openSessionAndWait(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("connection-status").waitFor();
  // Wait for socket connect (green dot)
  await page.waitForFunction(
    () => document.querySelector('[data-testid="connection-status"]')?.textContent?.includes("●"),
    null,
    { timeout: 10_000 },
  );
}
