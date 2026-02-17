import type { ToolContext } from "./tool-context.js";
import { createFileReadTool } from "./file-read.js";
import { createFileWriteTool } from "./file-write.js";
import { createShellExecTool } from "./shell-exec.js";
import { createWebSearchTool } from "./web-search.js";
import { createWebBrowseTool } from "./web-browse.js";
import { createInstallPackageTool } from "./install-package.js";
import { createOpenCodeTaskTool } from "./opencode-task.js";
import { SkillService } from "../skills/skill-service.js";

type ToolCreator = (ctx: ToolContext) => unknown;

const TOOL_REGISTRY: Record<string, ToolCreator> = {
  file_read: createFileReadTool,
  file_write: createFileWriteTool,
  shell_exec: createShellExecTool,
  web_search: createWebSearchTool,
  web_browse: createWebBrowseTool,
  install_package: createInstallPackageTool,
  opencode_task: createOpenCodeTaskTool,
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

/**
 * Create tools for an agent, merging tools from assigned skills.
 * Returns the tools and any additional system prompt content from skills.
 */
export function createToolsForAgent(
  toolNames: string[],
  ctx: ToolContext,
  registryEntryId?: string,
): { tools: Record<string, unknown>; skillPromptContent: string } {
  // Start with the base tools
  const allToolNames = new Set(toolNames);
  let skillPromptContent = "";

  // Merge skill tools and prompts if agent has a registry entry
  if (registryEntryId) {
    try {
      const skillService = new SkillService();
      const skills = skillService.getForAgent(registryEntryId);

      for (const skill of skills) {
        // Add the skill's required tools
        for (const toolName of skill.meta.tools) {
          allToolNames.add(toolName);
        }

        // Append the skill's system prompt content
        if (skill.body.trim()) {
          skillPromptContent += `\n\n--- Skill: ${skill.meta.name} ---\n${skill.body}`;
        }
      }
    } catch (err) {
      console.warn("[tool-factory] Failed to load agent skills:", err);
    }
  }

  const tools = createTools([...allToolNames], ctx);
  return { tools, skillPromptContent };
}

/** List all available tool names */
export function getAvailableToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY);
}
