import { useEffect, useMemo } from "react";
import { useToolsStore } from "../../../stores/tools-store";
import type { ToolExample } from "../../../stores/tools-store";

interface ToolExamplesProps {
  onSelect: (example: ToolExample) => void;
  onClose: () => void;
}

export function ToolExamples({ onSelect, onClose }: ToolExamplesProps) {
  const examples = useToolsStore((s) => s.examples);
  const loadExamples = useToolsStore((s) => s.loadExamples);

  useEffect(() => {
    if (examples.length === 0) loadExamples();
  }, []);

  const grouped = useMemo(() => {
    const groups: Record<string, ToolExample[]> = {};
    for (const ex of examples) {
      if (!groups[ex.category]) groups[ex.category] = [];
      groups[ex.category].push(ex);
    }
    return groups;
  }, [examples]);

  return (
    <div className="border border-border rounded-md bg-secondary/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
          Load Example
        </span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {examples.length === 0 ? (
        <p className="text-xs text-muted-foreground">Loading examples...</p>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              {category}
            </div>
            <div className="space-y-1">
              {items.map((ex) => (
                <button
                  key={ex.name}
                  onClick={() => onSelect(ex)}
                  className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-secondary transition-colors"
                >
                  <div className="text-xs font-mono font-medium">{ex.name}</div>
                  <div className="text-[10px] text-muted-foreground">{ex.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
