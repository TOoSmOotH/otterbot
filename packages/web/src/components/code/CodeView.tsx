import { useEffect, useRef, useState, useCallback } from "react";
import { useOpenCodeStore } from "../../stores/opencode-store";
import { getSocket } from "../../lib/socket";
import type { OpenCodeSession, OpenCodeFileDiff } from "@otterbot/shared";

function StatusDot({ status }: { status: OpenCodeSession["status"] }) {
  const colors: Record<string, string> = {
    active: "bg-green-400 animate-pulse",
    idle: "bg-yellow-400",
    completed: "bg-emerald-500",
    error: "bg-red-500",
    "awaiting-input": "bg-yellow-400 animate-pulse",
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
      {entries.map((session) => (
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
            <div className="truncate font-mono">{session.agentId.slice(0, 8)}</div>
            <div className="truncate opacity-70">{session.task.slice(0, 50)}</div>
          </div>
        </button>
      ))}
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
      <details className="group">
        <summary className="cursor-pointer text-xs text-violet-400 opacity-70 hover:opacity-100 py-0.5">
          Thinking...
        </summary>
        <div className="pl-3 border-l border-violet-500/20 text-violet-300/60 text-xs whitespace-pre-wrap">
          {content}
        </div>
      </details>
    );
  }

  if (type === "tool-invocation") {
    return (
      <div className="my-1 rounded border border-blue-500/20 bg-blue-500/5 text-xs">
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-blue-500/10">
          <span className="text-blue-400 font-medium">{toolName || "tool"}</span>
          {toolState && (
            <span className={`text-[10px] px-1 rounded ${
              toolState === "result"
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-yellow-500/20 text-yellow-400"
            }`}>
              {toolState}
            </span>
          )}
        </div>
        <pre className="px-2 py-1 whitespace-pre-wrap break-all text-foreground/80 max-h-[200px] overflow-y-auto">
          {content}
        </pre>
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

  // text or other
  return (
    <div className="whitespace-pre-wrap text-xs text-foreground/90">{content}</div>
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

function SessionContent({ agentId }: { agentId: string }) {
  const session = useOpenCodeStore((s) => s.sessions.get(agentId));
  const sessionId = session?.id || "";
  const sessionMessages = useOpenCodeStore((s) => s.messages.get(sessionId) ?? []);
  const partBuffers = useOpenCodeStore((s) => s.partBuffers);
  const sessionDiffs = useOpenCodeStore((s) => s.diffs.get(sessionId) ?? []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll on new content
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessionMessages, partBuffers, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        Select a session to view
      </div>
    );
  }

  // Collect streaming parts from buffers for this session
  const streamingParts: Array<{
    key: string;
    messageId: string;
    partId: string;
    type: string;
    content: string;
    toolName?: string;
    toolState?: string;
  }> = [];

  for (const [key, buf] of partBuffers) {
    if (key.startsWith(`${sessionId}:`)) {
      const parts = key.split(":");
      streamingParts.push({
        key,
        messageId: parts[1],
        partId: parts[2],
        type: buf.type,
        content: buf.content,
        toolName: buf.toolName,
        toolState: buf.toolState,
      });
    }
  }

  // Group streaming parts by messageId
  const streamingByMessage = new Map<string, typeof streamingParts>();
  for (const part of streamingParts) {
    const existing = streamingByMessage.get(part.messageId) ?? [];
    existing.push(part);
    streamingByMessage.set(part.messageId, existing);
  }

  // Track which messageIds are in full messages to avoid duplication
  const fullMessageIds = new Set(sessionMessages.map((m) => m.id));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Session header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50">
        <StatusDot status={session.status} />
        <span className="text-xs font-mono text-foreground/80">{session.agentId.slice(0, 12)}</span>
        <span className="text-xs text-muted-foreground truncate flex-1">{session.task.slice(0, 100)}</span>
      </div>

      {/* Message area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-3 font-mono bg-[#0d1117]"
      >
        {/* User message (the task) */}
        <div className="rounded border border-border/50 bg-card/30 p-2">
          <div className="text-[10px] text-muted-foreground mb-1">Task</div>
          <div className="text-xs text-foreground whitespace-pre-wrap">{session.task}</div>
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

        {/* Diff summary */}
        {sessionDiffs.length > 0 && <DiffSummary diffs={sessionDiffs} />}

        {/* Completion status */}
        {session.status === "completed" && (
          <div className="text-xs text-emerald-400 border-t border-border pt-2 mt-2">
            Session completed
          </div>
        )}
        {session.status === "error" && (
          <div className="text-xs text-red-400 border-t border-border pt-2 mt-2">
            Session ended with error
          </div>
        )}
      </div>

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
        <SessionContent agentId={selectedAgentId} />
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
