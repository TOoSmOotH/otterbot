import { useState, useMemo, useRef, useImperativeHandle, forwardRef } from "react";
import { cn } from "../../lib/utils";
import { SETTINGS_NAV, type SettingsSection, type ConfigStatus } from "./settings-nav";
import { NavIcon } from "./NavIcon";

interface SettingsSearchProps {
  onSelect: (section: SettingsSection) => void;
  statusMap: Record<string, ConfigStatus>;
  className?: string;
}

export interface SettingsSearchHandle {
  focus: () => void;
}

export const SettingsSearch = forwardRef<SettingsSearchHandle, SettingsSearchProps>(
  function SettingsSearch({ onSelect, statusMap, className }, ref) {
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    const results = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return null;
      const matches: Array<{ id: SettingsSection; label: string; description: string; icon: typeof SETTINGS_NAV[0]["items"][0]["icon"] }> = [];
      for (const group of SETTINGS_NAV) {
        for (const item of group.items) {
          const searchable = [item.label, item.description, ...(item.keywords ?? [])].join(" ").toLowerCase();
          if (searchable.includes(q)) {
            matches.push(item);
          }
        }
      }
      return matches;
    }, [query]);

    const handleSelect = (id: SettingsSection) => {
      setQuery("");
      onSelect(id);
    };

    return (
      <div className={cn("relative", className)}>
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings..."
            className="w-full bg-secondary border border-border rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {results && (
          <div className="mt-1 space-y-0.5 max-h-64 overflow-y-auto">
            {results.length === 0 ? (
              <p className="text-[10px] text-muted-foreground px-2 py-2">No matching settings found</p>
            ) : (
              results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <NavIcon icon={item.icon} size={12} />
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-[10px] truncate flex-1">{item.description}</span>
                  {statusMap[item.id] && statusMap[item.id] !== "none" && statusMap[item.id] !== "unconfigured" && (
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        statusMap[item.id] === "connected" && "bg-green-500",
                        statusMap[item.id] === "configured" && "bg-blue-500",
                        statusMap[item.id] === "partial" && "bg-yellow-500",
                      )}
                    />
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  },
);
