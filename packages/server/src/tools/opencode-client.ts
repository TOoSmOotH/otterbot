/**
 * HTTP client for the OpenCode server API, built on @opencode-ai/sdk.
 *
 * Uses SSE event streaming for activity-based idle timeout instead of
 * a fixed duration — OpenCode can run as long as it's actively working.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client";
import { Agent } from "undici";

export interface OpenCodeConfig {
  apiUrl: string;
  username?: string;
  password?: string;
  /** Idle timeout — abort only after this many ms with NO new activity (default: 180 000) */
  timeoutMs?: number;
  maxIterations?: number;
  /** Called for each SSE event received from the OpenCode server */
  onEvent?: (event: { type: string; properties: Record<string, unknown> }) => void;
  /** Called when OpenCode requests permission for a tool use (interactive mode).
   *  Return the user's response; if absent, auto-approves with "once". */
  onPermissionRequest?: (
    sessionId: string,
    permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> },
  ) => Promise<"once" | "always" | "reject">;
}

export interface OpenCodeDiff {
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

export interface OpenCodeTokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number; // microcents (from OpenCode SDK)
  model: string;
  provider: string;
}

export interface OpenCodeTaskResult {
  success: boolean;
  sessionId: string;
  summary: string;
  diff: OpenCodeDiff | null;
  usage: OpenCodeTokenUsage | null;
  error?: string;
}

export type GetHumanResponse = (sessionId: string, assistantText: string) => Promise<string | null>;

/**
 * Extract the sessionID from an SSE event, checking all known SDK locations:
 * - properties.sessionID (most events)
 * - properties.part.sessionID (message.part.updated, message.part.delta)
 * - properties.info.sessionID (message.updated)
 * - properties.info.id (session.created/updated/deleted — Session objects use `id`)
 */
export function extractSessionId(eventType: string, props: Record<string, unknown>): string | undefined {
  // Direct sessionID (most events)
  if (typeof props.sessionID === "string") return props.sessionID;

  // Nested in part (message.part.updated, message.part.delta)
  const part = props.part as Record<string, unknown> | undefined;
  if (typeof part?.sessionID === "string") return part.sessionID;

  // Nested in info (message.updated)
  const info = props.info as Record<string, unknown> | undefined;
  if (typeof info?.sessionID === "string") return info.sessionID;

  // Session objects use `id` instead of `sessionID` (session.created/updated/deleted)
  if (eventType.startsWith("session.") && typeof info?.id === "string") return info.id;

  return undefined;
}

const POLL_INTERVAL_MS = 15_000; // Fallback poll interval if SSE isn't available
const MAX_TOTAL_WAIT_MS = 30 * 60 * 1000; // Hard cap at 30 minutes regardless of activity

/** Sentinel string that signals task completion when detected in streaming output.
 *  The worker injects a prompt instruction telling OpenCode to output this exact
 *  string when all work is finished, giving us a reliable completion signal even
 *  when SDK session events are unreliable. */
export const TASK_COMPLETE_SENTINEL = "◊◊TASK_COMPLETE_9f8e7d◊◊";

export class OpenCodeClient {
  private client: OpencodeClient;
  private apiUrl: string;
  private idleTimeoutMs: number;
  private maxIterations: number;
  private onEvent?: (event: { type: string; properties: Record<string, unknown> }) => void;
  private onPermissionRequest?: OpenCodeConfig["onPermissionRequest"];
  /** True while waiting for a permission response — prevents idle timeout */
  private permissionPending = false;

  constructor(config: OpenCodeConfig) {
    const baseUrl = config.apiUrl.replace(/\/+$/, "");
    this.apiUrl = baseUrl;
    this.idleTimeoutMs = config.timeoutMs ?? 1_200_000;
    this.maxIterations = config.maxIterations ?? 50;
    this.onEvent = config.onEvent;
    this.onPermissionRequest = config.onPermissionRequest;

    // Build auth header for HTTP Basic
    const headers: Record<string, string> = {};
    if (config.username && config.password) {
      headers["Authorization"] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
    } else if (config.password) {
      headers["Authorization"] = `Basic ${Buffer.from(`:${config.password}`).toString("base64")}`;
    }

    // Disable undici's default headers/body timeouts — session.prompt() blocks
    // until OpenCode finishes which can take many minutes. Our activity monitor
    // handles idle detection instead.
    const dispatcher = new Agent({
      headersTimeout: 0,
      bodyTimeout: 0,
      connectTimeout: 30_000,
    });

    this.client = createOpencodeClient({
      baseUrl,
      headers,
      fetch: ((input: Request) =>
        fetch(input, { dispatcher } as RequestInit)) as (request: Request) => Promise<Response>,
    });
  }

  /** Create a new OpenCode session */
  async createSession(): Promise<{ id: string }> {
    console.log(`[OpenCode Client] Creating session...`);
    const result = await this.client.session.create({ body: {} });
    if (result.error) {
      console.error(`[OpenCode Client] createSession failed:`, result.error);
      throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`);
    }
    const session = result.data!;
    console.log(`[OpenCode Client] Session created: ${session.id}`);
    return { id: session.id };
  }

  /** Send a task message to a session (blocks until OpenCode finishes) */
  async sendMessage(
    sessionId: string,
    task: string,
    signal?: AbortSignal,
  ): Promise<{ content: Record<string, unknown>; usage: OpenCodeTokenUsage | null }> {
    console.log(`[OpenCode Client] Sending message to session ${sessionId} (${task.length} chars)`);
    const result = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: task }],
      },
      signal,
    });
    if (result.error) {
      console.error(`[OpenCode Client] sendMessage failed:`, result.error);
      throw new Error(`Failed to send message: ${JSON.stringify(result.error)}`);
    }
    console.log(`[OpenCode Client] sendMessage response received`);

    const data = (result.data ?? {}) as Record<string, unknown>;

    // Extract token usage from AssistantMessage info
    let usage: OpenCodeTokenUsage | null = null;
    const info = data.info as Record<string, unknown> | undefined;
    if (info) {
      const tokens = info.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined;
      if (tokens) {
        usage = {
          inputTokens: tokens.input ?? 0,
          outputTokens: tokens.output ?? 0,
          reasoningTokens: tokens.reasoning ?? 0,
          cacheReadTokens: tokens.cache?.read ?? 0,
          cacheWriteTokens: tokens.cache?.write ?? 0,
          cost: (info.cost as number) ?? 0,
          model: (info.modelID as string) ?? "unknown",
          provider: (info.providerID as string) ?? "unknown",
        };
        console.log(`[OpenCode Client] Token usage: ${usage.inputTokens} in / ${usage.outputTokens} out / ${usage.reasoningTokens} reasoning, cost=${usage.cost} microcents`);
      }
    }

    return { content: data, usage };
  }

  /** Get session messages */
  async getMessages(sessionId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.client.session.messages({
      path: { id: sessionId },
    });
    if (result.error) {
      throw new Error(`Failed to get messages: ${JSON.stringify(result.error)}`);
    }
    const data = result.data;
    return Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  }

  /** Get file changes made in a session */
  async getDiff(sessionId: string): Promise<OpenCodeDiff> {
    const result = await this.client.session.diff({
      path: { id: sessionId },
    });
    if (result.error) {
      throw new Error(`Failed to get diff: ${JSON.stringify(result.error)}`);
    }
    // SDK returns Array<FileDiff> with { file, additions, deletions, before, after }
    // Map to our interface: { files: [{ path, additions, deletions }] }
    const fileDiffs = result.data ?? [];
    return {
      files: fileDiffs.map((f) => ({
        path: f.file,
        additions: f.additions,
        deletions: f.deletions,
      })),
    };
  }

  /** Cancel a running session */
  async abort(sessionId: string): Promise<void> {
    try {
      await this.client.session.abort({
        path: { id: sessionId },
      });
    } catch {
      // Best-effort abort
    }
  }

  /** Lightweight connectivity test */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.client.session.list();
      if (result.error) {
        const errStr = JSON.stringify(result.error);
        if (errStr.includes("401") || errStr.includes("403")) {
          return { ok: false, error: "Authentication failed. Check credentials." };
        }
        return { ok: false, error: `Server returned error: ${errStr}` };
      }
      return { ok: true };
    } catch (err) {
      if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("ECONNREFUSED"))) {
        return { ok: false, error: "Connection refused. Is OpenCode server running?" };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Extract text content from an OpenCode message/response.
   */
  private extractContent(response: Record<string, unknown>): string {
    let text: string;

    // Direct content field
    if (typeof response.content === "string") {
      text = response.content;
    }
    // Message with parts array (OpenCode v2 format)
    else {
      const parts = response.parts as Array<{ type?: string; text?: string }> | undefined;
      if (Array.isArray(parts)) {
        const textParts = parts.filter((p) => p.type === "text" && p.text);
        text = textParts.map((p) => p.text).join("\n");
      }
      // Array of messages — extract from last assistant message
      else if (Array.isArray(response)) {
        text = "";
        for (let i = response.length - 1; i >= 0; i--) {
          const msg = response[i] as Record<string, unknown>;
          if (msg.role === "assistant") {
            text = this.extractContent(msg);
            break;
          }
        }
      }
      // Fallback: stringify
      else {
        text = JSON.stringify(response).slice(0, 2000);
      }
    }

    // Strip the completion sentinel so it doesn't pollute summaries
    if (text.includes(TASK_COMPLETE_SENTINEL)) {
      text = text.replace(TASK_COMPLETE_SENTINEL, "").trim();
    }

    return text;
  }

  /**
   * Monitor session activity via SSE event stream.
   * Resets idle timer on any event related to this session.
   * Falls back to polling if SSE subscription fails.
   *
   * Resolves with a reason string when the session should be aborted.
   */
  private async monitorActivity(
    sessionId: string,
    controller: AbortController,
  ): Promise<"idle" | "hard_cap" | "error" | "completed"> {
    const startTime = Date.now();
    let lastActivityTime = Date.now();

    // Try SSE first, fall back to polling
    try {
      return await this.monitorViaSse(sessionId, controller, startTime, lastActivityTime);
    } catch (err) {
      console.warn(`[OpenCode Client] SSE subscription failed, falling back to polling:`, err instanceof Error ? err.message : err);
      return this.monitorViaPolling(sessionId, controller, startTime, lastActivityTime);
    }
  }

  /** Monitor activity via SSE event stream */
  private async monitorViaSse(
    sessionId: string,
    controller: AbortController,
    startTime: number,
    lastActivityTime: number,
  ): Promise<"idle" | "hard_cap" | "error" | "completed"> {
    const events = await this.client.event.subscribe({
      signal: controller.signal,
    });

    // Process events with a timeout check loop
    const checkInterval = setInterval(() => {
      if (controller.signal.aborted) return;

      // Hard cap
      if (Date.now() - startTime > MAX_TOTAL_WAIT_MS) {
        console.warn(`[OpenCode Client] Hard cap reached (${MAX_TOTAL_WAIT_MS / 1000}s total). Aborting.`);
        controller.abort();
        return;
      }

      // Skip idle timeout while waiting for user permission response
      if (this.permissionPending) return;

      // Idle timeout
      const idleMs = Date.now() - lastActivityTime;
      if (idleMs > this.idleTimeoutMs) {
        console.warn(`[OpenCode Client] Idle timeout (${Math.round(idleMs / 1000)}s with no activity). Aborting.`);
        controller.abort();
        return;
      }
    }, 5_000);

    // Rolling buffer of recent text output to detect the completion sentinel.
    // We keep the last 100 chars which is more than enough to catch the ~30-char sentinel
    // even if it arrives split across multiple delta chunks.
    let recentText = "";
    const SENTINEL_BUF_SIZE = 100;

    try {
      for await (const event of events.stream) {
        if (controller.signal.aborted) break;

        const eventType = (event as Record<string, unknown>).type as string | undefined;
        const props = (event as Record<string, unknown>).properties as Record<string, unknown> | undefined;

        // Check if this event is related to our session (strict match — reject events without a sessionID)
        const eventSessionId = extractSessionId(eventType ?? "", props ?? {});
        const isOurSession = eventSessionId === sessionId;

        if (isOurSession) {
          lastActivityTime = Date.now();
          console.log(`[OpenCode Client] SSE activity: ${eventType ?? "unknown"}`);

          // Debug: log structure of delta and permission events
          if (eventType === "message.part.delta") {
            console.log(`[OpenCode Client] part.delta properties:`, JSON.stringify(props).slice(0, 500));
          }

          // Forward event to listener
          if (eventType) {
            try {
              this.onEvent?.({ type: eventType, properties: props ?? {} });
            } catch {
              // Best-effort event forwarding
            }
          }

          // Accumulate text deltas to detect the completion sentinel
          if (eventType === "message.part.delta") {
            const field = (props?.field ?? "text") as string;
            const delta = props?.delta as string | undefined;
            if (field === "text" && delta) {
              recentText = (recentText + delta).slice(-SENTINEL_BUF_SIZE);
              if (recentText.includes(TASK_COMPLETE_SENTINEL)) {
                console.log(`[OpenCode Client] Completion sentinel detected in streaming output — task complete.`);
                clearInterval(checkInterval);
                controller.abort();
                return "completed";
              }
            }
          }

          // Check for completion events
          if (isOurSession) {
            if (eventType === "session.error") {
              console.error(`[OpenCode Client] Session error event:`, props?.error);
              clearInterval(checkInterval);
              controller.abort();
              return "error";
            }
            if (eventType === "session.idle") {
              console.log(`[OpenCode Client] Session idle event — task complete.`);
              clearInterval(checkInterval);
              controller.abort();
              return "completed";
            }
            if (eventType === "session.status") {
              const statusObj = props?.status as { type?: string } | undefined;
              if (statusObj?.type === "idle") {
                console.log(`[OpenCode Client] Session status=idle — task complete.`);
                clearInterval(checkInterval);
                controller.abort();
                return "completed";
              }
            }
            if (eventType === "session.updated") {
              const statusObj = props?.status as { type?: string } | undefined;
              if (statusObj?.type === "idle" || statusObj?.type === "completed") {
                console.log(`[OpenCode Client] Session updated status=${statusObj.type} — task complete.`);
                clearInterval(checkInterval);
                controller.abort();
                return "completed";
              }
            }
          }

          // Handle permission requests (interactive mode)
          if (eventType === "permission.asked" && isOurSession && props) {
            console.log(`[OpenCode Client] Permission event properties:`, JSON.stringify(props));
            const permissionId = (props.id ?? props.permissionID) as string | undefined;
            if (permissionId) {
              // permission.asked shape: { id, sessionID, permission: "toolname", patterns: [...], metadata, tool: { messageID, callID } }
              const permissionType = (props.permission as string) ?? (props.type as string) ?? "unknown";
              const permissionTitle = permissionType; // No separate title field — use the permission/tool name
              const permissionPatterns = (props.patterns ?? props.pattern) as string | string[] | undefined;
              console.log(`[OpenCode Client] Permission requested: ${permissionTitle} (${permissionId})`);
              this.permissionPending = true;
              try {
                let response: "once" | "always" | "reject" = "once";
                if (this.onPermissionRequest) {
                  response = await this.onPermissionRequest(sessionId, {
                    id: permissionId,
                    type: permissionType,
                    title: permissionTitle,
                    pattern: permissionPatterns,
                    metadata: (props.metadata as Record<string, unknown>) ?? {},
                  });
                }
                console.log(`[OpenCode Client] Responding to permission ${permissionId}: ${response}`);
                await this.client.postSessionIdPermissionsPermissionId({
                  path: { id: sessionId, permissionID: permissionId },
                  body: { response },
                });
              } catch (err) {
                console.error(`[OpenCode Client] Permission response failed:`, err instanceof Error ? err.message : err);
                // Auto-approve on error to prevent session hang
                try {
                  await this.client.postSessionIdPermissionsPermissionId({
                    path: { id: sessionId, permissionID: permissionId },
                    body: { response: "once" },
                  });
                } catch { /* best-effort */ }
              } finally {
                this.permissionPending = false;
                lastActivityTime = Date.now();
              }
            }
          }
        }
      }
    } catch (err) {
      // Stream ended or was aborted
      if (!controller.signal.aborted) {
        console.warn(`[OpenCode Client] SSE stream ended unexpectedly:`, err instanceof Error ? err.message : err);
      }
    } finally {
      clearInterval(checkInterval);
    }

    console.log(`[OpenCode Client] SSE monitor exited — determining stop reason (elapsed=${Math.round((Date.now() - startTime) / 1000)}s, idleMs=${Math.round((Date.now() - lastActivityTime) / 1000)}s)`);

    // Determine why we stopped
    if (Date.now() - startTime > MAX_TOTAL_WAIT_MS) return "hard_cap";
    if (Date.now() - lastActivityTime > this.idleTimeoutMs) return "idle";
    return "idle"; // controller was aborted by sendMessage completing
  }

  /** Fallback: monitor activity by polling session messages */
  private async monitorViaPolling(
    sessionId: string,
    controller: AbortController,
    startTime: number,
    lastActivityTime: number,
  ): Promise<"idle" | "hard_cap"> {
    let lastMessageCount = 0;

    while (!controller.signal.aborted) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (controller.signal.aborted) break;

      // Hard cap
      if (Date.now() - startTime > MAX_TOTAL_WAIT_MS) {
        console.warn(`[OpenCode Client] Hard cap reached (${MAX_TOTAL_WAIT_MS / 1000}s). Aborting.`);
        controller.abort();
        return "hard_cap";
      }

      try {
        const messages = await this.getMessages(sessionId);
        if (messages.length > lastMessageCount) {
          console.log(`[OpenCode Client] Poll activity: messages ${lastMessageCount}→${messages.length}`);
          lastActivityTime = Date.now();
          lastMessageCount = messages.length;
        } else {
          const idleMs = Date.now() - lastActivityTime;
          console.log(`[OpenCode Client] No activity — idle ${Math.round(idleMs / 1000)}s (timeout at ${Math.round(this.idleTimeoutMs / 1000)}s)`);
        }
      } catch {
        // Polling error — ignore and try again
      }

      if (Date.now() - lastActivityTime > this.idleTimeoutMs) {
        console.warn(`[OpenCode Client] Idle timeout. Aborting.`);
        controller.abort();
        return "idle";
      }
    }

    return "idle";
  }

  /**
   * Execute a single turn: race sendMessage vs activity monitor.
   * Returns the response if sendMessage wins, or a timeout result.
   */
  private async executeTurn(
    sessionId: string,
    message: string,
  ): Promise<
    | { type: "response"; response: Record<string, unknown>; usage: OpenCodeTokenUsage | null }
    | { type: "timeout"; reason: string }
  > {
    const controller = new AbortController();

    const messagePromise = this.sendMessage(sessionId, message, controller.signal)
      .then(({ content, usage }) => ({ type: "response" as const, response: content, usage }))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return { type: "aborted" as const, response: null, usage: null };
        }
        if (err instanceof Error && err.name === "AbortError") {
          return { type: "aborted" as const, response: null, usage: null };
        }
        throw err;
      });

    const monitorPromise = this.monitorActivity(sessionId, controller);

    try {
      const result = await Promise.race([
        messagePromise,
        monitorPromise.then((reason) => ({ type: "timeout" as const, reason, response: null, usage: null })),
      ]);

      if (!controller.signal.aborted) {
        controller.abort();
      }

      if (result.type === "response" && result.response) {
        return { type: "response", response: result.response, usage: result.usage };
      }

      const reason = result.type === "timeout"
        ? (result as { reason: string }).reason
        : "idle";
      return { type: "timeout", reason };
    } catch (err) {
      if (!controller.signal.aborted) {
        controller.abort();
      }
      throw err;
    }
  }

  /**
   * High-level orchestrator: create session, send message with activity-based
   * timeout, fetch diff, return structured result.
   *
   * When `getHumanResponse` is provided, runs a multi-turn loop: after each
   * assistant turn, the callback is invoked with the assistant's last message.
   * If it returns a non-null string, that becomes the next user message.
   * If null (user declined/timed out), the loop ends.
   *
   * Without `getHumanResponse`, the loop runs exactly once (backwards compatible).
   */
  async executeTask(
    task: string,
    getHumanResponse?: GetHumanResponse,
    onPermissionRequest?: OpenCodeConfig["onPermissionRequest"],
  ): Promise<OpenCodeTaskResult> {
    // Allow per-task permission callback override
    if (onPermissionRequest) {
      this.onPermissionRequest = onPermissionRequest;
    }

    console.log(`[OpenCode Client] executeTask starting (idleTimeout=${this.idleTimeoutMs}ms, task: ${task.slice(0, 200)}...)`);
    const session = await this.createSession();

    let currentMessage = task;
    let lastSummary = "";
    let timedOut = false;
    let timeoutReason = "";
    let accumulatedUsage: OpenCodeTokenUsage | null = null;

    for (let turn = 0; turn < this.maxIterations; turn++) {
      console.log(`[OpenCode Client] executeTask turn ${turn + 1}/${this.maxIterations}`);

      try {
        const result = await this.executeTurn(session.id, currentMessage);

        if (result.type === "response") {
          const summary = this.extractContent(result.response);
          console.log(`[OpenCode Client] Turn ${turn + 1} response (${summary.length} chars): ${summary.slice(0, 500)}`);
          lastSummary = summary;

          // Accumulate token usage across turns
          if (result.usage) {
            if (accumulatedUsage) {
              accumulatedUsage.inputTokens += result.usage.inputTokens;
              accumulatedUsage.outputTokens += result.usage.outputTokens;
              accumulatedUsage.reasoningTokens += result.usage.reasoningTokens;
              accumulatedUsage.cacheReadTokens += result.usage.cacheReadTokens;
              accumulatedUsage.cacheWriteTokens += result.usage.cacheWriteTokens;
              accumulatedUsage.cost += result.usage.cost;
              // Keep model/provider from the latest turn
              accumulatedUsage.model = result.usage.model;
              accumulatedUsage.provider = result.usage.provider;
            } else {
              accumulatedUsage = { ...result.usage };
            }
          }

          // If no callback, single-turn mode — break after first response
          if (!getHumanResponse) break;

          // Ask for human response
          const humanResponse = await getHumanResponse(session.id, summary);
          if (humanResponse === null) {
            console.log(`[OpenCode Client] Human declined to respond — ending loop`);
            break;
          }

          currentMessage = humanResponse;
          continue;
        }

        // Timeout or completion detected by monitor
        timedOut = true;
        timeoutReason = result.reason;

        // If completion was detected via SSE/events (monitorActivity won the race),
        // treat it as success, not timeout.
        if (result.type === "timeout" && result.reason === "completed") {
          console.log(`[OpenCode Client] Monitor detected completion — finalizing session.`);
          timedOut = false;
          // Fetch full history since prompt() was aborted
          try {
            const messages = await this.getMessages(session.id);
            lastSummary = this.extractContent(messages);
          } catch (err) {
            console.warn(`[OpenCode Client] Failed to fetch final messages:`, err);
          }
          break; // Exit loop with success
        }

        break;
      } catch (err) {
        console.error(`[OpenCode Client] executeTask turn error:`, err);
        throw err;
      }
    }

    // Finalization: fetch diff and build result
    if (timedOut) {
      const timeoutDesc = timeoutReason === "hard_cap"
        ? `${Math.round(MAX_TOTAL_WAIT_MS / 1000)}s total time`
        : timeoutReason === "error"
          ? "session error"
          : `${Math.round(this.idleTimeoutMs / 1000)}s with no activity`;

      console.warn(`[OpenCode Client] executeTask timed out (${timeoutReason}: ${timeoutDesc})`);
      await this.abort(session.id);

      let summary = `Task timed out after ${timeoutDesc}. The session was aborted.`;
      try {
        const messages = await this.getMessages(session.id);
        if (messages.length > 0) {
          const lastAssistant = [...messages].reverse().find(
            (m) => m.role === "assistant",
          );
          if (lastAssistant) {
            const partial = this.extractContent(lastAssistant);
            if (partial.length > 50) {
              summary += `\n\nPartial result from last assistant message:\n${partial}`;
            }
          }
        }
      } catch {
        // Best-effort partial result extraction
      }

      let diff: OpenCodeDiff | null = null;
      try {
        diff = await this.getDiff(session.id);
      } catch {
        // Best-effort diff
      }

      return {
        success: false,
        sessionId: session.id,
        summary,
        diff,
        usage: accumulatedUsage,
        error: timeoutReason === "hard_cap" ? "hard_timeout" : timeoutReason === "error" ? "session_error" : "idle_timeout",
      };
    }

    // Success path
    let diff: OpenCodeDiff | null = null;
    try {
      diff = await this.getDiff(session.id);
      console.log(`[OpenCode Client] getDiff: ${diff?.files?.length ?? 0} files changed`);
    } catch (err) {
      console.warn(`[OpenCode Client] getDiff failed (non-fatal):`, err);
    }

    return { success: true, sessionId: session.id, summary: lastSummary, diff, usage: accumulatedUsage };
  }
}
