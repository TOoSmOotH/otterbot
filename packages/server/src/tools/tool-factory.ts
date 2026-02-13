import type { ToolContext } from "./tool-context.js";
import { createFileReadTool } from "./file-read.js";
import { createFileWriteTool } from "./file-write.js";
import { createShellExecTool } from "./shell-exec.js";
import { createWebSearchTool } from "./web-search.js";
import { createWebBrowseTool } from "./web-browse.js";
import { createGitCommitTool } from "./git-commit.js";

type ToolCreator = (ctx: ToolContext) => unknown;

const TOOL_REGISTRY: Record<string, ToolCreator> = {
  file_read: createFileReadTool,
  file_write: createFileWriteTool,
  shell_exec: createShellExecTool,
  web_search: createWebSearchTool,
  web_browse: createWebBrowseTool,
  git_commit: createGitCommitTool,
};

/**
 * Create Vercel AI SDK tool() objects for the given tool names.
 * Unknown tool names are logged as warnings and silently skipped.
 */
export function createTools(
  toolNames: string[],
  ctx: ToolContext,
): Record<string, unknown> {
  const tools: Record<string, unknown> = {};
  for (const name of toolNames) {
    const creator = TOOL_REGISTRY[name];
    if (creator) {
      tools[name] = creator(ctx);
    } else {
      console.warn(`[tool-factory] Unknown tool "${name}" requested — skipping.`);
    }
  }
  return tools;
}

/** List all available tool names */
export function getAvailableToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY);
}
