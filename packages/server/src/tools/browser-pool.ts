/**
 * Shared Chromium browser management.
 *
 * Uses a singleton Browser instance (lazy-initialized) with separate
 * BrowserContext per agent for cookie/state isolation. Playwright is
 * dynamically imported so the module doesn't crash if it's not installed.
 *
 * When ENABLE_DESKTOP=true, launches in headed mode so the browser is
 * visible on the virtual XFCE desktop. Otherwise runs headless.
 */

import type { Browser, BrowserContext } from "playwright";

let browserInstance: Browser | null = null;

const desktopEnabled = process.env.ENABLE_DESKTOP !== "false";

/**
 * Parse viewport dimensions from DESKTOP_RESOLUTION env var (e.g. "1280x720x24").
 */
function getViewportFromResolution(): { width: number; height: number } {
  const res = process.env.DESKTOP_RESOLUTION ?? "1280x720x24";
  const parts = res.split("x");
  const width = parseInt(parts[0], 10) || 1280;
  const height = parseInt(parts[1], 10) || 720;
  return { width, height };
}

/**
 * Get or launch the shared Chromium browser.
 * Lazy-initialized on first call.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  // Dynamic import — playwright may not be installed yet
  const { chromium } = await import("playwright");

  const commonArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    // Isolate from any manually-opened Chrome on the desktop
    "--user-data-dir=/tmp/otterbot-browser-profile",
  ];

  if (desktopEnabled) {
    // Headed mode — browser visible on the virtual desktop
    browserInstance = await chromium.launch({
      headless: false,
      args: commonArgs,
    });
  } else {
    // Headless mode — default behavior
    browserInstance = await chromium.launch({
      headless: true,
      args: [...commonArgs, "--disable-gpu"],
    });
  }

  return browserInstance;
}

/**
 * Create a fresh browser context (isolated cookies, storage).
 * Each agent gets its own context for isolation.
 */
export async function createBrowserContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  const viewport = getViewportFromResolution();
  return browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport,
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
