import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { installAptPackage, installNpmPackage } from "../packages/packages.js";

export function createInstallPackageTool(ctx: ToolContext) {
  return tool({
    description:
      "Install a system (apt) or global npm package. " +
      "The package is installed immediately and added to the persistent manifest " +
      "so it survives container restarts.",
    parameters: z.object({
      type: z
        .enum(["apt", "npm"])
        .describe('Package manager — "apt" for OS packages, "npm" for Node.js packages'),
      name: z.string().describe("Package name (e.g. \"gimp\", \"puppeteer\")"),
      version: z
        .string()
        .optional()
        .describe("Version specifier for npm packages (e.g. \"^1.0.0\"). Ignored for apt."),
    }),
    execute: async ({ type, name, version }) => {
      if (type === "apt") {
        const result = installAptPackage(name, ctx.agentId);
        if (!result.success) {
          return `Failed to install apt package "${name}": ${result.error}`;
        }
        return result.alreadyInManifest
          ? `apt package "${name}" was already in the manifest. Ensured it is installed.`
          : `Successfully installed apt package "${name}" and added to manifest.`;
      } else {
        const result = installNpmPackage(name, version, ctx.agentId);
        if (!result.success) {
          return `Failed to install npm package "${name}": ${result.error}`;
        }
        const spec = version ? `${name}@${version}` : name;
        return result.alreadyInManifest
          ? `npm package "${spec}" was already in the manifest. Ensured it is installed.`
          : `Successfully installed npm package "${spec}" globally and added to manifest.`;
      }
    },
  });
}
