import { useState, type ComponentPropsWithoutRef } from "react";
import { MermaidBlock } from "./MermaidBlock";

export function CodeBlock({
  children,
  className,
  node: _node,
  ...rest
}: ComponentPropsWithoutRef<"code"> & { node?: unknown }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const isBlock = match !== null;

  // Inline code
  if (!isBlock) {
    return (
      <code
        className="bg-white/10 rounded px-1.5 py-0.5 text-[0.85em] font-mono"
        {...rest}
      >
        {children}
      </code>
    );
  }

  const language = match[1];

  // Mermaid diagrams
  if (language === "mermaid") {
    const code =
      typeof children === "string"
        ? children
        : String(children).replace(/\n$/, "");
    return <MermaidBlock code={code} />;
  }

  // Regular code blocks
  const handleCopy = async () => {
    const text =
      typeof children === "string"
        ? children
        : String(children).replace(/\n$/, "");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      {language && (
        <div className="absolute top-0 left-0 px-2.5 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">
          {language}
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-0 right-0 px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <code className={className} {...rest}>
        {children}
      </code>
    </div>
  );
}
