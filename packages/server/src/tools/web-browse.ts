/**
 * Web browse tool — headless Chromium browser automation via Playwright.
 *
 * Single multi-action tool (matches the manage_packages pattern from COO).
 * Per-agent sessions persist across tool calls so the LLM can navigate
 * then interact with the page in subsequent invocations.
 */

import { tool } from "ai";
import { z } from "zod";
import { createBrowserContext } from "./browser-pool.js";
import type { BrowserContext, Page } from "playwright";
import type { ToolContext } from "./tool-context.js";

const PAGE_TEXT_LIMIT = 30_000; // 30KB text per extraction
const NAVIGATION_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 10_000;

// Per-agent page cache: agentId -> { context, page, lastUsed }
const agentSessions: Map<
  string,
  { context: BrowserContext; page: Page; lastUsed: number }
> = new Map();

// Clean up stale sessions after 5 minutes of inactivity
const SESSION_TTL = 5 * 60 * 1000;

async function getOrCreateSession(
  agentId: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const existing = agentSessions.get(agentId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }

  const context = await createBrowserContext();
  const page = await context.newPage();
  const session = { context, page, lastUsed: Date.now() };
  agentSessions.set(agentId, session);
  return session;
}

async function closeSession(agentId: string): Promise<void> {
  const session = agentSessions.get(agentId);
  if (session) {
    await session.context.close();
    agentSessions.delete(agentId);
  }
}

// Periodic cleanup of stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [agentId, session] of agentSessions) {
    if (now - session.lastUsed > SESSION_TTL) {
      session.context.close().catch(() => {});
      agentSessions.delete(agentId);
    }
  }
}, 60_000);

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return (
    text.slice(0, limit) +
    `\n\n[Truncated at ${limit} chars. Total: ${text.length} chars]`
  );
}

export function createWebBrowseTool(ctx: ToolContext) {
  return tool({
    description:
      "Browse the web using a headless browser. Supports navigating to URLs, " +
      "extracting page text, clicking elements, filling forms, taking screenshots, " +
      "and executing JavaScript. The browser session persists between calls so you " +
      "can navigate then interact with the page across multiple tool invocations.",
    parameters: z.object({
      action: z
        .enum([
          "navigate",
          "get_text",
          "click",
          "fill",
          "screenshot",
          "evaluate",
          "close",
        ])
        .describe("The browser action to perform"),
      url: z
        .string()
        .optional()
        .describe("URL to navigate to (required for 'navigate')"),
      selector: z
        .string()
        .optional()
        .describe(
          "CSS selector for the target element (required for 'click' and 'fill')",
        ),
      value: z
        .string()
        .optional()
        .describe(
          "Value to fill into the element (required for 'fill')",
        ),
      script: z
        .string()
        .optional()
        .describe(
          "JavaScript to evaluate in the page context (for 'evaluate')",
        ),
    }),
    execute: async ({ action, url, selector, value, script }) => {
      try {
        switch (action) {
          case "navigate": {
            if (!url) return "Error: url is required for navigate action.";
            const { page } = await getOrCreateSession(ctx.agentId);
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: NAVIGATION_TIMEOUT,
            });
            const title = await page.title();
            return `Navigated to "${title}" (${page.url()})`;
          }

          case "get_text": {
            const { page } = await getOrCreateSession(ctx.agentId);
            const text = await page.innerText("body");
            return truncate(text, PAGE_TEXT_LIMIT) || "(empty page)";
          }

          case "click": {
            if (!selector)
              return "Error: selector is required for click action.";
            const { page } = await getOrCreateSession(ctx.agentId);
            await page.click(selector, { timeout: ACTION_TIMEOUT });
            // Wait briefly for any navigation/rendering
            await page
              .waitForLoadState("domcontentloaded", { timeout: 5000 })
              .catch(() => {});
            return `Clicked element matching "${selector}". Current page: ${page.url()}`;
          }

          case "fill": {
            if (!selector)
              return "Error: selector is required for fill action.";
            if (value === undefined)
              return "Error: value is required for fill action.";
            const { page } = await getOrCreateSession(ctx.agentId);
            await page.fill(selector, value, { timeout: ACTION_TIMEOUT });
            return `Filled "${selector}" with "${value.slice(0, 100)}${value.length > 100 ? "..." : ""}"`;
          }

          case "screenshot": {
            const { page } = await getOrCreateSession(ctx.agentId);
            const buffer = await page.screenshot({
              type: "png",
              fullPage: false,
            });
            return `Screenshot captured (${buffer.length} bytes). Use get_text to read page content if you need the text.`;
          }

          case "evaluate": {
            if (!script)
              return "Error: script is required for evaluate action.";
            const { page } = await getOrCreateSession(ctx.agentId);
            const result = await page.evaluate(script);
            const serialized = JSON.stringify(result, null, 2);
            return truncate(serialized ?? "(undefined)", PAGE_TEXT_LIMIT);
          }

          case "close": {
            await closeSession(ctx.agentId);
            return "Browser session closed.";
          }

          default:
            return `Unknown action: ${action}`;
        }
      } catch (err) {
        return `Browser error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
