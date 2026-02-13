import { tool } from "ai";
import { z } from "zod";
import { execSync } from "node:child_process";
import type { ToolContext } from "./tool-context.js";

export function createGitCommitTool(ctx: ToolContext) {
  return tool({
    description:
      "Stage all changes and create a git commit in your workspace. " +
      "Use this to make semantic commits as you work (e.g., after completing a logical unit). " +
      "If you don't commit, your changes will be auto-committed when the task is merged.",
    parameters: z.object({
      message: z
        .string()
        .describe("A concise commit message describing what changed"),
    }),
    execute: async ({ message }) => {
      try {
        execSync("git add -A", {
          cwd: ctx.workspacePath,
          stdio: "pipe",
          timeout: 10_000,
        });

        const status = execSync("git status --porcelain", {
          cwd: ctx.workspacePath,
          stdio: "pipe",
          timeout: 10_000,
        }).toString();

        if (!status.trim()) {
          return "Nothing to commit — working tree is clean.";
        }

        execSync(`git commit -m ${JSON.stringify(message)}`, {
          cwd: ctx.workspacePath,
          stdio: "pipe",
          timeout: 10_000,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Smoothbot Worker",
            GIT_AUTHOR_EMAIL: "worker@smoothbot.local",
            GIT_COMMITTER_NAME: "Smoothbot Worker",
            GIT_COMMITTER_EMAIL: "worker@smoothbot.local",
          },
        });

        const fileCount = status.trim().split("\n").length;
        return `Committed ${fileCount} file(s): ${message}`;
      } catch (err: unknown) {
        const execErr = err as { stderr?: Buffer; message?: string };
        const stderr = execErr.stderr?.toString() ?? execErr.message ?? "Unknown error";
        return `Commit failed: ${stderr}`;
      }
    },
  });
}
