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
      continue;
    }
    const contextlessCreator = CONTEXTLESS_TOOL_REGISTRY[name];
    if (contextlessCreator) {
      tools[name] = contextlessCreator();
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

/** List all available tool names */
export function getAvailableToolNames(): string[] {
  return [...Object.keys(TOOL_REGISTRY), ...Object.keys(CONTEXTLESS_TOOL_REGISTRY)];
}
