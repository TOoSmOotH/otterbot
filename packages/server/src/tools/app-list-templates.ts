import { tool } from "ai";
import { z } from "zod";
import { listAppTemplates } from "../apps/app-service.js";

export function createAppListTemplatesTool() {
  return tool({
    description:
      "List available web application templates. Each template provides starter boilerplate for a specific framework (HTML, React, Vue, etc.). Use this to choose the right template before creating an app.",
    parameters: z.object({
      framework: z
        .enum(["html", "react", "nextjs", "astro", "vue", "custom"])
        .optional()
        .describe("Filter templates by framework"),
    }),
    execute: async ({ framework }) => {
      let templates = listAppTemplates();
      if (framework) {
        templates = templates.filter((t) => t.framework === framework);
      }
      if (templates.length === 0) {
        return "No templates found.";
      }
      return JSON.stringify(templates, null, 2);
    },
  });
}
