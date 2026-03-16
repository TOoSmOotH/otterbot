import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { createApp } from "../apps/app-service.js";

export function createAppCreateTool(ctx: ToolContext) {
  return tool({
    description:
      "Create a new web application from a template. Scaffolds the directory structure, copies starter files, and creates an app manifest. Use app_list_templates first to see available templates.",
    parameters: z.object({
      name: z.string().describe("Name of the application"),
      framework: z
        .enum(["html", "react", "nextjs", "astro", "vue", "custom"])
        .describe("Web framework to use"),
      templateId: z.string().optional().describe("Template ID to use (e.g. 'html-basic', 'react-vite', 'vue-vite', 'landing-page')"),
      description: z.string().optional().describe("Short description of the application"),
    }),
    execute: async ({ name, framework, templateId, description }) => {
      const manifest = createApp(ctx.workspacePath, {
        name,
        framework,
        templateId,
        description,
        projectId: ctx.projectId,
      });
      return JSON.stringify(manifest, null, 2);
    },
  });
}
