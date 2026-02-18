import { z } from "zod";
import { tool } from "ai";
import type { ToolContext } from "./tool-context.js";
import { createFileReadTool } from "./file-read.js";
import { createFileWriteTool } from "./file-write.js";
import { createShellExecTool } from "./shell-exec.js";
import { createWebSearchTool } from "./web-search.js";
import { createWebBrowseTool } from "./web-browse.js";
import { createInstallPackageTool } from "./install-package.js";
import { createOpenCodeTaskTool } from "./opencode-task.js";
import { createTodoListTool } from "./todo-list.js";
import { createTodoCreateTool } from "./todo-create.js";
import { createTodoUpdateTool } from "./todo-update.js";
import { createTodoDeleteTool } from "./todo-delete.js";
import { createGmailListTool } from "./gmail-list.js";
import { createGmailReadTool } from "./gmail-read.js";
import { createGmailSendTool } from "./gmail-send.js";
import { createGmailReplyTool } from "./gmail-reply.js";
import { createGmailLabelTool } from "./gmail-label.js";
import { createGmailArchiveTool } from "./gmail-archive.js";
import { createCalendarListEventsTool } from "./calendar-list-events.js";
import { createCalendarCreateEventTool } from "./calendar-create-event.js";
import { createCalendarUpdateEventTool } from "./calendar-update-event.js";
import { createCalendarDeleteEventTool } from "./calendar-delete-event.js";
import { createCalendarListCalendarsTool } from "./calendar-list-calendars.js";
import { SkillService } from "../skills/skill-service.js";
import { CustomToolService } from "./custom-tool-service.js";
import { executeCustomTool } from "./custom-tool-executor.js";

type ToolCreator = (ctx: ToolContext) => unknown;

/** Tools that require a workspace context */
const TOOL_REGISTRY: Record<string, ToolCreator> = {
  file_read: createFileReadTool,
  file_write: createFileWriteTool,
  shell_exec: createShellExecTool,
  web_search: createWebSearchTool,
  web_browse: createWebBrowseTool,
  install_package: createInstallPackageTool,
  opencode_task: createOpenCodeTaskTool,
};

/** Tools that don't require a workspace context (admin/personal tools) */
const CONTEXTLESS_TOOL_REGISTRY: Record<string, () => unknown> = {
  todo_list: createTodoListTool,
  todo_create: createTodoCreateTool,
  todo_update: createTodoUpdateTool,
  todo_delete: createTodoDeleteTool,
  gmail_list: createGmailListTool,
  gmail_read: createGmailReadTool,
  gmail_send: createGmailSendTool,
  gmail_reply: createGmailReplyTool,
  gmail_label: createGmailLabelTool,
  gmail_archive: createGmailArchiveTool,
  calendar_list_events: createCalendarListEventsTool,
  calendar_create_event: createCalendarCreateEventTool,
  calendar_update_event: createCalendarUpdateEventTool,
  calendar_delete_event: createCalendarDeleteEventTool,
  calendar_list_calendars: createCalendarListCalendarsTool,
  // Tool Builder agent tools
  create_custom_tool: createCreateCustomToolTool,
  list_custom_tools: createListCustomToolsTool,
  update_custom_tool: createUpdateCustomToolTool,
  test_custom_tool: createTestCustomToolTool,
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
  const customToolService = new CustomToolService();

  for (const name of toolNames) {
    const creator = TOOL_REGISTRY[name];
    if (creator) {
      tools[name] = creator(ctx);
      continue;
    }
    const contextlessCreator = CONTEXTLESS_TOOL_REGISTRY[name];
    if (contextlessCreator) {
      tools[name] = contextlessCreator();
      continue;
    }
    // Check custom tools
    const customTool = customToolService.getByName(name);
    if (customTool) {
      tools[name] = createCustomToolWrapper(customTool);
      continue;
    }
    console.warn(`[tool-factory] Unknown tool "${name}" requested — skipping.`);
  }
  return tools;
}

/**
 * Create all contextless (admin/personal) tools without requiring a ToolContext.
 * Used by the AdminAssistant agent which doesn't have a workspace.
 */
export function createAdminTools(): Record<string, unknown> {
  const tools: Record<string, unknown> = {};
  for (const [name, creator] of Object.entries(CONTEXTLESS_TOOL_REGISTRY)) {
    tools[name] = creator();
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

/** List all available tool names (built-in + contextless + custom) */
export function getAvailableToolNames(): string[] {
  const customToolService = new CustomToolService();
  const customNames = customToolService.list().map((t) => t.name);
  return [
    ...Object.keys(TOOL_REGISTRY),
    ...Object.keys(CONTEXTLESS_TOOL_REGISTRY),
    ...customNames,
  ];
}

/**
 * Get metadata for all tools: built-in and custom.
 * Returns tool names grouped by type, plus metadata for each.
 */
export function getToolsWithMeta(): {
  builtInTools: string[];
  customTools: import("@otterbot/shared").CustomTool[];
  toolMeta: Record<string, { description: string; builtIn: boolean }>;
} {
  const builtInNames = [...Object.keys(TOOL_REGISTRY), ...Object.keys(CONTEXTLESS_TOOL_REGISTRY)];
  const customToolService = new CustomToolService();
  const customs = customToolService.list();

  const toolMeta: Record<string, { description: string; builtIn: boolean }> = {};

  // Built-in tool descriptions (basic since they don't expose detailed metadata)
  const BUILTIN_DESCRIPTIONS: Record<string, string> = {
    file_read: "Read file contents from the workspace",
    file_write: "Write or create files in the workspace",
    shell_exec: "Execute shell commands in the workspace",
    web_search: "Search the web for information",
    web_browse: "Browse and interact with web pages",
    install_package: "Install packages via npm/pip/etc",
    opencode_task: "Delegate coding tasks to OpenCode agent",
    todo_list: "List all todos",
    todo_create: "Create a new todo item",
    todo_update: "Update an existing todo",
    todo_delete: "Delete a todo item",
    gmail_list: "List Gmail messages",
    gmail_read: "Read a specific Gmail message",
    gmail_send: "Send a new email via Gmail",
    gmail_reply: "Reply to a Gmail message",
    gmail_label: "Add/remove labels on Gmail messages",
    gmail_archive: "Archive Gmail messages",
    calendar_list_events: "List calendar events",
    calendar_create_event: "Create a new calendar event",
    calendar_update_event: "Update a calendar event",
    calendar_delete_event: "Delete a calendar event",
    calendar_list_calendars: "List available calendars",
    create_custom_tool: "Create a new custom JavaScript tool",
    list_custom_tools: "List all custom tools",
    update_custom_tool: "Update an existing custom tool",
    test_custom_tool: "Test a custom tool with parameters",
  };

  for (const name of builtInNames) {
    toolMeta[name] = {
      description: BUILTIN_DESCRIPTIONS[name] ?? "",
      builtIn: true,
    };
  }

  for (const ct of customs) {
    toolMeta[ct.name] = {
      description: ct.description,
      builtIn: false,
    };
  }

  return { builtInTools: builtInNames, customTools: customs, toolMeta };
}

/** Create a Vercel AI SDK tool wrapper for a custom tool */
function createCustomToolWrapper(customTool: import("@otterbot/shared").CustomTool) {
  // Build the zod schema from the custom tool's parameters
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const param of customTool.parameters) {
    let schema: z.ZodTypeAny;
    switch (param.type) {
      case "number":
        schema = z.number().describe(param.description);
        break;
      case "boolean":
        schema = z.boolean().describe(param.description);
        break;
      default:
        schema = z.string().describe(param.description);
    }
    shape[param.name] = param.required ? schema : schema.optional();
  }

  return tool({
    description: customTool.description,
    parameters: z.object(shape),
    execute: async (params: Record<string, unknown>) => {
      return executeCustomTool(customTool, params);
    },
  });
}

// =========================================================================
// Tool Builder Agent Tools (contextless)
// =========================================================================

function createCreateCustomToolTool() {
  return tool({
    description: "Create a new custom JavaScript tool that agents can use. Returns the created tool.",
    parameters: z.object({
      name: z.string().describe("Unique snake_case name for the tool"),
      description: z.string().describe("What the tool does"),
      parameters: z.array(z.object({
        name: z.string(),
        type: z.enum(["string", "number", "boolean"]),
        required: z.boolean(),
        description: z.string(),
      })).describe("Tool parameters"),
      code: z.string().describe("JavaScript async function body. Receives params object, must return a string. Available globals: fetch, JSON, Math, Date, console.log."),
      timeout: z.number().optional().describe("Execution timeout in ms (default 30000)"),
    }),
    execute: async (params) => {
      const svc = new CustomToolService();
      if (!svc.isNameAvailable(params.name)) {
        return JSON.stringify({ error: `Tool name "${params.name}" already exists` });
      }
      const created = svc.create(params);
      return JSON.stringify(created);
    },
  });
}

function createListCustomToolsTool() {
  return tool({
    description: "List all custom tools.",
    parameters: z.object({}),
    execute: async () => {
      const svc = new CustomToolService();
      return JSON.stringify(svc.list());
    },
  });
}

function createUpdateCustomToolTool() {
  return tool({
    description: "Update an existing custom tool by ID.",
    parameters: z.object({
      id: z.string().describe("The tool ID to update"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      parameters: z.array(z.object({
        name: z.string(),
        type: z.enum(["string", "number", "boolean"]),
        required: z.boolean(),
        description: z.string(),
      })).optional().describe("New parameters"),
      code: z.string().optional().describe("New code"),
      timeout: z.number().optional().describe("New timeout"),
    }),
    execute: async ({ id, ...data }) => {
      const svc = new CustomToolService();
      if (data.name && !svc.isNameAvailable(data.name, id)) {
        return JSON.stringify({ error: `Tool name "${data.name}" already exists` });
      }
      const updated = svc.update(id, data);
      if (!updated) return JSON.stringify({ error: "Tool not found" });
      return JSON.stringify(updated);
    },
  });
}

function createTestCustomToolTool() {
  return tool({
    description: "Test a custom tool by executing it with the given parameters and returning the result.",
    parameters: z.object({
      id: z.string().describe("The tool ID to test"),
      params: z.record(z.unknown()).describe("Parameters to pass to the tool"),
    }),
    execute: async ({ id, params }) => {
      const svc = new CustomToolService();
      const customTool = svc.get(id);
      if (!customTool) return JSON.stringify({ error: "Tool not found" });
      try {
        const result = await executeCustomTool(customTool, params);
        return JSON.stringify({ result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: message });
      }
    },
  });
}
