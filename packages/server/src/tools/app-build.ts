import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { buildApp, getApp } from "../apps/app-service.js";

export function createAppBuildTool(ctx: ToolContext) {
  return tool({
    description:
      "Build a web application. For HTML apps, copies source to dist/. For React/Vue/Next.js/Astro apps, runs the configured build command. Updates the app status on success.",
    parameters: z.object({
      appId: z.string().describe("The app ID to build"),
    }),
    execute: async ({ appId }) => {
      const result = buildApp(ctx.workspacePath, appId);
      if (!result.ok) {
        return JSON.stringify({ error: result.error });
      }
      return JSON.stringify({ ok: true, app: result.manifest }, null, 2);
    },
  });
}
