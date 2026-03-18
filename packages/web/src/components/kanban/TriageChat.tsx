import { useCallback, useEffect, useRef, useState } from "react";
import type { KanbanTask, TriageMessage } from "@otterbot/shared";
import { getSocket } from "../../lib/socket";

export function TriageChat({
  task,
}: {
  task: KanbanTask;
}) {
  const [messages, setMessages] = useState<TriageMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load existing messages on mount
  useEffect(() => {
    const socket = getSocket();
    socket.emit("triage:load-messages", { taskId: task.id }, (msgs) => {
      setMessages(msgs);
      setInitialLoading(false);
    });
  }, [task.id]);

  // Listen for new messages
  useEffect(() => {
    const socket = getSocket();
    const handler = (data: { taskId: string; message: TriageMessage }) => {
      if (data.taskId !== task.id) return;
      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
      setLoading(false);
    };
    socket.on("triage:message", handler);
    return () => {
      socket.off("triage:message", handler);
    };
  }, [task.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setLoading(true);

    const socket = getSocket();
    socket.emit("triage:send-message", { taskId: task.id, content: text }, (ack) => {
      if (ack && !ack.ok) {
        setLoading(false);
        console.error("Triage send failed:", ack.error);
      }
    });
  }, [input, loading, task.id]);

  const handleApprove = useCallback(() => {
    const socket = getSocket();
    socket.emit("triage:approve", { taskId: task.id }, (ack) => {
      if (ack && !ack.ok) {
        console.error("Triage approve failed:", ack.error);
      }
    });
  }, [task.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Loading triage conversation...
      </div>
    );
  }

  const isApproved = task.triageStatus === "approved";

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground italic py-4">
            No triage analysis yet. The AI will analyze this issue when triage runs.
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm rounded-lg px-3 py-2 ${
              msg.role === "assistant"
                ? "bg-secondary text-foreground"
                : "bg-primary/15 text-foreground ml-8"
            }`}
          >
            <div className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">
              {msg.role === "assistant" ? "AI Analysis" : "You"}
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div className="text-sm text-muted-foreground italic flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse" />
            AI is analyzing...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      {!isApproved && (
        <div className="border-t border-border pt-3 mt-3 space-y-2">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Discuss the triage analysis..."
              disabled={loading}
              rows={2}
              className="flex-1 bg-secondary text-foreground text-sm rounded-lg px-3 py-2 resize-none border border-border focus:border-primary/50 focus:outline-none disabled:opacity-50 placeholder:text-muted-foreground"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="self-end px-3 py-2 text-sm font-medium bg-primary/15 text-primary hover:bg-primary/25 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
          <button
            onClick={handleApprove}
            disabled={loading || messages.length === 0}
            className="w-full text-sm font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Approve Triage
          </button>
        </div>
      )}

      {isApproved && (
        <div className="border-t border-border pt-3 mt-3">
          <div className="text-sm text-emerald-400 font-medium text-center py-2">
            Triage approved — analysis posted to GitHub
          </div>
        </div>
      )}
    </div>
  );
}
