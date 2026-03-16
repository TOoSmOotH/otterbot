import { tool } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import type { ToolContext } from "./tool-context.js";
import { getApp } from "../apps/app-service.js";
import type { AppTestResult } from "@otterbot/shared";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

export function createAppTestResponsiveTool(ctx: ToolContext) {
  return tool({
    description:
      "Test a web application's responsiveness by taking screenshots at mobile (375x667), " +
      "tablet (768x1024), and desktop (1440x900) viewports. Saves screenshots and returns results.",
    parameters: z.object({
      appId: z.string().describe("The app ID to test"),
      previewUrl: z.string().describe("The URL where the app is running (from app_preview)"),
    }),
    execute: async ({ appId, previewUrl }) => {
      const app = getApp(ctx.workspacePath, appId);
      if (!app) return JSON.stringify({ error: `App ${appId} not found` });

      const screenshotDir = path.join(ctx.workspacePath, "apps", appId, "test-screenshots");
      fs.mkdirSync(screenshotDir, { recursive: true });

      const results: AppTestResult[] = [];

      try {
        const { getBrowser } = await import("./browser-pool.js");
        const browser = await getBrowser();

        for (const viewport of VIEWPORTS) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
          });
          const page = await context.newPage();

          await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await page.waitForTimeout(2000);

          const filename = `${viewport.name}_${nanoid(6)}.png`;
          const filePath = path.join(screenshotDir, filename);
          await page.screenshot({ path: filePath, type: "png", fullPage: true });

          results.push({
            id: nanoid(12),
            timestamp: new Date().toISOString(),
            viewport: `${viewport.name} (${viewport.width}x${viewport.height})`,
            screenshotPath: `apps/${appId}/test-screenshots/${filename}`,
            accessibilityIssues: 0,
          });

          await context.close();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: `Responsive test failed: ${message}` });
      }

      return JSON.stringify({
        appId,
        framework: app.framework,
        viewportsTested: VIEWPORTS.length,
        results,
        screenshotDir: `apps/${appId}/test-screenshots/`,
      }, null, 2);
    },
  });
}
