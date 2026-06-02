import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, FileText, Wrench } from "lucide-react";
import { Icon } from "../ui/Icon";
import { fonts } from "../../lib/typography";
import { withToken } from "../../lib/api";
import { ChatImage } from "./ChatImage";
import type { ChatMessage } from "../../stores/chat-store";

/** Pretty-print a tool arg/result for the expandable detail: strings verbatim,
 *  everything else as indented JSON. */
function formatPayload(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isMeaningful(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t !== "{}" && t !== "[]" && t !== '""';
}

function firstLine(s: string): string {
  const line = s.trim().split("\n")[0] ?? "";
  return line.length > 80 ? line.slice(0, 80) + "…" : line;
}

/** Lift a captured terminal transcript out of a tool result so it can render as
 *  raw text; the remaining fields stay as the JSON "Output". */
function splitTranscript(result: unknown): { transcript: string | null; rest: unknown } {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { transcript: null, rest: result };
  }
  const r = result as Record<string, unknown>;
  if (typeof r.transcript !== "string") return { transcript: null, rest: result };
  const { transcript, ...rest } = r;
  return { transcript, rest };
}

/** A one-line preview of the most useful arg (command/prompt/task), shown dimmed
 *  on the collapsed row so you can scan without expanding. */
function argPreview(args: unknown): string | null {
  if (typeof args === "string") return args.trim() ? firstLine(args) : null;
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  for (const key of ["task", "command", "prompt", "query", "path", "url", "host", "agentId"]) {
    const v = a[key];
    if (typeof v === "string" && v.trim()) return firstLine(v);
  }
  return null;
}

/**
 * One tool-use row in the chat: a collapsed summary line that expands on click
 * to reveal the tool's input and output. Generated images / shared files render
 * inline as before; the expandable detail is for everything the tool did.
 */
export function ToolMessage({
  message,
  onEditImage,
}: {
  message: ChatMessage;
  onEditImage: (url: string, change: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Pull a captured terminal transcript out of the result so it renders as its
  // own monospace block (real newlines) instead of an escaped JSON string.
  const { transcript, rest } = splitTranscript(message.toolResult);

  const inputText = formatPayload(message.toolArgs);
  const outputText = formatPayload(rest);
  const hasInput = isMeaningful(inputText);
  const hasOutput = isMeaningful(outputText);
  const hasTranscript = !!transcript && transcript.trim().length > 0;
  const expandable = hasInput || hasOutput || hasTranscript;

  // Don't echo a preview line for rows that already show their content (images,
  // files) — it would just duplicate the prompt/name above the artifact.
  const showPreview = expandable && !message.imageUrl && !message.fileUrl;
  const preview = showPreview ? argPreview(message.toolArgs) : null;

  const header = (
    <div style={headerRow}>
      <Icon
        icon={Wrench}
        size={14}
        style={{ color: "rgb(var(--subtle))", flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
        <span>{message.content}</span>
        {preview && <span style={previewText}>{preview}</span>}
      </div>
      {expandable && (
        <Icon
          icon={ChevronRight}
          size={14}
          style={{
            color: "rgb(var(--subtle))",
            flexShrink: 0,
            marginTop: 2,
            transition: "transform 0.15s ease",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
      )}
    </div>
  );

  return (
    <div style={box}>
      {expandable ? (
        <button
          type="button"
          data-testid="tool-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={headerButton}
        >
          {header}
        </button>
      ) : (
        header
      )}

      {message.imageUrl && (
        <ChatImage
          url={message.imageUrl}
          alt={message.content}
          onEdit={(change) => onEditImage(message.imageUrl!, change)}
        />
      )}
      {message.fileUrl && (
        <a href={withToken(message.fileUrl)} download={message.fileName} style={fileLink}>
          <Icon icon={FileText} size={14} />
          {message.fileName ?? "Download file"}
        </a>
      )}

      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.div
            key="detail"
            data-testid="tool-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
              {hasInput && <Section title="Input" body={inputText} />}
              {hasOutput && <Section title="Output" body={outputText} />}
              {hasTranscript && <Section title="Terminal" body={transcript!} tall />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({ title, body, tall }: { title: string; body: string; tall?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={sectionLabel}>{title}</span>
      <pre style={tall ? { ...sectionBody, maxHeight: 460 } : sectionBody}>{body}</pre>
    </div>
  );
}

const box: React.CSSProperties = {
  alignSelf: "stretch",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "6px 10px",
  border: "1px solid rgb(var(--border))",
  background: "rgb(var(--surface-sunken))",
  borderRadius: 6,
  color: "rgb(var(--muted))",
  fontFamily: fonts.mono,
  fontSize: 11,
  lineHeight: 1.5,
  wordBreak: "break-word",
};

const headerButton: React.CSSProperties = {
  all: "unset",
  cursor: "pointer",
  display: "block",
  width: "100%",
  boxSizing: "border-box",
};

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
};

const previewText: React.CSSProperties = {
  color: "rgb(var(--subtle))",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const sectionLabel: React.CSSProperties = {
  color: "rgb(var(--subtle))",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontSize: 10,
};

const sectionBody: React.CSSProperties = {
  margin: 0,
  maxHeight: 320,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: "rgb(var(--surface))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 5,
  padding: "7px 9px",
  color: "rgb(var(--fg))",
  fontFamily: fonts.mono,
  fontSize: 11,
  lineHeight: 1.5,
};

const fileLink: React.CSSProperties = {
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
};
