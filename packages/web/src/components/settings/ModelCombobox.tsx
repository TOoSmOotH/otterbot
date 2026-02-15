import { useState, useRef, useEffect } from "react";
import type { ModelOption } from "../../stores/settings-store";

interface ModelComboboxProps {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

export function ModelCombobox({ value, options, onChange, placeholder }: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter((opt) => {
    const q = filter.toLowerCase();
    return (
      opt.modelId.toLowerCase().includes(q) ||
      (opt.label?.toLowerCase().includes(q) ?? false)
    );
  });

  const displayLabel = (opt: ModelOption) =>
    opt.label ? `${opt.label} (${opt.modelId})` : opt.modelId;

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={open ? filter : value}
        onChange={(e) => {
          if (!open) {
            setOpen(true);
            setFilter(e.target.value);
          } else {
            setFilter(e.target.value);
          }
          // Also update the actual value so users can type custom model names
          onChange(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          setFilter("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setFilter("");
            inputRef.current?.blur();
          }
        }}
        placeholder={placeholder ?? "Select or type a model..."}
        className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-[200px] overflow-y-auto bg-popover border border-border rounded-md shadow-lg">
          {filtered.map((opt) => (
            <button
              key={`${opt.source}-${opt.modelId}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(opt.modelId);
                setOpen(false);
                setFilter("");
                inputRef.current?.blur();
              }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-secondary transition-colors flex items-center justify-between ${
                opt.modelId === value ? "bg-secondary/50" : ""
              }`}
            >
              <span className="truncate">
                {opt.label ? (
                  <>
                    <span>{opt.label}</span>
                    <span className="text-muted-foreground ml-1 text-xs">({opt.modelId})</span>
                  </>
                ) : (
                  opt.modelId
                )}
              </span>
              {opt.source === "custom" && (
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground bg-secondary px-1 py-0.5 rounded ml-2 shrink-0">
                  custom
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
