import { memo, useState } from "react";
import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Check, Copy } from "lucide-react";
import { Icon } from "../ui/Icon";
import { fonts } from "../../lib/typography";

// Tight block spacing so a message bubble doesn't get a leading/trailing gap.
const block: CSSProperties = { margin: "0 0 8px" };

const heading = (fontSize: number): CSSProperties => ({
  margin: "12px 0 6px",
  fontSize,
  fontWeight: 600,
  lineHeight: 1.35,
});

const codeFont: CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 12,
};

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);

  function copy() {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <pre
      style={{
        position: "relative",
        margin: "0 0 8px",
        padding: "9px 11px",
        borderRadius: 8,
        border: "1px solid rgb(var(--border))",
        background: "rgb(var(--surface-sunken))",
        overflowX: "auto",
        ...codeFont,
        lineHeight: 1.5,
      }}
    >
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          display: "inline-flex",
          alignItems: "center",
          padding: 4,
          borderRadius: 5,
          border: "1px solid rgb(var(--border))",
          background: "rgb(var(--surface))",
          color: "rgb(var(--subtle))",
          cursor: "pointer",
        }}
      >
        <Icon icon={copied ? Check : Copy} size={14} />
      </button>
      {children}
    </pre>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

const components: Components = {
  p: ({ children }) => <p style={block}>{children}</p>,
  h1: ({ children }) => <h1 style={heading(17)}>{children}</h1>,
  h2: ({ children }) => <h2 style={heading(15)}>{children}</h2>,
  h3: ({ children }) => <h3 style={heading(14)}>{children}</h3>,
  h4: ({ children }) => <h4 style={heading(13)}>{children}</h4>,
  h5: ({ children }) => <h5 style={heading(13)}>{children}</h5>,
  h6: ({ children }) => <h6 style={heading(13)}>{children}</h6>,
  ul: ({ children }) => <ul style={{ margin: "0 0 8px", paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: "2px 0" }}>{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "rgb(var(--accent))", textDecoration: "underline" }}
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    // react-markdown gives fenced blocks a `language-*` class and wraps them in
    // <pre>; inline code has neither. Inline code styles itself; block code
    // stays unstyled here and is framed by the <pre> renderer below.
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code className={className} style={codeFont} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        style={{
          ...codeFont,
          fontSize: 11.5,
          padding: "1px 4px",
          borderRadius: 4,
          background: "rgb(var(--surface-sunken))",
          border: "1px solid rgb(var(--border))",
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: "0 0 8px",
        paddingLeft: 10,
        borderLeft: "3px solid rgb(var(--border))",
        color: "rgb(var(--subtle))",
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr style={{ border: "none", borderTop: "1px solid rgb(var(--border))", margin: "12px 0" }} />
  ),
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "0 0 8px" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: "1px solid rgb(var(--border))",
        padding: "4px 8px",
        textAlign: "left",
        fontWeight: 600,
        background: "rgb(var(--surface-sunken))",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ border: "1px solid rgb(var(--border))", padding: "4px 8px" }}>{children}</td>
  ),
  img: ({ src, alt }) => (
    <img src={src} alt={alt} style={{ maxWidth: "100%", borderRadius: 6 }} />
  ),
};

const remarkPlugins = [remarkGfm, remarkBreaks];

function MarkdownImpl({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl, (a, b) => a.content === b.content);
