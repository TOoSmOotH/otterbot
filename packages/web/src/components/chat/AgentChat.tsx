import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Clock,
  FileText,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Artifact } from "@otterbot/shared";
import { useChatStore } from "../../stores/chat-store";
import { useAgentsStore } from "../../stores/agents-store";
import { withToken, uploadFile } from "../../lib/api";
import { Icon } from "../ui/Icon";
import { type, fonts } from "../../lib/typography";
import { ConversationList } from "./ConversationList";
import { CodingCliIndicator } from "./CodingCliIndicator";
import type { CodingTool } from "../../lib/coding-cli";
import { ContextPanel } from "./ContextPanel";
import { ChatImage } from "./ChatImage";
import { ToolMessage } from "./ToolMessage";
import { Markdown } from "./Markdown";

export function AgentChat({
  onEditAgent,
  onOpenSettings,
  onOpenLoginTerminal,
}: {
  onEditAgent: (id: string) => void;
  onOpenSettings?: (tab?: string) => void;
  onOpenLoginTerminal?: (tool: CodingTool) => void;
}) {
  const connect = useChatStore((s) => s.connect);
  const join = useChatStore((s) => s.join);
  const send = useChatStore((s) => s.send);
  const newConversation = useChatStore((s) => s.newConversation);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const refreshContext = useChatStore((s) => s.refreshContext);
  const byAgent = useChatStore((s) => s.byAgent);
  const streamingMap = useChatStore((s) => s.streaming);

  const agents = useAgentsStore((s) => s.agents);
  const activeAgentId = useAgentsStore((s) => s.activeAgentId);
  const agent = agents.find((a) => a.id === activeAgentId) ?? null;

  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [pending, setPending] = useState<Artifact[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!activeAgentId) return;
    join(activeAgentId);
    void loadConversations(activeAgentId);
    void refreshContext(activeAgentId);
  }, [activeAgentId, join, loadConversations, refreshContext]);

  const messages = activeAgentId ? (byAgent[activeAgentId] ?? []) : [];
  const streaming = activeAgentId ? Boolean(streamingMap[activeAgentId]) : false;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, streaming]);

  const canSend = (input.trim() || pending.length > 0) && !streaming && !uploading;

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSend || !activeAgentId) return;
    send(activeAgentId, input, pending.length ? pending : undefined);
    setInput("");
    setPending([]);
  };

  // Re-prompt an existing image: send an edit instruction that references the
  // source image so the agent can run edit_image (delegating if needed).
  const editImage = (imageUrl: string, change: string) => {
    if (!activeAgentId) return;
    send(activeAgentId, `Edit this image: ${change}\n(source: ${imageUrl})`);
  };

  // Upload selected/dropped/pasted files; each becomes a pending attachment.
  const uploadFiles = async (files: FileList | File[]) => {
    if (!activeAgentId) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const f of list) {
        const art = await uploadFile(activeAgentId, f);
        setPending((p) => [...p, art]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removePending = (id: string) => setPending((p) => p.filter((a) => a.id !== id));

  if (!agent || !activeAgentId) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "rgb(var(--muted))",
          fontSize: 14,
        }}
      >
        Select an agent to start chatting.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {showHistory && <ConversationList agentId={activeAgentId} />}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          flex: 1,
          minWidth: 0,
          background: "rgb(var(--bg))",
        }}
      >
        <header
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid rgb(var(--border))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 data-testid="channel-title" style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
              <span style={{ color: "rgb(var(--subtle))", fontWeight: 700, marginRight: 4 }}>#</span>
              {agent.displayName}
            </h2>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 9px",
                borderRadius: 20,
                color:
                  agent.status === "working" || agent.status === "thinking"
                    ? "rgb(var(--success))"
                    : "rgb(var(--muted))",
                background:
                  agent.status === "working" || agent.status === "thinking"
                    ? "rgba(61,215,196,0.1)"
                    : "rgb(var(--surface-elevated))",
              }}
            >
              {agent.status}
            </span>
            {streaming && <StreamingDots />}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <CodingCliIndicator
              onOpenSettings={onOpenSettings}
              onOpenLoginTerminal={onOpenLoginTerminal}
            />
            <IconButton
              icon={Clock}
              label="History"
              active={showHistory}
              onClick={() => setShowHistory((v) => !v)}
            />
            <IconButton
              icon={FileText}
              label="Context"
              active={showContext}
              onClick={() => setShowContext((v) => !v)}
            />
            <IconButton
              icon={Pencil}
              label="Edit agent"
              onClick={() => onEditAgent(agent.id)}
            />
            <IconButton
              icon={MessageSquarePlus}
              label="New conversation"
              onClick={() => newConversation(activeAgentId)}
            />
          </div>
        </header>

        {showContext && <ContextPanel agentId={activeAgentId} />}

        <div
          ref={listRef}
          data-testid="message-list"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {messages.length === 0 && (
            <div style={{ color: "rgb(var(--muted))", fontSize: 13, lineHeight: 1.5 }}>
              Say hello. {agent.displayName} remembers things across sessions.
            </div>
          )}
          <AnimatePresence initial={false}>
            {messages.map((m) =>
              m.role === "tool" ? (
                <motion.div
                  key={m.id}
                  data-testid="message-tool"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                  style={{ alignSelf: "stretch", maxWidth: "75ch" }}
                >
                  <ToolMessage message={m} onEditImage={editImage} />
                </motion.div>
              ) : (
                <motion.div
                  key={m.id}
                  data-testid={`message-${m.role}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "75ch",
                    padding: "9px 13px",
                    borderRadius: 10,
                    background:
                      m.role === "user" ? "rgb(var(--accent))" : "rgb(var(--surface))",
                    color:
                      m.role === "user" ? "rgb(var(--accent-fg))" : "rgb(var(--fg))",
                    border:
                      m.role === "user"
                        ? "1px solid rgb(var(--accent))"
                        : "1px solid rgb(var(--border))",
                    whiteSpace: m.role === "assistant" ? "normal" : "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 13,
                    lineHeight: 1.55,
                    boxShadow: m.role === "user" ? "var(--shadow-sm)" : "none",
                  }}
                >
                  {m.attachments && m.attachments.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        marginBottom: m.content ? 8 : 0,
                      }}
                    >
                      {m.attachments.map((a) =>
                        a.kind === "image" ? (
                          <ChatImage
                            key={a.id}
                            url={a.url}
                            alt={a.name}
                            onEdit={(change) => editImage(a.url, change)}
                          />
                        ) : (
                          <a
                            key={a.id}
                            href={withToken(a.url)}
                            download={a.name}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              alignSelf: "flex-start",
                              padding: "5px 9px",
                              borderRadius: 6,
                              border: "1px solid rgb(var(--border))",
                              background: "rgb(var(--surface))",
                              color: "rgb(var(--fg))",
                              textDecoration: "none",
                              fontSize: 12,
                            }}
                          >
                            <Icon icon={FileText} size={14} />
                            {a.name}
                          </a>
                        )
                      )}
                    </div>
                  )}
                  {m.role === "assistant" ? <Markdown content={m.content} /> : m.content}
                  {m.error && (
                    <div
                      style={{
                        color: "rgb(var(--danger))",
                        marginTop: 4,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      Error: {m.error}
                    </div>
                  )}
                </motion.div>
              ),
            )}
          </AnimatePresence>
        </div>

        <form
          onSubmit={onSubmit}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
          }}
          style={{
            padding: "12px 14px 14px",
            borderTop: "1px solid rgb(var(--border))",
            background: "rgb(var(--bg))",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.csv,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {(pending.length > 0 || uploading || uploadError) && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 8,
                alignItems: "center",
              }}
            >
              {pending.map((a) => (
                <span
                  key={a.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 6px 3px 8px",
                    borderRadius: 6,
                    border: "1px solid rgb(var(--border))",
                    background: "rgb(var(--surface))",
                    color: "rgb(var(--fg))",
                    fontSize: 12,
                  }}
                >
                  {a.kind === "image" ? (
                    <img
                      src={withToken(a.url)}
                      alt={a.name}
                      style={{ width: 24, height: 24, objectFit: "cover", borderRadius: 3 }}
                    />
                  ) : (
                    <Icon icon={FileText} size={14} />
                  )}
                  <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {a.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => removePending(a.id)}
                    style={{
                      display: "inline-flex",
                      border: "none",
                      background: "transparent",
                      color: "rgb(var(--subtle))",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <Icon icon={X} size={13} />
                  </button>
                </span>
              ))}
              {uploading && (
                <span style={{ fontSize: 12, color: "rgb(var(--subtle))" }}>Uploading…</span>
              )}
              {uploadError && (
                <span style={{ fontSize: 12, color: "rgb(var(--danger))" }}>{uploadError}</span>
              )}
            </div>
          )}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-end",
              background: "rgb(var(--surface))",
              border: `1px solid rgb(var(--${dragOver ? "accent" : "border"}))`,
              borderRadius: 10,
              padding: "6px 8px 6px 8px",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <button
              type="button"
              aria-label="Attach a file"
              title="Attach a file"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming || uploading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "rgb(var(--subtle))",
                cursor: streaming || uploading ? "not-allowed" : "pointer",
                flexShrink: 0,
                marginBottom: 2,
              }}
            >
              <Icon icon={Paperclip} size={16} />
            </button>
            <textarea
              data-testid="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  void uploadFiles(files);
                }
              }}
              placeholder={
                streaming
                  ? `${agent.displayName} is typing…`
                  : `Message ${agent.displayName}…`
              }
              disabled={streaming}
              rows={2}
              style={{
                flex: 1,
                background: "transparent",
                color: "rgb(var(--fg))",
                border: "none",
                outline: "none",
                padding: "4px 0",
                resize: "none",
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            />
            <button
              type="submit"
              data-testid="chat-send"
              aria-label="Send message"
              disabled={!canSend}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "none",
                background: canSend ? "rgb(var(--accent))" : "rgb(var(--surface-elevated))",
                color: canSend ? "rgb(var(--accent-fg))" : "rgb(var(--subtle))",
                cursor: canSend ? "pointer" : "not-allowed",
                flexShrink: 0,
                marginBottom: 2,
              }}
            >
              <Icon icon={ArrowUp} size={16} strokeWidth={2.25} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}

function IconButton({ icon, label, active, onClick }: IconButtonProps) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    background: active ? "rgb(var(--surface-elevated))" : "transparent",
    color: active ? "rgb(var(--fg))" : "rgb(var(--muted))",
    border: `1px solid ${active ? "rgb(var(--border-strong))" : "transparent"}`,
    borderRadius: 7,
    cursor: "pointer",
  };
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} style={base}>
      <Icon icon={icon} size={14} />
    </button>
  );
}

function StreamingDots() {
  const dot: CSSProperties = {
    width: 4,
    height: 4,
    borderRadius: "50%",
    background: "rgb(var(--muted))",
    animation: "otter-dots 1.2s ease-in-out infinite",
  };
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        marginLeft: 4,
      }}
    >
      <span style={{ ...dot, animationDelay: "-0.32s" }} />
      <span style={{ ...dot, animationDelay: "-0.16s" }} />
      <span style={dot} />
    </span>
  );
}
