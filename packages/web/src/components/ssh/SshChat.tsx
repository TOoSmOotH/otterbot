import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { getSocket } from "../../lib/socket";
import { MarkdownContent } from "../chat/MarkdownContent";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  command?: string;
  timestamp: number;
}

interface SshChatProps {
  sessionId: string;
}

export function SshChat({ sessionId }: SshChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    const socket = getSocket();

    const handleStream = (data: { sessionId: string; token: string; messageId: string }) => {
      if (data.sessionId !== sessionId) return;
      setStreamingMessageId(data.messageId);
      setStreamingContent((prev) => prev + data.token);
    };

    const handleResponse = (data: { sessionId: string; messageId: string; content: string; command?: string }) => {
      if (data.sessionId !== sessionId) return;
      setStreamingContent("");
      setStreamingMessageId(null);
      setIsLoading(false);
      setIsAnalyzing(false);
      setMessages((prev) => [
        ...prev,
        {
          id: data.messageId,
          role: "assistant",
          content: data.content,
          command: data.command,
          timestamp: Date.now(),
        },
      ]);
    };

    const handleAnalyzing = (data: { sessionId: string; command: string }) => {
      if (data.sessionId !== sessionId) return;
      setIsAnalyzing(true);
      setIsLoading(true);
    };

    socket.on("ssh:chat-stream", handleStream);
    socket.on("ssh:chat-response", handleResponse);
    socket.on("ssh:chat-analyzing", handleAnalyzing);

    return () => {
      socket.off("ssh:chat-stream", handleStream);
      socket.off("ssh:chat-response", handleResponse);
      socket.off("ssh:chat-analyzing", handleAnalyzing);
    };
  }, [sessionId]);

  // Clear messages when session changes
  useEffect(() => {
    setMessages([]);
    setStreamingContent("");
    setStreamingMessageId(null);
    setIsLoading(false);
    setIsAnalyzing(false);
  }, [sessionId]);

  const sendMessage = useCallback(() => {
    const content = input.trim();
    if (!content || isLoading) return;

    const socket = getSocket();

    // Add user message
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content, timestamp: Date.now() },
    ]);
    setInput("");
    setIsLoading(true);

    socket.emit("ssh:chat", { sessionId, message: content }, (ack) => {
      if (ack && !ack.ok) {
        setIsLoading(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `Error: ${ack.error ?? "Failed to send message"}`,
            timestamp: Date.now(),
          },
        ]);
      }
    });

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, isLoading, sessionId]);

  const handleRunCommand = useCallback(
    (messageId: string, command: string) => {
      const socket = getSocket();
      socket.emit("ssh:chat-confirm", { sessionId, messageId, command }, (ack) => {
        if (ack && !ack.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "assistant",
              content: `Failed to run command: ${ack.error}`,
              timestamp: Date.now(),
            },
          ]);
        }
      });
      // Mark command as executed in the message
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, command: undefined } : msg,
        ),
      );
    },
    [sessionId],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  return (
    <div className="flex flex-col border-t border-border bg-card h-full">
      {/* Chat header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <div className="flex items-center gap-1.5">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-xs font-medium text-muted-foreground">Terminal Assistant</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {messages.length === 0 && !streamingContent && (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-muted-foreground text-center max-w-[280px]">
              Ask questions about the terminal or request commands to run. E.g. "Show me disk space" or "Check for errors in syslog"
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`max-w-[90%] ${msg.role === "user" ? "ml-auto" : "mr-auto"}`}
          >
            <div
              className={`rounded-lg px-3 py-1.5 text-xs leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              {msg.role === "user" ? (
                msg.content
              ) : (
                <MarkdownContent content={msg.content} />
              )}
            </div>
            {msg.command && (
              <div className="mt-1 flex items-center gap-1.5">
                <code className="text-[11px] bg-zinc-800 text-green-400 px-2 py-1 rounded font-mono">
                  {msg.command}
                </code>
                <button
                  onClick={() => handleRunCommand(msg.id, msg.command!)}
                  className="text-[10px] px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-500 transition-colors"
                >
                  Run
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        {streamingContent && (
          <div className="max-w-[90%] mr-auto">
            <div className="bg-secondary text-secondary-foreground rounded-lg px-3 py-1.5 text-xs leading-relaxed">
              <MarkdownContent content={streamingContent} />
              <span className="inline-block w-1 h-3 bg-muted-foreground/50 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        {/* Loading indicator (before streaming starts) */}
        {isLoading && !streamingContent && (
          <div className="max-w-[90%] mr-auto">
            <div className="bg-secondary text-secondary-foreground rounded-lg px-3 py-1.5 text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>{isAnalyzing ? "Analyzing output..." : "Thinking..."}</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex items-end gap-1.5 bg-secondary rounded-lg px-2.5 py-1.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              resizeTextarea();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the terminal or request a command..."
            rows={1}
            className="flex-1 bg-transparent text-xs resize-none outline-none placeholder:text-muted-foreground max-h-[120px]"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className={`shrink-0 w-6 h-6 rounded flex items-center justify-center transition-colors ${
              input.trim() && !isLoading
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <svg
              width="12"
              height="12"
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
