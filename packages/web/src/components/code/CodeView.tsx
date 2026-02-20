import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useOpenCodeStore } from "../../stores/opencode-store";
import { useAgentStore } from "../../stores/agent-store";
import { getSocket } from "../../lib/socket";
import { MarkdownContent } from "../chat/MarkdownContent";
import type { OpenCodeSession, OpenCodeMessage, OpenCodeFileDiff, OpenCodePermission } from "@otterbot/shared";

type PartBuffer = { type: string; content: string; toolName?: string; toolState?: string };

const EMPTY_MESSAGES: OpenCodeMessage[] = [];
const EMPTY_DIFFS: OpenCodeFileDiff[] = [];

function StatusDot({ status }: { status: OpenCodeSession["status"] }) {
  const colors: Record<string, string> = {
    active: "bg-green-400 animate-pulse",
    idle: "bg-yellow-400",
    completed: "bg-emerald-500",
    error: "bg-red-500",
    "awaiting-input": "bg-yellow-400 animate-pulse",
    "awaiting-permission": "bg-orange-400 animate-pulse",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? "bg-gray-400"}`} />;
}

function SessionSidebar({
  sessions,
  selectedAgentId,
  onSelect,
}: {
  sessions: Map<string, OpenCodeSession>;
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
}) {
  const agents = useAgentStore((s) => s.agents);
  const entries = Array.from(sessions.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );

  if (entries.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No active OpenCode sessions. Start a coding task to see live output here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-1">
      {entries.map((session) => {
        const agent = agents.get(session.agentId);
        const displayName = agent?.name ?? session.agentId.slice(0, 8);
        return (
          <button
            key={session.agentId}
            onClick={() => onSelect(session.agentId)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors ${
              selectedAgentId === session.agentId
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <StatusDot status={session.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono">{displayName}</div>
              <div className="truncate opacity-70">{session.task.slice(0, 50)}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PartContent({
  type,
  content: rawContent,
  toolName,
  toolState: rawToolState,
}: {
  type: string;
  content: string;
  toolName?: string;
  toolState?: string;
}) {
  // Safety: ensure content is always a string (SSE data may contain objects)
  const content = typeof rawContent === "string"
    ? rawContent
    : (rawContent != null ? JSON.stringify(rawContent) : "");
  const toolState = typeof rawToolState === "string"
    ? rawToolState
    : (rawToolState != null ? JSON.stringify(rawToolState) : undefined);

  if (type === "reasoning") {
    return (
      <div className="border-l-2 border-blue-500 pl-3 py-1">
        <span className="text-xs italic text-muted-foreground">
          <span className="text-blue-400">Thinking:</span>{" "}
          {content}
        </span>
      </div>
    );
  }

  if (type === "tool" || type === "tool-invocation") {
    // Try to parse JSON tool input/output for nicer display
    let parsed: Record<string, unknown> | null = null;
    try {
      if (content.startsWith("{")) parsed = JSON.parse(content);
    } catch { /* not JSON, render as-is */ }

    const isError = toolState === "error" || parsed?.error;
    const borderColor = isError ? "border-red-500" : "border-yellow-500";

    // Extract display-friendly fields from parsed tool data
    const command = parsed?.command as string | undefined;
    const description = parsed?.description as string | undefined;
    const output = parsed?.output as string | undefined;
    const error = parsed?.error as string | undefined;
    const path = parsed?.path as string | undefined;

    // Build a header label: "# bash" or "# Wrote hello.py"
    const headerLabel = toolName || "tool";
    const headerDetail = description || path || "";

    return (
      <div className={`border-l-2 ${borderColor} pl-3 py-1 my-1`}>
        <div className="text-xs text-muted-foreground mb-0.5">
          <span className={isError ? "text-red-400/80" : "text-yellow-400/80"}>#</span>{" "}
          <span className="text-foreground/70">{headerLabel}</span>
          {headerDetail && (
            <span className="ml-1.5 text-muted-foreground/70">{headerDetail}</span>
          )}
          {toolState && toolState !== "pending" && (
            <span className={`ml-1.5 ${
              toolState === "completed" || toolState === "result"
                ? "text-emerald-400/70"
                : isError
                  ? "text-red-400/70"
                  : "text-yellow-400/70"
            }`}>
              ({toolState})
            </span>
          )}
        </div>
        {/* Show command for bash/shell tools */}
        {command && (
          <pre className="text-xs text-foreground/80 bg-white/5 rounded px-2 py-1 my-0.5 overflow-x-auto">
            <code>{command}</code>
          </pre>
        )}
        {/* Show error message */}
        {error && (
          <div className="text-xs text-red-400/90 mt-0.5">{error}</div>
        )}
        {/* Show output */}
        {output && (
          <pre className="text-xs text-foreground/70 bg-white/5 rounded px-2 py-1 my-0.5 max-h-[200px] overflow-y-auto overflow-x-auto whitespace-pre-wrap">
            <code>{output}</code>
          </pre>
        )}
        {/* Non-JSON content or content without recognized fields — render as markdown */}
        {!parsed && content && (
          <div className="text-xs [&_.prose]:text-xs [&_.prose_pre]:my-1 [&_.prose_pre]:text-xs [&_.prose_code]:text-xs">
            <MarkdownContent content={content} />
          </div>
        )}
      </div>
    );
  }

  if (type === "step-start") {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <div className="flex-1 border-t border-border" />
        <span>Step</span>
        <div className="flex-1 border-t border-border" />
      </div>
    );
  }

  // text — render as markdown for inline code, links, code blocks, etc.
  if (!content.trim()) return null;
  return (
    <div className="text-xs text-foreground/90 [&_.prose]:text-xs [&_.prose_pre]:my-1 [&_.prose_pre]:text-xs [&_.prose_code]:text-xs">
      <MarkdownContent content={content} />
    </div>
  );
}

function DiffSummary({ diffs }: { diffs: OpenCodeFileDiff[] }) {
  if (diffs.length === 0) return null;
  return (
    <div className="border-t border-border mt-2 pt-2">
      <div className="text-xs font-medium text-muted-foreground mb-1">Files Changed</div>
      <div className="flex flex-col gap-0.5">
        {diffs.map((d) => (
          <div key={d.path} className="flex items-center gap-2 text-xs font-mono">
            <span className="truncate flex-1 text-foreground/80">{d.path}</span>
            {d.additions > 0 && <span className="text-green-400">+{d.additions}</span>}
            {d.deletions > 0 && <span className="text-red-400">-{d.deletions}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function InputPrompt({ agentId }: { agentId: string }) {
  const awaiting = useOpenCodeStore((s) => s.awaitingInput.get(agentId));
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (awaiting) {
      inputRef.current?.focus();
      setValue("");
      setSending(false);
    }
  }, [awaiting]);

  const handleSubmit = useCallback(() => {
    if (!awaiting || !value.trim() || sending) return;
    setSending(true);
    getSocket().emit("opencode:respond", {
      agentId,
      sessionId: awaiting.sessionId,
      content: value.trim(),
    }, (ack) => {
      if (!ack?.ok) {
        setSending(false);
      }
    });
  }, [agentId, awaiting, value, sending]);

  if (!awaiting) return null;

  return (
    <div className="border-t border-yellow-500/30 bg-yellow-500/5 px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
        <span className="text-xs text-yellow-400 font-medium">OpenCode is waiting for your input</span>
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Type your response..."
          disabled={sending}
          className="flex-1 bg-black/30 border border-yellow-500/20 rounded px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-yellow-500/50 disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || sending}
          className="px-3 py-1.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}

function PermissionPrompt({ agentId }: { agentId: string }) {
  const pending = useOpenCodeStore((s) => s.pendingPermission.get(agentId));
  const clearPendingPermission = useOpenCodeStore((s) => s.clearPendingPermission);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (pending) setSending(false);
  }, [pending]);

  const handleRespond = useCallback((response: "once" | "always" | "reject") => {
    if (!pending || sending) return;
    setSending(true);
    getSocket().emit("opencode:permission-respond", {
      agentId,
      sessionId: pending.sessionId,
      permissionId: pending.permission.id,
      response,
    }, (ack) => {
      if (ack?.ok) {
        clearPendingPermission(agentId);
      } else {
        setSending(false);
      }
    });
  }, [agentId, pending, sending, clearPendingPermission]);

  if (!pending) return null;

  const { permission } = pending;

  return (
    <div className="border-t border-orange-500/30 bg-orange-500/5 px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
        <span className="text-xs text-orange-400 font-medium">Permission required</span>
      </div>
      <div className="text-xs text-foreground/90 mb-1.5">
        <span className="font-medium">{permission.title || permission.type}</span>
        {permission.pattern && (
          <span className="ml-1.5 text-muted-foreground font-mono text-[10px]">
            {Array.isArray(permission.pattern) ? permission.pattern.join(", ") : permission.pattern}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => handleRespond("once")}
          disabled={sending}
          className="px-3 py-1.5 rounded text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Allow Once
        </button>
        <button
          onClick={() => handleRespond("always")}
          disabled={sending}
          className="px-3 py-1.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Always Allow
        </button>
        <button
          onClick={() => handleRespond("reject")}
          disabled={sending}
          className="px-3 py-1.5 rounded text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function SessionContent({ agentId }: { agentId: string }) {
  const session = useOpenCodeStore((s) => s.sessions.get(agentId));
  const agent = useAgentStore((s) => s.agents.get(agentId));
  const sessionId = session?.id || "";
  const sessionMessages = useOpenCodeStore((s) => s.messages.get(sessionId) ?? EMPTY_MESSAGES);
  const partBuffers = useOpenCodeStore((s) => s.partBuffers);
  const sessionDiffs = useOpenCodeStore((s) => s.diffs.get(sessionId) ?? EMPTY_DIFFS);

  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const rafRef = useRef<number>(0);

  // Auto-scroll on new content
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (autoScrollRef.current && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [sessionMessages, partBuffers]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        Select a session to view
      </div>
    );
  }

  // Collect streaming parts from buffers for this session, grouped by messageId
  const streamingByMessage = useMemo(() => {
    if (!sessionId) return new Map<string, Array<{ key: string; messageId: string; partId: string; type: string; content: string; toolName?: string; toolState?: string }>>();
    const result = new Map<string, Array<{ key: string; messageId: string; partId: string; type: string; content: string; toolName?: string; toolState?: string }>>();
    const prefix = `${sessionId}:`;
    for (const [key, buf] of partBuffers) {
      if (!key.startsWith(prefix)) continue;
      const parts = key.split(":");
      const entry = {
        key,
        messageId: parts[1],
        partId: parts.slice(2).join(":"),
        type: buf.type,
        content: buf.content,
        toolName: buf.toolName,
        toolState: buf.toolState,
      };
      const existing = result.get(entry.messageId);
      if (existing) existing.push(entry);
      else result.set(entry.messageId, [entry]);
    }
    return result;
  }, [sessionId, partBuffers]);

  // Track which messageIds are in full messages to avoid duplication
  const fullMessageIds = new Set(sessionMessages.map((m) => m.id));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Session header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50">
        <StatusDot status={session.status} />
        <span className="text-xs font-mono text-foreground/80">{agent?.name ?? session.agentId.slice(0, 12)}</span>
        <span className="text-xs text-muted-foreground truncate flex-1">{session.task.slice(0, 100)}</span>
      </div>

      {/* Message area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-3 font-mono bg-[#0d1117]"
      >
        {/* User message (the task) */}
        <div className="border-l-2 border-blue-500 pl-3 py-1">
          <div className="text-xs text-foreground font-medium whitespace-pre-wrap">{session.task}</div>
        </div>

        {/* Full messages from server */}
        {sessionMessages
          .filter((m) => m.role === "assistant")
          .map((msg) => (
            <div key={msg.id} className="space-y-1">
              {msg.parts.map((part, i) => (
                <PartContent
                  key={part.id || i}
                  type={part.type}
                  content={String(part.content ?? "")}
                  toolName={part.toolName}
                  toolState={typeof part.toolState === "string" ? part.toolState : undefined}
                />
              ))}
            </div>
          ))}

        {/* Streaming parts not yet in full messages */}
        {Array.from(streamingByMessage.entries())
          .filter(([msgId]) => !fullMessageIds.has(msgId))
          .map(([msgId, parts]) => (
            <div key={msgId} className="space-y-1">
              {parts.map((part) => (
                <PartContent
                  key={part.key}
                  type={part.type}
                  content={part.content}
                  toolName={part.toolName}
                  toolState={part.toolState}
                />
              ))}
            </div>
          ))}

        {/* Active indicator */}
        {session.status === "active" && (
          <div className="flex items-center gap-2 text-xs text-green-400/70">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Working...
          </div>
        )}

        {/* Awaiting input indicator */}
        {session.status === "awaiting-input" && (
          <div className="flex items-center gap-2 text-xs text-yellow-400/70">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            Waiting for your input...
          </div>
        )}

        {/* Awaiting permission indicator */}
        {(session.status as string) === "awaiting-permission" && (
          <div className="flex items-center gap-2 text-xs text-orange-400/70">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            Permission required...
          </div>
        )}

        {/* Diff summary */}
        {sessionDiffs.length > 0 && <DiffSummary diffs={sessionDiffs} />}

        {/* Completion status */}
        {session.status === "completed" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-3 pt-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            <span>Completed</span>
            {session.completedAt && (
              <>
                <span className="text-border">·</span>
                <span>{Math.round((new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)}s</span>
              </>
            )}
          </div>
        )}
        {session.status === "error" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-3 pt-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" />
            <span className="text-red-400">Error</span>
          </div>
        )}
      </div>

      {/* Permission prompt — sticky footer */}
      <PermissionPrompt agentId={agentId} />
      {/* Input prompt — sticky footer */}
      <InputPrompt agentId={agentId} />
    </div>
  );
}

export function CodeView() {
  const sessions = useOpenCodeStore((s) => s.sessions);
  const selectedAgentId = useOpenCodeStore((s) => s.selectedAgentId);
  const selectAgent = useOpenCodeStore((s) => s.selectAgent);

  return (
    <div className="h-full flex bg-[#0d1117] text-foreground">
      {/* Left sidebar — session list */}
      <div className="w-48 shrink-0 border-r border-border overflow-y-auto bg-card/30">
        <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
          Sessions
        </div>
        <SessionSidebar
          sessions={sessions}
          selectedAgentId={selectedAgentId}
          onSelect={selectAgent}
        />
      </div>

      {/* Main content */}
      {selectedAgentId ? (
        <SessionContent key={selectedAgentId} agentId={selectedAgentId} />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground text-xs">
            <div className="text-lg mb-2 opacity-30">{"</>"}</div>
            <div>Live coding view</div>
            <div className="mt-1 opacity-70">
              OpenCode sessions will appear here when workers execute coding tasks
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
