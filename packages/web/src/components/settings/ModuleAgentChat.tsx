import { useState, useEffect, useRef } from "react";
import { cn } from "../../lib/utils";

interface AgentModule {
  id: string;
  name: string;
}

interface ChatMessage {
  role: "user" | "agent";
  content: string;
}

interface ModuleAgentChatProps {
  modules: AgentModule[];
  onClose: () => void;
}

export function ModuleAgentChat({ modules, onClose }: ModuleAgentChatProps) {
  const [selectedId, setSelectedId] = useState(modules[0]?.id ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Clear conversation when switching agents
  useEffect(() => {
    setMessages([]);
    setInput("");
  }, [selectedId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || sending || !selectedId) return;
    setSending(true);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 150_000);
      const res = await fetch(`/api/modules/${selectedId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: `Error: ${data.error ?? "Query failed"}` },
        ]);
      } else {
        setMessages((prev) => [...prev, { role: "agent", content: data.answer || "(empty response)" }]);
      }
    } catch (err) {
      const msg = err instanceof DOMException && err.name === "AbortError"
        ? "Request timed out — the agent may be busy."
        : (err instanceof Error ? err.message : "Query failed");
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Error: ${msg}` },
      ]);
    } finally {
      setSending(false);
    }
  };

  const selectedModule = modules.find((m) => m.id === selectedId);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-lg w-full max-w-2xl h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium">Agent Chat</div>
            {modules.length > 1 ? (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary"
              >
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
              </select>
            ) : selectedModule ? (
              <span className="text-xs text-muted-foreground">
                {selectedModule.name} ({selectedModule.id})
              </span>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">
              Ask {selectedModule?.name ?? "the agent"} a question to get started.
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-foreground",
                )}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-secondary text-muted-foreground rounded-lg px-3 py-2 text-xs animate-pulse">
                Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border px-4 py-3 flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type a message..."
            disabled={sending || !selectedId}
            className="flex-1 bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim() || !selectedId}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
