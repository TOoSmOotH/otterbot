/**
 * Display-only side-channel for tool calls.
 *
 * A tool's return value is what the *model* sees during the turn, so it must
 * stay small. But some tools produce rich output worth showing the *user* — the
 * full terminal transcript of a coding-CLI run, for example. A tool records
 * that extra detail here keyed by its `toolCallId`; the runtime takes it when it
 * persists/streams the tool message, merging it into the displayed result. The
 * model never sees it (and persisted tool messages are excluded from context).
 */
export interface ToolDisplayDetail {
  /** Full cleaned terminal output captured from a CLI tool. */
  transcript?: string;
}

const details = new Map<string, ToolDisplayDetail>();
/** Bound memory if a recorded detail is never taken (e.g. an aborted turn). */
const MAX_PENDING = 200;

export function recordToolDisplay(toolCallId: string, detail: ToolDisplayDetail): void {
  if (!toolCallId) return;
  if (details.size >= MAX_PENDING) {
    const oldest = details.keys().next().value;
    if (oldest !== undefined) details.delete(oldest);
  }
  details.set(toolCallId, detail);
}

/** Read and remove the display detail recorded for a tool call, if any. */
export function takeToolDisplay(toolCallId: string): ToolDisplayDetail | undefined {
  const detail = details.get(toolCallId);
  if (detail) details.delete(toolCallId);
  return detail;
}
