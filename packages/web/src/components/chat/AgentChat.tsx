import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Clock,
  FileText,
  MessageSquarePlus,
  Pencil,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useChatStore } from "../../stores/chat-store";
import { useAgentsStore } from "../../stores/agents-store";
import { statusColor } from "../agents/agent-visual";
import { Icon } from "../ui/Icon";
import { type, fonts } from "../../lib/typography";
import { ConversationList } from "./ConversationList";
import { ContextPanel } from "./ContextPanel";

const PULSING_STATUSES = new Set(["working", "thinking"]);

export function AgentChat({ onEditAgent }: { onEditAgent: (id: string) => void }) {
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
  const listRef = useRef<HTMLDivElement>(null);

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

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || streaming || !activeAgentId) return;
    send(activeAgentId, input);
    setInput("");
  };

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

  const statusPulse = PULSING_STATUSES.has(agent.status);

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
          <h2
            style={{
              ...type.h2,
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              letterSpacing: "-0.005em",
            }}
          >
            {agent.displayName}
            <span
              title={agent.status}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: statusColor(agent.status),
                animation: statusPulse ? "otter-pulse 1.5s ease-in-out infinite" : undefined,
                boxShadow: statusPulse ? `0 0 6px ${statusColor(agent.status)}` : undefined,
              }}
            />
            {streaming && <StreamingDots />}
          </h2>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
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
                  style={{
                    alignSelf: "stretch",
                    maxWidth: "75ch",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "6px 10px",
                    border: "1px solid rgb(var(--border))",
                    background: "rgb(var(--surface-sunken))",
                    borderRadius: 6,
                    color: "rgb(var(--muted))",
                    fontFamily: fonts.mono,
                    fontSize: 11,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <Icon
                    icon={Wrench}
                    size={14}
                    style={{
                      color: "rgb(var(--subtle))",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  />
                  <span>{m.content}</span>
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
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 13,
                    lineHeight: 1.55,
                    boxShadow: m.role === "user" ? "var(--shadow-sm)" : "none",
                  }}
                >
                  {m.content}
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
          style={{
            padding: "12px 14px 14px",
            borderTop: "1px solid rgb(var(--border))",
            background: "rgb(var(--bg))",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-end",
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--border))",
              borderRadius: 10,
              padding: "6px 8px 6px 12px",
              boxShadow: "var(--shadow-sm)",
            }}
          >
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
              disabled={!input.trim() || streaming}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "none",
                background:
                  !input.trim() || streaming
                    ? "rgb(var(--surface-elevated))"
                    : "rgb(var(--accent))",
                color:
                  !input.trim() || streaming
                    ? "rgb(var(--subtle))"
                    : "rgb(var(--accent-fg))",
                cursor: !input.trim() || streaming ? "not-allowed" : "pointer",
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
