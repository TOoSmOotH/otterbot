import { useState, useEffect, useRef, useId } from "react";

let mermaidInitialized = false;

export function MermaidBlock({ code }: { code: string }) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Debounce to avoid expensive renders during streaming
    const timer = setTimeout(async () => {
      try {
        const mermaid = (await import("mermaid")).default;

        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            themeVariables: {
              darkMode: true,
              background: "hsl(0 0% 9%)",
              primaryColor: "hsl(217 92% 60%)",
              primaryTextColor: "hsl(0 0% 93%)",
              primaryBorderColor: "hsl(0 0% 25%)",
              lineColor: "hsl(0 0% 60%)",
              secondaryColor: "hsl(0 0% 15%)",
              tertiaryColor: "hsl(0 0% 12%)",
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            },
          });
          mermaidInitialized = true;
        }

        // Create a unique element id (useId returns colons which mermaid doesn't like)
        const elId = `mermaid-${id.replace(/:/g, "")}`;
        const { svg: rendered } = await mermaid.render(elId, code.trim());
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Mermaid render error");
          setSvg(null);
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs py-3">
        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
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
        Rendering diagram...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-white/5 p-3 overflow-x-auto">
        <p className="text-xs text-destructive mb-1">Diagram error</p>
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex justify-center py-2 overflow-x-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg! }}
    />
  );
}
