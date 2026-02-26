import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type FC } from "react";
import { useMessageStore } from "../../stores/message-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useProjectStore } from "../../stores/project-store";
import { useSpeechToText } from "../../hooks/use-speech-to-text";
import { getSocket } from "../../lib/socket";
import { cn } from "../../lib/utils";
import { MarkdownContent } from "./MarkdownContent";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const ThinkingDisclosure: FC<{ thinking: string }> = ({ thinking }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("transition-transform", expanded && "rotate-90")}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {expanded ? "Hide thinking" : "View thinking"}
      </button>
      {expanded && (
        <pre className="mt-1.5 text-[11px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 whitespace-pre-wrap max-h-[200px] overflow-y-auto">
          {thinking}
        </pre>
      )}
    </div>
  );
};

export function CeoChat({ cooName, detached }: { cooName?: string; detached?: boolean }) {
  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatMessages = useMessageStore((s) => s.chatMessages);
  const streamingContent = useMessageStore((s) => s.streamingContent);
  const streamingMessageId = useMessageStore((s) => s.streamingMessageId);
  const thinkingContent = useMessageStore((s) => s.thinkingContent);
  const isThinking = useMessageStore((s) => s.isThinking);
  const clearChat = useMessageStore((s) => s.clearChat);
  const currentConversationId = useMessageStore((s) => s.currentConversationId);
  const setCurrentConversation = useMessageStore((s) => s.setCurrentConversation);
  const conversations = useMessageStore((s) => s.conversations);
  const loadConversationMessages = useMessageStore((s) => s.loadConversationMessages);

  const setConversations = useMessageStore((s) => s.setConversations);

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) => s.activeProject);
  const projectConversations = useProjectStore((s) => s.projectConversations);
  const setProjectConversations = useProjectStore((s) => s.setProjectConversations);
  const projects = useProjectStore((s) => s.projects);
  const enterProject = useProjectStore((s) => s.enterProject);
  const exitProject = useProjectStore((s) => s.exitProject);

  // Use project conversations when in a project context, global otherwise
  const displayedConversations = activeProjectId ? projectConversations : conversations;

  const sttEnabled = useSettingsStore((s) => s.sttEnabled);
  const activeSTTProvider = useSettingsStore((s) => s.activeSTTProvider);

  const [speechError, setSpeechError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");
  const [speakerOn, setSpeakerOn] = useState(() => {
    return localStorage.getItem("otterbot:speaker") === "true";
  });

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  const { isListening, isTranscribing, isSupported, error: sttError, setError: setSttError, startListening, stopListening } =
    useSpeechToText({
      provider: sttEnabled ? activeSTTProvider : null,
      onTranscript: (finalText) => {
        setInput((prev) => {
          const separator = prev && !prev.endsWith(" ") ? " " : "";
          return prev + separator + finalText;
        });
        setInterimText("");
        setTimeout(resizeTextarea, 0);
      },
      onInterim: (partialText) => {
        setInterimText(partialText);
      },
    });

  // Reset history panel when project context changes
  useEffect(() => {
    setShowHistory(false);
  }, [activeProjectId]);

  // Refresh conversation list when history panel opens
  useEffect(() => {
    if (!showHistory) return;
    const socket = getSocket();
    if (activeProjectId) {
      socket.emit("project:conversations", { projectId: activeProjectId }, (convs) => {
        setProjectConversations(convs);
      });
    } else {
      socket.emit("ceo:list-conversations", undefined, (convs) => {
        setConversations(convs);
      });
    }
  }, [showHistory, activeProjectId, setConversations, setProjectConversations]);

  // Sync speech-to-text errors to local state with auto-dismiss
  useEffect(() => {
    if (sttError) {
      setSpeechError(sttError);
      setSttError(null);
      const timer = setTimeout(() => setSpeechError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [sttError, setSttError]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((prev) => {
      const next = !prev;
      localStorage.setItem("otterbot:speaker", String(next));
      return next;
    });
  }, []);

  const isStreaming = !!streamingContent;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, streamingContent, thinkingContent]);

  const sendMessage = () => {
    const content = input.trim();
    if (!content) return;

    const socket = getSocket();
    socket.emit(
      "ceo:message",
      {
        content,
        conversationId: currentConversationId ?? undefined,
        projectId: activeProjectId ?? undefined,
      },
      (ack) => {
        if (ack?.conversationId) {
          setCurrentConversation(ack.conversationId);
        }
      },
    );
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
    setShowHistory(false);
  }, [clearChat]);

  const handlePopOut = useCallback(() => {
    window.open(
      `${window.location.origin}?detached-chat=true`,
      "OtterbotChat",
      "width=500,height=700,menubar=no,toolbar=no,status=no",
    );
  }, []);

  const handleSwitchContext = useCallback(
    (projectId: string | null) => {
      const socket = getSocket();
      clearChat();
      if (projectId) {
        // Switch to project context
        const cached = projects.find((p) => p.id === projectId);
        if (cached) {
          enterProject(projectId, cached, [], []);
        }
        socket.emit("project:enter", { projectId }, (result) => {
          if (result.project) {
            enterProject(projectId, result.project, result.conversations, result.tasks);
            if (result.conversations.length > 0) {
              const latest = result.conversations[0];
              socket.emit("ceo:load-conversation", { conversationId: latest.id }, (convResult) => {
                loadConversationMessages(convResult.messages);
                setCurrentConversation(latest.id);
              });
            }
          }
        });
      } else {
        // Switch to global context
        exitProject();
        socket.emit("ceo:list-conversations", undefined, (convs) => {
          setConversations(convs);
          if (convs.length > 0) {
            const latest = convs[0];
            socket.emit("ceo:load-conversation", { conversationId: latest.id }, (result) => {
              loadConversationMessages(result.messages);
              setCurrentConversation(latest.id);
            });
          }
        });
      }
      setShowHistory(false);
    },
    [clearChat, projects, enterProject, exitProject, loadConversationMessages, setCurrentConversation, setConversations],
  );

  const handleLoadConversation = useCallback(
    (conversationId: string) => {
      const socket = getSocket();
      socket.emit("ceo:load-conversation", { conversationId }, (result) => {
        loadConversationMessages(result.messages);
        setCurrentConversation(conversationId);
        setShowHistory(false);
      });
    },
    [loadConversationMessages, setCurrentConversation],
  );

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    resizeTextarea();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-sm font-semibold tracking-tight truncate">
            {showHistory
              ? "Chat History"
              : activeProject
                ? activeProject.name
                : `${cooName ?? "COO"} Chat`}
          </h2>
          {!showHistory && currentConversationId && (() => {
            const activeConv = displayedConversations.find((c) => c.id === currentConversationId);
            return activeConv ? (
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={activeConv.title}>
                {activeConv.title}
              </span>
            ) : null;
          })()}
          {activeProject && !showHistory && (
            <span className="text-[10px] text-muted-foreground bg-secondary rounded px-1.5 py-0.5">
              project
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Pop-out button (not shown when already detached) */}
          {!detached && (
            <button
              onClick={handlePopOut}
              title="Pop out chat"
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
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          )}
          {/* History toggle */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            disabled={isStreaming}
            title={showHistory ? "Back to chat" : "Chat history"}
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
              showHistory
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary",
              isStreaming && "opacity-50 cursor-not-allowed",
            )}
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
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          {/* New Chat */}
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
      </div>

      {/* Context switcher (detached mode only) */}
      {detached && projects.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card overflow-x-auto">
          <button
            onClick={() => handleSwitchContext(null)}
            className={cn(
              "shrink-0 text-[11px] px-2 py-1 rounded transition-colors",
              !activeProjectId
                ? "bg-primary/20 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary",
            )}
          >
            Global
          </button>
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => handleSwitchContext(project.id)}
              className={cn(
                "shrink-0 text-[11px] px-2 py-1 rounded transition-colors truncate max-w-[120px]",
                activeProjectId === project.id
                  ? "bg-primary/20 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary",
              )}
              title={project.name}
            >
              {project.name}
            </button>
          ))}
        </div>
      )}

      {showHistory ? (
        /* Conversation history list */
        <div className="flex-1 overflow-y-auto">
          {displayedConversations.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground text-center max-w-[240px]">
                No conversations yet
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {displayedConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleLoadConversation(conv.id)}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors",
                    conv.id === currentConversationId && "bg-secondary/30",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm truncate">{conv.title}</p>
                    {conv.projectId && !activeProjectId && (
                      <span className="shrink-0 text-[9px] text-muted-foreground bg-secondary rounded px-1 py-0.5">
                        project
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatRelativeTime(conv.updatedAt)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {chatMessages.length === 0 && !streamingContent && (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground text-center max-w-[240px]">
                  Send a message to start working with {cooName ?? "your COO"}
                </p>
              </div>
            )}

            {chatMessages.map((msg) => {
              const isCeo = msg.fromAgentId === null;
              const thinking = msg.metadata?.thinking as string | undefined;
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
                    {isCeo ? msg.content : <MarkdownContent content={msg.content} />}
                  </div>
                  {thinking && <ThinkingDisclosure thinking={thinking} />}
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

            {/* Thinking indicator */}
            {isThinking && !streamingContent && (
              <div className="max-w-[85%] mr-auto">
                <div className="bg-secondary/60 border border-border/50 text-secondary-foreground rounded-xl px-3.5 py-2.5 text-sm leading-relaxed">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
                    <svg
                      className="animate-spin h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    <span className="text-xs font-medium">Thinking...</span>
                  </div>
                  {thinkingContent && (
                    <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                      {thinkingContent}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {/* Streaming indicator */}
            {streamingContent && (
              <div className="max-w-[85%] mr-auto">
                <div className="bg-secondary text-secondary-foreground rounded-xl px-3.5 py-2.5 text-sm leading-relaxed">
                  <MarkdownContent content={streamingContent} />
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
                placeholder={`Message ${cooName ?? "the COO"}...`}
                rows={1}
                className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground max-h-[200px]"
              />
              {isSupported && (
                <button
                  onClick={toggleListening}
                  disabled={isTranscribing}
                  title={
                    isTranscribing
                      ? "Transcribing..."
                      : isListening
                        ? "Stop recording"
                        : "Start recording"
                  }
                  className={cn(
                    "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
                    isTranscribing
                      ? "bg-amber-500/90 text-white"
                      : isListening
                        ? "bg-red-500/90 text-white animate-pulse"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                    isTranscribing && "cursor-not-allowed",
                  )}
                >
                  {isTranscribing ? (
                    <svg
                      className="animate-spin h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  ) : (
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
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  )}
                </button>
              )}
              <button
                onClick={toggleSpeaker}
                title={speakerOn ? "Mute assistant voice" : "Unmute assistant voice"}
                className={cn(
                  "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
                  speakerOn
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                )}
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
                  {speakerOn ? (
                    <>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </>
                  ) : (
                    <>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </>
                  )}
                </svg>
              </button>
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
            {interimText && (
              <p className="text-xs text-muted-foreground mt-1.5 px-1 italic">{interimText}</p>
            )}
            {speechError && (
              <p className="text-xs text-destructive mt-1.5 px-1">{speechError}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
