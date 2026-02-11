/**
 * Shared headless Chromium browser management.
 *
 * Uses a singleton Browser instance (lazy-initialized) with separate
 * BrowserContext per agent for cookie/state isolation. Playwright is
 * dynamically imported so the module doesn't crash if it's not installed.
 */

import type { Browser, BrowserContext } from "playwright";

let browserInstance: Browser | null = null;

/**
 * Get or launch the shared headless Chromium browser.
 * Lazy-initialized on first call.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  // Dynamic import — playwright may not be installed yet
  const { chromium } = await import("playwright");
  browserInstance = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", // Use /tmp instead of /dev/shm (Docker)
      "--disable-gpu",
    ],
  });

  return browserInstance;
}

/**
 * Create a fresh browser context (isolated cookies, storage).
 * Each agent gets its own context for isolation.
 */
export async function createBrowserContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
}

/**
 * Graceful shutdown — close the browser. Called on process exit.
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
