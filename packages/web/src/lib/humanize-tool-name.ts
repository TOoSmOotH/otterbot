const TOOL_LABELS: Record<string, string> = {
  file_read: "Reading file",
  file_write: "Writing file",
  shell_exec: "Running command",
  web_search: "Searching the web",
  web_browse: "Browsing web",
  install_package: "Installing package",
  opencode_task: "Writing code",
  github_get_issue: "Reading issue",
  github_list_issues: "Checking issues",
  github_get_pr: "Reading PR",
  github_list_prs: "Checking PRs",
  github_comment: "Commenting on GitHub",
  github_create_pr: "Creating PR",
  todo_list: "Checking tasks",
  todo_create: "Creating task",
  todo_update: "Updating task",
  todo_delete: "Removing task",
  gmail_list: "Checking email",
  gmail_read: "Reading email",
  gmail_send: "Sending email",
  gmail_reply: "Replying to email",
  gmail_label: "Labeling email",
  gmail_archive: "Archiving email",
  calendar_list_events: "Checking calendar",
  calendar_create_event: "Creating event",
  calendar_update_event: "Updating event",
  calendar_delete_event: "Deleting event",
  calendar_list_calendars: "Listing calendars",
  create_custom_tool: "Building tool",
  memory_save: "Saving memory",
};

export function humanizeToolName(toolName: string): string {
  const label = TOOL_LABELS[toolName];
  if (label) return label;

  // Fallback: split on underscore, capitalize first word
  const words = toolName.split("_");
  if (words.length === 0) return toolName;
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(" ");
}

export function truncateText(text: string, maxLen = 30): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "\u2026";
}
