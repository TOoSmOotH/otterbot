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
import {
  createGitHubGetIssueTool,
  createGitHubListIssuesTool,
  createGitHubGetPRTool,
  createGitHubListPRsTool,
  createGitHubCommentTool,
  createGitHubCreatePRTool,
} from "./github.js";
import { SkillService } from "../skills/skill-service.js";
import { CustomToolService } from "./custom-tool-service.js";
import { executeCustomTool } from "./custom-tool-executor.js";
import { createMemorySaveTool } from "./memory-save.js";
import { McpClientManager } from "../mcp/mcp-client-manager.js";
import { McpServerService as McpServerServiceRef } from "../mcp/mcp-service.js";

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
  github_get_issue: createGitHubGetIssueTool,
  github_list_issues: createGitHubListIssuesTool,
  github_get_pr: createGitHubGetPRTool,
  github_list_prs: createGitHubListPRsTool,
  github_comment: createGitHubCommentTool,
  github_create_pr: createGitHubCreatePRTool,
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
  // Memory tools
  memory_save: createMemorySaveTool,
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
    // Check MCP tools (naming convention: mcp_<serverName>_<toolName>)
    if (name.startsWith("mcp_")) {
      const mcpTool = createMcpToolWrapper(name);
      if (mcpTool) {
        tools[name] = mcpTool;
        continue;
      }
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
  const mcpNames = McpClientManager.getAllEnabledToolNames();
  return [
    ...Object.keys(TOOL_REGISTRY),
    ...Object.keys(CONTEXTLESS_TOOL_REGISTRY),
    ...customNames,
    ...mcpNames,
  ];
}

interface ToolParamMeta {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ToolMetaEntry {
  description: string;
  builtIn: boolean;
  parameters?: ToolParamMeta[];
  category?: string;
}

/**
 * Get metadata for all tools: built-in and custom.
 * Returns tool names grouped by type, plus metadata for each.
 */
export function getToolsWithMeta(): {
  builtInTools: string[];
  customTools: import("@otterbot/shared").CustomTool[];
  toolMeta: Record<string, ToolMetaEntry>;
} {
  const builtInNames = [...Object.keys(TOOL_REGISTRY), ...Object.keys(CONTEXTLESS_TOOL_REGISTRY)];
  const customToolService = new CustomToolService();
  const customs = customToolService.list();

  const toolMeta: Record<string, ToolMetaEntry> = {};

  // Detailed built-in tool metadata
  const BUILTIN_META: Record<string, { description: string; category: string; parameters: ToolParamMeta[] }> = {
    file_read: {
      description: "Read the contents of a file in the workspace. Paths are relative to the workspace directory.",
      category: "Workspace",
      parameters: [
        { name: "path", type: "string", required: true, description: "Relative path to the file within the workspace" },
      ],
    },
    file_write: {
      description: "Write content to a file in the workspace. Creates the file if it doesn't exist, overwrites if it does.",
      category: "Workspace",
      parameters: [
        { name: "path", type: "string", required: true, description: "Relative path to the file within the workspace" },
        { name: "content", type: "string", required: true, description: "Content to write to the file" },
      ],
    },
    shell_exec: {
      description: "Execute a shell command in the workspace directory. Commands have a 30-second timeout by default (max 120s). Output is capped at 50KB.",
      category: "Workspace",
      parameters: [
        { name: "command", type: "string", required: true, description: "The shell command to execute" },
        { name: "timeout", type: "number", required: false, description: "Timeout in milliseconds (default: 30000, max: 120000)" },
      ],
    },
    web_search: {
      description: "Search the web for information using a configured search provider.",
      category: "Web",
      parameters: [
        { name: "query", type: "string", required: true, description: "The search query" },
      ],
    },
    web_browse: {
      description: "Browse and interact with web pages using a headless browser. Supports navigation, clicking, form filling, text extraction, and JavaScript evaluation.",
      category: "Web",
      parameters: [
        { name: "action", type: "string", required: true, description: "Action to perform: navigate, click, fill, get_text, evaluate, screenshot, close" },
        { name: "url", type: "string", required: false, description: "URL to navigate to (for navigate action)" },
        { name: "selector", type: "string", required: false, description: "CSS selector for click/fill actions" },
        { name: "value", type: "string", required: false, description: "Value for fill action or JS code for evaluate" },
      ],
    },
    install_package: {
      description: "Install a package using the appropriate package manager (npm, pip, etc.).",
      category: "Workspace",
      parameters: [
        { name: "manager", type: "string", required: true, description: "Package manager to use: npm, pip, etc." },
        { name: "package", type: "string", required: true, description: "Package name to install" },
      ],
    },
    opencode_task: {
      description: "Delegate a complex coding task to OpenCode, an autonomous AI coding agent. Ideal for multi-file implementations, refactoring, and large code changes.",
      category: "Workspace",
      parameters: [
        { name: "task", type: "string", required: true, description: "Detailed description of the coding task" },
      ],
    },
    github_get_issue: {
      description: "Fetch a GitHub issue by number, including its comments.",
      category: "GitHub",
      parameters: [
        { name: "issue_number", type: "number", required: true, description: "The issue number to fetch" },
      ],
    },
    github_list_issues: {
      description: "List GitHub issues for the project repository. Defaults to issues assigned to you.",
      category: "GitHub",
      parameters: [
        { name: "state", type: "string", required: false, description: "Filter by state: open, closed, all (default: open)" },
        { name: "labels", type: "string", required: false, description: "Comma-separated label names to filter by" },
        { name: "assignee", type: "string", required: false, description: "Filter by assignee login (defaults to configured username)" },
        { name: "per_page", type: "number", required: false, description: "Number of results (default: 30, max: 100)" },
      ],
    },
    github_get_pr: {
      description: "Fetch a GitHub pull request by number, including its comments.",
      category: "GitHub",
      parameters: [
        { name: "pr_number", type: "number", required: true, description: "The pull request number to fetch" },
      ],
    },
    github_list_prs: {
      description: "List GitHub pull requests for the project repository.",
      category: "GitHub",
      parameters: [
        { name: "state", type: "string", required: false, description: "Filter by state: open, closed, all (default: open)" },
        { name: "per_page", type: "number", required: false, description: "Number of results (default: 30, max: 100)" },
      ],
    },
    github_comment: {
      description: "Post a comment on a GitHub issue or pull request.",
      category: "GitHub",
      parameters: [
        { name: "issue_number", type: "number", required: true, description: "The issue or PR number to comment on" },
        { name: "body", type: "string", required: true, description: "The comment text (Markdown supported)" },
      ],
    },
    github_create_pr: {
      description: "Create a new GitHub pull request.",
      category: "GitHub",
      parameters: [
        { name: "title", type: "string", required: true, description: "PR title" },
        { name: "head", type: "string", required: true, description: "The branch containing your changes" },
        { name: "base", type: "string", required: false, description: "The branch to merge into (defaults to project branch)" },
        { name: "body", type: "string", required: false, description: "PR description (Markdown supported)" },
      ],
    },
    todo_list: {
      description: "List all todo items, optionally filtered by status.",
      category: "Personal",
      parameters: [
        { name: "status", type: "string", required: false, description: "Filter by status: todo, in_progress, done" },
      ],
    },
    todo_create: {
      description: "Create a new todo item with title, description, priority, and optional due date.",
      category: "Personal",
      parameters: [
        { name: "title", type: "string", required: true, description: "Title of the todo" },
        { name: "description", type: "string", required: false, description: "Detailed description" },
        { name: "priority", type: "string", required: false, description: "Priority: low, medium, high" },
        { name: "dueDate", type: "string", required: false, description: "Due date in ISO format" },
        { name: "tags", type: "string[]", required: false, description: "Tags for categorization" },
        { name: "reminderAt", type: "string", required: false, description: "ISO datetime for reminder notification" },
      ],
    },
    todo_update: {
      description: "Update an existing todo item by ID.",
      category: "Personal",
      parameters: [
        { name: "id", type: "string", required: true, description: "The todo ID to update" },
        { name: "title", type: "string", required: false, description: "New title" },
        { name: "status", type: "string", required: false, description: "New status: todo, in_progress, done" },
        { name: "priority", type: "string", required: false, description: "New priority: low, medium, high" },
        { name: "reminderAt", type: "string", required: false, description: "ISO datetime for reminder, or null to clear" },
      ],
    },
    todo_delete: {
      description: "Delete a todo item by ID.",
      category: "Personal",
      parameters: [
        { name: "id", type: "string", required: true, description: "The todo ID to delete" },
      ],
    },
    gmail_list: {
      description: "List Gmail messages from the inbox, with optional query filtering.",
      category: "Email",
      parameters: [
        { name: "query", type: "string", required: false, description: "Gmail search query (e.g. 'is:unread', 'from:user@example.com')" },
        { name: "maxResults", type: "number", required: false, description: "Maximum number of messages to return (default: 10)" },
      ],
    },
    gmail_read: {
      description: "Read the full content of a specific Gmail message by ID.",
      category: "Email",
      parameters: [
        { name: "messageId", type: "string", required: true, description: "The Gmail message ID" },
      ],
    },
    gmail_send: {
      description: "Send a new email via Gmail.",
      category: "Email",
      parameters: [
        { name: "to", type: "string", required: true, description: "Recipient email address" },
        { name: "subject", type: "string", required: true, description: "Email subject" },
        { name: "body", type: "string", required: true, description: "Email body (plain text)" },
      ],
    },
    gmail_reply: {
      description: "Reply to an existing Gmail message.",
      category: "Email",
      parameters: [
        { name: "messageId", type: "string", required: true, description: "The message ID to reply to" },
        { name: "body", type: "string", required: true, description: "Reply body (plain text)" },
      ],
    },
    gmail_label: {
      description: "Add or remove labels on Gmail messages.",
      category: "Email",
      parameters: [
        { name: "messageId", type: "string", required: true, description: "The message ID" },
        { name: "addLabels", type: "string[]", required: false, description: "Labels to add" },
        { name: "removeLabels", type: "string[]", required: false, description: "Labels to remove" },
      ],
    },
    gmail_archive: {
      description: "Archive Gmail messages by removing the INBOX label.",
      category: "Email",
      parameters: [
        { name: "messageId", type: "string", required: true, description: "The message ID to archive" },
      ],
    },
    calendar_list_events: {
      description: "List calendar events within a date range.",
      category: "Calendar",
      parameters: [
        { name: "startDate", type: "string", required: false, description: "Start date in ISO format" },
        { name: "endDate", type: "string", required: false, description: "End date in ISO format" },
      ],
    },
    calendar_create_event: {
      description: "Create a new calendar event with title, time, and optional location.",
      category: "Calendar",
      parameters: [
        { name: "title", type: "string", required: true, description: "Event title" },
        { name: "start", type: "string", required: true, description: "Start time in ISO format" },
        { name: "end", type: "string", required: true, description: "End time in ISO format" },
        { name: "description", type: "string", required: false, description: "Event description" },
        { name: "location", type: "string", required: false, description: "Event location" },
      ],
    },
    calendar_update_event: {
      description: "Update an existing calendar event by ID.",
      category: "Calendar",
      parameters: [
        { name: "id", type: "string", required: true, description: "The event ID to update" },
        { name: "title", type: "string", required: false, description: "New title" },
        { name: "start", type: "string", required: false, description: "New start time" },
        { name: "end", type: "string", required: false, description: "New end time" },
      ],
    },
    calendar_delete_event: {
      description: "Delete a calendar event by ID.",
      category: "Calendar",
      parameters: [
        { name: "id", type: "string", required: true, description: "The event ID to delete" },
      ],
    },
    calendar_list_calendars: {
      description: "List all available calendars.",
      category: "Calendar",
      parameters: [],
    },
    create_custom_tool: {
      description: "Create a new custom JavaScript tool that agents can use.",
      category: "Tool Builder",
      parameters: [
        { name: "name", type: "string", required: true, description: "Unique snake_case name for the tool" },
        { name: "description", type: "string", required: true, description: "What the tool does" },
        { name: "parameters", type: "object[]", required: true, description: "Tool parameters definition" },
        { name: "code", type: "string", required: true, description: "JavaScript async function body" },
        { name: "timeout", type: "number", required: false, description: "Execution timeout in ms (default 30000)" },
      ],
    },
    list_custom_tools: {
      description: "List all custom tools.",
      category: "Tool Builder",
      parameters: [],
    },
    update_custom_tool: {
      description: "Update an existing custom tool by ID.",
      category: "Tool Builder",
      parameters: [
        { name: "id", type: "string", required: true, description: "The tool ID to update" },
        { name: "name", type: "string", required: false, description: "New name" },
        { name: "description", type: "string", required: false, description: "New description" },
        { name: "code", type: "string", required: false, description: "New code" },
      ],
    },
    test_custom_tool: {
      description: "Test a custom tool by executing it with given parameters and returning the result.",
      category: "Tool Builder",
      parameters: [
        { name: "id", type: "string", required: true, description: "The tool ID to test" },
        { name: "params", type: "object", required: true, description: "Parameters to pass to the tool" },
      ],
    },
  };

  for (const name of builtInNames) {
    const meta = BUILTIN_META[name];
    toolMeta[name] = {
      description: meta?.description ?? "",
      builtIn: true,
      parameters: meta?.parameters ?? [],
      category: meta?.category ?? "Other",
    };
  }

  for (const ct of customs) {
    toolMeta[ct.name] = {
      description: ct.description,
      builtIn: false,
      parameters: ct.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        description: p.description,
      })),
      category: "Custom",
    };
  }

  // Add MCP tools
  const mcpService = new McpServerServiceRef();
  const mcpServers = mcpService.list().filter((s) => s.enabled);
  for (const server of mcpServers) {
    if (!McpClientManager.isConnected(server.id)) continue;
    const tools = server.discoveredTools ?? [];
    for (const t of tools) {
      if (server.allowedTools !== null && !server.allowedTools.includes(t.name)) continue;
      const fullName = `mcp_${McpClientManager.sanitizeName(server.name)}_${t.name}`;
      toolMeta[fullName] = {
        description: t.description,
        builtIn: false,
        parameters: extractMcpToolParams(t.inputSchema),
        category: `MCP: ${server.name}`,
      };
    }
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
    shape[param.name] = param.required ? schema : schema.nullable().optional();
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
      name: z.string().nullable().optional().describe("New name"),
      description: z.string().nullable().optional().describe("New description"),
      parameters: z.array(z.object({
        name: z.string(),
        type: z.enum(["string", "number", "boolean"]),
        required: z.boolean(),
        description: z.string(),
      })).nullable().optional().describe("New parameters"),
      code: z.string().nullable().optional().describe("New code"),
      timeout: z.number().nullable().optional().describe("New timeout"),
    }),
    execute: async ({ id, name, description, parameters, code, timeout }) => {
      // Strip null values for downstream compatibility
      const data = {
        ...(name != null && { name }),
        ...(description != null && { description }),
        ...(parameters != null && { parameters }),
        ...(code != null && { code }),
        ...(timeout != null && { timeout }),
      };
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

// =========================================================================
// MCP Tool Helpers
// =========================================================================

/**
 * Create a Vercel AI SDK tool wrapper for an MCP tool.
 * Tool names follow the convention: mcp_<serverName>_<toolName>
 */
function createMcpToolWrapper(fullName: string): unknown | null {
  // fullName = mcp_<sanitizedServerName>_<toolName>
  const mcpService = new McpServerServiceRef();
  const servers = mcpService.list().filter((s) => s.enabled);

  for (const server of servers) {
    if (!McpClientManager.isConnected(server.id)) continue;
    const prefix = `mcp_${McpClientManager.sanitizeName(server.name)}_`;
    if (!fullName.startsWith(prefix)) continue;

    const toolName = fullName.slice(prefix.length);
    const tools = server.discoveredTools ?? [];
    const mcpTool = tools.find((t) => t.name === toolName);
    if (!mcpTool) continue;

    // Check allowed tools gate
    if (server.allowedTools !== null && !server.allowedTools.includes(toolName)) continue;

    // Convert JSON Schema to Zod
    const zodSchema = jsonSchemaToZod(mcpTool.inputSchema);

    return tool({
      description: mcpTool.description || `MCP tool: ${toolName}`,
      parameters: zodSchema,
      execute: async (params: Record<string, unknown>) => {
        const result = await McpClientManager.callTool(server.id, toolName, params);
        return JSON.stringify(result);
      },
    });
  }

  return null;
}

/** Convert a JSON Schema object to a Zod schema (basic support) */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || schema.type !== "object") {
    return z.object({});
  }

  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let fieldSchema: z.ZodTypeAny;
    const desc = (prop.description as string) || "";

    switch (prop.type) {
      case "number":
      case "integer":
        fieldSchema = z.number().describe(desc);
        break;
      case "boolean":
        fieldSchema = z.boolean().describe(desc);
        break;
      case "array":
        fieldSchema = z.array(z.unknown()).describe(desc);
        break;
      case "object":
        fieldSchema = z.record(z.unknown()).describe(desc);
        break;
      default:
        fieldSchema = z.string().describe(desc);
    }

    shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional();
  }

  return z.object(shape);
}

/** Extract parameter metadata from a JSON Schema for UI display */
function extractMcpToolParams(
  schema: Record<string, unknown>,
): ToolParamMeta[] {
  if (!schema || schema.type !== "object") return [];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);

  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: (prop.type as string) || "string",
    required: required.has(name),
    description: (prop.description as string) || "",
  }));
}
