import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { listApps } from "../apps/app-service.js";

export function createAppListTool(ctx: ToolContext) {
  return tool({
    description:
      "List all web applications in the current project workspace. Returns app manifests with name, framework, status, and metadata.",
    parameters: z.object({
      status: z
        .enum(["draft", "building", "preview", "testing", "deployed"])
        .optional()
        .describe("Filter by app status"),
    }),
    execute: async ({ status }) => {
      let apps = listApps(ctx.workspacePath);
      if (status) {
        apps = apps.filter((a) => a.status === status);
      }
      if (apps.length === 0) {
        return "No apps found in this project.";
      }
      return JSON.stringify(apps, null, 2);
    },
  });
}
