import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { useMessageStore } from "../../stores/message-store";
import { getSocket } from "../../lib/socket";
import { cn } from "../../lib/utils";

export function CeoChat() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatMessages = useMessageStore((s) => s.chatMessages);
  const streamingContent = useMessageStore((s) => s.streamingContent);
  const streamingMessageId = useMessageStore((s) => s.streamingMessageId);
  const clearChat = useMessageStore((s) => s.clearChat);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, streamingContent]);

  const sendMessage = () => {
    const content = input.trim();
    if (!content) return;

    const socket = getSocket();
    socket.emit("ceo:message", { content });
    setInput("");

    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewChat = useCallback(() => {
    const socket = getSocket();
    socket.emit("ceo:new-chat");
    clearChat();
  }, [clearChat]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-sm font-semibold tracking-tight">COO Chat</h2>
        </div>
        <button
          onClick={handleNewChat}
          title="New Chat"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {chatMessages.length === 0 && !streamingContent && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground text-center max-w-[240px]">
              Send a message to start working with your COO
            </p>
          </div>
        )}

        {chatMessages.map((msg) => {
          const isCeo = msg.fromAgentId === null;
          return (
            <div
              key={msg.id}
              className={cn(
                "max-w-[85%] text-sm",
                isCeo ? "ml-auto" : "mr-auto",
              )}
            >
              <div
                className={cn(
                  "rounded-xl px-3.5 py-2.5 leading-relaxed",
                  isCeo
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {msg.content}
              </div>
              <p
                className={cn(
                  "text-[10px] text-muted-foreground mt-1 px-1",
                  isCeo ? "text-right" : "text-left",
                )}
              >
                {new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          );
        })}

        {/* Streaming indicator */}
        {streamingContent && (
          <div className="max-w-[85%] mr-auto">
            <div className="bg-secondary text-secondary-foreground rounded-xl px-3.5 py-2.5 text-sm leading-relaxed">
              {streamingContent}
              <span className="inline-block w-1.5 h-4 bg-muted-foreground/50 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-border">
        <div className="flex items-end gap-2 bg-secondary rounded-xl px-3 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message the COO..."
            rows={1}
            className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground max-h-[200px]"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim()}
            className={cn(
              "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
              input.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground",
            )}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
