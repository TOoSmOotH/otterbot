import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { ToolContext } from "./tool-context.js";
import { getApp, getAppDistPath, getAppSourcePath, buildApp } from "../apps/app-service.js";

export function createAppDeployTool(ctx: ToolContext) {
  return tool({
    description:
      "Deploy a web application. Currently supports copying the built app to a local directory for serving. " +
      "Automatically builds the app if not already built.",
    parameters: z.object({
      appId: z.string().describe("The app ID to deploy"),
      target: z.enum(["local", "directory"]).describe("Deployment target (currently only local/directory supported)"),
      outputPath: z.string().optional().describe("Custom output directory path (defaults to workspace deploy/ directory)"),
    }),
    execute: async ({ appId, target, outputPath }) => {
      const app = getApp(ctx.workspacePath, appId);
      if (!app) return JSON.stringify({ error: `App ${appId} not found` });

      // Ensure the app is built
      let distPath = getAppDistPath(ctx.workspacePath, appId);
      if (!distPath) {
        const buildResult = buildApp(ctx.workspacePath, appId);
        if (!buildResult.ok) {
          return JSON.stringify({ error: `Build failed: ${buildResult.error}` });
        }
        distPath = getAppDistPath(ctx.workspacePath, appId);
      }

      // Fall back to source if still no dist
      if (!distPath) {
        distPath = getAppSourcePath(ctx.workspacePath, appId);
      }

      if (!distPath) {
        return JSON.stringify({ error: "No build output found" });
      }

      const deployDir = outputPath ?? path.join(ctx.workspacePath, "deploy", appId);
      fs.mkdirSync(deployDir, { recursive: true });

      // Copy dist contents to deploy directory
      copyRecursive(distPath, deployDir);

      return JSON.stringify({
        ok: true,
        appId,
        target,
        deployPath: deployDir,
        message: `App deployed to ${deployDir}`,
      }, null, 2);
    },
  });
}

function copyRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
