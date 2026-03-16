import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { getApp } from "../apps/app-service.js";

const AXE_CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js";

export function createAppTestA11yTool(ctx: ToolContext) {
  return tool({
    description:
      "Test a web application for accessibility issues using axe-core. " +
      "Injects the axe-core library into the page, runs an audit, and returns a summary of violations " +
      "grouped by severity (critical, serious, moderate, minor).",
    parameters: z.object({
      appId: z.string().describe("The app ID to test"),
      previewUrl: z.string().describe("The URL where the app is running (from app_preview)"),
    }),
    execute: async ({ appId, previewUrl }) => {
      const app = getApp(ctx.workspacePath, appId);
      if (!app) return JSON.stringify({ error: `App ${appId} not found` });

      try {
        const { getBrowser } = await import("./browser-pool.js");
        const browser = await getBrowser();
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
        });
        const page = await context.newPage();

        await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(2000);

        // Inject axe-core
        await page.addScriptTag({ url: AXE_CDN_URL });
        await page.waitForTimeout(1000);

        // Run axe audit
        const axeResults = await page.evaluate(async () => {
          const results = await (window as any).axe.run();
          return {
            violations: results.violations.map((v: any) => ({
              id: v.id,
              impact: v.impact,
              description: v.description,
              help: v.help,
              helpUrl: v.helpUrl,
              nodes: v.nodes.length,
            })),
            passes: results.passes.length,
            incomplete: results.incomplete.length,
            inapplicable: results.inapplicable.length,
          };
        });

        // Summarize by severity
        const bySeverity: Record<string, number> = {
          critical: 0,
          serious: 0,
          moderate: 0,
          minor: 0,
        };

        for (const v of axeResults.violations) {
          if (v.impact && bySeverity[v.impact] !== undefined) {
            bySeverity[v.impact]++;
          }
        }

        await context.close();

        return JSON.stringify({
          appId,
          framework: app.framework,
          totalViolations: axeResults.violations.length,
          bySeverity,
          passes: axeResults.passes,
          violations: axeResults.violations,
        }, null, 2);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: `Accessibility test failed: ${message}` });
      }
    },
  });
}
