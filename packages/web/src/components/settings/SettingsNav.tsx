import { useState, useRef, useMemo } from "react";
import { cn } from "../../lib/utils";
import { SETTINGS_NAV, type SettingsSection, type ConfigStatus } from "./settings-nav";
import { NavIcon } from "./NavIcon";
import { SettingsSearch, type SettingsSearchHandle } from "./SettingsSearch";
import { useUIModeStore } from "../../stores/ui-mode-store";

const BASIC_SECTIONS = new Set<SettingsSection>([
  "overview", "profile", "appearance", "system", "providers", "models", "workshop", "channels", "github",
]);

interface SettingsNavProps {
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  onBack: () => void;
  statusMap: Record<string, ConfigStatus>;
  searchRef?: React.RefObject<SettingsSearchHandle | null>;
}

export function SettingsNav({ activeSection, onSelect, onBack, statusMap, searchRef }: SettingsNavProps) {
  const isBasic = useUIModeStore((s) => s.mode === "basic");

  const filteredNav = useMemo(() => {
    if (!isBasic) return SETTINGS_NAV;
    return SETTINGS_NAV
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => BASIC_SECTIONS.has(item.id)),
      }))
      .filter((group) => group.items.length > 0);
  }, [isBasic]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of SETTINGS_NAV) {
      initial[group.label] = group.defaultOpen;
    }
    return initial;
  });
  const [searchActive, setSearchActive] = useState(false);

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const handleSearchSelect = (section: SettingsSection) => {
    setSearchActive(false);
    onSelect(section);
  };

  return (
    <nav className="w-60 shrink-0 border-r border-border bg-card flex flex-col h-full">
      {/* Back button */}
      <div className="p-3 border-b border-border space-y-2">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded hover:bg-secondary w-full"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to app
        </button>

        {/* Search */}
        <SettingsSearch
          ref={searchRef}
          onSelect={handleSearchSelect}
          statusMap={statusMap}
          className="px-0"
        />
      </div>

      {/* Overview link */}
      <div className="px-2 pt-2">
        <button
          onClick={() => onSelect("overview")}
          className={cn(
            "w-full text-left px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-2",
            activeSection === "overview"
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary",
          )}
        >
          <NavIcon icon="overview" size={12} />
          <span>Overview</span>
        </button>
      </div>

      {/* Navigation groups */}
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {filteredNav.map((group) => (
          <div key={group.label}>
            <button
              onClick={() => toggleGroup(group.label)}
              className="flex items-center justify-between w-full px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="font-semibold">{group.label}</span>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={cn(
                  "transition-transform",
                  openGroups[group.label] ? "rotate-180" : "",
                )}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {openGroups[group.label] && (
              <div className="space-y-0.5 mb-2">
                {group.items.map((item) => {
                  const status = statusMap[item.id] ?? "none";
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSelect(item.id)}
                      title={item.description}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-2",
                        activeSection === item.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                      )}
                    >
                      <NavIcon icon={item.icon} size={12} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {status !== "none" && status !== "unconfigured" && (
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0",
                            status === "connected" && "bg-green-500",
                            status === "configured" && "bg-blue-500",
                            status === "partial" && "bg-yellow-500",
                          )}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
